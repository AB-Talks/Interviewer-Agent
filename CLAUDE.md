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
- The pre-interview room scan (interviews.room_scan_url, recorded in
  /i/[token]/check) is a REQUIRED action -- Start Interview stays disabled until
  it's uploaded -- but its CONTENT is advisory-only like every other proctoring
  signal: never auto-analyzed, never auto-rejected, just a clip a human reviewer
  can watch later.
- core_score and integrity_score are always computed in code from weighted
  subscores / event weights -- never trust a model's own aggregate.
- Decision Engine: jobs.minimum_interview_score (nullable) and
  interviews.auto_qualified (nullable bool) are ADVISORY ONLY, computed in code
  as core_score >= minimum_interview_score at evaluation time (evaluate.ts). It
  never auto-advances, auto-schedules, or auto-rejects anything -- a human
  recruiter still sets interviews.recommendation. Null minimum_interview_score
  means no auto-qualify decision is made (safe default: manual review).
- Every API route validates input with zod and checks the access token.
- ABtalksapp cross-app integration (/api/integrations/abtalks/*): server-to-server
  only, gated on ABTALKS_INTEGRATION_SECRET via the x-abtalks-integration-secret
  header -- never callable from a browser. Same no-scores-to-candidate rule applies:
  these routes return status/links only, never core_score, integrity_score,
  transcript, or evidence. ABtalksapp's own application code is off-limits here --
  see its CLAUDE.md (Cursor executes there; this repo only ever writes the
  Interviewer-Agent side and plan docs under ABtalksapp/docs/plans/).
- Read PLAN.md. Work on one phase only.
