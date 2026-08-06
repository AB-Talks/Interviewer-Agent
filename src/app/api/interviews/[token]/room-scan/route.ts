import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";

const paramsSchema = z.object({ token: z.string().min(1) });
const bodySchema = z.object({ url: z.string().url() });

// POST /api/interviews/[token]/room-scan
// Records the uploaded environment-scan clip URL (candidate panning the
// camera around their surroundings during system-check, before Start
// Interview unlocks -- see /i/[token]/check). Advisory only: this route just
// stores where the clip is, a human reviewer watches it later, nothing here
// inspects or judges the content.
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
  const { url } = parsedBody.data;

  const interviewRes = await sqlQuery(
    "SELECT id, status, expires_at FROM interviews WHERE access_token = $1",
    [token],
  );
  const interview = interviewRes.rows[0];
  if (!interview) {
    return NextResponse.json({ ok: false, message: "Interview not found" }, { status: 404 });
  }
  if (interview.expires_at && new Date(interview.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, message: "Interview expired" }, { status: 410 });
  }
  if (!["system_check", "in_progress"].includes(interview.status)) {
    return NextResponse.json({ ok: false, message: "Interview is not active" }, { status: 409 });
  }

  await sqlQuery("UPDATE interviews SET room_scan_url = $2 WHERE id = $1", [interview.id, url]);

  return NextResponse.json({ ok: true });
}
