import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";
import { askOpenAIVisionJson } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ token: z.string().min(1) });
const bodySchema = z.object({
  studentId: z.string().trim().min(1).max(120),
  url: z.string().url(),
});

type VerificationResult = {
  passed: boolean;
  confidence: number;
  reason: string;
  extractedStudentId?: string | null;
  visibleFace?: boolean;
  visibleIdCard?: boolean;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, message: "Invalid body." }, { status: 400 });
  }

  const { token } = parsedParams.data;
  const { studentId, url } = parsedBody.data;

  const interviewRes = await sqlQuery(
    "SELECT id, status, expires_at, consent_at, student_id_value, student_id_verified_at FROM interviews WHERE access_token = $1",
    [token],
  );
  const interview = interviewRes.rows[0];
  if (!interview) {
    return NextResponse.json({ ok: false, message: "Interview not found." }, { status: 404 });
  }
  if (interview.expires_at && new Date(interview.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, message: "Interview expired." }, { status: 410 });
  }
  if (!interview.consent_at) {
    return NextResponse.json({ ok: false, message: "Consent required before verification." }, { status: 403 });
  }
  if (!["invited", "system_check", "in_progress"].includes(interview.status)) {
    return NextResponse.json(
      { ok: false, message: `Verification is not allowed from status "${interview.status}".` },
      { status: 409 },
    );
  }

  if (
    interview.student_id_verified_at &&
    String(interview.student_id_value ?? "").trim() === studentId
  ) {
    return NextResponse.json({ ok: true, verified: true, interview });
  }

  const verification = await askOpenAIVisionJson<VerificationResult>({
    system:
      "You verify whether a student is standing with their student ID card visible in the image. Return only JSON. Pass only if exactly one person is visible, a student ID card is clearly visible, the card text matches the claimed student ID, and the person holding the card appears to be the same person shown in the frame. If any part is unclear, fail.",
    user: `Claimed student ID: ${studentId}. Evaluate the image for identity verification.`,
    imageUrl: url,
    maxTokens: 700,
  });

  if (!verification.ok) {
    return NextResponse.json({ ok: false, message: verification.message }, { status: 502 });
  }

  const result = verification.data;
  const passed = result.passed && result.confidence >= 0.75;
  if (!passed) {
    return NextResponse.json(
      {
        ok: false,
        message:
          result.reason ||
          "Could not verify the student ID from the photo. Please try again with the ID held clearly beside your face.",
        details: result,
      },
      { status: 422 },
    );
  }

  const updateRes = await sqlQuery(
    `UPDATE interviews
     SET student_id_value = $2,
         student_id_verified_at = NOW(),
         student_id_snapshot_url = $3
     WHERE id = $1
     RETURNING *`,
    [interview.id, studentId, url],
  );

  return NextResponse.json({ ok: true, verified: true, interview: updateRes.rows[0], result });
}