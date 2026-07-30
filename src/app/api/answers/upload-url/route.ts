import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import type { PutBlobResult } from "@vercel/blob";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string, clientPayload: string | null) => {
        // Authenticate the candidate session using the clientPayload/token
        // In production, you would verify clientPayload.access_token is valid in the DB
        return {
          allowedContentTypes: ["video/mp4", "video/webm"],
          tokenPayload: JSON.stringify({
            // Pass any metadata needed in onUploadCompleted
            candidateSession: clientPayload
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }: { blob: PutBlobResult; tokenPayload?: string | null }) => {
        // This callback runs on Vercel servers after the file is successfully uploaded
        // In Phase 5/7, we will insert the answer row with the video URL (blob.url)
        console.log("Blob upload completed:", blob.url);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    );
  }
}
