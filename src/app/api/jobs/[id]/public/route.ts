import { NextResponse } from "next/server";
import { sqlQuery } from "@/lib/db";
import type { ParsedJD } from "@/lib/agents/contracts";

// GET /api/jobs/[id]/public
// Candidate-facing job detail for the self-service apply flow (/jobs/[id]/apply).
// Only ever returns role information a candidate is meant to see -- title,
// seniority, responsibilities, and the requirement labels (not weights,
// never jobs.rubric or core_questions.ideal_answer -- CLAUDE.md: the
// interviewer conducts, it does not grade, and candidates never see scoring
// criteria). 404s for anything not live so a candidate can't probe draft jobs.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const jobRes = await sqlQuery(
      "SELECT id, title, status, invite_threshold, jd_parsed, created_at FROM jobs WHERE id = $1",
      [id],
    );
    const job = jobRes.rows[0];
    if (!job || job.status !== "live") {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const parsedJD = job.jd_parsed as ParsedJD | null;

    return NextResponse.json({
      job: {
        id: job.id,
        title: job.title,
        seniority: parsedJD?.seniority ?? null,
        responsibilities: parsedJD?.responsibilities ?? [],
        mustHave: (parsedJD?.mustHave ?? []).map((r) => r.label),
        niceToHave: (parsedJD?.niceToHave ?? []).map((r) => r.label),
        inviteThreshold: Number(job.invite_threshold ?? 60),
        createdAt: job.created_at,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
