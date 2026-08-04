import { askGeminiJson } from "@/lib/gemini";

// Turn-by-turn decision engine for the TEMPORARY text-preview interview mode
// (src/app/api/interviews/[token]/turn/route.ts), used only while
// OPENAI_API_KEY has no billing attached. Same rules as
// lib/interview/instructions.ts (one genuine follow-up max, grounded in the
// specifics of the answer; never a new unscored topic; early conclusion on
// repeated stuck signals) -- decided per-turn here instead of continuously by
// voice. Never receives jobs.rubric or ideal_answer: it conducts, it doesn't
// grade.

export interface TurnQuestion {
  id: string;
  kind: "core" | "probe";
  text: string;
  competency?: string | null;
}

interface DecideFollowUpInput {
  question: TurnQuestion;
  answerText: string;
}

export interface FollowUpDecision {
  candidateStuck: boolean;
  askFollowUp: boolean;
  followUpText: string;
}

const SYSTEM_PROMPT = `You are assisting a screening interview conducted turn-by-turn in text.

You are given ONE question that was just asked and the candidate's answer to it.

Decide two things:
1. "candidateStuck": true if the answer is very short, evasive, off-topic, or the
   candidate effectively says they don't know / can't answer. NOT true just
   because the answer is short but substantive.
2. "askFollowUp": true only if a single genuine follow-up grounded in the
   SPECIFICS of what they said would reveal more -- e.g. probe a vague or
   surprising claim, ask how they'd handle a variant, ask what they'd do
   differently. Never true if candidateStuck is true -- acknowledge and move on
   instead. The follow-up must explore the SAME question further, never a new,
   unscored topic.

Return ONLY JSON: {"candidateStuck":boolean,"askFollowUp":boolean,"followUpText":"<empty string if askFollowUp is false>"}`;

export async function decideFollowUp({
  question,
  answerText,
}: DecideFollowUpInput): Promise<FollowUpDecision> {
  const user = `QUESTION (${question.kind}): ${question.text}\n\nCANDIDATE'S ANSWER:\n"""${answerText || "(no answer given)"}"""`;

  const result = await askGeminiJson<FollowUpDecision>({
    system: SYSTEM_PROMPT,
    user,
    maxTokens: 300,
  });

  if (!result.ok) {
    // Fail safe: don't block the interview on an AI hiccup -- move on as if
    // no follow-up were warranted.
    console.error("[turnDecision] decideFollowUp failed", result.message);
    return { candidateStuck: false, askFollowUp: false, followUpText: "" };
  }
  return result.data;
}
