import { NextResponse, after } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";
import { evaluateInterview } from "@/lib/interview/evaluate";

export const runtime = "nodejs";

const paramsSchema = z.object({ token: z.string().min(1) });

const transcriptLineSchema = z.object({
  role: z.enum(["ai", "candidate"]),
  text: z.string().max(4000),
  ts: z.number(),
  latencyMs: z.number().optional(),
});

const bodySchema = z.object({
  transcript: z.array(transcriptLineSchema).max(1000),
  durationSeconds: z.number().int().min(0).max(2400),
});

// Salvage floor for accidental drops (crash, connection loss) -- NOT a judgment
// on whether the AI's own early-conclusion decision (PLAN.md §6.3) was valid.
// A candidate who was clearly struggling can legitimately finish well under
// the time ceiling; this just guards against a near-empty submission.
const MIN_DURATION_SECONDS = 5;

// POST /api/interviews/[token]/complete
// Ends the live interview: stores the final transcript/duration, flips status,
// then evaluates in the background via after() so the candidate gets a fast
// redirect to /done. "Store first, evaluate second" -- a failed evaluation
// never loses the transcript, and can be retried (see evaluateInterview).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
  }
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, message: "Invalid body" }, { status: 400 });
  }
  const { token } = parsedParams.data;
  const { transcript, durationSeconds } = parsedBody.data;

  if (durationSeconds < MIN_DURATION_SECONDS) {
    return NextResponse.json(
      { ok: false, message: "Interview too short to submit." },
      { status: 422 },
    );
  }

  const interviewRes = await sqlQuery("SELECT id, status FROM interviews WHERE access_token = $1", [
    token,
  ]);
  const interview = interviewRes.rows[0];
  if (!interview) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }
  if (!["system_check", "in_progress"].includes(interview.status)) {
    return NextResponse.json({ ok: false, message: "Interview already completed." }, { status: 409 });
  }

  await sqlQuery(
    `UPDATE interviews
     SET status = 'submitted', submitted_at = NOW(), video_finalized_at = NOW(),
         transcript = $2::jsonb, duration_seconds = $3
     WHERE id = $1`,
    [interview.id, JSON.stringify(transcript), durationSeconds],
  );

  const interviewId = interview.id as string;
  after(async () => {
    await evaluateInterview(interviewId);
  });

  return NextResponse.json({ ok: true });
}
