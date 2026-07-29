# AI Interview Agent — Build Roadmap & Tutorial

**Use case:** hiring / screening candidates
**Format:** async recorded interview (Internshala-style), grounded in JD + resume
**Upstream agents (already exist):** JD parser, resume parser, readiness matcher
**Build tooling:** Claude Code + Antigravity
**Status:** plan v2 — drop this in your repo root as `PLAN.md`

---

## 0. The two formats, explained

**Async recorded (recommended).** The candidate gets a link and does the interview alone, whenever they want. Your app shows one question at a time, the browser records their webcam + mic answer, uploads it, and the AI transcribes and scores it *afterwards*. Nobody is on the other end. Think "video version of a written test."

**Live voice AI.** A realtime voice agent talks to the candidate and can ask genuine follow-ups. But it needs a realtime speech pipeline (WebRTC + streaming STT + streaming TTS + barge-in handling), costs ~5–10× more per interview, and every latency spike is visible to the candidate.

**Why async wins for screening:** you're filtering volume, not having a conversation. No scheduling, no live infra, no latency risk. Build async first.

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
| Styling | **Tailwind** | Fast, matches how you already build. |
| DB + Auth + Storage | **Supabase** | Postgres + RLS + S3-compatible storage for video blobs + auth in one dashboard. |
| Hosting | **Vercel** | Zero-config for Next.js. |
| Background jobs | **Inngest** (or Supabase Edge Functions) | You now have a multi-step chain (parse → match → generate → invite). Inngest gives you retries and step visibility; worth the dependency here. |
| Speech-to-text | **Deepgram Nova** (or AssemblyAI) | ~$0.004/min batch, good with Indian English accents. Test both on 10 real clips first. |
| LLM | **Claude Sonnet 5** (`claude-sonnet-5`) — $2/$10 per MTok through Aug 31 2026, then $3/$15 | Question generation + answer scoring. Use `claude-haiku-4-5` for cheap classification (gibberish filter, language detect). |
| Face/presence detection | **MediaPipe Tasks Vision** (in-browser) | Client-side, no video leaves the browser for this check. |
| TTS (optional) | Browser `SpeechSynthesis` first | Free "AI reads the question aloud." |

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
  device_info jsonb
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
  interview_question_id uuid references interview_questions(id),
  video_path text,
  duration_seconds int,
  transcript text,
  transcript_confidence numeric,
  score numeric,                   -- 0-5, CORE only
  subscores jsonb,
  corroboration text,              -- PROBE only: corroborated|partial|not_corroborated|unclear
  feedback text,
  evidence_quotes jsonb,
  raw_model_response jsonb,
  scored_at timestamptz
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

Note `parser_version` / `matcher_version`: when you improve an upstream agent, you need to know which candidates were scored under which version. You will want this the first time a hiring manager asks why two similar candidates got different treatment.

**Row-level security:** candidates authenticate only via `access_token`; recruiters via Supabase Auth. Turn RLS on for every table before launch — "on but no policy" is safe, "off" is a data leak.

---

## 5. Routes

**Candidate**
```
/i/[token]                → landing: role info, rules, CONSENT CHECKBOX
/i/[token]/check          → camera, mic, speaker, bandwidth, 5s test recording
/i/[token]/interview      → the runner
/i/[token]/done           → confirmation
```

**Recruiter**
```
/admin                    → pipeline board, sorted by core_score
/admin/jobs/new           → upload JD → parse → review generated core questions → approve → live
/admin/jobs/[id]          → question bank, rubric, invite threshold, funnel stats
/admin/candidates/new     → upload resume → parse → match → invite decision
/admin/interviews/[id]    → review page: video + transcript + scores + probe evidence + timeline
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
POST /api/answers/upload-url              → signed Supabase upload URL
POST /api/answers/[id]/complete           → enqueue transcribe + score
POST /api/proctor/events                  → batched ingest
POST /api/interviews/[id]/submit
```

---

## 6. Question generation prompts

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

---

## 7. Rubric & answer scoring

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

### 7.1 Core answers — `claude-sonnet-5`, `temperature: 0`, one call per answer

