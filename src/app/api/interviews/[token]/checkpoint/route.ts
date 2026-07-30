import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";

const paramsSchema = z.object({ token: z.string().min(1) });

const transcriptLineSchema = z.object({
  role: z.enum(["ai", "candidate"]),
  text: z.string().max(4000),
  ts: z.number(),
  latencyMs: z.number().optional(),
});

const segmentSchema = z.object({
  seq: z.number().int().nonnegative(),
  url: z.string().url(),
  startedAtMs: z.number(),
  endedAtMs: z.number(),
  bytes: z.number().optional(),
});

const bodySchema = z.object({
  segment: segmentSchema.optional(),
  transcript: z.array(transcriptLineSchema).max(1000).optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
});

// POST /api/interviews/[token]/checkpoint
// Periodic safety write during a live interview: a finished ~3-min video
// segment, and/or the transcript-so-far, and/or elapsed duration. Called
// repeatedly through the call so a crash never loses more than one
// checkpoint's worth of progress.
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
  const { segment, transcript, durationSeconds } = parsedBody.data;

  const interviewRes = await sqlQuery("SELECT id, status FROM interviews WHERE access_token = $1", [
    token,
  ]);
  const interview = interviewRes.rows[0];
  if (!interview) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }
  if (!["system_check", "in_progress"].includes(interview.status)) {
    return NextResponse.json({ ok: false, message: "Interview is not active" }, { status: 409 });
  }

  if (segment) {
    await sqlQuery(
      "UPDATE interviews SET video_segments = video_segments || $2::jsonb WHERE id = $1",
      [interview.id, JSON.stringify([segment])],
    );
  }
  if (transcript) {
    await sqlQuery("UPDATE interviews SET transcript = $2::jsonb WHERE id = $1", [
      interview.id,
      JSON.stringify(transcript),
    ]);
  }
  if (typeof durationSeconds === "number") {
    await sqlQuery("UPDATE interviews SET duration_seconds = $2 WHERE id = $1", [
      interview.id,
      durationSeconds,
    ]);
  }

  return NextResponse.json({ ok: true });
}
