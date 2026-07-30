"use client";

import React, { useEffect, useMemo, useRef, useState, use } from "react";

interface VideoSegment {
  seq: number;
  url: string;
  startedAtMs: number;
  endedAtMs: number;
  bytes?: number;
}

interface TranscriptLine {
  role: "ai" | "candidate";
  text: string;
  ts: number;
  latencyMs?: number;
}

interface ProctorEvent {
  id: number;
  type: string;
  severity: number;
  at: string;
  offset_ms: number | null;
  meta: Record<string, unknown> | null;
}

interface QuestionRow {
  id: string;
  position: number;
  kind: "core" | "probe";
  text: string;
  competency: string | null;
  ideal_answer: string | null;
  source_ref: { type?: string; label?: string; reason?: string; rationale?: string } | null;
  score: string | number | null;
  subscores: Record<string, number> | null;
  corroboration: string | null;
  feedback: string | null;
  evidence_quotes: string[] | null;
  scored_at: string | null;
}

interface InterviewDetail {
  id: string;
  status: string;
  job_title: string;
  job_rubric: { dimensions?: { key: string; label: string; weight: number }[] };
  candidate_name: string;
  candidate_email: string;
  core_score: number | null;
  integrity_score: number | null;
  overall_match: number | null;
  recommendation: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  transcript: TranscriptLine[] | null;
  video_segments: VideoSegment[] | null;
  duration_seconds: number | null;
  submitted_at: string | null;
  evaluated_at: string | null;
}

const SEVERITY_LABEL: Record<number, string> = { 1: "Low", 2: "Medium", 3: "High" };
const SEVERITY_CLASS: Record<number, string> = {
  1: "bg-muted text-muted-foreground",
  2: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  3: "bg-destructive/15 text-destructive",
};

