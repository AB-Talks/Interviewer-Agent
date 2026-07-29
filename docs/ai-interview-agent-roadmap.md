# AI Interview Agent — Build Roadmap & Tutorial

**Use case:** hiring / screening candidates
**Format:** async recorded interview (Internshala-style)
**Build tooling:** Claude Code + Antigravity
**Status:** plan v1 — drop this in your repo root as `PLAN.md`

---

## 0. The two formats, explained

**Async recorded (recommended).** The candidate gets a link and does the interview alone, whenever they want. Your app shows one question at a time, the browser records their webcam + mic answer, uploads it, and the AI transcribes and scores it *afterwards*. Nobody is on the other end. Think "video version of a written test."

**Live voice AI.** A realtime voice agent talks to the candidate, hears them, and replies within ~700ms. Feels like a real conversation, and it can ask genuine follow-ups. But it needs a realtime speech pipeline (WebRTC + streaming STT + streaming TTS + barge-in handling), costs ~5–10× more per interview, and every latency spike is visible to the candidate.

**Why async wins for screening:** you're filtering volume, not having a conversation. No scheduling, no live infra, no latency risk, every answer is comparable across candidates because everyone got the same question in the same order, and if the AI scoring is wrong a human can just watch the clip. Build async first. If you later want follow-up questions, you can add a *semi-adaptive* version: score answer N, then pick question N+1 from a bank based on that score. That's 90% of the value of live, with none of the realtime infra.

---

## 1. Recommended stack

| Layer | Pick | Why |
|---|---|---|
| App | **Next.js 15 (App Router) + TypeScript** | One repo for UI + API routes. Agents write TS well because types catch their mistakes. |
| Styling | **Tailwind** | Fast, and matches how you already build. |
| DB + Auth + Storage | **Supabase** | Postgres + row-level security + S3-compatible storage for the video blobs + auth, all in one dashboard. Free tier covers a pilot. |
| Hosting | **Vercel** | Zero-config for Next.js. |
| Background jobs | **Supabase Edge Functions** or **Inngest** | Transcription + scoring must run *after* the response returns. Never block the upload on an LLM call. |
| Speech-to-text | **Deepgram Nova** (or AssemblyAI) | ~$0.004/min batch, fast, good with Indian English accents. Test both on 10 real clips before committing. |
| LLM scoring | **Claude Sonnet 5** (`claude-sonnet-5`) | $2/$10 per MTok through Aug 31 2026, then $3/$15. Plenty for rubric scoring. Use `claude-haiku-4-5` for cheap classification (language detection, gibberish filter). |
| Face/presence detection | **MediaPipe Tasks Vision** (in-browser) | Runs client-side, no video leaves the browser for this check. |
| TTS (optional) | Browser `SpeechSynthesis` first, ElevenLabs only if it sounds bad | Free tier of "AI reads the question aloud." |

**Do not** add a media server, WebRTC, Kubernetes, or a queue system in v1. `MediaRecorder` → upload file → job → done.

---

## 2. Data model

Run this in the Supabase SQL editor.

```sql
create table roles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  rubric jsonb not null,          -- see §6
  question_count int default 6,
  created_at timestamptz default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid references roles(id) on delete cascade,
  position int not null,          -- display order
  text text not null,
  competency text not null,       -- e.g. 'communication', 'react_fundamentals'
  prep_seconds int default 30,
  answer_seconds int default 120,
  ideal_answer text               -- graded against this; never shown to candidate
);

create table candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  created_at timestamptz default now()
);

create table interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id),
  role_id uuid references roles(id),
  access_token text unique not null,     -- the magic link
  status text default 'invited',         -- invited|system_check|in_progress|submitted|scored|expired
  consent_at timestamptz,                -- REQUIRED before any recording
  started_at timestamptz,
  submitted_at timestamptz,
  expires_at timestamptz,
  overall_score numeric,
  integrity_score numeric,               -- 0-100, higher = cleaner session
  recommendation text,                   -- advance|review|reject  (advisory only)
  device_info jsonb
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid references interviews(id) on delete cascade,
  question_id uuid references questions(id),
  video_path text,                       -- supabase storage key
  duration_seconds int,
  transcript text,
  transcript_confidence numeric,
  score numeric,                         -- 0-5
  subscores jsonb,                       -- per rubric dimension
  feedback text,
  evidence_quotes jsonb,                 -- what the score is based on
  scored_at timestamptz
);

create table proctor_events (
  id bigserial primary key,
  interview_id uuid references interviews(id) on delete cascade,
  question_id uuid,
  type text not null,                    -- see §5 taxonomy
  severity int not null,                 -- 1 low, 2 medium, 3 high
  at timestamptz default now(),
  offset_ms int,                         -- ms since question started, for timeline overlay
  meta jsonb
);

create index on proctor_events (interview_id, at);
create index on answers (interview_id);
```

