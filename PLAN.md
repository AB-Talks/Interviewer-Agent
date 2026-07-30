# AI Interview Agent — Build Roadmap & Tutorial

**Use case:** hiring / screening candidates
**Format:** Live AI Voice Interview (WebRTC + OpenAI Realtime) + Parallel Recorded Video (Vercel Blob) + Proctoring
**Base Agents:** JD parser, resume parser, readiness matcher, and judge agent from `agent packages` (always wrap and build on these as the core base; enhance but do not reimplement them).
**Build tooling:** Claude Code + Antigravity
**Status:** plan v3.0 — DB + storage swapped from Supabase to Neon Postgres + Vercel Blob, WebRTC voice call + parallel video + proctoring.

---

## 0. The format, explained

**Live Voice & Video AI.** A realtime voice agent talks to the candidate, hears them, and replies within ~700ms. Feels like a real conversation, and it can ask genuine, adaptive follow-ups grounded in what the candidate actually said. The candidate's camera stream (video) is recorded in parallel, mixed with the conversation audio, split into 3-minute segments, and uploaded to Vercel Blob for recruiter review. Client-side proctoring (tab-switch, devtools, copy-paste) and webcam face-presence (using MediaPipe) are logged.

---

## 1. THE BIG DESIGN DECISION: how far to personalise

You want questions driven by the resume and the JD. That's the right instinct — but taken to its limit it breaks the thing that makes screening defensible.

**The problem.** If every candidate gets a different set of questions, every candidate has taken a different test. You can no longer say candidate A scored higher than candidate B, because they weren't measured on the same thing. Structured interviews — same questions, same order, same rubric — are the single most validated practice in hiring research, and it's the only version you can defend if a rejected candidate ever asks why. Fully generated per-candidate questions throw that away, and they quietly introduce bias: give an LLM a resume with a tier-3 college on it and it writes easier, more basic questions than it writes for an IIT resume. Same candidate ability, different test difficulty, and the score gap looks like a real signal.

**The fix — split the interview into two tracks:**

| | **Core questions (4)** | **Probe questions (2)** |
|---|---|---|
| Derived from | JD only | This candidate's match report |
| Identical across candidates? | **Yes** — same for everyone applying to this job | No |
| Scored how | 0–5 rubric (§7) | Corroborated / partial / not corroborated |
| Feeds the ranking score? | **Yes** | **No** — shown to the recruiter as evidence |

The core track gives you a comparable, rankable, defensible score. The probe track gives you what you actually wanted personalisation for: "she claims she led the Razorpay integration — did she actually?" and "the JD needs Kubernetes and her resume never mentions it — can she talk about it at all?"

Probes are *evidence for a human*, not points in a ranking. Keep that line hard and the whole system stays defensible.

---

## 2. Recommended stack

| Layer | Pick | Why |
|---|---|---|
| App | **Next.js 15 (App Router) + TypeScript** | One repo for UI + API routes. Agents write TS well because types catch their mistakes. |
| Styling | **Tailwind** | Fast, matches how you already build. Uses Visual HSL port of `ABtalksapp` tokens. |
| DB | **Neon Postgres** | Serverless Postgres, branching, generous free tier. Accessed via `@neondatabase/serverless` (`lib/db.ts`). |
| Storage | **Vercel Blob** | Video blobs, signed upload URLs via `@vercel/blob/next`. |
| Auth | **TBD (Phase A)** | Candidates via `access_token` only. Recruiter auth not yet chosen — decide in Phase A. |
| Hosting | **Vercel** | Zero-config for Next.js. |
| Background jobs | **Inngest** (or next/server `after()`) | You now have a multi-step chain. `after()` covers MVP, Inngest is for retries. |
| Speech-to-text | **OpenAI Realtime** | Built-in within the realtime WebRTC connection. |
| LLM | **Claude 3.5 Sonnet** (`claude-sonnet-5`) | For generating probes, scoring rubric, and evaluation. |
| Face/presence detection | **MediaPipe Tasks Vision** | Client-side face proctoring. |
| TTS (optional) | **OpenAI Realtime** | Voice conversation (Voice: `"marin"`). |

