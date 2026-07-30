import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";
import { parseResume } from "@/lib/agents/resumeParser";
import { matchCandidate } from "@/lib/agents/readinessMatcher";
import { redactForGeneration } from "@/lib/agents/redact";
import { generateProbeQuestions } from "@/lib/interview/probes";
import { generateAccessToken, getExpirationDate } from "@/lib/interview/token";
import type { ParsedJD } from "@/lib/agents/contracts";

const bodySchema = z.object({
  jobId: z.string().uuid(),
  candidate: z.object({
    fullName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
  }),
  resumeFilePath: z.string().min(1),
});

// POST /api/interviews/create
// Intake chain per PLAN.md §3.1: resume -> parse -> match -> (gate on invite
// threshold) -> redact -> generate probes -> copy approved core questions in
// -> mint token. This is the one route allowed to touch resumeParser /
// readinessMatcher / redactForGeneration directly -- everything downstream
// only ever sees interview_questions (already redacted/generated), never the
// raw resume or match report again (CLAUDE.md: resume data is for question
// generation only).
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, message: "Invalid request", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { jobId, candidate, resumeFilePath } = parsed.data;

    const jobRes = await sqlQuery("SELECT * FROM jobs WHERE id = $1", [jobId]);
    const job = jobRes.rows[0];
    if (!job) {
      return NextResponse.json({ ok: false, message: "Job not found" }, { status: 404 });
    }
    if (job.status !== "live") {
      return NextResponse.json(
        { ok: false, message: "Job is not live yet — core questions must be approved first." },
        { status: 409 },
      );
    }

    const coreQuestionsRes = await sqlQuery(
      "SELECT * FROM core_questions WHERE job_id = $1 AND approved_at IS NOT NULL ORDER BY position ASC",
      [jobId],
    );
    if (coreQuestionsRes.rows.length === 0) {
      return NextResponse.json(
        { ok: false, message: "Job has no approved core questions." },
        { status: 409 },
      );
    }

    const candidateRes = await sqlQuery(
      `INSERT INTO candidates (full_name, email, phone) VALUES ($1, $2, $3) RETURNING *`,
      [candidate.fullName, candidate.email, candidate.phone ?? null],
    );
    const candidateRow = candidateRes.rows[0];

    const parsedResume = await parseResume(resumeFilePath);
    const resumeRes = await sqlQuery(
      `INSERT INTO resumes (candidate_id, file_path, parsed, parser_version)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [candidateRow.id, resumeFilePath, JSON.stringify(parsedResume), "adapter-mock-v1"],
    );
    const resumeRow = resumeRes.rows[0];

    const parsedJD = job.jd_parsed as ParsedJD;
    const matchReport = await matchCandidate(parsedResume, parsedJD);

    const inviteThreshold = Number(job.invite_threshold ?? 60);
    if (matchReport.overallMatch < inviteThreshold) {
      return NextResponse.json(
        {
          ok: false,
          message: `Candidate match (${matchReport.overallMatch}%) is below the invite threshold (${inviteThreshold}%).`,
        },
        { status: 422 },
      );
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
        "adapter-mock-v1",
      ],
    );
    const matchReportRow = matchReportRes.rows[0];

    const generationProfile = redactForGeneration(parsedResume);
    const probes = await generateProbeQuestions(
      matchReport.gaps,
      matchReport.verifiableClaims,
      generationProfile,
    );

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
        [
          interview.id,
          position++,
          cq.text,
          cq.competency,
          cq.ideal_answer,
          cq.id,
          cq.prep_seconds,
          cq.answer_seconds,
        ],
      );
    }
    for (const probe of probes) {
      await sqlQuery(
        `INSERT INTO interview_questions (interview_id, position, kind, text, source_ref)
         VALUES ($1, $2, 'probe', $3, $4)`,
        [interview.id, position++, probe.text, JSON.stringify({ ...probe.sourceRef, rationale: probe.rationale })],
      );
    }

    return NextResponse.json({
      ok: true,
      interviewId: interview.id,
      token: accessToken,
      url: `/i/${accessToken}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