**Row-level security:** candidates authenticate only via `access_token`; recruiters via Supabase Auth with a `recruiters` table. Turn RLS on for every table before you go live — the default of "on but no policy" is safe, "off" is a data leak.

---

## 3. Routes & pages

**Candidate-facing**
```
/i/[token]                → landing: role info, rules, CONSENT CHECKBOX
/i/[token]/check          → system check: camera, mic, speaker, bandwidth, 5s test recording
/i/[token]/interview      → the runner (one question at a time)
/i/[token]/done           → confirmation + what happens next
```

**Recruiter-facing**
```
/admin                    → pipeline board, filters, sort by score
/admin/roles              → create role, edit rubric, manage question bank
/admin/interviews/[id]    → the review page: video player + transcript + scores + event timeline
```

**API**
```
POST /api/interviews/[id]/consent        → stamps consent_at, unlocks recording
POST /api/answers/upload-url             → returns signed Supabase upload URL
POST /api/answers/[id]/complete          → marks uploaded, enqueues transcribe+score job
POST /api/proctor/events                 → batched event ingest (see §5)
POST /api/interviews/[id]/submit         → finalize, enqueue aggregate scoring
GET  /api/admin/interviews               → list w/ filters
```

---

## 4. Phase plan

Each phase is one Claude Code session. Do not start the next until the current one is deployed and manually tested — agent-built projects rot fast when you stack unverified layers.

### Phase 0 — Decisions (½ day, no code)
Write these down before touching the repo:
- Which role are you hiring for first? Build for exactly one.
- 6 questions, with an `ideal_answer` for each. Write them yourself; LLM-generated questions are generic.
- The rubric (§6) and what score means "advance."
- Retention: how long do you keep videos? Pick a number (90 days is sane) and put it in the consent copy.
- Who reviews flagged interviews? Name a person.

### Phase 1 — Skeleton (1 day)
Next.js + TS + Tailwind, Supabase connected, schema migrated, seed one role + 6 questions, magic-link token generation, recruiter auth. Deploy to Vercel *now* so you're never debugging deploy at the end.

**Done when:** you can generate a link, open it on your phone, and see the landing page with role details.

### Phase 2 — Consent + system check (1 day)
- Landing page states plainly: video and audio are recorded, tab-switching and window focus are logged, data retained N days, AI assists scoring but a human makes the decision.
- Explicit checkbox → `POST /consent`. **No `getUserMedia` call before consent is stamped.** This is the single most important line in the build.
- Check page: enumerate devices, let them pick camera/mic, show live preview + a mic level meter, record 5 seconds and play it back, run a small upload to measure bandwidth.

**Done when:** it works on Chrome Android, Safari iOS, and desktop Chrome. iOS Safari will break something — find out now, not on launch day.

### Phase 3 — The interview runner (2 days)
The core loop. See §7 for the recording code.

Per question: show text → prep countdown → recording starts automatically → answer countdown with visible timer → auto-stop at limit or manual "Done" → upload → next question. No back button. No re-record in v1 (add "one retake per interview" later if candidates complain).

**Critical:** upload each answer as soon as it's recorded, in the background, while the candidate reads the next question. Do not hold 9 minutes of video in memory and upload at the end — that's where mobile sessions die.

