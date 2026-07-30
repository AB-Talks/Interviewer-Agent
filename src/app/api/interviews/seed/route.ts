import { NextResponse } from "next/server";
import { sqlQuery } from "@/lib/db";

export async function GET() {
  try {
    // 1. Seed a test job if none exists
    let jobRes = await sqlQuery("SELECT id FROM jobs LIMIT 1");
    let jobId = jobRes.rows[0]?.id;

    if (!jobId) {
      const newJob = await sqlQuery(
        `INSERT INTO jobs (title, jd_raw, rubric, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          "React Developer",
          "Requirements: React, TypeScript, Tailwind",
          JSON.stringify({
            dimensions: [
              { key: "relevance", label: "Answers the question asked", weight: 0.3 },
              { key: "depth", label: "Specific and concrete, not generic", weight: 0.3 }
            ]
          }),
          "live"
        ]
      );
      jobId = newJob.rows[0].id;
    }

    // Ensure we have core questions for the job
    const coreQsCheck = await sqlQuery("SELECT id FROM core_questions WHERE job_id = $1", [jobId]);
    if (coreQsCheck.rows.length === 0) {
      const mockQs = [
        "How do you handle state management in a large-scale React application?",
        "Can you describe your experience with TypeScript type systems and decorators?",
        "How do you approach optimizing performance bottlenecks in a Web application?",
        "Tell me about a time you resolved a major production bug under pressure."
      ];
      for (let i = 0; i < mockQs.length; i++) {
        await sqlQuery(
          `INSERT INTO core_questions (job_id, position, text, competency, ideal_answer)
           VALUES ($1, $2, $3, $4, $5)`,
          [jobId, i + 1, mockQs[i], "technical", "Detailed experience explanation"]
        );
      }
    }

    // 2. Seed a test candidate
    const candidateRes = await sqlQuery(
      `INSERT INTO candidates (full_name, email)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      ["John Doe", "john.doe@example.com"]
    );
    const candidateId = candidateRes.rows[0].id;

    // 3. Delete existing test-token interview to avoid duplicates
    await sqlQuery("DELETE FROM interviews WHERE access_token = $1", ["test-token"]);

    // 4. Create interview with test-token
    const interviewRes = await sqlQuery(
      `INSERT INTO interviews (candidate_id, job_id, access_token, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [candidateId, jobId, "test-token", "invited"]
    );
    const interview = interviewRes.rows[0];

    // 5. Populate interview_questions with core questions
    const coreQuestionsRes = await sqlQuery(
      "SELECT * FROM core_questions WHERE job_id = $1 ORDER BY position ASC",
      [jobId]
    );
    
    let position = 1;
    for (const cq of coreQuestionsRes.rows) {
      await sqlQuery(
        `INSERT INTO interview_questions (interview_id, position, kind, text, competency, ideal_answer, core_question_id, prep_seconds, answer_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [interview.id, position++, "core", cq.text, cq.competency, cq.ideal_answer, cq.id, 30, 120]
      );
    }

    // Add 2 mock probe questions
    const mockProbes = [
      "Can you expand on your experience with Tailwind layout systems?",
      "How do you configure dynamic routing in Next.js?"
    ];
    for (const probeText of mockProbes) {
      await sqlQuery(
        `INSERT INTO interview_questions (interview_id, position, kind, text, competency, prep_seconds, answer_seconds)
         VALUES ($1, $2, $3, $4, $5, 30, 90)`,
        [interview.id, position++, "probe", probeText, "frameworks", 30, 90]
      );
    }

    return NextResponse.json({
      success: true,
      token: "test-token",
      interview: interview,
      questionsCount: position - 1
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
