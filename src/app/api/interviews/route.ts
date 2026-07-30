import { NextResponse } from "next/server";
import { sqlQuery } from "@/lib/db";
import { generateAccessToken, getExpirationDate } from "@/lib/interview/token";

// POST /api/interviews: Create new candidate interview session
export async function POST(request: Request) {
  try {
    const { jobId, candidateName, candidateEmail, candidatePhone, matchReportId } = await request.json();

    if (!jobId || !candidateName || !candidateEmail) {
      return NextResponse.json(
        { error: "Missing required fields: jobId, candidateName, candidateEmail" },
        { status: 400 }
      );
    }

    // 1. Ensure the job exists and is live
    const jobRes = await sqlQuery("SELECT id, status FROM jobs WHERE id = $1", [jobId]);
    const job = jobRes.rows[0];

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.status !== "live") {
      return NextResponse.json({ error: "Job is not live yet" }, { status: 400 });
    }

    // 2. Fetch core questions to copy
    const coreQuestionsRes = await sqlQuery(
      "SELECT * FROM core_questions WHERE job_id = $1 ORDER BY position ASC",
      [jobId]
    );
    const coreQuestions = coreQuestionsRes.rows;

    if (coreQuestions.length === 0) {
      return NextResponse.json({ error: "Job has no approved core questions" }, { status: 400 });
    }

    // 3. Upsert or create candidate record
    const candidateRes = await sqlQuery(
      `INSERT INTO candidates (full_name, email, phone)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone
       RETURNING id`,
      [candidateName, candidateEmail, candidatePhone]
    );
    // Note: Candidates table needs a unique index on email for ON CONFLICT to work.
    // If unique constraint is missing, we fall back to a check and insert.
    let candidateId = candidateRes.rows[0]?.id;

    if (!candidateId) {
      // Fallback
      const existRes = await sqlQuery("SELECT id FROM candidates WHERE email = $1", [candidateEmail]);
      if (existRes.rows.length > 0) {
        candidateId = existRes.rows[0].id;
      } else {
        const insertRes = await sqlQuery(
          "INSERT INTO candidates (full_name, email, phone) VALUES ($1, $2, $3) RETURNING id",
          [candidateName, candidateEmail, candidatePhone]
        );
        candidateId = insertRes.rows[0].id;
      }
    }

    // 4. Generate candidate interview token & record
    const accessToken = generateAccessToken();
    const expiresAt = getExpirationDate().toISOString();

    const interviewRes = await sqlQuery(
      `INSERT INTO interviews (candidate_id, job_id, match_report_id, access_token, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [candidateId, jobId, matchReportId || null, accessToken, expiresAt, "invited"]
    );
    const interview = interviewRes.rows[0];

    // 5. Copy Core Questions into interview_questions
    let position = 1;
    for (const cq of coreQuestions) {
      await sqlQuery(
        `INSERT INTO interview_questions (interview_id, position, kind, text, competency, ideal_answer, core_question_id, prep_seconds, answer_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          interview.id,
          position++,
          "core",
          cq.text,
          cq.competency,
          cq.ideal_answer,
          cq.id,
          cq.prep_seconds,
          cq.answer_seconds
        ]
      );
    }

    // 6. Generate up to 2 Probe Questions (Mocked for Phase A. Will use Claude in Phase B)
    // We look up the match report to extract gaps/claims if matchReportId is provided
    let gaps = [];
    let claims = [];

    if (matchReportId) {
      const matchRes = await sqlQuery("SELECT gaps, verifiable_claims FROM match_reports WHERE id = $1", [matchReportId]);
      if (matchRes.rows.length > 0) {
        gaps = matchRes.rows[0].gaps || [];
        claims = matchRes.rows[0].verifiable_claims || [];
      }
    }

    // Generate up to 2 mock probes based on match report findings
    const mockProbes = [];
    if (gaps.length > 0) {
      mockProbes.push({
        text: `I noticed there is a requirement for ${gaps[0].requirementKey || "state management"}. Can you discuss your experience working with this competency, or how you would approach learning it?`,
        competency: gaps[0].requirementKey || "state_management",
        source_ref: { type: "gap", details: gaps[0] }
      });
    }
    if (claims.length > 0 && mockProbes.length < 2) {
      mockProbes.push({
        text: `You mentioned experience in "${claims[0].label || "TypeScript conversion"}". Could you describe the technical design tradeoffs you made during that project?`,
        competency: claims[0].key || "typescript",
        source_ref: { type: "claim", details: claims[0] }
      });
    }

    // Fallback default mock probes if no match report is passed
    if (mockProbes.length === 0) {
      mockProbes.push({
        text: "Could you walk us through a specific experience you had with complex systems design or state management?",
        competency: "system_design",
        source_ref: { type: "generic" }
      });
    }

    // Insert probes
    for (const probe of mockProbes) {
      await sqlQuery(
        `INSERT INTO interview_questions (interview_id, position, kind, text, competency, source_ref, prep_seconds, answer_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          interview.id,
          position++,
          "probe",
          probe.text,
          probe.competency,
          JSON.stringify(probe.source_ref),
          30,
          90
        ]
      );
    }

    return NextResponse.json({
      success: true,
      interviewId: interview.id,
      accessToken,
      expiresAt,
      interview
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
