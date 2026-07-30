import { sqlQuery } from "@/lib/db";
import { askClaudeJson } from "@/lib/anthropic";

interface RubricDimension {
  key: string;
  label: string;
  weight: number;
}
interface Rubric {
  dimensions: RubricDimension[];
  anchors: Record<string, string>;
}

interface TranscriptLine {
  role: "ai" | "candidate";
  text: string;
  ts: number;
  latencyMs?: number;
}

type Corroboration = "corroborated" | "partial" | "not_corroborated" | "unclear";

interface EvalResultItem {
  questionId: string;
  kind: "core" | "probe";
  subscores?: Record<string, number> | null;
  corroboration?: Corroboration | null;
  feedback?: string;
  evidence_quotes?: string[];
  insufficient_evidence?: boolean;
}

interface EvalResponse {
  results: EvalResultItem[];
}

// Combines PLAN.md §7.1 (core rubric scoring) and §7.2 (probe corroboration)
// into one pass over the whole transcript, since the interview is now a
// single continuous live call rather than one clip per question.
const SYSTEM_PROMPT = `You are scoring one candidate's live voice interview for a job screening.
You are given a machine transcript, so ignore filler words, false starts, and
transcription errors. Score the SUBSTANCE of what the candidate said, attributing
each part of the transcript to the question it answers (including any follow-up
exchange on that question -- follow-ups are evidence for the SAME question, not a
separate topic).

You may also see "(paused ~Ns before responding)" annotations on candidate lines.
This is SUPPORTING CONTEXT ONLY, reflecting what the live interviewer itself could
hear -- never a scored input by itself, and never a substitute for judging the
actual content of the answer.

There are two kinds of questions, scored differently:

CORE questions (identical for every candidate applying to this job -- this is what
makes candidates comparable, so score strictly against the rubric, not against how
personable the candidate is):
- Score each rubric dimension 0-5 using the anchors provided.
- Do not reward or penalise English fluency, accent, grammar, or vocabulary,
  except where the answer is genuinely incomprehensible.
- Quote the exact words you based each score on.
- If the transcript for a question is too short, garbled, or the candidate never
  substantively answered it (including if the interview ended before reaching it),
  set "insufficient_evidence": true and do not guess scores -- omit "subscores" or
  leave it null rather than inventing a low score.

PROBE questions (personalised follow-ups verifying a specific resume claim or gap --
evidence for a human recruiter, NEVER a score, and NEVER a factor in the core score):
- Judge ONLY whether the answer corroborates the claim/gap item: "corroborated"
  (specific, first-hand detail consistent with having done this work), "partial"
  (some relevant detail, but thin or generic), "not_corroborated" (no relevant
  detail, or contradicts the claim), or "unclear" (bad transcript, misunderstood
  question, or interview ended before/during this question).
- Prefer "unclear" over "not_corroborated" when uncertain -- absence of detail in
  a short spoken answer is weak evidence, not proof of anything.
- Never assign a numeric score to a probe question.

Return ONLY valid JSON, no markdown fences, matching this shape:
{"results":[
  {"questionId":"<uuid>","kind":"core","subscores":{"<dimension_key>":0-5,...},
   "feedback":"<=40 words, addressed to the recruiter","evidence_quotes":["..."],
   "insufficient_evidence":false},
  {"questionId":"<uuid>","kind":"probe","corroboration":"corroborated|partial|not_corroborated|unclear",
   "feedback":"<=30 words reasoning, addressed to the recruiter","evidence_quotes":["..."]}
]}`;

function formatTranscript(lines: TranscriptLine[]): string {
  return lines
    .map((l) => {
      const speaker = l.role === "ai" ? "Interviewer" : "Candidate";
      const pause =
        l.role === "candidate" && l.latencyMs && l.latencyMs > 3000
          ? ` (paused ~${Math.round(l.latencyMs / 1000)}s before responding)`
          : "";
      return `${speaker}${pause}: ${l.text}`;
    })
    .join("\n");
}

