# Project rules
- Next.js 15 App Router, TypeScript strict, Tailwind. No new deps without asking.
- Supabase is the only backend. No new services.
- The JD parser, resume parser, and readiness matcher are EXISTING services.
  Call them through lib/agents/*. Never write parsing or matching logic in this repo.
- Never call getUserMedia before interviews.consent_at is set.
- Never pass the resume or match report to an ANSWER-SCORING prompt.
  Resume data is for question generation only, and only after redactForGeneration().
- Core questions are identical for all candidates for a job and require human approval.
- Probe answers produce a corroboration verdict, never a number, and never affect core_score.
- overall_match is displayed alongside core_score, never blended into it.
- Proctoring events are advisory. Never write code that auto-rejects a candidate.
- Every API route validates input with zod and checks the access token.
- Read PLAN.md. Work on one phase only.
