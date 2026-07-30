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

    return NextResponse.json({ job, questions: questionsRes.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
