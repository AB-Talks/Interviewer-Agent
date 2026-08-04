# Project rules
- Next.js 15 App Router, TypeScript strict, Tailwind. No new deps without asking.
- Neon Postgres + Vercel Blob is the backend. The only external AI service allowed
  is OpenAI (Realtime API for live voice interview conduct; Chat Completions for
  question/probe generation and post-interview evaluation, via lib/openai.ts). No
  other AI vendor or new service without asking. @mediapipe/tasks-vision is the
  one pre-approved npm dependency, for client-side face-presence proctoring only.
- OPENAI_API_KEY must never reach the client. The browser only ever receives a
  short-lived OpenAI ephemeral client secret minted server-side by
  /api/interviews/[token]/session.
- The JD parser, resume parser, and readiness matcher are EXISTING services.
  Call them through lib/agents/*. Never write parsing or matching logic in this repo.
- Never call getUserMedia anywhere -- landing, system-check, or interview page --
  until interviews.consent_at is set.
- Never pass the resume or match report to an ANSWER-SCORING prompt.
  Resume data is for question generation only, and only after redactForGeneration().
- The live interview instructions given to the realtime model must never include
  jobs.rubric, core_questions.ideal_answer, or any scoring criteria -- the
  interviewer conducts, it does not grade.
- Core questions are identical for all candidates for a job (asked near-verbatim by
  the live interviewer, in order) and require human approval. Adaptive follow-ups
  probe a question's own answer further -- they never replace or reword a core
  question, and never introduce a new unscored topic that isn't attributed back to
  the question it followed up on.
- Probe answers produce a corroboration verdict, never a number, and never affect core_score.
- overall_match is displayed alongside core_score, never blended into it.
- Proctoring events (including face-presence) are advisory. Never write code that
  auto-rejects a candidate or auto-ends an interview from a proctoring signal.
- core_score and integrity_score are always computed in code from weighted
  subscores / event weights -- never trust a model's own aggregate.
- Every API route validates input with zod and checks the access token.
- Read PLAN.md. Work on one phase only.
