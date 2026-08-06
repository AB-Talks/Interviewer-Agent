import { NextResponse } from "next/server";
import { parseJD } from "@/lib/agents/jdParser";
import { generateCoreQuestions } from "@/lib/interview/coreQuestions";
import { sqlQuery } from "@/lib/db";
import { extractTextFromFile } from "@/lib/files/extractText";

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

// GET /api/jobs?status=live -- list jobs, optionally filtered by status.
// Non-sensitive (titles + JD text, no candidate data), so no auth gate --
// used by this app's own admin UI and, with ?status=live, by ABtalksapp to
// populate a job picker when creating a screening interview.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const res = status
      ? await sqlQuery("SELECT * FROM jobs WHERE status = $1 ORDER BY created_at DESC", [status])
      : await sqlQuery("SELECT * FROM jobs ORDER BY created_at DESC");
    return NextResponse.json({ jobs: res.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Create job, parse JD, and generate core questions in Neon Postgres.
// Accepts multipart/form-data so a recruiter can either paste JD text or
// upload a JD file (PDF/DOCX/TXT) -- same extraction path as resume uploads
// (extractTextFromFile). Seniority is never taken from the client: parseJD
// infers it from the JD text itself, so a manually-picked value would just
// silently disagree with what's actually stored in jd_parsed.
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected a multipart form (JD text or file)." }, { status: 400 });
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    }

    const title = (formData.get("title") as string | null)?.trim() ?? "";
    const pastedJD = (formData.get("rawJD") as string | null)?.trim() ?? "";
    const minimumInterviewScoreRaw = formData.get("minimumInterviewScore");
    const minimumInterviewScore =
      typeof minimumInterviewScoreRaw === "string" && minimumInterviewScoreRaw !== ""
        ? Number(minimumInterviewScoreRaw)
        : null;

    const jdFile = formData.get("jdFile");
    let rawJD = pastedJD;
    if (jdFile instanceof File) {
      try {
        rawJD = await extractTextFromFile(jdFile);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not read the uploaded JD file.";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    if (!rawJD) {
      return NextResponse.json({ error: "Paste a job description or upload a JD file." }, { status: 400 });
    }

    // 1. Parse raw Job Description using our adapter
    const parsedJD = await parseJD(rawJD);
    const finalTitle = title || parsedJD.title;

    // 2. Insert new job record into Neon
    const jobRes = await sqlQuery(
      `INSERT INTO jobs (title, jd_raw, jd_parsed, rubric, status, invite_threshold, minimum_interview_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        finalTitle,
        rawJD,
        JSON.stringify(parsedJD),
        JSON.stringify(defaultRubric),
        "questions_pending_review",
        60,
        typeof minimumInterviewScore === "number" ? minimumInterviewScore : null,
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