```ts
const system = `You are scoring one answer from a recorded job interview.
You are given a machine transcript, so ignore filler words, false starts, and
transcription errors. Score the SUBSTANCE of what the candidate said.

Rules:
- Do not reward or penalise English fluency, accent, grammar, or vocabulary,
  except where the answer is genuinely incomprehensible.
- You have NOT been given the candidate's resume. Score only what is in the
  transcript. Do not speculate about their background.
- Quote the exact words you based each score on.
- If the transcript is too short or garbled to judge, set
  "insufficient_evidence": true and do not guess a score.

Return ONLY valid JSON:
{"subscores":{"relevance":0-5,"depth":0-5,"correctness":0-5,"clarity":0-5},
 "feedback":"<40 words, addressed to the recruiter>",
 "evidence_quotes":["..."],"insufficient_evidence":false}`;
```

**Do not give the scorer the resume.** It's tempting — it feels like context. What actually happens is the model scores the résumé it can see rather than the answer it heard, and strong résumés get inflated. The resume's job was to generate the question; it's done.

Compute the final 0–5 yourself from the weighted subscores. `core_score` = weighted mean across the 4 core answers, scaled to 100. That is the only number you rank on.

### 7.2 Probe answers — corroboration, not scoring

```ts
const system = `A candidate was asked a follow-up question about a specific claim
or capability. You are given the claim, the question, and the transcript.

Judge ONLY whether the answer corroborates the claim:
- "corroborated": specific, first-hand detail consistent with having done this work
- "partial": some relevant detail, but thin or generic
- "not_corroborated": no relevant detail, or contradicts the claim
- "unclear": bad transcript, misunderstood question, or ran out of time

You are not judging quality, seniority, or hireability. You are not producing a
score. Absence of detail in 90 seconds of speech is weak evidence — prefer
"unclear" over "not_corroborated" when uncertain.

Return ONLY: {"corroboration":"...","reasoning":"<30 words>",
 "evidence_quotes":["..."]}`;
```

Surface this on the review page as a line of text next to the claim and the resume snippet it came from. Never convert it to points.

---

## 8. Phase plan

One phase per Claude Code session. Don't start the next until the current is deployed and manually tested.

### Phase 0 — Decisions (½ day, no code)
Pick one job to build for. Write its rubric. Set the invite threshold. Decide retention (90 days is sane). Name the human who reviews flagged interviews and approves question sets.

### Phase 1 — Skeleton (1 day)
Next.js + TS + Tailwind, Supabase connected, schema migrated, recruiter auth, token generation. **Deploy to Vercel now** so you're never debugging deploy at the end.

### Phase 2 — Agent adapters + contracts (1 day)
`lib/agents/contracts.ts`, the three adapters, `redactForGeneration` + its CI test. Mock the agents behind the interface and get the whole chain green against mocks *before* wiring the real services. This is the phase that determines whether the rest of the build is clean.

**Done when:** you can POST a JD and a resume and get a `MatchReport` row, using real agents.

### Phase 3 — Job setup flow (1 day)
Upload JD → parse → generate core questions → recruiter edit screen → approve → live. Include the DB-level guard that blocks going live with unapproved questions.

### Phase 4 — Consent + system check (1 day)
Landing page states plainly: video and audio recorded, tab-switching and focus logged, retained N days, AI assists scoring but a human decides. Explicit checkbox → `POST /consent`. **No `getUserMedia` call before `consent_at` is stamped** — the single most important line in this build.

Check page: enumerate devices, pick camera/mic, live preview + mic level meter, record 5s and play it back, measure upload bandwidth.

**Done when:** works on Chrome Android, Safari iOS, desktop Chrome. iOS Safari will break something — find out now.

### Phase 5 — Interview runner (2 days)
Per question: show text → prep countdown → recording auto-starts → answer countdown → auto-stop or manual "Done" → background upload → next. No back button, no re-record in v1. Core questions first, probes last.

Upload each answer while the candidate reads the next question. Never hold 9 minutes of video in memory — that's where mobile sessions die.

**Done when:** you complete a full interview on a phone on mobile data and all 6 files land in Storage.

### Phase 6 — Proctoring layer (1–2 days)
Everything in §10, as one `useProctor()` hook.