**Done when:** you complete a full 6-question interview on a phone on mobile data and all 6 files land in Storage.

### Phase 4 — Proctoring layer (1–2 days)
Everything in §5. Build it as one `useProctor(interviewId, questionId)` hook so it's testable in isolation.

**Done when:** you can deliberately tab-switch, exit fullscreen, unplug the webcam, and paste text, then see all four events on the recruiter timeline at the right timestamps.

### Phase 5 — Transcription + scoring pipeline (2 days)
Background job per answer: download from Storage → extract audio → STT → Claude scoring call (§6) → write score, subscores, feedback, evidence quotes. Then an aggregate job on submit: overall score, integrity score, recommendation.

Make it idempotent and retryable. Store the raw STT response and the raw model response in a `jsonb` column — you will need them when you debug a weird score.

**Done when:** you submit a test interview and scores appear within 3 minutes without you touching anything.

### Phase 6 — Recruiter dashboard (2 days)
The review page is the product. Get this right:
- Video player with the **proctor event timeline underneath the scrubber** — colored ticks you can click to jump to that moment.
- Transcript synced to playback, clicking a line seeks the video.
- Per-question score with the model's evidence quotes visible, so a recruiter can see *why* in two seconds.
- Two buttons: Advance / Reject, plus a free-text note. Log who clicked what and when.
- **Override is one click.** If overriding the AI is harder than agreeing with it, recruiters will just agree with it.

### Phase 7 — Calibration (1 week, part-time — do not skip)
Run 20–30 real candidates. Have a human score every one *blind* to the AI score. Then compare.
- If AI and human disagree by >1 point on more than ~25% of answers, your rubric is too vague. Rewrite it, don't tweak the prompt.
- Check score distribution by candidate gender, mother tongue, and college tier. If a group scores systematically lower, your rubric is probably rewarding fluent English rather than the competency you care about. Fix the rubric.
- Only after calibration do you let the score influence real decisions.

### Phase 8 — Hardening & launch
Rate limits, token expiry, retention cron job that actually deletes videos, error monitoring (Sentry), a "something broke" path that lets a candidate resume rather than losing their session.

---

## 5. Proctoring: what to build and what it's worth

Log everything, trust nothing individually. Every signal below has an innocent explanation.

| Event type | Severity | Innocent explanation you must account for |
|---|---|---|
| `tab_hidden` / `window_blur` | 2 | Incoming call, notification popup |
| `fullscreen_exited` | 1 | Accidental Esc |
| `no_face_detected` | 2 | Bad lighting, dark skin + cheap laptop camera, looking down to think |
| `multiple_faces_detected` | 2 | Family member walked past; most Indian candidates interview from a shared room |
| `camera_stream_ended` | 3 | Cable knocked out, browser bug |
| `paste_into_field` | 2 | — (fairly strong signal) |
| `devtools_shortcut` | 1 | Reflex |
| `long_silence` | 1 | Thinking, or the question was bad |
| `network_drop` | 1 | India, on mobile data |

**Integrity score, not a verdict:**
```ts
const raw = events.reduce((sum, e) => sum + WEIGHTS[e.type] * e.severity, 0);
const integrity = Math.max(0, 100 - Math.min(60, raw));  // floor the damage
```
Cap it. One bad minute shouldn't zero someone out.

**Hard rules:**
- Never auto-reject on proctoring signals. Flag for human review. That's it.
- Never claim in your UI that the system "detects cheating." It detects *events*. Say that.
- Multiple-monitor detection is not reliable in a browser. Skip it; don't ship a feature that generates false accusations.
- Aggressive lockdown (disabling right-click, blocking copy) stops nobody technical and irritates everybody else. Log the attempt, don't block it.

**Batch the events.** Buffer client-side and POST every 5 seconds or 20 events, whichever comes first, plus a `sendBeacon` flush on `pagehide`. One request per event will melt your API route.

