-- Schema setup for AI Interview Agent (Neon PostgreSQL)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: jobs
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  jd_raw TEXT,
  jd_parsed JSONB,                 -- ParsedJD JSON structure
  rubric JSONB NOT NULL,           -- Evaluation rubric
  invite_threshold NUMERIC DEFAULT 60,     -- pre-interview gate: resume/JD match required to even be invited
  minimum_interview_score NUMERIC,         -- post-interview gate: core_score required to auto-qualify (nullable = no auto-qualify decision made)
  status VARCHAR(50) DEFAULT 'draft', -- draft | questions_pending_review | live | closed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: core_questions
CREATE TABLE IF NOT EXISTS core_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  position INT NOT NULL,
  text TEXT NOT NULL,
  competency VARCHAR(100) NOT NULL, -- maps to a ParsedJD requirement key
  ideal_answer TEXT,               -- criteria candidate is scored against (hidden)
  prep_seconds INT DEFAULT 30,
  answer_seconds INT DEFAULT 120,
  approved_by UUID,                -- recruiter uuid who approved it (optional for v1)
  approved_at TIMESTAMPTZ
);

-- Table: candidates
CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: resumes
CREATE TABLE IF NOT EXISTS resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  file_path TEXT,
  parsed JSONB,                    -- ParsedResume JSON
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  parser_version VARCHAR(50)
);

-- Table: match_reports
CREATE TABLE IF NOT EXISTS match_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES resumes(id),
  overall_match NUMERIC,
  dimension_scores JSONB,
  gaps JSONB,
  verifiable_claims JSONB,
  matcher_version VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: interviews
CREATE TABLE IF NOT EXISTS interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id),
  job_id UUID REFERENCES jobs(id),
  match_report_id UUID REFERENCES match_reports(id),
  access_token VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'invited', -- invited | system_check | in_progress | submitted | scored | expired
  consent_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  core_score NUMERIC,              -- 0-100 core ranking score
  integrity_score NUMERIC,         -- 0-100 proctoring integrity score
  recommendation VARCHAR(50),      -- advance | review | reject
  device_info JSONB,
  -- Live voice interview (interview-level, not per-answer -- one continuous call):
  transcript JSONB,                -- ordered [{role,text,ts,latencyMs}]
  video_segments JSONB DEFAULT '[]', -- [{seq,url,startedAtMs,endedAtMs,bytes}], ~3-min checkpointed segments
  duration_seconds INT,
  video_finalized_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ,
  session_mint_count INT DEFAULT 0,
  -- Recruiter decision audit trail (PLAN.md §12: who reviewed, what they
  -- decided, when -- this is the entire defence if a rejection is disputed):
  reviewed_by VARCHAR(255),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Decision Engine (advisory only -- see CLAUDE.md): auto_qualified is
  -- computed in code from core_score >= jobs.minimum_interview_score at
  -- evaluation time. It does NOT auto-advance or auto-schedule anything on
  -- its own -- a human recruiter still makes the advance/reject call via
  -- interviews.recommendation. NULL means the job has no
  -- minimum_interview_score set, so no auto-qualify decision was made.
  auto_qualified BOOLEAN,
  -- Pre-interview environment scan (system-check step): candidate pans the
  -- camera around their surroundings before Start Interview unlocks. Content
  -- is advisory-only for a human reviewer, same as all other proctoring
  -- signals -- never auto-analyzed or auto-rejected.
  room_scan_url TEXT,
  student_id_value TEXT,
  student_id_verified_at TIMESTAMPTZ,
  student_id_snapshot_url TEXT
);

-- Table: interview_questions
CREATE TABLE IF NOT EXISTS interview_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE,
  position INT NOT NULL,
  kind VARCHAR(20) NOT NULL,       -- core | probe
  text TEXT NOT NULL,
  competency VARCHAR(100),
  ideal_answer TEXT,
  source_ref JSONB,
  core_question_id UUID REFERENCES core_questions(id),
  prep_seconds INT DEFAULT 30,
  answer_seconds INT DEFAULT 120
);

-- Table: answers
-- One row per interview_question, populated by post-call evaluation (not per-clip-upload
-- anymore -- the interview is one continuous live call, see interviews.transcript).
CREATE TABLE IF NOT EXISTS answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE,
  interview_question_id UUID REFERENCES interview_questions(id) UNIQUE,
  video_path TEXT,                 -- DEPRECATED: recording is interview-level now (interviews.video_segments)
  duration_seconds INT,            -- DEPRECATED: see interviews.duration_seconds
  transcript TEXT,                 -- excerpt attributed to this question by evaluation
  transcript_confidence NUMERIC,
  score NUMERIC,                   -- 0-5, CORE only, computed in code from subscores
  subscores JSONB,
  corroboration VARCHAR(50),       -- PROBE only: corroborated | partial | not_corroborated | unclear
  feedback TEXT,
  evidence_quotes JSONB,
  raw_model_response JSONB,
  scored_at TIMESTAMPTZ,
  evidence_start_ms INT,           -- offset into interviews.transcript/video for dashboard seek
  evidence_end_ms INT
);

-- Table: proctor_events
CREATE TABLE IF NOT EXISTS proctor_events (
  id BIGSERIAL PRIMARY KEY,
  interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE,
  interview_question_id UUID,
  type VARCHAR(100) NOT NULL,
  severity INT NOT NULL,
  at TIMESTAMPTZ DEFAULT NOW(),
  offset_ms INT,
  meta JSONB
);

-- Create performance indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_core_questions_job_id ON core_questions(job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_proctor_events_interview_id ON proctor_events(interview_id);
CREATE INDEX IF NOT EXISTS idx_answers_interview_id ON answers(interview_id);
CREATE INDEX IF NOT EXISTS idx_match_reports_job_candidate ON match_reports(job_id, candidate_id);

-- ============================================================================
-- Migration: PLAN.md Phase A -- live voice interview columns.
-- The CREATE TABLE blocks above already include these for a fresh database;
-- these ALTERs make the change idempotent against a database that was
-- provisioned before this phase (no migration tool in this repo -- schema.sql
-- is applied by hand, so re-running the whole file must be safe either way).
-- ============================================================================
ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS transcript JSONB,
  ADD COLUMN IF NOT EXISTS video_segments JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS duration_seconds INT,
  ADD COLUMN IF NOT EXISTS video_finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_mint_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS auto_qualified BOOLEAN,
  ADD COLUMN IF NOT EXISTS room_scan_url TEXT,
  ADD COLUMN IF NOT EXISTS student_id_value TEXT,
  ADD COLUMN IF NOT EXISTS student_id_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS student_id_snapshot_url TEXT;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS minimum_interview_score NUMERIC;

ALTER TABLE answers
  ADD COLUMN IF NOT EXISTS evidence_start_ms INT,
  ADD COLUMN IF NOT EXISTS evidence_end_ms INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'candidates_email_key'
  ) THEN
    ALTER TABLE candidates
      ADD CONSTRAINT candidates_email_key UNIQUE (email);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'answers_interview_question_id_key'
  ) THEN
    ALTER TABLE answers
      ADD CONSTRAINT answers_interview_question_id_key UNIQUE (interview_question_id);
  END IF;
END $$;