**Done when:** you can deliberately tab-switch, exit fullscreen, unplug the webcam and paste text, then see all four on the recruiter timeline at the right timestamps.

### Phase 7 — Transcription + scoring pipeline (2 days)
Per answer: Storage → audio → STT → core scoring *or* probe corroboration → write results. Then aggregate on submit. Idempotent, retryable, raw responses stored.

### Phase 8 — Recruiter dashboard (2–3 days)
The review page is the product:
- Header: `core_score` (big), `overall_match` (smaller, clearly labelled "resume match — not part of interview score"), `integrity_score`.
- Video player with the proctor event timeline under the scrubber; clicking a tick seeks.
- Transcript synced to playback.
- Per-core-question score with the model's evidence quotes visible.
- **Probe section:** the resume claim, the snippet it came from, the question asked, the rationale, and the corroboration verdict.
- Advance / Reject + free-text note. Log who decided what, when.
- **Override is one click.** If disagreeing with the AI is harder than agreeing, recruiters will just agree.

### Phase 9 — Calibration (1 week, part-time — do not skip)
20–30 real candidates. A human scores every one *blind* to the AI score, then compare.
- Disagreement >1 point on more than ~25% of answers → your rubric is too vague. Rewrite the rubric, don't tweak the prompt.
- Check `core_score` distribution by gender, mother tongue, and college tier. A systematic gap usually means the rubric is rewarding fluent English rather than the competency. Fix the rubric.
- Separately check whether probe questions differ in difficulty across groups. If redaction is working they shouldn't.
- Only after calibration does the score influence real decisions.

### Phase 10 — Hardening & launch
Rate limits, token expiry, a retention cron that actually deletes videos, Sentry, and a resume-your-session path so a crash doesn't cost a candidate their interview.

---

## 9. The recording core

```ts
const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
  ? 'video/webm;codecs=vp9,opus'
  : 'video/mp4';                      // Safari

const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 800_000 });
const chunks: Blob[] = [];

rec.ondataavailable = e => e.data.size > 0 && chunks.push(e.data);
rec.onstop = async () => {
  const blob = new Blob(chunks, { type: mimeType });
  const { uploadUrl, answerId } = await fetch('/api/answers/upload-url', {
    method: 'POST',
    body: JSON.stringify({ interviewId, interviewQuestionId, mimeType })
  }).then(r => r.json());

  await fetch(uploadUrl, { method: 'PUT', body: blob });       // direct to Storage
  await fetch(`/api/answers/${answerId}/complete`, { method: 'POST' });
};

rec.start(1000);   // 1s timeslices — survives a crash mid-answer
```

Gotchas that cost a day each:
- **iOS Safari** ignores `videoBitsPerSecond`, is fussy about `MediaRecorder`, and refuses `getUserMedia` on non-HTTPS. Test on a real iPhone.
- **Autoplay policy:** create the AudioContext for your mic meter inside a user gesture, or it stays suspended.
- **800 kbps at 480p is plenty.** You're transcribing speech and letting a human glance at a face.
- Always `stream.getTracks().forEach(t => t.stop())` on unmount, or the camera light stays on and candidates panic.

---

## 10. Proctoring: what to build and what it's worth

Log everything, trust nothing individually.

| Event | Severity | Innocent explanation you must account for |
|---|---|---|
| `tab_hidden` / `window_blur` | 2 | Incoming call, notification |
| `fullscreen_exited` | 1 | Accidental Esc |
| `no_face_detected` | 2 | Bad lighting, dark skin + cheap laptop camera, looking down to think |
| `multiple_faces_detected` | 2 | Most Indian candidates interview from a shared room |
| `camera_stream_ended` | 3 | Cable knocked out, browser bug |
| `paste_into_field` | 2 | — (fairly strong signal) |
| `devtools_shortcut` | 1 | Reflex |
| `long_silence` | 1 | Thinking, or a bad question |
| `network_drop` | 1 | India, on mobile data |

```ts
const raw = events.reduce((s, e) => s + WEIGHTS[e.type] * e.severity, 0);
const integrity = Math.max(0, 100 - Math.min(60, raw));   // cap the damage
```