**Do not** add a media server, WebRTC, Kubernetes, or a queue system in v1.

---

## 3. Integrating your existing agents

Your parsers and matcher already exist. The rule for this build: **wrap them, never reimplement them.** Define the contract first, in one file, and make Claude Code code against the interface — otherwise it will helpfully write its own resume parser inside your interview app.

`lib/agents/contracts.ts`:

```ts
export interface ParsedJD {
  jobId: string;
  title: string;
  mustHave: Requirement[];      // hard requirements
  niceToHave: Requirement[];
  responsibilities: string[];
  seniority: 'intern' | 'junior' | 'mid' | 'senior';
}

export interface Requirement {
  key: string;                  // 'react', 'system_design', 'stakeholder_comms'
  label: string;
  weight: number;               // 0-1
}

export interface ParsedResume {
  resumeId: string;
  skills: SkillClaim[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  education: EducationItem[];   // stored, but NOT passed to the generator — see §3.2
}

export interface SkillClaim {
  key: string;
  label: string;
  evidenceStrength: 'stated' | 'used_in_project' | 'owned_in_role';
  sourceSnippet: string;        // the exact resume text — you'll cite this to the recruiter
}

export interface MatchReport {
  candidateId: string;
  jobId: string;
  overallMatch: number;                // 0-100
  dimensionScores: Record<string, number>;
  gaps: Gap[];                         // JD requires it, resume is silent or weak
  verifiableClaims: SkillClaim[];      // high-value claims worth probing
}

export interface Gap {
  requirementKey: string;
  severity: 'blocking' | 'significant' | 'minor';
  reason: string;
}
```

Then one adapter per agent (`lib/agents/jdParser.ts` etc.) that calls your existing service and returns these types. If the shapes don't match what your agents currently emit, map them in the adapter — don't change your agents to suit this app, and don't change this app to suit whatever your agents currently happen to return.

### 3.1 The intake chain

```
JD uploaded ──► jdParser ──► ParsedJD ──► generateCoreQuestions(job)   [ONCE PER JOB]
                                              │
                                              └─► human review & edit ──► job goes live

Resume uploaded ──► resumeParser ──► ParsedResume ─┐
                                                   ├─► readinessMatcher ──► MatchReport
ParsedJD ──────────────────────────────────────────┘                            │
                                                                                 │
                                             match >= invite threshold? ──────────┤
                                                                                 │
                                             generateProbeQuestions(report) ◄────┘
                                                                                 │
                                                     interview link sent ◄────────┘
```

Two things to notice:

- **Core questions are generated once per job, then a human edits them.** Never per candidate, never unreviewed. This is a 10-minute human task per job that removes most of your risk.
- **The match score gates the invite. It must not also be added into the final ranking.** If a 78% match is why she got invited, and you then add that 78% to her interview score, you've counted the same resume evidence twice and buried the interview signal under the résumé signal. Report the match score *next to* the interview score, never inside it.

### 3.2 Redaction before generation — do not skip this

Before `ParsedResume` reaches any question-generation prompt, strip:

