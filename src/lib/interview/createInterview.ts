import { sqlQuery } from "@/lib/db";
import { parseResume } from "@/lib/agents/resumeParser";
import { matchCandidate } from "@/lib/agents/readinessMatcher";
import { redactForGeneration } from "@/lib/agents/redact";
import { generateProbeQuestions } from "@/lib/interview/probes";
import { generateAccessToken, getExpirationDate } from "@/lib/interview/token";
import type { ParsedJD } from "@/lib/agents/contracts";

export interface CreateInterviewInput {
  jobId: string;
  candidate: { fullName: string; email: string; phone?: string };
  resumeText: string;
  resumeFilePath?: string;
}

export type CreateInterviewResult =
  | { ok: true; interviewId: string; token: string; url: string }
  | { ok: false; status: number; message: string; overallMatch?: number };

// Intake chain per PLAN.md §3.1: resume -> parse -> match -> (gate on invite
// threshold) -> redact -> generate probes -> copy approved core questions in
// -> mint token. This is the one code path allowed to touch resumeParser /
// readinessMatcher / redactForGeneration directly -- everything downstream
// only ever sees interview_questions (already redacted/generated), never the
// raw resume or match report again (CLAUDE.md: resume data is for question
// generation only). Shared by /api/interviews/create (internal admin UI) and
// /api/integrations/abtalks/interviews (cross-app, secret-gated).
export async function createInterview(input: CreateInterviewInput): Promise<CreateInterviewResult> {
  const { jobId, candidate, resumeText, resumeFilePath } = input;

  const jobRes = await sqlQuery("SELECT * FROM jobs WHERE id = $1", [jobId]);
  const job = jobRes.rows[0];
  if (!job) {
    return { ok: false, status: 404, message: "Job not found" };
  }
  if (job.status !== "live") {
    return { ok: false, status: 409, message: "Job is not live yet — core questions must be approved first." };
  }

  const coreQuestionsRes = await sqlQuery(
    "SELECT * FROM core_questions WHERE job_id = $1 AND approved_at IS NOT NULL ORDER BY position ASC",
    [jobId],
  );
  if (coreQuestionsRes.rows.length === 0) {
    return { ok: false, status: 409, message: "Job has no approved core questions." };
  }

  const candidateRes = await sqlQuery(
    `INSERT INTO candidates (full_name, email, phone) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone
     RETURNING *`,
    [candidate.fullName, candidate.email, candidate.phone ?? null],
  );
  const candidateRow = candidateRes.rows[0];

  const parsedResume = await parseResume(resumeText);
  const resumeRes = await sqlQuery(
    `INSERT INTO resumes (candidate_id, file_path, parsed, parser_version)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [candidateRow.id, resumeFilePath ?? "pasted-text", JSON.stringify(parsedResume), "gemini-v1"],
  );
  const resumeRow = resumeRes.rows[0];

  const parsedJD = job.jd_parsed as ParsedJD;
  const matchReport = await matchCandidate(parsedResume, parsedJD);

  const inviteThreshold = Number(job.invite_threshold ?? 60);
  if (matchReport.overallMatch < inviteThreshold) {
    return {
      ok: false,
      status: 422,
      message: `Candidate match (${matchReport.overallMatch}%) is below the invite threshold (${inviteThreshold}%).`,
      overallMatch: matchReport.overallMatch,
    };
  }

  const matchReportRes = await sqlQuery(
    `INSERT INTO match_reports (candidate_id, job_id, resume_id, overall_match, dimension_scores, gaps, verifiable_claims, matcher_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      candidateRow.id,
      jobId,
      resumeRow.id,
      matchReport.overallMatch,
      JSON.stringify(matchReport.dimensionScores),
      JSON.stringify(matchReport.gaps),
      JSON.stringify(matchReport.verifiableClaims),
      "deterministic-v1",
    ],
  );
  const matchReportRow = matchReportRes.rows[0];

  const generationProfile = redactForGeneration(parsedResume);
  const probes = await generateProbeQuestions(matchReport.gaps, matchReport.verifiableClaims, generationProfile);

  const accessToken = generateAccessToken();
  const expiresAt = getExpirationDate();

  const interviewRes = await sqlQuery(
    `INSERT INTO interviews (candidate_id, job_id, match_report_id, access_token, status, expires_at)
     VALUES ($1, $2, $3, $4, 'invited', $5) RETURNING *`,
    [candidateRow.id, jobId, matchReportRow.id, accessToken, expiresAt.toISOString()],
  );
  const interview = interviewRes.rows[0];

  let position = 1;
  for (const cq of coreQuestionsRes.rows) {
    await sqlQuery(
      `INSERT INTO interview_questions (interview_id, position, kind, text, competency, ideal_answer, core_question_id, prep_seconds, answer_seconds)
       VALUES ($1, $2, 'core', $3, $4, $5, $6, $7, $8)`,
      [interview.id, position++, cq.text, cq.competency, cq.ideal_answer, cq.id, cq.prep_seconds, cq.answer_seconds],
    );
  }
  for (const probe of probes) {
    await sqlQuery(
      `INSERT INTO interview_questions (interview_id, position, kind, text, source_ref)
       VALUES ($1, $2, 'probe', $3, $4)`,
      [interview.id, position++, probe.text, JSON.stringify({ ...probe.sourceRef, rationale: probe.rationale })],
    );
  }

  return { ok: true, interviewId: interview.id, token: accessToken, url: `/i/${accessToken}` };
}