**Hard rules:**
- Never auto-reject on proctoring signals. Flag for human review, full stop.
- Never claim the system "detects cheating." It detects *events*. Say that.
- Multiple-monitor detection isn't reliable in a browser. Skip it rather than ship false accusations.
- Aggressive lockdown stops nobody technical and irritates everyone else. Log attempts, don't block.
- On mobile, downgrade `visibilitychange` severity — it fires on every notification and screen lock.

Batch events client-side (every 5s or 20 events) and `sendBeacon` on `pagehide`. One request per event will melt your API route.

```ts
document.addEventListener('visibilitychange', () =>
  push(document.hidden ? 'tab_hidden' : 'tab_visible', isMobile ? 1 : 2));
window.addEventListener('blur', () => push('window_blur', 2));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) push('fullscreen_exited', 1);
});
window.addEventListener('pagehide', () =>
  navigator.sendBeacon('/api/proctor/events', JSON.stringify(buffer)));
```

---

## 11. Cost per interview (6 questions, ~9 min)

| Item | Cost |
|---|---|
| Resume + JD parse + match (your agents) | your existing cost |
| Probe generation, 2 calls | ~$0.01 |
| STT @ ~$0.004/min | ~$0.04 |
| Scoring: 4 core + 2 probe + aggregate | ~$0.05 |
| Storage, ~55 MB, 90 days | ~$0.002 |
| **Total (this app)** | **≈ $0.10 / ₹9 per candidate** |

Core question generation is once per job, not per candidate — negligible. Use the Batch API (50% off) for scoring if you don't need results within the hour.

---

## 12. Legal & fairness (India)

- **DPDP Act 2023:** video, resumes, and derived profiles are personal data — collected for a stated purpose, with consent, retained no longer than needed, deletable on request. Build the delete endpoint in Phase 1, and make sure it cascades to `resumes.parsed` and `match_reports`, not just the video.
- **Consent must be specific and pre-recording.** A line in a privacy policy isn't consent.
- Tell candidates AI assists the evaluation and a human decides — then make that true.
- **Keep the audit trail:** parser version, matcher version, question set served, scores, who reviewed, what they decided. If a rejection is ever disputed, this is your entire defence.
- Offer an accessibility path: a candidate who can't do a video interview gets a written or scheduled human alternative, stated on the landing page.
- Screening anyone in the EU or NYC turns this into a regulated high-risk system with audit obligations. Flag it before it happens, not after.

---

## 13. Working with Claude Code and Antigravity

**Split by strength:**
- **Claude Code** — contracts, adapters, schema, API routes, scoring pipeline, dashboard.
- **Antigravity** — the browser-heavy surfaces (system check, recorder, proctor hook), because its browser control lets it load the page and see what broke instead of guessing.

**`CLAUDE.md` at repo root** — this is what stops agents redesigning your architecture every session:

```md
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
```

**Prompt per phase, scoped hard:**
> "Read PLAN.md and CLAUDE.md. Implement Phase 5 only — the interview runner. Do not touch the proctoring layer or the scoring pipeline. Start by listing the files you'll create and the state machine for the question loop, then wait for my approval before writing code."

**Non-negotiables:**
- Commit at the end of every phase.
- Never let it commit `.env`. A service-role key in the client bundle is full DB access for anyone who opens devtools.
- Review RLS policies by hand. Agents write permissive policies because permissive policies make tests pass.
- Run one full interview manually after every phase. No test catches "the camera light stayed on."

---

## 14. Schedule

| Days | Phase |
|---|---|
| 1 | 0 + 1 — decisions, skeleton, deployed |
| 2 | 2 — contracts + adapters + redaction |
| 3 | 3 — job setup & question approval flow |
| 4 | 4 — consent + system check |
| 5–6 | 5 — interview runner |
| 7–8 | 6 — proctoring |
| 9–10 | 7 — transcription + scoring |
| 11–13 | 8 — recruiter dashboard |
| 14–20 | 9 — calibration with real candidates |
| then | 10 — hardening, launch |

---

## First thing to do tomorrow

Write `lib/agents/contracts.ts` against what your three existing agents actually emit today — not what you wish they emitted. Everything in this plan hangs off those three types, and getting them wrong on day two means rewriting adapters on day ten.