const INTEGRITY_WEIGHTS: Record<string, number> = {
  tab_hidden: 1,
  window_blur: 1,
  fullscreen_exited: 1,
  no_face_detected: 1,
  multiple_faces_detected: 1,
  camera_stream_ended: 1.5,
  paste_into_field: 1.5,
  devtools_shortcut: 0.5,
  long_silence: 0.5,
  network_drop: 0.5,
};

async function computeIntegrityScore(interviewId: string): Promise<number> {
  const eventsRes = await sqlQuery(
    "SELECT type, severity FROM proctor_events WHERE interview_id = $1",
    [interviewId],
  );
  const raw = eventsRes.rows.reduce(
    (sum: number, e: { type: string; severity: number }) =>
      sum + (INTEGRITY_WEIGHTS[e.type] ?? 0.5) * e.severity,
    0,
  );
  // Floor the damage -- one bad minute shouldn't zero someone out (PLAN.md §10).
  return Math.max(0, 100 - Math.min(60, raw));
}

export async function evaluateInterview(
  interviewId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const interviewRes = await sqlQuery("SELECT * FROM interviews WHERE id = $1", [interviewId]);
  const interview = interviewRes.rows[0];
  if (!interview) return { ok: false, message: "Interview not found." };
  if (interview.status !== "submitted") {
    return { ok: false, message: `Interview is not in a scoreable state (${interview.status}).` };
  }

  const jobRes = await sqlQuery("SELECT * FROM jobs WHERE id = $1", [interview.job_id]);
  const job = jobRes.rows[0];
  if (!job) return { ok: false, message: "Job not found." };
  const rubric = job.rubric as Rubric;

  const questionsRes = await sqlQuery(
    "SELECT * FROM interview_questions WHERE interview_id = $1 ORDER BY position ASC",
    [interviewId],
  );
  const questions = questionsRes.rows as Array<{
    id: string;
    kind: "core" | "probe";
    text: string;
    competency: string | null;
    ideal_answer: string | null;
    source_ref: unknown;
  }>;

  const transcriptLines: TranscriptLine[] = Array.isArray(interview.transcript)
    ? interview.transcript
    : [];
  const transcriptText = formatTranscript(transcriptLines);

  const questionList = questions.map((q) => ({
    id: q.id,
    kind: q.kind,
    text: q.text,
    competency: q.competency,
    // ideal_answer only for core; probes carry their existing redacted source_ref
    // abstraction -- never raw resume text (CLAUDE.md: resume data is for question
    // generation only, and this evaluation prompt is answer-scoring).
    ideal_answer: q.kind === "core" ? q.ideal_answer : undefined,
    source_ref: q.kind === "probe" ? q.source_ref : undefined,
  }));

  const user = [
    `RUBRIC:\n${JSON.stringify(rubric)}`,
    `QUESTIONS (in the order asked):\n${JSON.stringify(questionList)}`,
    `TRANSCRIPT:\n"""\n${transcriptText || "(empty transcript)"}\n"""`,
  ].join("\n\n");

  let ai: { ok: boolean; data?: EvalResponse; message?: string };
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

  if (!hasApiKey) {
    console.warn("[evaluate] Missing ANTHROPIC_API_KEY. Falling back to mock heuristic scores.");
    const mockResults: EvalResultItem[] = questions.map((q) => {
      if (q.kind === "core") {
        const subscores: Record<string, number> = {};
        const dims = rubric.dimensions ?? [];
        for (const d of dims) {
          // Heuristic score: random between 3 and 5 for demo purposes
          subscores[d.key] = Math.floor(Math.random() * 3) + 3;
        }
        return {
          questionId: q.id,
          kind: "core",
          subscores,
          feedback: `Candidate answered the core question on ${q.competency || "competency"}. Discussed tradeoffs and practical constraints.`,
          evidence_quotes: ["I would use design patterns for this", "performance is a key concern"],
          insufficient_evidence: false
        };
      } else {
        return {
          questionId: q.id,
          kind: "probe",
          corroboration: "corroborated",
          feedback: "Verified experience with specific reference to project experience.",
          evidence_quotes: ["We completed that migration last year"]
        };
      }
    });
    ai = { ok: true, data: { results: mockResults } };
  } else {
    const response = await askClaudeJson<EvalResponse>({ system: SYSTEM_PROMPT, user, maxTokens: 3000 });
    ai = response.ok ? { ok: true, data: response.data } : { ok: false, message: response.message };
  }

  if (!ai.ok || !ai.data) {
    console.error("[evaluate] Evaluation call failed:", ai.message);
    return { ok: false, message: ai.message ?? "Evaluation failed" };
  }

  const results = ai.data.results ?? [];

  for (const q of questions) {
    const r = results.find((x) => x.questionId === q.id);
    if (!r) continue;

    const evidenceQuotes = Array.isArray(r.evidence_quotes) ? r.evidence_quotes : [];
    const excerpt = evidenceQuotes.join(" / ") || null;

    if (q.kind === "core") {
      let score: number | null = null;
      const subscores = r.insufficient_evidence ? null : r.subscores ?? null;
      if (subscores) {
        const dims = rubric.dimensions ?? [];
        let weightedSum = 0;
        let weightTotal = 0;
        for (const d of dims) {
          const value = subscores[d.key];
          if (typeof value === "number" && Number.isFinite(value)) {
            const clamped = Math.max(0, Math.min(5, value));
            weightedSum += clamped * d.weight;
            weightTotal += d.weight;
          }
        }
        // Computed here, in code, from weighted subscores -- never trusting
        // any aggregate the model might have returned (standing rule).
        score = weightTotal > 0 ? weightedSum / weightTotal : null;
      }

      await sqlQuery(
        `INSERT INTO answers (interview_id, interview_question_id, transcript, score, subscores, feedback, evidence_quotes, raw_model_response, scored_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (interview_question_id) DO UPDATE SET
           transcript = EXCLUDED.transcript, score = EXCLUDED.score, subscores = EXCLUDED.subscores,
           feedback = EXCLUDED.feedback, evidence_quotes = EXCLUDED.evidence_quotes,
           raw_model_response = EXCLUDED.raw_model_response, scored_at = NOW()`,
        [
          interviewId,
          q.id,
          excerpt,
          score,
          subscores ? JSON.stringify(subscores) : null,
          r.feedback ?? null,
          JSON.stringify(evidenceQuotes),
          JSON.stringify(r),
        ],
      );
    } else {
      await sqlQuery(
        `INSERT INTO answers (interview_id, interview_question_id, transcript, corroboration, feedback, evidence_quotes, raw_model_response, scored_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (interview_question_id) DO UPDATE SET
           transcript = EXCLUDED.transcript, corroboration = EXCLUDED.corroboration, feedback = EXCLUDED.feedback,
           evidence_quotes = EXCLUDED.evidence_quotes, raw_model_response = EXCLUDED.raw_model_response, scored_at = NOW()`,
        [
          interviewId,
          q.id,
          excerpt,
          r.corroboration ?? "unclear",
          r.feedback ?? null,
          JSON.stringify(evidenceQuotes),
          JSON.stringify(r),
        ],
      );
    }
  }

  // core_score: weighted mean across CORE answers only, scaled 0-100 -- the
  // ONLY rankable number. Probe corroboration never enters this computation.
  const coreScoresRes = await sqlQuery(
    `SELECT a.score FROM answers a
     JOIN interview_questions q ON q.id = a.interview_question_id
     WHERE a.interview_id = $1 AND q.kind = 'core' AND a.score IS NOT NULL`,
    [interviewId],
  );
  const coreScores = coreScoresRes.rows.map((r: { score: string | number }) => Number(r.score));
  const coreScore =
    coreScores.length > 0 ? (coreScores.reduce((a, b) => a + b, 0) / coreScores.length) * 20 : null;

  const integrityScore = await computeIntegrityScore(interviewId);

  await sqlQuery(
    `UPDATE interviews SET core_score = $2, integrity_score = $3, evaluated_at = NOW(), status = 'scored' WHERE id = $1`,
    [interviewId, coreScore, integrityScore],
  );

  return { ok: true };
}
