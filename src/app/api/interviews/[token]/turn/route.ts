import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlQuery } from "@/lib/db";
import { decideFollowUp, type TurnQuestion } from "@/lib/interview/turnDecision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ token: z.string().min(1) });

const stateSchema = z.object({
  questionIndex: z.number().int().min(0),
  followUpCount: z.number().int().min(0),
  stuckCoreCount: z.number().int().min(0),
  coreAnsweredCount: z.number().int().min(0),
});

const bodySchema = z.object({
  state: stateSchema.optional(),
  answerText: z.string().max(8000).optional(),
});

// POST /api/interviews/[token]/turn
// Text-turn conversational interview engine -- a TEMPORARY substitute for the
// live OpenAI Realtime voice call (see /session) while OPENAI_API_KEY has no
// billing attached. Same governing rules as buildInterviewInstructions
// (verbatim core questions in order, one genuine follow-up max, early
// conclusion on repeated stuck signals) but decided one turn at a time via
// Gemini instead of continuously by voice. State is round-tripped through the
// client (this route is otherwise stateless) since it's a short-lived preview
// flow, not the system of record -- the transcript persisted via /checkpoint
// is.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
  }
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, message: "Invalid body" }, { status: 400 });
  }
  const { token } = parsedParams.data;
  const { state, answerText } = parsedBody.data;

  const interviewRes = await sqlQuery("SELECT * FROM interviews WHERE access_token = $1", [token]);
  const interview = interviewRes.rows[0];
  if (!interview) {
    return NextResponse.json({ ok: false, message: "Interview link not found or expired." }, { status: 404 });
  }

  if (interview.expires_at && new Date(interview.expires_at) < new Date()) {
    if (interview.status !== "expired") {
      await sqlQuery("UPDATE interviews SET status = 'expired' WHERE id = $1", [interview.id]);
    }
    return NextResponse.json({ ok: false, message: "Interview link not found or expired." }, { status: 410 });
  }

  if (!interview.consent_at) {
    return NextResponse.json({ ok: false, message: "Consent required before starting." }, { status: 403 });
  }

  if (interview.status !== "system_check" && interview.status !== "in_progress") {
    return NextResponse.json(
      { ok: false, message: `Interview is not startable from status "${interview.status}".` },
      { status: 409 },
    );
  }

  const questionsRes = await sqlQuery(
    "SELECT id, kind, text, competency FROM interview_questions WHERE interview_id = $1 ORDER BY position ASC",
    [interview.id],
  );
  const questions: TurnQuestion[] = questionsRes.rows.map((q) => ({
    id: q.id,
    kind: q.kind,
    text: q.text,
    competency: q.competency,
  }));
  if (questions.length === 0) {
    return NextResponse.json({ ok: false, message: "This interview has no questions configured." }, { status: 409 });
  }
  const coreCount = questions.filter((q) => q.kind === "core").length;

  if (!interview.started_at) {
    await sqlQuery(
      "UPDATE interviews SET started_at = NOW(), status = 'in_progress', session_mint_count = session_mint_count + 1 WHERE id = $1",
      [interview.id],
    );
  }

  // First turn: no state yet -- open with the first core question, verbatim.
  if (!state) {
    const first = questions[0];
    return NextResponse.json({
      ok: true,
      data: {
        aiText: first.text,
        questionId: first.id,
        kind: first.kind,
        ended: false,
        state: { questionIndex: 0, followUpCount: 0, stuckCoreCount: 0, coreAnsweredCount: 0 },
      },
    });
  }

  const current = questions[state.questionIndex];
  if (!current) {
    return NextResponse.json({ ok: false, message: "Invalid turn state." }, { status: 400 });
  }

  const decision = await decideFollowUp({ question: current, answerText: answerText ?? "" });

  // One genuine follow-up max per question, never on a candidate who's stuck.
  if (decision.askFollowUp && !decision.candidateStuck && state.followUpCount < 1) {
    return NextResponse.json({
      ok: true,
      data: {
        aiText: decision.followUpText,
        questionId: current.id,
        kind: current.kind,
        ended: false,
        state: { ...state, followUpCount: state.followUpCount + 1 },
      },
    });
  }

  const coreAnsweredCount = state.coreAnsweredCount + (current.kind === "core" ? 1 : 0);
  const stuckCoreCount = state.stuckCoreCount + (current.kind === "core" && decision.candidateStuck ? 1 : 0);

  // Early conclusion: the candidate has been unable to substantively answer
  // the majority of core questions attempted so far.
  const majorityStuck =
    coreAnsweredCount > 0 &&
    coreAnsweredCount >= Math.ceil(coreCount / 2) &&
    stuckCoreCount > coreCount / 2;

  if (majorityStuck) {
    return NextResponse.json({
      ok: true,
      data: {
        aiText:
          "Thanks for your time today -- that's everything I need for this round. We'll be in touch about next steps.",
        questionId: null,
        kind: null,
        ended: true,
        state: { ...state, coreAnsweredCount, stuckCoreCount },
      },
    });
  }

  const nextIndex = state.questionIndex + 1;
  const next = questions[nextIndex];

  if (!next) {
    return NextResponse.json({
      ok: true,
      data: {
        aiText: "That covers everything -- thank you for your thoughtful answers today. We'll be in touch about next steps.",
        questionId: null,
        kind: null,
        ended: true,
        state: { ...state, coreAnsweredCount, stuckCoreCount, questionIndex: nextIndex },
      },
    });
  }

  return NextResponse.json({
    ok: true,
    data: {
      aiText: next.text,
      questionId: next.id,
      kind: next.kind,
      ended: false,
      state: { questionIndex: nextIndex, followUpCount: 0, stuckCoreCount, coreAnsweredCount },
    },
  });
}
