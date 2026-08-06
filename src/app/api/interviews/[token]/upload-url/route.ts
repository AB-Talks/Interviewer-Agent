import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import type { PutBlobResult } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";

const paramsSchema = z.object({ token: z.string().min(1) });

// POST /api/interviews/[token]/upload-url
// Signed-upload plumbing for the ~3-minute video segments recorded during a
// live interview (interviews/{id}/segment-{n}.webm, pathname chosen by the
// client). Segment metadata itself is recorded via /checkpoint, not here --
// this route only authorizes the blob upload.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { token } = parsedParams.data;

  const interviewRes = await sqlQuery(
    "SELECT id, status, expires_at FROM interviews WHERE access_token = $1",
    [token],
  );
  const interview = interviewRes.rows[0];
  if (!interview) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }
  if (interview.expires_at && new Date(interview.expires_at) < new Date()) {
    return NextResponse.json({ error: "Interview expired" }, { status: 410 });
  }
  if (!["system_check", "in_progress"].includes(interview.status)) {
    return NextResponse.json({ error: "Interview is not active" }, { status: 409 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/webm", "video/mp4", "image/jpeg", "image/png"],
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ interviewId: interview.id }),
      }),
      onUploadCompleted: async ({ blob }: { blob: PutBlobResult; tokenPayload?: string | null }) => {
        console.log("[interview upload] segment uploaded:", blob.url);
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
