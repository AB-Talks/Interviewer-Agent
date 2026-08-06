import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";

const paramsSchema = z.object({ token: z.string().min(1) });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { token } = parsedParams.data;

  try {
    // Fetch interview details joined with job and candidate details
    const res = await sqlQuery(
      `SELECT
        i.id, i.status, i.consent_at, i.started_at, i.expires_at,
        i.student_id_value, i.student_id_verified_at, i.student_id_snapshot_url,
        i.room_scan_url,
        j.title as job_title, j.jd_parsed as job_jd_parsed,
        c.full_name as candidate_name
       FROM interviews i
       JOIN jobs j ON i.job_id = j.id
       JOIN candidates c ON i.candidate_id = c.id
       WHERE i.access_token = $1`,
      [token]
    );

    const interview = res.rows[0];

    if (!interview) {
      return NextResponse.json(
        { error: "Interview session not found or link has expired." },
        { status: 404 }
      );
    }

    // Lazily flip to 'expired' once past expires_at, so candidate-facing pages
    // and the session-mint route see a consistent status.
    if (interview.expires_at && new Date(interview.expires_at) < new Date() && interview.status !== "expired") {
      await sqlQuery("UPDATE interviews SET status = 'expired' WHERE access_token = $1", [token]);
      interview.status = "expired";
    }

    return NextResponse.json({ interview });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