function scoreColor(score: number | null) {
  if (score === null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

export default function InterviewReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [interview, setInterview] = useState<InterviewDetail | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [proctorEvents, setProctorEvents] = useState<ProctorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [reviewedBy, setReviewedBy] = useState("");
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  const [segmentIndex, setSegmentIndex] = useState(0);
  const [seekTarget, setSeekTarget] = useState<{ segment: number; offsetSec: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/admin/interviews/${id}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to load interview.");
      setInterview(data.interview);
      setQuestions(data.questions);
      setProctorEvents(data.proctorEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load interview.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const segments = interview?.video_segments ?? [];

  useEffect(() => {
    if (!seekTarget || !videoRef.current) return;
    if (segmentIndex !== seekTarget.segment) return;
    videoRef.current.currentTime = seekTarget.offsetSec;
    void videoRef.current.play().catch(() => {});
    setSeekTarget(null);
  }, [segmentIndex, seekTarget]);

  function seekToTranscriptLine(line: TranscriptLine) {
    const idx = segments.findIndex((s) => line.ts >= s.startedAtMs && line.ts <= s.endedAtMs);
    if (idx === -1) return;
    const offsetSec = Math.max(0, (line.ts - segments[idx].startedAtMs) / 1000);
    if (idx === segmentIndex && videoRef.current) {
      videoRef.current.currentTime = offsetSec;
      void videoRef.current.play().catch(() => {});
    } else {
      setSeekTarget({ segment: idx, offsetSec });
      setSegmentIndex(idx);
    }
  }

  const coreQuestions = useMemo(() => questions.filter((q) => q.kind === "core"), [questions]);
  const probeQuestions = useMemo(() => questions.filter((q) => q.kind === "probe"), [questions]);

  async function submitDecision(recommendation: "advance" | "reject") {
    if (!reviewedBy.trim()) {
      setError("Enter your name before deciding.");
      return;
    }
    setDeciding(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/interviews/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation, reviewedBy: reviewedBy.trim(), note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to save decision.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save decision.");
    } finally {
      setDeciding(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <span className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <p className="text-destructive">{error || "Interview not found."}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground py-10 px-6 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="bg-card border border-border rounded-3xl p-6 md:p-8 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold">{interview.candidate_name}</h1>
              <p className="text-muted-foreground text-sm">
                {interview.candidate_email} &middot; {interview.job_title}
              </p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-secondary text-secondary-foreground border border-border">
              {interview.status}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="rounded-2xl border border-border bg-secondary p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Core Score</span>
              <p className={`font-display text-3xl font-bold ${scoreColor(interview.core_score)}`}>
                {interview.core_score !== null ? Math.round(interview.core_score) : "—"}
                <span className="text-base text-muted-foreground">/100</span>
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-secondary p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Resume Match <span className="normal-case">(not part of interview score)</span>
              </span>
              <p className="font-display text-3xl font-bold text-muted-foreground">
                {interview.overall_match !== null ? Math.round(interview.overall_match) : "—"}
                <span className="text-base">%</span>
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-secondary p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Integrity Score</span>
              <p className={`font-display text-3xl font-bold ${scoreColor(interview.integrity_score)}`}>
                {interview.integrity_score !== null ? Math.round(interview.integrity_score) : "—"}
                <span className="text-base text-muted-foreground">/100</span>
              </p>
            </div>
          </div>

          {interview.recommendation && (
            <div className="text-sm text-muted-foreground pt-1">
              Decision: <span className="font-semibold text-foreground capitalize">{interview.recommendation}</span>
              {interview.reviewed_by && ` by ${interview.reviewed_by}`}
              {interview.reviewed_at && ` on ${new Date(interview.reviewed_at).toLocaleString()}`}
              {interview.review_note && <> — &ldquo;{interview.review_note}&rdquo;</>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Video + proctor timeline */}
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-3xl p-4 space-y-3">
              {segments.length > 0 ? (
                <>
                  <video
                    ref={videoRef}
                    key={segments[segmentIndex]?.url}
                    src={segments[segmentIndex]?.url}
                    controls
                    className="w-full rounded-2xl bg-black aspect-video"
                    onEnded={() => setSegmentIndex((i) => Math.min(i + 1, segments.length - 1))}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <button
                      onClick={() => setSegmentIndex((i) => Math.max(0, i - 1))}
                      disabled={segmentIndex === 0}
                      className="px-3 py-1.5 rounded-lg bg-secondary disabled:opacity-40"
                    >
                      Prev part
                    </button>
                    <span>
                      Part {segmentIndex + 1} of {segments.length}
                    </span>
                    <button
                      onClick={() => setSegmentIndex((i) => Math.min(segments.length - 1, i + 1))}
                      disabled={segmentIndex === segments.length - 1}
                      className="px-3 py-1.5 rounded-lg bg-secondary disabled:opacity-40"
                    >
                      Next part
                    </button>
                  </div>
                </>
              ) : (
                <div className="aspect-video rounded-2xl bg-muted flex items-center justify-center text-sm text-muted-foreground">
                  No recording available.
                </div>
              )}
            </div>

            <div className="bg-card border border-border rounded-3xl p-6 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Proctor Timeline ({proctorEvents.length})
              </h2>
              {proctorEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events logged.</p>
              ) : (
                <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {proctorEvents.map((e) => (
                    <li key={e.id} className="flex items-center justify-between text-xs gap-2">
                      <span className="text-muted-foreground shrink-0">
                        {new Date(e.at).toLocaleTimeString()}
                      </span>
                      <span className="flex-1 text-foreground">{e.type.replace(/_/g, " ")}</span>
                      <span className={`px-2 py-0.5 rounded-full font-semibold shrink-0 ${SEVERITY_CLASS[e.severity] ?? ""}`}>
                        {SEVERITY_LABEL[e.severity] ?? e.severity}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground pt-1">
                Advisory only — proctoring signals never auto-reject a candidate.
              </p>
            </div>
          </div>

          {/* Transcript */}
          <div className="bg-card border border-border rounded-3xl p-6 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Transcript</h2>
            {!interview.transcript || interview.transcript.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transcript available.</p>
            ) : (
              <ul className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
                {interview.transcript.map((line, i) => (
                  <li key={i}>
                    <button
                      onClick={() => seekToTranscriptLine(line)}
                      className="text-left w-full rounded-xl px-3 py-2 hover:bg-accent transition-colors"
                    >
                      <span
                        className={`text-xs font-bold uppercase tracking-wider ${
                          line.role === "ai" ? "text-primary" : "text-muted-foreground"
                        }`}
                      >
                        {line.role === "ai" ? "Interviewer" : "Candidate"}
                      </span>
                      <p className="text-sm mt-0.5">{line.text}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Core questions */}
        <div className="space-y-4">
          <h2 className="font-display text-xl font-bold">Core Questions</h2>
          {coreQuestions.map((q) => (
            <div key={q.id} className="bg-card border border-border rounded-3xl p-6 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-primary">{q.competency}</span>
                  <p className="font-medium mt-1">{q.text}</p>
                </div>
                <span className={`font-display text-2xl font-bold shrink-0 ${scoreColor(q.score !== null ? Number(q.score) * 20 : null)}`}>
                  {q.score !== null ? Number(q.score).toFixed(1) : "—"}
                  <span className="text-sm text-muted-foreground">/5</span>
                </span>
              </div>
              {q.subscores && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(q.subscores).map(([k, v]) => (
                    <span key={k} className="text-xs px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground">
                      {k}: {v}/5
                    </span>
                  ))}
                </div>
              )}
              {q.feedback && <p className="text-sm text-muted-foreground">{q.feedback}</p>}
              {q.evidence_quotes && q.evidence_quotes.length > 0 && (
                <div className="space-y-1">
                  {q.evidence_quotes.map((quote, i) => (
                    <p key={i} className="text-sm italic text-muted-foreground border-l-2 border-primary/40 pl-3">
                      &ldquo;{quote}&rdquo;
                    </p>
                  ))}
                </div>
              )}
              {q.score === null && <p className="text-xs text-muted-foreground">Not yet evaluated (or insufficient evidence).</p>}
            </div>
          ))}
        </div>

        {/* Probe questions */}
        {probeQuestions.length > 0 && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold">Probe Questions — Evidence for Review</h2>
            {probeQuestions.map((q) => (
              <div key={q.id} className="bg-card border border-border rounded-3xl p-6 space-y-2">
                {q.source_ref && (
                  <p className="text-xs text-muted-foreground">
                    {q.source_ref.type === "gap" ? "Gap check" : "Claim check"}: {q.source_ref.label}
                    {q.source_ref.reason ? ` — ${q.source_ref.reason}` : ""}
                    {q.source_ref.rationale ? ` (${q.source_ref.rationale})` : ""}
                  </p>
                )}
                <p className="font-medium">{q.text}</p>
                {q.corroboration && (
                  <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground capitalize">
                    {q.corroboration.replace(/_/g, " ")}
                  </span>
                )}
                {q.feedback && <p className="text-sm text-muted-foreground">{q.feedback}</p>}
                {q.evidence_quotes && q.evidence_quotes.length > 0 && (
                  <div className="space-y-1">
                    {q.evidence_quotes.map((quote, i) => (
                      <p key={i} className="text-sm italic text-muted-foreground border-l-2 border-primary/40 pl-3">
                        &ldquo;{quote}&rdquo;
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Decision */}
        <div className="bg-card border border-border rounded-3xl p-6 md:p-8 space-y-4">
          <h2 className="font-display text-xl font-bold">Decision</h2>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <input
            type="text"
            value={reviewedBy}
            onChange={(e) => setReviewedBy(e.target.value)}
            placeholder="Your name"
            className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-ring"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            rows={3}
            className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-ring resize-none"
          />
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => submitDecision("advance")}
              disabled={deciding}
              className="flex-1 py-3.5 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 disabled:opacity-50"
            >
              Advance
            </button>
            <button
              onClick={() => submitDecision("reject")}
              disabled={deciding}
              className="flex-1 py-3.5 bg-secondary text-secondary-foreground border border-border rounded-xl font-semibold hover:bg-accent disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
