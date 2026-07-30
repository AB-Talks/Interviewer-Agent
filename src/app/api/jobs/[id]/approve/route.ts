import { NextResponse } from "next/server";
import { sqlQuery } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { questions } = await request.json();

    if (!questions || !Array.isArray(questions)) {
      return NextResponse.json(
        { error: "Missing or invalid questions array" },
        { status: 400 }
      );
    }

    const approvedAt = new Date().toISOString();

    // 1. Update each modified question in Neon
    for (const q of questions) {
      await sqlQuery(
        `UPDATE core_questions 
         SET text = $1, ideal_answer = $2, prep_seconds = $3, answer_seconds = $4, approved_at = $5
         WHERE id = $6`,
        [
          q.text,
          q.ideal_answer,
          q.prep_seconds,
          q.answer_seconds,
          approvedAt,
          q.id
        ]
      );
    }

    // 2. Transition job status to live
    await sqlQuery("UPDATE jobs SET status = 'live' WHERE id = $1", [id]);

    return NextResponse.json({ success: true, approvedAt });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
