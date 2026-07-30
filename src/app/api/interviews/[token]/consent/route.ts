import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";

const paramsSchema = z.object({ token: z.string().min(1) });

// Never call getUserMedia before interviews.consent_at is set (CLAUDE.md) --
// this route is what stamps it. It must run, and succeed, before any
// candidate-facing page acquires the camera/mic.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { token } = parsedParams.data;

  try {
    const existingRes = await sqlQuery(
      "SELECT status, expires_at, consent_at FROM interviews WHERE access_token = $1",
      [token],
    );
    const existing = existingRes.rows[0];

    if (!existing) {
      return NextResponse.json(
        { error: "Interview session not found or invalid token." },
        { status: 404 },
      );
    }
    if (existing.expires_at && new Date(existing.expires_at) < new Date()) {
      return NextResponse.json({ error: "Interview link has expired." }, { status: 410 });
    }
    if (!["invited", "system_check"].includes(existing.status)) {
      return NextResponse.json(
        { error: `Cannot consent from status "${existing.status}".` },
        { status: 409 },
      );
    }

    // Idempotent: consenting again doesn't reset an already-stamped consent_at.
    const res = await sqlQuery(
      `UPDATE interviews
       SET consent_at = COALESCE(consent_at, NOW()),
           status = CASE WHEN status = 'invited' THEN 'system_check' ELSE status END
       WHERE access_token = $1
       RETURNING *`,
      [token]
    );

    return NextResponse.json({ success: true, interview: res.rows[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