```ts
// lib/proctor.ts — sketch
const buffer: ProctorEvent[] = [];
const push = (type: string, severity: number, meta = {}) => {
  buffer.push({ type, severity, meta, at: Date.now(),
                offset_ms: Date.now() - questionStartedAt });
  if (buffer.length >= 20) flush();
};

document.addEventListener('visibilitychange', () =>
  push(document.hidden ? 'tab_hidden' : 'tab_visible', 2));
window.addEventListener('blur',  () => push('window_blur', 2));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) push('fullscreen_exited', 1);
});
window.addEventListener('pagehide', () =>
  navigator.sendBeacon('/api/proctor/events', JSON.stringify(buffer)));
```

Note: `visibilitychange` fires on mobile whenever a notification is tapped or the screen locks. On mobile, downgrade its severity or you'll flag every candidate.

---

## 6. Rubric + scoring prompt

**Rubric lives in the DB, not the prompt.** Stored on `roles.rubric`:

```json
{
  "dimensions": [
    { "key": "relevance",   "label": "Answers the question asked", "weight": 0.3 },
    { "key": "depth",       "label": "Specific, concrete, not generic", "weight": 0.3 },
    { "key": "correctness", "label": "Technically accurate", "weight": 0.25 },
    { "key": "clarity",     "label": "Structured and understandable", "weight": 0.15 }
  ],
  "anchors": {
    "0": "No usable answer, or off-topic",
    "1": "Vague; restates the question without content",
    "2": "Partially relevant; generic examples only",
    "3": "Solid, correct, at least one specific example",
    "4": "Strong; specific, correct, shows reasoning about tradeoffs",
    "5": "Excellent; specific, correct, and surfaces a nuance most candidates miss"
  }
}
```

Scoring call — one per answer, `claude-sonnet-5`, `temperature: 0`:

```ts
const system = `You are scoring one answer from a recorded job interview.
You are given a machine transcript, so ignore filler words, false starts, and
transcription errors. Score the SUBSTANCE of what the candidate said.

Rules:
- Do not reward or penalise English fluency, accent, grammar, or vocabulary,
  except where the answer is genuinely incomprehensible.
- Do not infer anything about the candidate beyond the transcript.
- Quote the exact words you based each score on.
- If the transcript is too short or garbled to judge, return
  "insufficient_evidence": true and do not guess a score.

Return ONLY valid JSON, no markdown fences, matching this shape:
{"subscores":{"relevance":0-5,"depth":0-5,"correctness":0-5,"clarity":0-5},
 "score":0-5,"feedback":"<40 words, addressed to the recruiter>",
 "evidence_quotes":["..."],"insufficient_evidence":false}`;

const user = `QUESTION: ${q.text}
COMPETENCY: ${q.competency}
WHAT A STRONG ANSWER CONTAINS: ${q.ideal_answer}
SCORING ANCHORS: ${JSON.stringify(rubric.anchors)}

TRANSCRIPT:
"""${transcript}"""`;
```

Then compute `score` yourself from the weighted subscores rather than trusting the model's own aggregate — it drifts.

**Score the transcript, not the video.** Judging body language, eye contact, or "confidence" from webcam footage is where hiring tools generate discrimination claims, and the signal is close to noise anyway.

---

## 7. The recording core

```ts
// hooks/useAnswerRecorder.ts — the bit that matters
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
    body: JSON.stringify({ interviewId, questionId, mimeType })
  }).then(r => r.json());

  await fetch(uploadUrl, { method: 'PUT', body: blob });      // direct to Storage
  await fetch(`/api/answers/${answerId}/complete`, { method: 'POST' });
};

rec.start(1000);   // 1s timeslices — survives a crash mid-answer
```

Gotchas that will cost you a day each if you don't know them:
- **iOS Safari** ignores `videoBitsPerSecond`, only recently supports `MediaRecorder` properly, and refuses `getUserMedia` on non-HTTPS. Test on a real iPhone, not the simulator.
- **Autoplay policy:** the AudioContext for your mic meter must be created inside a user gesture (the "Start" click), or it stays suspended.
- **800 kbps at 480p is plenty.** You're transcribing speech and letting a human glance at the face. 1080p triples your storage bill for zero decision value.
- Always `stream.getTracks().forEach(t => t.stop())` on unmount, or the camera light stays on and candidates panic.

