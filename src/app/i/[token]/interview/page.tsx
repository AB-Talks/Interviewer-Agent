"use client";

import { useCallback, useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { useProctor } from "@/lib/interview/useProctor";

// Hard safety cutoff. The 20-25 min target is a ceiling the AI paces itself
// against (see instructions.ts) -- it is intentionally not shown to the
// candidate as a countdown, only this outer safety cap exists client-side.
const HARD_CAP_SECONDS = 30 * 60;
// Manual "End interview" is disabled before this -- guards against an
// accidental/impulsive early exit, not the AI's own early-conclusion judgment.
const MIN_MANUAL_END_SECONDS = 3 * 60;
// Video is checkpointed in ~3-minute segments (segmented-file strategy, not a
// single repeatedly-re-uploaded blob -- see PLAN.md design notes).
const SEGMENT_DURATION_MS = 3 * 60 * 1000;
const REALTIME_CALLS_URL_BASE = "https://api.openai.com/v1/realtime/calls";

type Phase =
  | "checking_consent"
  | "loading_media"
  | "ready"
  | "connecting"
  | "live"
  | "ending"
  | "done"
  | "error"
  | "offer_preview";

interface TranscriptLine {
  role: "ai" | "candidate";
  text: string;
  ts: number;
  latencyMs?: number;
}

// Round-tripped through the client for the TEMPORARY text-preview mode (see
// /api/interviews/[token]/turn) -- that route is otherwise stateless.
interface TurnState {
  questionIndex: number;
  followUpCount: number;
  stuckCoreCount: number;
  coreAnsweredCount: number;
}

interface TurnLabel {
  text: string;
  kind: "core" | "probe" | "followup" | "closing";
}

// Minimal ambient shape for the (non-standard, webkit-prefixed) Web Speech
// API -- not part of TS's default DOM lib. Used only for the optional
// dictation convenience in text-preview mode.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export default function LiveInterviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const router = useRouter();
  const { token } = use(params);

  const [phase, setPhase] = useState<Phase>("checking_consent");
  const [errorMessage, setErrorMessage] = useState("");
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [transcriptCount, setTranscriptCount] = useState(0);
  const [interviewId, setInterviewId] = useState<string | null>(null);

  // TEMPORARY text-preview mode (see /api/interviews/[token]/turn) -- used
  // only while OPENAI_API_KEY has no billing attached, so the team can walk
  // through the interview flow without the live voice call.
  const [textPreviewMode, setTextPreviewMode] = useState(false);
  const [currentTurn, setCurrentTurn] = useState<TurnLabel | null>(null);
  const [answerDraft, setAnswerDraft] = useState("");
  const [turnBusy, setTurnBusy] = useState(false);
  const [dictating, setDictating] = useState(false);
  const turnStateRef = useRef<TurnState | null>(null);
  const lastQuestionIdRef = useRef<string | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const proctorEnabled = phase === "ready" || phase === "connecting" || phase === "live";
  const { push: pushProctorEvent } = useProctor(token, proctorEnabled);

  // Media
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoElRef = useRef<HTMLVideoElement | null>(null);
  const aiAudioElRef = useRef<HTMLAudioElement | null>(null);

  // WebRTC
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  // Recording (mixed local + AI audio, segmented every ~3 min)
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const segmentSeqRef = useRef(0);
  const segmentStartRef = useRef(0);
  const segmentChunksRef = useRef<Blob[]>([]);
  const segmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Transcript + turn-timing
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const lastAiTurnEndRef = useRef<number | null>(null);
  const lastSpeechStartRef = useRef<number | null>(null);

  // Silence watch (advisory proctoring signal)
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const silenceRafRef = useRef<number | null>(null);

  // Face-presence watch (advisory proctoring signal, optional dependency --
  // see src/lib/interview/faceDetector.ts)
  const faceWatchStopRef = useRef<(() => void) | null>(null);

  const startedAtRef = useRef<number | null>(null);
  const endedRef = useRef(false);

  // ---- Step 0: consent gate -- never getUserMedia before consent_at is set ----
  useEffect(() => {
    let cancelled = false;
    async function verify() {
      try {
        const res = await fetch(`/api/interviews/${token}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.interview) {
          router.replace(`/i/${token}`);
          return;
        }
        const iv = data.interview;
        if (!iv.consent_at) {
          router.replace(`/i/${token}`);
          return;
        }
        if (iv.status === "submitted" || iv.status === "scored") {
          router.replace(`/i/${token}/done`);
          return;
        }
        setInterviewId(iv.id);
        setPhase("loading_media");
      } catch {
        if (!cancelled) router.replace(`/i/${token}`);
      }
    }
    verify();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  const stopEverything = useCallback(() => {
    if (silenceRafRef.current !== null) cancelAnimationFrame(silenceRafRef.current);
    if (segmentTimerRef.current !== null) clearInterval(segmentTimerRef.current);
    faceWatchStopRef.current?.();
    faceWatchStopRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    recordedStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordedStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  useEffect(() => stopEverything, [stopEverything]);

  useEffect(() => {
    if (localVideoElRef.current && localStreamRef.current) {
      localVideoElRef.current.srcObject = localStreamRef.current;
    }
  }, [phase]);

  // ---- Step 1: acquire camera + mic ----
  useEffect(() => {
    if (phase !== "loading_media") return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoElRef.current) localVideoElRef.current.srcObject = stream;

        stream.getVideoTracks().forEach((t) => {
          t.addEventListener("ended", () => pushProctorEvent("camera_stream_ended", 3));
        });

        setPhase("ready");
      } catch {
        setErrorMessage("Camera or microphone access denied. Allow permissions and reload to continue.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, pushProctorEvent]);

  const pushTranscript = useCallback((line: TranscriptLine) => {
    transcriptRef.current = [...transcriptRef.current, line];
    setTranscriptCount(transcriptRef.current.length);
  }, []);

  // Uploads the just-finished segment blob and registers it via /checkpoint.
  const flushSegment = useCallback(
    async (blob: Blob, seq: number, startedAtMs: number, endedAtMs: number) => {
      if (!interviewId) return;
      try {
        const result = await upload(`interviews/${interviewId}/segment-${seq}.webm`, blob, {
          access: "public",
          handleUploadUrl: `/api/interviews/${token}/upload-url`,
        });
        await fetch(`/api/interviews/${token}/checkpoint`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segment: { seq, url: result.url, startedAtMs, endedAtMs, bytes: blob.size },
          }),
        });
      } catch (err) {
        // A dropped segment upload is recoverable (later segments + transcript
        // still land) -- log and move on rather than derailing the interview.
        console.error("[interview] segment upload failed", err);
      }
    },
    [interviewId, token],
  );

  // Periodically send transcript-so-far + elapsed duration, independent of
  // segment boundaries, so a crash never loses more than ~5s of transcript.
  const flushTranscriptCheckpoint = useCallback(() => {
    if (!startedAtRef.current) return;
    const durationSeconds = Math.round((Date.now() - startedAtRef.current) / 1000);
    fetch(`/api/interviews/${token}/checkpoint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: transcriptRef.current, durationSeconds }),
      keepalive: true,
    }).catch(() => {});
  }, [token]);

  const startNewSegment = useCallback(
    (stream: MediaStream) => {
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 800_000 });
      const seq = segmentSeqRef.current;
      const startedAtMs = Date.now();
      segmentStartRef.current = startedAtMs;
      segmentChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) segmentChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(segmentChunksRef.current, { type: mimeType });
        void flushSegment(blob, seq, startedAtMs, Date.now());
      };

      recorder.start(1000);
      recorderRef.current = recorder;
      segmentSeqRef.current += 1;
    },
    [flushSegment],
  );

  const rotateSegment = useCallback(() => {
    const stream = recordedStreamRef.current;
    if (!stream || !recorderRef.current) return;
    recorderRef.current.stop(); // triggers onstop -> upload, see startNewSegment
    startNewSegment(stream);
  }, [startNewSegment]);

  // ---- Silence watch: advisory-only proctoring signal, not used to end the call ----
  const startSilenceWatch = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const now = Date.now();
      if (avg < 3) {
        if (silenceStartRef.current === null) silenceStartRef.current = now;
        else if (now - silenceStartRef.current > 15000) {
          pushProctorEvent("long_silence", 1, { seconds: Math.round((now - silenceStartRef.current) / 1000) });
          silenceStartRef.current = now; // avoid re-firing every frame
        }
      } else {
        silenceStartRef.current = null;
      }
      silenceRafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }, [pushProctorEvent]);

  // ---- End of call ----
  const endInterview = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setPhase("ending");

    const durationSeconds = startedAtRef.current
      ? Math.round((Date.now() - startedAtRef.current) / 1000)
      : secondsElapsed;

    // Final segment + transcript checkpoint before tearing down media.
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    flushTranscriptCheckpoint();
    stopEverything();

    try {
      const res = await fetch(`/api/interviews/${token}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcriptRef.current, durationSeconds }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message ?? "Could not submit the interview.");
      }
      setPhase("done");
      router.push(`/i/${token}/done`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submission failed.";
      setErrorMessage(
        durationSeconds >= MIN_MANUAL_END_SECONDS
          ? `${message} Your progress was saved -- contact support if this persists.`
          : `${message} The interview was too short to submit; you may retry.`,
      );
      setPhase("error");
      endedRef.current = false;
    }
  }, [token, secondsElapsed, flushTranscriptCheckpoint, stopEverything, router]);

  // ---- Step 2: connect to the live AI interviewer ----
  const startInterview = useCallback(async () => {
    if (!localStreamRef.current || !interviewId) return;
    setPhase("connecting");
    endedRef.current = false;
    transcriptRef.current = [];
    segmentSeqRef.current = 0;

    try {
      const sessionRes = await fetch(`/api/interviews/${token}/session`, { method: "POST" });
      const sessionJson = await sessionRes.json();
      if (!sessionJson.ok || !sessionJson.data?.clientSecret) {
        // Live voice isn't available yet (most commonly: OPENAI_API_KEY has no
        // billing attached). Offer the text-preview fallback instead of a
        // dead-end error -- this is a deliberate, clearly-labeled substitute,
        // never a silent one.
        setErrorMessage(sessionJson.message ?? "Could not start the interview session.");
        setPhase("offer_preview");
        return;
      }
      const clientSecret: string = sessionJson.data.clientSecret;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const micTrack = localStreamRef.current.getAudioTracks()[0];
      if (micTrack) pc.addTrack(micTrack, localStreamRef.current);

      pc.ontrack = (e) => {
        const remoteStream = e.streams[0];
        if (!remoteStream) return;

        if (aiAudioElRef.current) {
          aiAudioElRef.current.srcObject = remoteStream;
          void aiAudioElRef.current.play().catch(() => {});
        }

        // Mix local mic + remote AI audio into one track so the saved
        // recording captures both sides of the conversation (mic-only
        // MediaRecorder would otherwise only hear the candidate).
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const destination = ctx.createMediaStreamDestination();
        if (localStreamRef.current) {
          ctx.createMediaStreamSource(localStreamRef.current).connect(destination);
          // Also tap the mic into an analyser for the silence watch.
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(localStreamRef.current).connect(analyser);
          analyserRef.current = analyser;
          startSilenceWatch();
        }
        ctx.createMediaStreamSource(remoteStream).connect(destination);

        const videoTrack = localStreamRef.current?.getVideoTracks()[0];
        const mixedAudioTrack = destination.stream.getAudioTracks()[0];
        const tracks = [videoTrack, mixedAudioTrack].filter((t): t is MediaStreamTrack => Boolean(t));
        const recordedStream = new MediaStream(tracks);
        recordedStreamRef.current = recordedStream;

        startNewSegment(recordedStream);
        segmentTimerRef.current = setInterval(rotateSegment, SEGMENT_DURATION_MS);

        // Face-presence proctoring is an optional dependency (@mediapipe/tasks-vision).
        // If it isn't installed yet, this silently no-ops -- everything else in
        // the interview still works (PLAN.md Phase E.2 is a separate, non-blocking sub-step).
        if (localVideoElRef.current) {
          import("@/lib/interview/faceDetector")
            .then(({ startFaceWatch }) => {
              if (localVideoElRef.current) {
                faceWatchStopRef.current = startFaceWatch(localVideoElRef.current, pushProctorEvent);
              }
            })
            .catch(() => {
              console.warn("[interview] face-presence proctoring unavailable (dependency not installed)");
            });
        }

        startedAtRef.current = Date.now();
        setPhase("live");
      };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("open", () => {
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              audio: { input: { transcription: { model: "gpt-4o-mini-transcribe" } } },
            },
          }),
        );
      });
      dc.addEventListener("message", (e) => {
        if (typeof e.data !== "string") return;
        try {
          const event = JSON.parse(e.data) as { type?: string; transcript?: string };
          // Event names per the OpenAI Realtime API as of this build -- this
          // protocol evolves; if transcripts/timing stop arriving, verify
          // current event names against the official docs and adapt names
          // only (architecture stands).
          if (event.type === "input_audio_buffer.speech_started") {
            lastSpeechStartRef.current = Date.now();
          } else if (
            event.type === "conversation.item.input_audio_transcription.completed" &&
            event.transcript?.trim()
          ) {
            const now = Date.now();
            const latencyMs =
              lastSpeechStartRef.current !== null && lastAiTurnEndRef.current !== null
                ? Math.max(0, lastSpeechStartRef.current - lastAiTurnEndRef.current)
                : undefined;
            pushTranscript({ role: "candidate", text: event.transcript.trim(), ts: now, latencyMs });
          } else if (event.type === "response.output_audio_transcript.done" && event.transcript?.trim()) {
            pushTranscript({ role: "ai", text: event.transcript.trim(), ts: Date.now() });
          } else if (event.type === "response.done") {
            lastAiTurnEndRef.current = Date.now();
          }
        } catch {
          // ignore malformed events
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const model = process.env.NEXT_PUBLIC_OPENAI_REALTIME_MODEL ?? "gpt-realtime";
      const sdpRes = await fetch(`${REALTIME_CALLS_URL_BASE}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) {
        const status = sdpRes.status;
        throw new Error(
          status === 429
            ? "The live voice interviewer is rate-limited or over quota (check OpenAI billing)."
            : `WebRTC connection failed (${status}).`,
        );
      }
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err) {
      // Any failure past this point means a client secret was minted but the
      // live call itself couldn't be established (most commonly a quota/
      // billing issue) -- offer the text-preview fallback rather than
      // silently dumping back to "ready" with an error nobody sees. Only tear
      // down the failed WebRTC attempt here, NOT the camera/mic stream --
      // startTextPreview() below needs it still running.
      const message = err instanceof Error ? err.message : "Connection failed.";
      setErrorMessage(message);
      setPhase("offer_preview");
      dcRef.current?.close();
      dcRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
    }
  }, [
    interviewId,
    token,
    startNewSegment,
    rotateSegment,
    startSilenceWatch,
    pushTranscript,
    pushProctorEvent,
  ]);

  function turnLabel(kind: "core" | "probe" | null, isFollowUp: boolean, ended: boolean): TurnLabel["kind"] {
    if (ended) return "closing";
    if (isFollowUp) return "followup";
    return kind === "probe" ? "probe" : "core";
  }

  // ---- TEMPORARY text-preview mode: same flow, but the "AI" side is a
  // Gemini text turn-by-turn engine instead of the live OpenAI voice call.
  // No AI voice output -- see /api/interviews/[token]/turn. ----
  const startTextPreview = useCallback(async () => {
    if (!localStreamRef.current || !interviewId) return;
    setTextPreviewMode(true);
    setPhase("connecting");
    endedRef.current = false;
    transcriptRef.current = [];
    segmentSeqRef.current = 0;
    turnStateRef.current = null;
    lastQuestionIdRef.current = null;

    // Recording still runs (video + candidate mic) for proctoring/review
    // parity -- there's just no remote AI audio to mix in this mode.
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    const micTrack = localStreamRef.current.getAudioTracks()[0];
    const tracks = [videoTrack, micTrack].filter((t): t is MediaStreamTrack => Boolean(t));
    const recordedStream = new MediaStream(tracks);
    recordedStreamRef.current = recordedStream;
    startNewSegment(recordedStream);
    segmentTimerRef.current = setInterval(rotateSegment, SEGMENT_DURATION_MS);

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(localStreamRef.current).connect(analyser);
    analyserRef.current = analyser;
    startSilenceWatch();

    if (localVideoElRef.current) {
      import("@/lib/interview/faceDetector")
        .then(({ startFaceWatch }) => {
          if (localVideoElRef.current) {
            faceWatchStopRef.current = startFaceWatch(localVideoElRef.current, pushProctorEvent);
          }
        })
        .catch(() => {
          console.warn("[interview] face-presence proctoring unavailable (dependency not installed)");
        });
    }

    startedAtRef.current = Date.now();

    try {
      const res = await fetch(`/api/interviews/${token}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message ?? "Could not start the preview.");
      turnStateRef.current = json.data.state;
      lastQuestionIdRef.current = json.data.questionId;
      setCurrentTurn({ text: json.data.aiText, kind: turnLabel(json.data.kind, false, json.data.ended) });
      pushTranscript({ role: "ai", text: json.data.aiText, ts: Date.now() });
      setPhase("live");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start the preview.";
      setErrorMessage(message);
      setPhase("ready");
      stopEverything();
    }
  }, [interviewId, token, startNewSegment, rotateSegment, startSilenceWatch, pushProctorEvent, pushTranscript, stopEverything]);

  const submitTextAnswer = useCallback(async () => {
    if (turnBusy || !turnStateRef.current) return;
    const answerText = answerDraft.trim();
    setTurnBusy(true);
    if (answerText) pushTranscript({ role: "candidate", text: answerText, ts: Date.now() });
    setAnswerDraft("");

    try {
      const res = await fetch(`/api/interviews/${token}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: turnStateRef.current, answerText }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message ?? "Could not submit your answer.");
      const isFollowUp = json.data.questionId === lastQuestionIdRef.current && !json.data.ended;
      turnStateRef.current = json.data.state;
      lastQuestionIdRef.current = json.data.questionId;
      setCurrentTurn({ text: json.data.aiText, kind: turnLabel(json.data.kind, isFollowUp, json.data.ended) });
      pushTranscript({ role: "ai", text: json.data.aiText, ts: Date.now() });
      setTurnBusy(false);
      if (json.data.ended) {
        void endInterview();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not submit your answer.";
      setErrorMessage(message);
      setTurnBusy(false);
    }
  }, [token, turnBusy, answerDraft, pushTranscript, endInterview]);

  // Optional dictation convenience for the answer box -- browser speech-to-text
  // only, no AI voice involved. No-ops silently if unsupported.
  const toggleDictation = useCallback(() => {
    if (dictating) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;
    const rec = new SpeechRecognitionCtor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      if (finalText) setAnswerDraft((prev) => (prev ? `${prev} ${finalText}` : finalText));
    };
    rec.onend = () => setDictating(false);
    rec.onerror = () => setDictating(false);
    rec.start();
    recognitionRef.current = rec;
    setDictating(true);
  }, [dictating]);

  // ---- Timer ----
  useEffect(() => {
    if (phase !== "live") return;
    const tick = setInterval(() => {
      setSecondsElapsed((s) => {
        const next = s + 1;
        if (next >= HARD_CAP_SECONDS) {
          void endInterview();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [phase, endInterview]);

  const canEndManually = phase === "live" && secondsElapsed >= MIN_MANUAL_END_SECONDS;

  return (
    <div className="flex-1 py-10 px-6 flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-6">
        <div className="hidden md:block rounded-[10px] border border-[#7364E6]/30 bg-[#7364E6]/10 px-4 py-3 text-sm text-white-70">
          For the best experience, use a laptop with headphones in a quiet room. This step is optimized for desktop.
        </div>

        {textPreviewMode && (
          <div className="rounded-[10px] border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300 font-medium">
            PREVIEW MODE — Gemini-powered text conversation. No live voice yet; this is not the final candidate experience.
          </div>
        )}

        {(phase === "checking_consent" || phase === "loading_media") && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <span className="w-8 h-8 border-4 border-[#7364E6]/30 border-t-[#7364E6] rounded-full animate-spin" />
            <p className="text-sm text-white-70">
              {phase === "checking_consent" ? "Checking your session..." : "Requesting camera & microphone access..."}
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="card-abtalks rounded-2xl p-8 space-y-4 text-center">
            <p className="text-red-400 font-medium">{errorMessage}</p>
            <button
              onClick={() => {
                setErrorMessage("");
                setPhase("loading_media");
              }}
              className="px-6 py-3 bg-[#7364E6] text-white rounded-[10px] font-semibold btn-abtalks"
            >
              Retry
            </button>
          </div>
        )}

        {phase === "offer_preview" && (
          <div className="card-abtalks rounded-2xl p-8 space-y-4 text-center">
            <p className="text-white-70">
              {errorMessage || "The live voice interviewer isn't connected yet."}
            </p>
            <p className="text-sm text-white-50">
              You can continue with a text-based preview (powered by Gemini) to check the flow, or come back once
              voice is set up.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <button
                onClick={() => {
                  setErrorMessage("");
                  setPhase("ready");
                }}
                className="px-6 py-3 bg-[#403880] text-white border border-[#2C1BA9] rounded-[10px] font-semibold btn-abtalks"
              >
                Cancel
              </button>
              <button
                onClick={() => void startTextPreview()}
                className="px-6 py-3 bg-[#7364E6] text-white rounded-[10px] font-semibold btn-abtalks"
              >
                Continue in Text Preview
              </button>
            </div>
          </div>
        )}

        {(phase === "ready" || phase === "connecting" || phase === "live" || phase === "ending") && (
          <div className="card-abtalks rounded-2xl p-6 md:p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="relative aspect-video rounded-xl overflow-hidden bg-[#191B40] border border-[#2C1BA9]/50">
                <video ref={localVideoElRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {phase === "live" && (
                  <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-500/90 text-white px-3 py-1 rounded-full text-xs font-semibold">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    Live
                  </div>
                )}
              </div>
              <div className="flex flex-col justify-center items-center gap-3 rounded-xl border border-[#2C1BA9]/50 bg-[#191B40]/80 p-6 text-center">
                <span className="text-xs font-bold uppercase tracking-wider text-white-50">
                  {phase === "live" ? "Interview Status" : "Ready to begin"}
                </span>
                {phase === "live" ? (
                  <div className="space-y-1">
                    <span className="flex items-center justify-center gap-2 text-emerald-400 font-display text-2xl font-bold">
                      <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                      Session Active
                    </span>
                    <p className="text-xs text-white-50">{transcriptCount} conversation turns saved</p>
                  </div>
                ) : (
                  <p className="text-sm text-white-70">
                    The interview will adapt to your background and responses.
                  </p>
                )}
              </div>
            </div>

            {phase === "ready" && (
              <button
                onClick={() => void startInterview()}
                className="w-full py-4 rounded-[10px] btn-gradient font-semibold"
              >
                Start Interview →
              </button>
            )}
            {phase === "connecting" && (
              <p className="text-center text-sm text-white-70">
                {textPreviewMode ? "Preparing the preview..." : "Connecting to your interviewer..."}
              </p>
            )}

            {phase === "live" && textPreviewMode && currentTurn && (
              <div className="border-t border-[#2C1BA9]/50 pt-6 space-y-4 text-left">
                <div className="bg-[#191B40]/80 p-5 rounded-xl border border-[#2C1BA9]/50">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white-50 mb-2">
                    {currentTurn.kind === "core" && "Core Question"}
                    {currentTurn.kind === "probe" && "Probe Question"}
                    {currentTurn.kind === "followup" && "Follow-up"}
                    {currentTurn.kind === "closing" && "Closing"}
                  </h3>
                  <p className="text-lg font-medium text-white">{currentTurn.text}</p>
                </div>

                {currentTurn.kind !== "closing" && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold uppercase tracking-wider text-white-50">Your answer</label>
                      <button
                        type="button"
                        onClick={toggleDictation}
                        className="text-xs text-[#7364E6] font-medium"
                      >
                        {dictating ? "● Stop dictation" : "Use microphone to dictate"}
                      </button>
                    </div>
                    <textarea
                      value={answerDraft}
                      onChange={(e) => setAnswerDraft(e.target.value)}
                      placeholder="Type your answer here..."
                      className="w-full h-32 p-4 bg-[#191B40] border border-[#2C1BA9]/50 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#7364E6] text-white placeholder:text-white-50 resize-none"
                    />
                    <button
                      onClick={() => void submitTextAnswer()}
                      disabled={turnBusy}
                      className="w-full py-4 rounded-[10px] btn-gradient font-semibold disabled:opacity-50"
                    >
                      {turnBusy ? "Thinking..." : "Submit Answer"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {phase === "live" && (
              <button
                onClick={() => void endInterview()}
                disabled={!canEndManually}
                className="w-full py-4 bg-[#403880] disabled:opacity-50 text-white border border-[#2C1BA9] rounded-[10px] font-semibold btn-abtalks"
              >
                End Interview
              </button>
            )}
            {phase === "ending" && (
              <p className="text-center text-sm text-white-70">Saving your interview...</p>
            )}
          </div>
        )}

        {/* Remote AI audio -- not shown, just played */}
        <audio ref={aiAudioElRef} className="hidden" />
      </div>
    </div>
  );
}
