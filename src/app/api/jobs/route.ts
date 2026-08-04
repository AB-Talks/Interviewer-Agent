import { NextResponse } from "next/server";
import { parseJD } from "@/lib/agents/jdParser";
import { generateCoreQuestions } from "@/lib/interview/coreQuestions";
import { sqlQuery } from "@/lib/db";

// Mock rubric template
const defaultRubric = {
  dimensions: [
    { key: "relevance", label: "Answers the question asked", weight: 0.3 },
    { key: "depth", label: "Specific and concrete, not generic", weight: 0.3 },
    { key: "correctness", label: "Technically accurate", weight: 0.25 },
    { key: "clarity", label: "Structured and understandable", weight: 0.15 }
  ],
  anchors: {
    "0": "No usable answer, or off-topic",
    "1": "Vague; restates the question without content",
    "2": "Partially relevant; generic examples only",
    "3": "Solid, correct, at least one specific example",
    "4": "Strong; specific, correct, reasons about tradeoffs",
    "5": "Excellent; specific, correct, surfaces a nuance most candidates miss"
  }
};

// GET: List all active jobs from Neon
export async function GET() {
  try {
    const res = await sqlQuery("SELECT * FROM jobs ORDER BY created_at DESC");
    return NextResponse.json({ jobs: res.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Create job, parse JD, and generate core questions in Neon Postgres
export async function POST(request: Request) {
  try {
    const { title, rawJD, seniority } = await request.json();

    if (!title || !rawJD) {
      return NextResponse.json({ error: "Missing title or rawJD" }, { status: 400 });
    }

    // 1. Parse raw Job Description using our adapter
    const parsedJD = await parseJD(rawJD);
    const finalTitle = title || parsedJD.title;

    // 2. Insert new job record into Neon
    const jobRes = await sqlQuery(
      `INSERT INTO jobs (title, jd_raw, jd_parsed, rubric, status, invite_threshold)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        finalTitle,
        rawJD,
        JSON.stringify(parsedJD),
        JSON.stringify(defaultRubric),
        "questions_pending_review",
        60
      ]
    );

    const job = jobRes.rows[0];
    if (!job) {
      return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
    }

    // 3. Draft core questions from the parsed JD's must-have requirements --
    // one genuine, non-templated question per requirement (see coreQuestions.ts).
    const drafts = await generateCoreQuestions(parsedJD);

    // 4. Bulk-insert core questions into Neon database
    let position = 1;
    for (const q of drafts) {
      await sqlQuery(
        `INSERT INTO core_questions (job_id, position, competency, text, ideal_answer, prep_seconds, answer_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [job.id, position++, q.competency, q.text, q.idealAnswer, 45, 120]
      );
    }

    return NextResponse.json({ jobId: job.id, job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
