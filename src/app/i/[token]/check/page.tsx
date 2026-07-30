"use client";

import React, { useEffect, useState, useRef, use } from "react";
import { useRouter } from "next/navigation";

interface Device {
  deviceId: string;
  label: string;
}

export default function SystemCheckPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const router = useRouter();
  const { token } = use(params);

  // States
  const [cameras, setCameras] = useState<Device[]>([]);
  const [mics, setMics] = useState<Device[]>([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMic, setSelectedMic] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [permissionError, setPermissionError] = useState("");
  
  // Test Recording states
  const [testRecording, setTestRecording] = useState(false);
  const [testCountdown, setTestCountdown] = useState(5);
  const [testBlobUrl, setTestBlobUrl] = useState<string | null>(null);
  
  // Streams & Nodes
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Media Recorder for 5s test
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const testChunksRef = useRef<Blob[]>([]);

  // Refs for HTML Elements
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  // 0. Never call getUserMedia before interviews.consent_at is set (CLAUDE.md).
  // A bookmarked or shared /check link must not skip the consent step, so this
  // gate runs before the permissions request below, not just on the landing page.
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function verifyConsent() {
      try {
        const res = await fetch(`/api/interviews/${token}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.interview || !data.interview.consent_at) {
          setConsentMissing(true);
        } else {
          setConsentChecked(true);
        }
      } catch {
        if (!cancelled) setConsentMissing(true);
      }
    }
    verifyConsent();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (consentMissing) {
      router.replace(`/i/${token}`);
    }
  }, [consentMissing, router, token]);

  // 1. Request initial permissions and list devices (only once consent is confirmed)
  useEffect(() => {
    if (!consentChecked) return;
    async function requestPermissionsAndEnumerate() {
      try {
        // Explicitly request media permissions to trigger permission dialog
        const initialStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        
        // Save stream to show live preview immediately
        streamRef.current = initialStream;
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = initialStream;
        }

        // Initialize mic meter
        setupMicMeter(initialStream);

        // Enumerate devices
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = allDevices
          .filter((d) => d.kind === "videoinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 5)}` }));
        const audioInputs = allDevices
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 5)}` }));

        setCameras(videoInputs);
        setMics(audioInputs);

        if (videoInputs.length > 0) setSelectedCamera(videoInputs[0].deviceId);
        if (audioInputs.length > 0) setSelectedMic(audioInputs[0].deviceId);

        setLoadingDevices(false);
      } catch (err: any) {
        setPermissionError(
          "Camera or microphone access denied. Please click the lock icon in the browser address bar to allow permissions, then refresh."
        );
        setLoadingDevices(false);
      }
    }

    requestPermissionsAndEnumerate();

    return () => {
      stopAllMedia();
    };
  }, [consentChecked]);

  // 2. Change active media stream when device selection changes
  const handleDeviceChange = async (camId: string, micId: string) => {
    stopAllMedia();
    setTestBlobUrl(null);
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: camId ? { deviceId: { exact: camId } } : true,
        audio: micId ? { deviceId: { exact: micId } } : true,
      });

      streamRef.current = newStream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = newStream;
      }
      setupMicMeter(newStream);
    } catch (err: any) {
      setPermissionError("Failed to switch to the selected media device.");
    }
  };

  // 3. Audio Meter implementation using AnalyserNode
  const setupMicMeter = (stream: MediaStream) => {
    // Clean up existing AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const drawMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // Compute average sound level
        let values = 0;
        for (let i = 0; i < bufferLength; i++) {
          values += dataArray[i];
        }
        const average = values / bufferLength;
        setMicLevel(Math.min(100, Math.round((average / 128) * 100)));

        animationFrameRef.current = requestAnimationFrame(drawMeter);
      };

      drawMeter();
    } catch (e) {
      console.warn("Could not start volume analysis:", e);
    }
  };

  // Stop streams and cancel animations
  const stopAllMedia = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  // 4. Record 5 seconds test clip
  const startTestRecording = () => {
    if (!streamRef.current) return;
    setTestBlobUrl(null);
    setTestRecording(true);
    setTestCountdown(5);

    testChunksRef.current = [];

    // Safari MP4 support fallback
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/mp4";

    const recorder = new MediaRecorder(streamRef.current, {
      mimeType,
      videoBitsPerSecond: 800000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        testChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(testChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setTestBlobUrl(url);
      setTestRecording(false);
    };

    mediaRecorderRef.current = recorder;
    recorder.start(1000); // 1s slice chunks

    // Start 5-second countdown timer
    const interval = setInterval(() => {
      setTestCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          recorder.stop();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  if (!consentChecked) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center">
        <span className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
        <p className="text-sm text-muted-foreground">Checking your session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground py-12 px-6 flex flex-col justify-center items-center font-sans">
      <div className="w-full max-w-4xl bg-card border border-border rounded-3xl p-8 shadow-xl space-y-8">
        <div>
          <span className="text-xs font-bold tracking-widest text-primary uppercase">
            Step 2 of 3
          </span>
          <h1 className="font-display text-3xl font-extrabold mt-2">
            System Check
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Check your camera and microphone before the live AI interview call — best on a laptop in a quiet room.
          </p>
        </div>

        {permissionError && (
          <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/25 text-destructive text-sm leading-relaxed">
            {permissionError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left panel: Video Preview and Controls */}
          <div className="space-y-6">
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-muted border border-border shadow-inner flex items-center justify-center">
              {testBlobUrl ? (
                <video
                  src={testBlobUrl}
                  controls
                  autoPlay
                  className="w-full h-full object-cover"
                />
              ) : (
                <video
                  ref={videoPreviewRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              )}

              {testRecording && (
                <div className="absolute top-4 left-4 flex items-center gap-2 bg-destructive/90 text-destructive-foreground px-3 py-1 rounded-full text-xs font-semibold animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-destructive-foreground" />
                  Recording Test... {testCountdown}s
                </div>
              )}
            </div>

            {/* Mic Audio Meter Indicator */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                <span>Microphone Level Indicator</span>
                <span>{micLevel}%</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden border border-border">
                <div
                  className="h-full bg-primary transition-all duration-75"
                  style={{ width: `${micLevel}%` }}
                />
              </div>
            </div>
          </div>

          {/* Right panel: Selector menus and testing actions */}
          <div className="space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Select Camera
                </label>
                <select
                  disabled={loadingDevices || testRecording}
                  value={selectedCamera}
                  onChange={(e) => {
                    setSelectedCamera(e.target.value);
                    handleDeviceChange(e.target.value, selectedMic);
                  }}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground text-sm focus:outline-none focus:border-ring transition-colors"
                >
                  {cameras.map((c) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Select Microphone
                </label>
                <select
                  disabled={loadingDevices || testRecording}
                  value={selectedMic}
                  onChange={(e) => {
                    setSelectedMic(e.target.value);
                    handleDeviceChange(selectedCamera, e.target.value);
                  }}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground text-sm focus:outline-none focus:border-ring transition-colors"
                >
                  {mics.map((m) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-4 pt-6 md:pt-0">
              <button
                type="button"
                disabled={testRecording || loadingDevices}
                onClick={startTestRecording}
                className="w-full py-3.5 bg-secondary hover:bg-accent disabled:opacity-50 text-secondary-foreground border border-border rounded-xl text-sm font-semibold transition-all"
              >
                {testBlobUrl ? "Record Again" : "Record 5s Test Clip"}
              </button>

              <button
                type="button"
                disabled={testRecording || !testBlobUrl}
                onClick={() => {
                  stopAllMedia();
                  router.push(`/i/${token}/interview`);
                }}
                className="w-full py-4 bg-primary hover:opacity-90 disabled:opacity-50 rounded-xl transition-all text-primary-foreground font-bold shadow-lg flex items-center justify-center gap-2"
              >
                Start Interview
              </button>

              {!testBlobUrl && (
                <p className="text-center text-xs text-muted-foreground">
                  Please record and play back a test clip to verify video & audio before proceeding.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