- name, gender, photo, age / DOB, marital status
- college name and tier, school, graduation year
- location, mother tongue
- company *names* (keep the role, industry, size band, and duration)
- employment gap framing (keep durations; don't editorialise them)

```ts
export function redactForGeneration(r: ParsedResume): GenerationProfile {
  return {
    skills: r.skills,                                  // keys + evidenceStrength + snippet
    roles: r.experience.map(e => ({
      title: e.title, months: e.months,
      industry: e.industry, teamSize: e.teamSize,
      responsibilities: e.responsibilities
    })),
    projects: r.projects.map(p => ({
      description: p.description, tools: p.tools, role: p.role
    }))
  };
}
```

The generator sees capability, never identity. Write a unit test that asserts the serialised `GenerationProfile` contains none of the redacted fields — and have it run in CI, because this is exactly the kind of thing that silently regresses when someone "just adds one more field for context."

---

## 4. Data model

```sql
create table jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  jd_raw text,
  jd_parsed jsonb,                 -- ParsedJD
  rubric jsonb not null,           -- §7
  invite_threshold numeric default 60,
  status text default 'draft',     -- draft|questions_pending_review|live|closed
  created_at timestamptz default now()
);

-- CORE questions: attached to the job, identical for every candidate
create table core_questions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  position int not null,
  text text not null,
  competency text not null,        -- maps to a ParsedJD requirement key
  ideal_answer text,               -- never shown to candidate
  prep_seconds int default 30,
  answer_seconds int default 120,
  approved_by uuid,                -- MUST be non-null before job goes live
  approved_at timestamptz
);

create table candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  created_at timestamptz default now()
);

create table resumes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id) on delete cascade,
  file_path text,
  parsed jsonb,                    -- ParsedResume
  parsed_at timestamptz,
  parser_version text
);

create table match_reports (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  resume_id uuid references resumes(id),
  overall_match numeric,
  dimension_scores jsonb,
  gaps jsonb,
  verifiable_claims jsonb,
  matcher_version text,
  created_at timestamptz default now()
);

create table interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id),
  job_id uuid references jobs(id),
  match_report_id uuid references match_reports(id),
  access_token text unique not null,
  status text default 'invited',   -- invited|system_check|in_progress|submitted|scored|expired
  consent_at timestamptz,          -- REQUIRED before any recording
  started_at timestamptz,
  submitted_at timestamptz,
  expires_at timestamptz,
  core_score numeric,              -- 0-100, the ONLY rankable number
  integrity_score numeric,         -- 0-100, higher = cleaner session
  recommendation text,             -- advance|review|reject (advisory only)
  device_info jsonb,
  transcript jsonb,                -- ordered [{role,text,ts,latencyMs}]
  video_segments jsonb default '[]', -- [{seq,url,startedAtMs,endedAtMs,bytes}]
  duration_seconds int,
  video_finalized_at timestamptz,
  evaluated_at timestamptz,
  session_mint_count int default 0
);

-- the actual question set served to ONE candidate: core rows copied in + probes generated
create table interview_questions (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid references interviews(id) on delete cascade,
  position int not null,
  kind text not null,              -- 'core' | 'probe'
  text text not null,
  competency text,
  ideal_answer text,
  source_ref jsonb,                -- for probes: which gap or claim produced this
  core_question_id uuid references core_questions(id),
  prep_seconds int default 30,
  answer_seconds int default 120
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid references interviews(id) on delete cascade,
  interview_question_id uuid references interview_questions(id) unique,
  video_path text,                 -- vercel blob URL or S3 key
  duration_seconds int,
  transcript text,
  transcript_confidence numeric,
  score numeric,                   -- 0-5, CORE only
  subscores jsonb,
  corroboration text,              -- PROBE only: corroborated|partial|not_corroborated|unclear
  feedback text,
  evidence_quotes jsonb,
  raw_model_response jsonb,
  scored_at timestamptz,
  evidence_start_ms int,
  evidence_end_ms int
);

create table proctor_events (
  id bigserial primary key,
  interview_id uuid references interviews(id) on delete cascade,
  interview_question_id uuid,
  type text not null,
  severity int not null,           -- 1 low, 2 medium, 3 high
  at timestamptz default now(),
  offset_ms int,
  meta jsonb
);

create index on proctor_events (interview_id, at);
create index on answers (interview_id);
create index on match_reports (job_id, candidate_id);
```

**Access control:** candidates authenticate only via `access_token`, checked in every API route. Recruiter auth mechanism TBD (Phase A) — Neon has no built-in RLS/auth like Supabase, so recruiter-only routes must enforce access checks in application code (middleware or per-route), not at the DB layer.

---

## 5. Routes

**Candidate**
```
/i/[token]                → landing: role info, rules, CONSENT CHECKBOX
/i/[token]/check          → camera, mic, speaker, bandwidth, 5s test recording
/i/[token]/interview      → the live voice + video WebRTC runner
/i/[token]/done           → confirmation
```

**Recruiter**
```
/admin                    → pipeline board, sorted by core_score
/admin/jobs/new           → upload JD → parse → review generated core questions → approve → live
/admin/jobs/[id]          → question bank, rubric, invite threshold, funnel stats
/admin/candidates/new     → upload resume → parse → match → invite decision
/admin/interviews/[id]    → review page: sequential segments video player + synced transcript + timeline
```

**API**
```
POST /api/jobs/[id]/parse                 → jdParser adapter
POST /api/jobs/[id]/generate-questions    → core set, status → questions_pending_review
POST /api/jobs/[id]/approve-questions     → stamps approved_by, job can go live
POST /api/candidates/[id]/parse-resume    → resumeParser adapter
POST /api/candidates/[id]/match           → readinessMatcher adapter → MatchReport
POST /api/interviews/create               → copies core Qs, generates probes, mints token
POST /api/interviews/[id]/consent
POST /api/interviews/[token]/session      → OpenAI Realtime ephemeral secret minting
POST /api/answers/upload-url              → Vercel Blob signed upload URL
POST /api/interviews/[token]/checkpoint    → updates segment list, transcript, and duration
POST /api/proctor/events                  → batched proctor event ingest
POST /api/interviews/[id]/submit
```

---

## 6. Question generation prompts & Live Instructions

### 6.1 Core set — once per job, from the JD only

```ts
const system = `You write structured interview questions for a screening interview.
The same questions will be asked of EVERY candidate for this job, so they must be
answerable by any qualified candidate regardless of background, employer, or college.

Rules:
- 4 questions, each targeting exactly one requirement key from the JD.
- Behavioural or applied, never trivia. "Tell me about a time..." or
  "How would you approach..." — not "What does useEffect do?"
- Answerable in 90-120 seconds of speech.
- No question may reference a specific company, tool brand, or credential that a
  qualified candidate might plausibly not have encountered.
- For each, write ideal_answer: what a strong answer contains. 3-5 bullets.

Return ONLY valid JSON:
{"questions":[{"text":"...","competency":"<requirement key>",
  "ideal_answer":"...","answer_seconds":120}]}`;

const user = `JOB: ${jd.title} (${jd.seniority})
MUST HAVE: ${JSON.stringify(jd.mustHave)}
RESPONSIBILITIES: ${JSON.stringify(jd.responsibilities)}`;
```

Output lands in `core_questions` with `approved_by = null`. **The job cannot go live until a human approves.** Enforce it in the DB with a check on the status transition, not just in the UI.

### 6.2 Probes — per candidate, from the match report

Pick at most 2, in this priority order:
1. The highest-severity gap that is *not* blocking (blocking gaps should have failed the invite threshold — don't interview someone to confirm they can't do the job).
2. The highest-value verifiable claim with `evidenceStrength: 'owned_in_role'` — the big claims are the ones worth checking.

```ts
const system = `You write ONE follow-up question for a recorded screening interview.

You are given a capability profile (identity has been removed) and one item to probe.

If the item is a GAP: write a question that gives the candidate a fair chance to
show relevant capability. Do not imply they lack it, do not mention their resume.
Neutral framing only.

If the item is a CLAIM: write a question that invites specifics about the work —
what they decided, what broke, what they'd change. A person who did the work can
answer in detail; a person who didn't will stay abstract. Do NOT write a
"gotcha" or ask them to prove anything.

The question must be answerable in 90 seconds and must not reference any company,
college, or person by name.

Return ONLY: {"text":"...","rationale":"<one line, for the recruiter>"}`;
```

Store `rationale` in `source_ref`. The recruiter should always be able to see *why* this candidate got this question.

**Cap probes at 2 and always place them last.** If a candidate bails early you still have the comparable core set.

### 6.3 Live Interview Instructions

Refer to instructions builder `buildInterviewInstructions({job, questions})` which compiles the following instructions:
- **Standard Questions**: Direct the model to ask core questions verbatim and in order.
- **Adaptive Follow-up**: Allow the interviewer to ask exactly ONE targeted follow-up question based on what the candidate just said before moving to the next topic.
- **Vocal Stuck Detection**: A candidate struggling (hesitation, long silent pauses, trailing off, false starts) must be detected from the live voice stream itself. On first struggle, simplify or prompt; on second, warmly acknowledge and skip to the next question.
- **Early-Conclusion Rule**: If a candidate is unable to substantively answer the majority of core questions, or is clearly too stuck to continue productively, the interviewer should skip remaining probes, ask at most one more core question to confirm the pattern, then give a brief closing line and end early.
- **Priority Rule**: If time is short for reasons other than early conclusion, drop or shorten probes first — never core questions.

---

## 7. Visual Design Tokens Port

We adopt `ABtalksapp` theme variables directly:
- Indigo primary `239 84% 67%`
- Background variables `hsl(var(--background))`
- Theme fonts (Plus Jakarta Sans + Inter) mapped to Next.js font classes.

---

## 8. Rubric & answer scoring

Rubric lives on `jobs.rubric`, not in the prompt:

```json
{
  "dimensions": [
    { "key": "relevance",   "label": "Answers the question asked", "weight": 0.3 },
    { "key": "depth",       "label": "Specific and concrete, not generic", "weight": 0.3 },
    { "key": "correctness", "label": "Technically accurate", "weight": 0.25 },
    { "key": "clarity",     "label": "Structured and understandable", "weight": 0.15 }
  ],
  "anchors": {
    "0": "No usable answer, or off-topic",
    "1": "Vague; restates the question without content",
    "2": "Partially relevant; generic examples only",
    "3": "Solid, correct, at least one specific example",
    "4": "Strong; specific, correct, reasons about tradeoffs",
    "5": "Excellent; specific, correct, surfaces a nuance most candidates miss"
  }
}
```

### 8.1 Post-Interview Evaluation

- One bounded `askClaudeJson` call evaluates the entire transcript against `jobs.rubric`.
- Upserts answers, calculates weighted means, and stamps the final scores in `interviews.core_score` and `integrity_score`.

---

## 9. Parallel Recording & audio mixing

We mix candidate mic + AI audio using `AudioContext` and segment video uploads every **3 minutes** directly to Vercel Blob.

---

## 10. Proctoring & MediaPipe

- Standard visibility, fullscreen, paste, devtools events are batched.
- `@mediapipe/tasks-vision` handles face-presence logging.

---

## 11. Schedule

*   **Phase A** — Data model + interview creation. ✅ shipped.
*   **Phase B** — Anthropic client + instructions builder + session route. ✅ shipped.
*   **Phase C** — Consent + system-check pages + design tokens. ✅ shipped.
*   **Phase D** — Live interview runner (WebRTC + recording + checkpoints). ✅ shipped.
*   **Phase E** — Proctoring & MediaPipe. ✅ shipped, except `@mediapipe/tasks-vision`
    itself isn't installed yet (no network access at build time) — run `npm install`
    once available; everything else in proctoring works without it.
*   **Phase F** — Evaluation pipeline (Claude scoring). ✅ shipped (built ahead of D,
    since `/complete` depends on it).
*   **Phase G** — Recruiter dashboard. ✅ shipped.
*   **Phase H** — Hardening & launch. Not started: session-mint rate limiting,
    token-expiry sweep cron, retention/deletion cron, Sentry, Azure Realtime
    adapter. None of these block a manual end-to-end test.

**Not yet done, tracked separately:** `npm install` (network access needed --
adds `@neondatabase/serverless`/`@vercel/blob`/`@mediapipe/tasks-vision` for
real, see package.json), running `npm run db:migrate` (or pasting `schema.sql`
into the Neon SQL editor) against the live database, and setting
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in `.env`. Nothing in Phases A–G has
been exercised against a real OpenAI/Anthropic call or a live browser session
yet — see the verification note in the engineering log for exactly what to
test first.

---

## 12. Legal & fairness (India)

- **DPDP Act 2023:** video, resumes, and derived profiles are personal data — collected for a stated purpose, with consent, retained no longer than needed, deletable on request.
- **Consent must be specific and pre-recording.** A line in a privacy policy isn't consent.
- Tell candidates AI assists the evaluation and a human decides — then make that true.

---

## 13. Working with Claude Code and Antigravity

**Split by strength:**
- **Claude Code** — contracts, adapters, schema, API routes, scoring pipeline, dashboard.
- **Antigravity** — the browser-heavy surfaces (system check, WebRTC connection, recorder, proctor hook), because its browser control lets it load the page and see what broke instead of guessing.
