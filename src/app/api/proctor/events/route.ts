import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";

const eventSchema = z.object({
  type: z.string().min(1).max(100),
  severity: z.number().int().min(0).max(3),
  meta: z.record(z.unknown()).optional(),
  at: z.number(),
  offsetMs: z.number().optional(),
});

const bodySchema = z.object({
  token: z.string().min(1),
  events: z.array(eventSchema).min(1).max(50),
});

// POST /api/proctor/events -- batched event ingest (PLAN.md §10). Advisory
// only: this route never touches interviews.status/recommendation.
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
  }
  const { token, events } = parsed.data;

  const interviewRes = await sqlQuery(
    "SELECT id, expires_at FROM interviews WHERE access_token = $1",
    [token],
  );
  const interview = interviewRes.rows[0];
  if (!interview) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }
  if (interview.expires_at && new Date(interview.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, message: "Expired" }, { status: 410 });
  }

  for (const e of events) {
    await sqlQuery(
      `INSERT INTO proctor_events (interview_id, type, severity, at, offset_ms, meta)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6)`,
      [interview.id, e.type, e.severity, e.at, e.offsetMs ?? null, e.meta ? JSON.stringify(e.meta) : null],
    );
  }

  return NextResponse.json({ ok: true });
}