---

## 8. Cost per interview (6 questions, ~9 min)

| Item | Cost |
|---|---|
| STT @ ~$0.004/min | ~$0.04 |
| Claude Sonnet 5 scoring, 6 calls + 1 aggregate | ~$0.05 |
| Storage, 9 min @ 800kbps ≈ 55 MB, 90 days | ~$0.002 |
| **Total** | **≈ $0.10 / ₹9 per candidate** |

500 candidates ≈ ₹4,500. Vercel + Supabase free tiers hold until you're well past that. Use the Batch API (50% off) for scoring if you don't need results within the hour.

---

## 9. Legal & fairness (India)

- **DPDP Act 2023:** biometric-adjacent video, collected for a stated purpose, with consent, retained no longer than needed, deletable on request. Build the delete endpoint in Phase 1, not "later."
- **Consent must be specific and pre-recording.** A buried line in a privacy policy isn't consent.
- Tell candidates plainly that AI assists the evaluation and a human makes the decision — then make that actually true.
- Keep an audit trail: score, who reviewed, what they decided, when. If a candidate ever disputes a rejection, this is your entire defence.
- Offer an accessibility path: a candidate who can't do a video interview gets a written or scheduled human alternative. Say so on the landing page.
- If you ever screen candidates in the EU or NYC, this becomes a regulated high-risk system with audit requirements. Different conversation — flag it before it happens.

---

## 10. Working with Claude Code and Antigravity

**Split the work by strength:**
- **Claude Code** — schema, API routes, the scoring pipeline, the dashboard, refactors. Anything that's mostly logic and types.
- **Antigravity** — the browser-heavy surfaces (system check, recorder, proctor hook), because its browser control lets it actually load the page, click through, and see what broke instead of guessing.

**Put a `CLAUDE.md` at the repo root** — this is what stops agents from redesigning your architecture every session:

```md
# Project rules
- Next.js 15 App Router, TypeScript strict, Tailwind. No new deps without asking.
- Supabase is the only backend. No new services.
- Never call getUserMedia before interviews.consent_at is set.
- Proctoring events are advisory. Never write code that auto-rejects a candidate.
- Scoring reads transcripts only. Never send video frames to the LLM.
- Every API route validates input with zod and checks the access token.
- Read PLAN.md before starting. Work on one phase only.
```

**How to prompt per phase:** point it at the plan, scope it hard, demand a checkpoint.
> "Read PLAN.md and CLAUDE.md. Implement Phase 3 only — the interview runner. Do not touch the proctoring layer or the scoring pipeline. Start by listing the files you'll create and the state machine for the question loop, and wait for my approval before writing code."

**Non-negotiables when agents build this:**
- Commit at the end of every phase. Agent-built code is easy to generate and hard to un-tangle.
- Never let it commit `.env`. Supabase service-role key in the client bundle = full database access for anyone who opens devtools.
- Review the RLS policies yourself, by hand. Agents write permissive policies because permissive policies make tests pass.
- Manually run one full interview after every phase. Automated tests won't catch "the camera light stayed on" or "the timer drifts on Safari."

---

## 11. Two-week schedule

| Days | Phase |
|---|---|
| 1 | 0 + 1 — decisions, skeleton, deployed |
| 2 | 2 — consent + system check, cross-device |
| 3–4 | 3 — interview runner |
| 5–6 | 4 — proctoring layer |
| 7–8 | 5 — transcription + scoring |
| 9–10 | 6 — recruiter dashboard |
| 11–14 | 7 — calibration with real candidates, rubric fixes |
| then | 8 — hardening, launch |

---

## First thing to do tomorrow

Write the 6 questions and their `ideal_answer`s for one role. Everything downstream — the rubric, the scoring quality, whether this tool is better than a human skim of a résumé — is determined by that document, and no amount of good engineering fixes bad questions.
