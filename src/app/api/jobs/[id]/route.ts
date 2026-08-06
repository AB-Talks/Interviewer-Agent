import { NextResponse } from "next/server";
import { sqlQuery } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Fetch job
    const jobRes = await sqlQuery("SELECT * FROM jobs WHERE id = $1", [id]);
    const job = jobRes.rows[0];

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // 2. Fetch associated core questions
    const questionsRes = await sqlQuery(
      "SELECT * FROM core_questions WHERE job_id = $1 ORDER BY position ASC",
      [id]
    );

    // 3. Fetch candidates interviewed for this job, with match + status --
    // the "eligibility" view for this job (mirrors an admin monitor page).
    const interviewsRes = await sqlQuery(
      `SELECT i.id, i.access_token, i.status, i.core_score, i.integrity_score,
              i.created_at, i.recommendation, i.auto_qualified,
              c.full_name AS candidate_name, c.email AS candidate_email,
              mr.overall_match
       FROM interviews i
       JOIN candidates c ON c.id = i.candidate_id
       LEFT JOIN match_reports mr ON mr.id = i.match_report_id
       WHERE i.job_id = $1
       ORDER BY i.created_at DESC`,
      [id]
    );

    return NextResponse.json({ job, questions: questionsRes.rows, interviews: interviewsRes.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
