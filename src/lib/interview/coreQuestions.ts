import type { ParsedJD, Requirement } from "@/lib/agents/contracts";
import { askGeminiJson } from "@/lib/gemini";

// Drafts core questions from a parsed JD's must-have requirements. Core
// questions are recruiter-facing drafts requiring human approval before a job
// goes live (PLAN.md) -- this isn't the JD/resume/matcher "existing service"
// boundary CLAUDE.md calls out, it's this app's own content-generation step,
// informed by the same approach as `agent packages/AI-Agents/Interview Agent`
// (one realistic, concise, non-templated question at a time).
// TEMPORARY: Gemini until OPENAI_API_KEY has billing, same as probes.ts.

export interface DraftCoreQuestion {
  competency: string;
  text: string;
  idealAnswer: string;
}

interface GeminiQuestionResponse {
  question?: string;
  idealAnswerNotes?: string;
}

const CORE_QUESTION_SYSTEM_PROMPT = `You write ONE core screening-interview question for a specific job requirement.

This question will be asked near-verbatim to every candidate for this role, so it must be:
- Realistic and professional, the way an experienced human interviewer would actually ask it.
- Specific to the requirement given, not generic or templated.
- Answerable in 60-120 seconds, one clear thing at a time.
- Behavioral or technical as fits the requirement -- pick whichever draws out real signal.

Do not mention "AI", scoring, or that this is being generated. Do not bundle multiple sub-questions.

Return ONLY JSON: {"question":"...","idealAnswerNotes":"<2-3 short bullet points a recruiter would look for in a strong answer, separated by newlines>"}`;

async function draftOneCoreQuestion(
  requirement: Requirement,
  jobTitle: string,
  seniority: string,
): Promise<DraftCoreQuestion | null> {
  const user = `ROLE: ${jobTitle} (${seniority} level)\nREQUIREMENT TO ASSESS: ${requirement.label}`;

  const result = await askGeminiJson<GeminiQuestionResponse>({
    system: CORE_QUESTION_SYSTEM_PROMPT,
    user,
    maxTokens: 400,
  });

  if (!result.ok || !result.data.question) {
    console.error("[coreQuestions] draft failed for", requirement.key, result.ok ? "no question field" : result.message);
    return null;
  }

  return {
    competency: requirement.key,
    text: result.data.question,
    idealAnswer: result.data.idealAnswerNotes || `Look for specific, concrete experience with ${requirement.label}.`,
  };
}

// Sequential, not Promise.all: Gemini's free tier caps at ~5 requests/minute,
// and this runs once at job-creation time so latency doesn't matter -- firing
// all requirements in parallel would blow through that quota immediately.
export async function generateCoreQuestions(parsedJD: ParsedJD): Promise<DraftCoreQuestion[]> {
  const drafts: DraftCoreQuestion[] = [];
  for (const req of parsedJD.mustHave) {
    const draft = await draftOneCoreQuestion(req, parsedJD.title, parsedJD.seniority);
    if (draft) drafts.push(draft);
  }
  return drafts;
}
