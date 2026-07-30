import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  recommendation: z.enum(["advance", "reject"]),
  reviewedBy: z.string().min(1).max(255),
  note: z.string().max(4000).optional(),
});

// POST /api/admin/interviews/[id]/decision
// The one-click advance/reject a human recruiter makes. Logged with who and
// when (PLAN.md §12 audit trail). This route only ever writes `recommendation`
// -- it never touches core_score/integrity_score, and proctoring signals are
// never read here: the decision is the recruiter's, not derived from events.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
  }
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, message: "Invalid body" }, { status: 400 });
  }
  const { id } = parsedParams.data;
  const { recommendation, reviewedBy, note } = parsedBody.data;

  const res = await sqlQuery(
    `UPDATE interviews
     SET recommendation = $2, reviewed_by = $3, reviewed_at = NOW(), review_note = $4
     WHERE id = $1
     RETURNING *`,
    [id, recommendation, reviewedBy, note ?? null],
  );
  if (!res.rows[0]) {
    return NextResponse.json({ ok: false, message: "Interview not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, interview: res.rows[0] });
}
