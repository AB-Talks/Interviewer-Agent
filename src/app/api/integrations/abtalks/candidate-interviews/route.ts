import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ email: z.string().email() });

// GET /api/integrations/abtalks/candidate-interviews?email=...
// Cross-app read for ABtalksapp's student dashboard: "do I have a screening
// interview scheduled?" Called server-to-server only (ABtalksapp's server
// component/action holds ABTALKS_INTEGRATION_SECRET, never the browser).
// Never returns scores/transcript/evidence -- candidates never see evaluation
// results (same rule as /i/[token]/done), only status + where to go next.
export async function GET(request: Request) {
  const configuredSecret = process.env.ABTALKS_INTEGRATION_SECRET;
  if (!configuredSecret) {
    console.error("[integrations/abtalks] ABTALKS_INTEGRATION_SECRET is not configured");
    return NextResponse.json({ ok: false, message: "Integration is not configured." }, { status: 503 });
  }
  const providedSecret = request.headers.get("x-abtalks-integration-secret");
  if (providedSecret !== configuredSecret) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ email: searchParams.get("email") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
  }
  const { email } = parsed.data;

  const res = await sqlQuery(
    `SELECT i.access_token, i.status, i.created_at, i.expires_at,
            j.title AS job_title
     FROM interviews i
     JOIN candidates c ON c.id = i.candidate_id
     JOIN jobs j ON j.id = i.job_id
     WHERE c.email = $1
     ORDER BY i.created_at DESC`,
    [email],
  );

  const interviews = res.rows.map((row) => ({
    jobTitle: row.job_title,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    // Candidate-facing link -- the only thing ABtalksapp needs to surface;
    // Interviewer-Agent stays the source of truth for the flow itself.
    url: `${process.env.INTERVIEWER_AGENT_PUBLIC_URL ?? ""}/i/${row.access_token}`,
  }));

  return NextResponse.json({ ok: true, interviews });
}
