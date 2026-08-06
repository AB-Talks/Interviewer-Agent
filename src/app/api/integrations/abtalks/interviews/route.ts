import { NextResponse } from "next/server";
import { z } from "zod";
import { createInterview } from "@/lib/interview/createInterview";
import { extractTextFromFile } from "@/lib/files/extractText";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const formSchema = z.object({
  jobId: z.string().uuid(),
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
});

// POST /api/integrations/abtalks/interviews
// Cross-app trigger: an ABtalksapp admin, viewing a ready student, creates a
// screening interview against an Interviewer-Agent job. Server-to-server only
// (ABtalksapp's server action holds ABTALKS_INTEGRATION_SECRET, never the
// browser). Same intake chain as the internal admin UI -- see createInterview.ts.
export async function POST(request: Request) {
  const configuredSecret = process.env.ABTALKS_INTEGRATION_SECRET;
  if (!configuredSecret) {
    console.error("[integrations/abtalks] ABTALKS_INTEGRATION_SECRET is not configured");
    return NextResponse.json({ ok: false, message: "Integration is not configured." }, { status: 503 });
  }
  const providedSecret = request.headers.get("x-abtalks-integration-secret");
  if (providedSecret !== configuredSecret) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ ok: false, message: "Expected a resume file upload." }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ ok: false, message: "Invalid form data." }, { status: 400 });
  }

  const parsed = formSchema.safeParse({
    jobId: formData.get("jobId"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const resume = formData.get("resume");
  if (!(resume instanceof File)) {
    return NextResponse.json({ ok: false, message: "Please upload a resume file." }, { status: 400 });
  }

  let resumeText: string;
  try {
    resumeText = await extractTextFromFile(resume);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read the uploaded resume.";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }

  if (!resumeText) {
    return NextResponse.json({ ok: false, message: "The uploaded resume did not contain readable text." }, { status: 400 });
  }

  try {
    const result = await createInterview({
      jobId: parsed.data.jobId,
      candidate: {
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        phone: parsed.data.phone,
      },
      resumeText,
      resumeFilePath: resume.name,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      interviewId: result.interviewId,
      url: `${process.env.INTERVIEWER_AGENT_PUBLIC_URL ?? ""}${result.url}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
