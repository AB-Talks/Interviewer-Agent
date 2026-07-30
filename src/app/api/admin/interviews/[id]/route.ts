import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";

const paramsSchema = z.object({ id: z.string().uuid() });

// GET /api/admin/interviews/[id] -- full review payload for the recruiter
// dashboard: interview + job + candidate + match report + every question
// with its scored answer (if evaluated yet) + the proctor event timeline.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
  }
  const { id } = parsedParams.data;

  const interviewRes = await sqlQuery(
    `SELECT i.*, j.title AS job_title, j.rubric AS job_rubric,
            c.full_name AS candidate_name, c.email AS candidate_email,
            mr.overall_match, mr.gaps AS match_gaps, mr.verifiable_claims AS match_verifiable_claims
     FROM interviews i
     JOIN jobs j ON j.id = i.job_id
     JOIN candidates c ON c.id = i.candidate_id
     LEFT JOIN match_reports mr ON mr.id = i.match_report_id
     WHERE i.id = $1`,
    [id],
  );
  const interview = interviewRes.rows[0];
  if (!interview) {
    return NextResponse.json({ ok: false, message: "Interview not found" }, { status: 404 });
  }

  const questionsRes = await sqlQuery(
    `SELECT q.*, a.score, a.subscores, a.corroboration, a.feedback, a.evidence_quotes,
            a.transcript AS answer_transcript, a.scored_at, a.evidence_start_ms, a.evidence_end_ms
     FROM interview_questions q
     LEFT JOIN answers a ON a.interview_question_id = q.id
     WHERE q.interview_id = $1
     ORDER BY q.position ASC`,
    [id],
  );

  const proctorEventsRes = await sqlQuery(
    "SELECT * FROM proctor_events WHERE interview_id = $1 ORDER BY at ASC",
    [id],
  );

  return NextResponse.json({
    ok: true,
    interview,
    questions: questionsRes.rows,
    proctorEvents: proctorEventsRes.rows,
  });
}
