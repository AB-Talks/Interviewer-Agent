import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";
import { buildInterviewInstructions } from "@/lib/interview/instructions";
import type { ParsedJD } from "@/lib/agents/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ token: z.string().min(1) });

type ClientSecretResponse = {
  value?: string;
  expires_at?: number;
  client_secret?: { value?: string; expires_at?: number };
};

// POST /api/interviews/[token]/session
// Mints a short-lived OpenAI Realtime ephemeral client secret so the browser
// can open a WebRTC voice session with the live interviewer. OPENAI_API_KEY
// never reaches the client -- only this ephemeral secret does.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
  }
  const { token } = parsedParams.data;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[interview/session] OPENAI_API_KEY is not configured");
    return NextResponse.json(
      { ok: false, message: "Interview service is not configured yet. Try again shortly." },
      { status: 503 },
    );
  }

  const interviewRes = await sqlQuery("SELECT * FROM interviews WHERE access_token = $1", [
    token,
  ]);
  const interview = interviewRes.rows[0];
  // Same generic message for not-found and expired -- avoids a token-enumeration oracle.
  if (!interview) {
    return NextResponse.json({ ok: false, message: "Interview link not found or expired." }, { status: 404 });
  }

  if (interview.expires_at && new Date(interview.expires_at) < new Date()) {
    if (interview.status !== "expired") {
      await sqlQuery("UPDATE interviews SET status = 'expired' WHERE id = $1", [interview.id]);
    }
    return NextResponse.json({ ok: false, message: "Interview link not found or expired." }, { status: 410 });
  }

  if (!interview.consent_at) {
    return NextResponse.json({ ok: false, message: "Consent required before starting." }, { status: 403 });
  }

  if (!interview.student_id_verified_at) {
    return NextResponse.json({ ok: false, message: "Student ID verification is required before starting." }, { status: 403 });
  }

  if (interview.status !== "system_check" && interview.status !== "in_progress") {
    return NextResponse.json(
      { ok: false, message: `Interview is not startable from status "${interview.status}".` },
      { status: 409 },
    );
  }

  const jobRes = await sqlQuery("SELECT * FROM jobs WHERE id = $1", [interview.job_id]);
  const job = jobRes.rows[0];
  if (!job) {
    return NextResponse.json({ ok: false, message: "Job not found." }, { status: 404 });
  }

  const questionsRes = await sqlQuery(
    "SELECT id, kind, text, competency FROM interview_questions WHERE interview_id = $1 ORDER BY position ASC",
    [interview.id],
  );

  const jdParsed = job.jd_parsed as ParsedJD | null;
  const instructions = buildInterviewInstructions({
    job: { title: job.title, seniority: jdParsed?.seniority ?? null },
    questions: questionsRes.rows.map((q) => ({
      id: q.id,
      kind: q.kind,
      text: q.text,
      competency: q.competency,
    })),
  });

  const safetyIdentifier = createHash("sha256").update(String(interview.id)).digest("hex").slice(0, 64);
  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";

  const sessionBody = {
    session: {
      type: "realtime",
      model,
      instructions,
      audio: {
        output: { voice: "marin" },
        input: { transcription: { model: "gpt-4o-mini-transcribe" } },
      },
    },
  };

  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify(sessionBody),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[interview/session] OpenAI client_secrets failed", res.status, errText.slice(0, 500));
      return NextResponse.json({ ok: false, message: "Failed to start interview session." }, { status: 502 });
    }

    const data = (await res.json()) as ClientSecretResponse;
    const secret = data.client_secret?.value ?? data.value ?? null;
    const expiresAt = data.client_secret?.expires_at ?? data.expires_at ?? null;

    if (!secret) {
      console.error("[interview/session] missing client secret in response");
      return NextResponse.json({ ok: false, message: "Unexpected session response." }, { status: 502 });
    }

    if (!interview.started_at) {
      await sqlQuery(
        "UPDATE interviews SET started_at = NOW(), status = 'in_progress', session_mint_count = session_mint_count + 1 WHERE id = $1",
        [interview.id],
      );
    } else {
      await sqlQuery("UPDATE interviews SET session_mint_count = session_mint_count + 1 WHERE id = $1", [
        interview.id,
      ]);
    }

    return NextResponse.json({ ok: true, data: { clientSecret: secret, expiresAt } });
  } catch (err) {
    console.error("[interview/session] request errored", err);
    return NextResponse.json({ ok: false, message: "Failed to start interview session." }, { status: 500 });
  }
}
