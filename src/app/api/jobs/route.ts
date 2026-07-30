import { NextResponse } from "next/server";
import { parseJD } from "@/lib/agents/jdParser";
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

    // 3. Generate 4 core questions from parsed JD (mock LLM generation)
    const mockQuestions = parsedJD.mustHave.map((requirement, index) => ({
      position: index + 1,
      competency: requirement.key,
      text: `Can you describe a challenging scenario where you had to leverage your skills in ${requirement.label}? What was the situation, your actions, and the outcome?`,
      ideal_answer: `- Explain the context and why ${requirement.label} was crucial.\n- Outline specific design decisions made.\n- Quantify or qualify the outcome and lessons learned.`,
      prep_seconds: 45,
      answer_seconds: 120
    }));

    // 4. Bulk-insert core questions into Neon database
    for (const q of mockQuestions) {
      await sqlQuery(
        `INSERT INTO core_questions (job_id, position, competency, text, ideal_answer, prep_seconds, answer_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          job.id,
          q.position,
          q.competency,
          q.text,
          q.ideal_answer,
          q.prep_seconds,
          q.answer_seconds
        ]
      );
    }

    return NextResponse.json({ jobId: job.id, job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
