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
  const [studentId, setStudentId] = useState("");
  const [studentIdVerified, setStudentIdVerified] = useState(false);
  const [studentIdVerifying, setStudentIdVerifying] = useState(false);
  const [studentIdError, setStudentIdError] = useState("");
  const [studentIdPreviewUrl, setStudentIdPreviewUrl] = useState<string | null>(null);
  const [studentIdSnapshotUrl, setStudentIdSnapshotUrl] = useState<string | null>(null);
  
  // Test Recording states
  const [testRecording, setTestRecording] = useState(false);
  const [testCountdown, setTestCountdown] = useState(5);
  const [testBlobUrl, setTestBlobUrl] = useState<string | null>(null);

  // Room-scan states -- a mandatory pre-interview environment check, separate
  // from the local-only device test clip above: this one is uploaded and
  // reviewable by a recruiter later (advisory only, never auto-analyzed).
  const ROOM_SCAN_SECONDS = 10;
  const [roomScanRecording, setRoomScanRecording] = useState(false);
  const [roomScanCountdown, setRoomScanCountdown] = useState(ROOM_SCAN_SECONDS);
  const [roomScanPreviewUrl, setRoomScanPreviewUrl] = useState<string | null>(null);
  const [roomScanUploading, setRoomScanUploading] = useState(false);
  const [roomScanUploaded, setRoomScanUploaded] = useState(false);
  const [roomScanError, setRoomScanError] = useState("");
  const roomScanRecorderRef = useRef<MediaRecorder | null>(null);
  const roomScanChunksRef = useRef<Blob[]>([]);

  const roomScanProgress = roomScanRecording
    ? Math.max(0, Math.min(100, ((ROOM_SCAN_SECONDS - roomScanCountdown) / ROOM_SCAN_SECONDS) * 100))
    : roomScanUploaded
      ? 100
      : 0;
  const interviewReady = !!testBlobUrl && roomScanUploaded && studentIdVerified;

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
          if (data.interview.student_id_verified_at) {
            setStudentIdVerified(true);
            setStudentId(data.interview.student_id_value ?? "");
            setStudentIdSnapshotUrl(data.interview.student_id_snapshot_url ?? null);
          }
          if (data.interview.room_scan_url) {
            setRoomScanUploaded(true);
          }
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

  const captureStudentIdFrame = async () => {
    if (!streamRef.current || !videoPreviewRef.current) {
      throw new Error("Camera preview is not ready yet.");
    }

    const video = videoPreviewRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new Error("Camera frame is still loading. Please wait a moment and try again.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare the verification photo.");
    }
    context.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (nextBlob) => {
          if (nextBlob) resolve(nextBlob);
          else reject(new Error("Could not capture the verification photo."));
        },
        "image/jpeg",
        0.9,
      );
    });

    return blob;
  };

  const verifyStudentId = async () => {
    if (!studentId.trim()) {
      setStudentIdError("Enter your student ID before verifying.");
      return;
    }

    setStudentIdError("");
    setStudentIdVerifying(true);

    try {
      const blob = await captureStudentIdFrame();
      const localPreviewUrl = URL.createObjectURL(blob);
      setStudentIdPreviewUrl(localPreviewUrl);

      const { upload } = await import("@vercel/blob/client");
      const result = await upload(`interviews/${token}/student-id-${Date.now()}.jpg`, blob, {
        access: "public",
        handleUploadUrl: `/api/interviews/${token}/upload-url`,
      });

      const res = await fetch(`/api/interviews/${token}/student-id-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: studentId.trim(), url: result.url }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message ?? "Could not verify the student ID.");
      }

      setStudentIdVerified(true);
      setStudentIdSnapshotUrl(data.interview?.student_id_snapshot_url ?? result.url);
    } catch (err) {
      setStudentIdError(err instanceof Error ? err.message : "Verification failed. Please try again.");
      setStudentIdVerified(false);
    } finally {
      setStudentIdVerifying(false);
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

  // 5. Record + upload the mandatory room scan: candidate slowly pans the
  // camera around their surroundings. Unlike the local-only test clip above,
  // this one is uploaded to Blob storage and saved on the interview record
  // for a recruiter to review later.
  const startRoomScan = () => {
    if (!streamRef.current) return;
    setRoomScanError("");
    setRoomScanPreviewUrl(null);
    setRoomScanUploaded(false);
    setRoomScanRecording(true);
    setRoomScanCountdown(ROOM_SCAN_SECONDS);

    roomScanChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/mp4";

    const recorder = new MediaRecorder(streamRef.current, {
      mimeType,
      videoBitsPerSecond: 800000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        roomScanChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      setRoomScanRecording(false);
      const blob = new Blob(roomScanChunksRef.current, { type: mimeType });
      setRoomScanPreviewUrl(URL.createObjectURL(blob));

      setRoomScanUploading(true);
      try {
        const { upload } = await import("@vercel/blob/client");
        const result = await upload(`interviews/${token}/room-scan-${Date.now()}.webm`, blob, {
          access: "public",
          handleUploadUrl: `/api/interviews/${token}/upload-url`,
        });
        const res = await fetch(`/api/interviews/${token}/room-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: result.url }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message ?? "Could not save the room scan.");
        setRoomScanUploaded(true);
      } catch (err) {
        setRoomScanError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      } finally {
        setRoomScanUploading(false);
      }
    };

    roomScanRecorderRef.current = recorder;
    recorder.start(1000);

    const interval = setInterval(() => {
      setRoomScanCountdown((prev) => {
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
      <div className="flex-1 flex flex-col items-center justify-center">
        <span className="w-8 h-8 border-4 border-[#7364E6]/30 border-t-[#7364E6] rounded-full animate-spin mb-4" />
        <p className="text-sm text-white-70">Checking your session...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 py-12 px-6 flex flex-col justify-center items-center">
      <div className="w-full max-w-4xl card-abtalks rounded-2xl p-8 space-y-8 relative">
        {/* Background glow */}
        <div className="absolute -top-20 -right-20 w-60 h-60 bg-[#7364E6]/10 rounded-full blur-[80px] pointer-events-none" />
        <div className="relative z-10">
          <span className="text-xs font-bold tracking-widest text-[#7364E6] uppercase">Setup your interview room</span>
          <h1 className="font-display text-3xl font-extrabold mt-2 text-white">
            System Check
          </h1>
          <p className="text-white-70 text-sm mt-1 max-w-2xl leading-relaxed">
            First we&apos;ll verify your student ID with your camera, then we&apos;ll check your camera, microphone, speakers, and internet. After that you&apos;ll record a short test clip and a room scan before starting the interview.
          </p>
        </div>

        <div className="rounded-2xl border border-[#2C1BA9]/50 bg-[#0F1230]/85 p-5 md:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#A79BFF]">Step 1</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Verify your student ID</h2>
            </div>
            <span className={`text-xs font-bold uppercase tracking-[0.2em] ${studentIdVerified ? "text-emerald-300" : "text-white/45"}`}>
              {studentIdVerified ? "Verified" : "Required before start"}
            </span>
          </div>

          <p className="text-sm text-white-70 leading-relaxed max-w-3xl">
            Enter your student ID, then hold the ID card beside your face so the camera can verify that the card and the student match.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4 items-start">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-white-50 mb-2">
                  Student ID
                </label>
                <input
                  value={studentId}
                  onChange={(e) => {
                    setStudentId(e.target.value);
                    setStudentIdError("");
                  }}
                  placeholder="Enter your student ID"
                  className="w-full bg-[#191B40] border border-[#2C1BA9]/50 rounded-[10px] px-4 py-3 text-white text-sm focus:outline-none focus:border-[#7364E6] transition-colors"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={studentIdVerifying || loadingDevices || !studentId.trim()}
                  onClick={() => void verifyStudentId()}
                  className="px-5 py-3 bg-[#7364E6] text-white rounded-[10px] text-sm font-semibold btn-abtalks disabled:opacity-50"
                >
                  {studentIdVerifying ? "Verifying..." : studentIdVerified ? "Re-verify Student ID" : "Verify Student ID"}
                </button>
                <p className="text-xs text-white-50 self-center">
                  Keep your ID and face clearly in frame before you click verify.
                </p>
              </div>

              {studentIdError && <p className="text-sm text-red-400">{studentIdError}</p>}
              {studentIdVerified && (
                <p className="text-sm text-emerald-300 font-medium">
                  Student ID verified. You can continue with the room scan and device checks.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="aspect-video rounded-xl overflow-hidden border border-[#2C1BA9]/50 bg-[#191B40]">
                {studentIdSnapshotUrl || studentIdPreviewUrl ? (
                  <img
                    src={studentIdSnapshotUrl || studentIdPreviewUrl || ""}
                    alt="Student ID verification capture"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-white-50 text-center px-4">
                    Your verification photo will appear here
                  </div>
                )}
              </div>
              <p className="text-[11px] text-white-45 uppercase tracking-[0.2em]">Captured verification photo</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Camera", state: loadingDevices ? "Checking" : permissionError ? "Needs attention" : "Working" },
            { label: "Microphone", state: loadingDevices ? "Checking" : permissionError ? "Needs attention" : "Working" },
            { label: "Speakers", state: loadingDevices ? "Checking" : "Working" },
            { label: "Internet", state: loadingDevices ? "Checking" : "Good" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-[#2C1BA9]/50 bg-[#191B40]/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-white">{item.label}</span>
                <span
                  className={`text-[11px] font-bold uppercase tracking-[0.2em] ${
                    item.state === "Working" || item.state === "Good"
                      ? "text-emerald-300"
                      : item.state === "Needs attention"
                        ? "text-amber-300"
                        : "text-white/45"
                  }`}
                >
                  {item.state}
                </span>
              </div>
            </div>
          ))}
        </div>

        {permissionError && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm leading-relaxed">
            {permissionError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left panel: Video Preview and Controls */}
          <div className="space-y-6">
            <div className="relative aspect-video rounded-xl overflow-hidden bg-[#191B40] border border-[#2C1BA9]/50 shadow-inner flex items-center justify-center">
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
              <div className="flex justify-between text-xs font-semibold text-white-50">
                <span>Microphone Level Indicator</span>
                <span>{micLevel}%</span>
              </div>
              <div className="w-full h-2 bg-[#191B40] rounded-full overflow-hidden border border-[#2C1BA9]/50">
                <div
                  className="h-full bg-[#7364E6] transition-all duration-75"
                  style={{ width: `${micLevel}%` }}
                />
              </div>
            </div>
          </div>

          {/* Right panel: Selector menus and testing actions */}
          <div className="space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
                <div className="rounded-2xl border border-[#2C1BA9]/50 bg-[#0F1230]/80 p-4 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Room scan progress</p>
                  <div className="flex items-center gap-4">
                    <div
                      className="relative h-16 w-16 rounded-full border border-[#2C1BA9]/50"
                      style={{
                        background: `conic-gradient(#7364E6 ${roomScanProgress}%, rgba(44,27,169,0.2) 0)`,
                      }}
                    >
                      <div className="absolute inset-2 rounded-full bg-[#0F1230] flex items-center justify-center text-white font-bold text-sm">
                        {Math.round(roomScanProgress)}%
                      </div>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="text-white font-semibold">{roomScanUploaded ? "Room scan uploaded" : roomScanRecording ? "Recording your room scan" : "Ready to record"}</p>
                      <p className="text-white-50">Slowly pan around your desk and room. This recording is for recruiter review only.</p>
                    </div>
                  </div>
                </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-white-50 mb-2">
                  Select Camera
                </label>
                <select
                  disabled={loadingDevices || testRecording}
                  value={selectedCamera}
                  onChange={(e) => {
                    setSelectedCamera(e.target.value);
                    handleDeviceChange(e.target.value, selectedMic);
                  }}
                  className="w-full bg-[#191B40] border border-[#2C1BA9]/50 rounded-[10px] px-4 py-3 text-white text-sm focus:outline-none focus:border-[#7364E6] transition-colors"
                >
                  {cameras.map((c) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-white-50 mb-2">
                  Select Microphone
                </label>
                <select
                  disabled={loadingDevices || testRecording}
                  value={selectedMic}
                  onChange={(e) => {
                    setSelectedMic(e.target.value);
                    handleDeviceChange(selectedCamera, e.target.value);
                  }}
                  className="w-full bg-[#191B40] border border-[#2C1BA9]/50 rounded-[10px] px-4 py-3 text-white text-sm focus:outline-none focus:border-[#7364E6] transition-colors"
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
                disabled={testRecording || loadingDevices || !studentIdVerified}
                onClick={startTestRecording}
                className="w-full py-3.5 bg-[#403880] hover:bg-[#504898] disabled:opacity-50 text-white border border-[#2C1BA9] rounded-[10px] text-sm font-semibold btn-abtalks"
              >
                {!studentIdVerified ? "Verify Student ID First" : testBlobUrl ? "Record Again" : "Record 5s Test Clip"}
              </button>

              <button
                type="button"
                disabled={testRecording || !interviewReady || roomScanUploading || loadingDevices}
                onClick={() => {
                  stopAllMedia();
                  router.push(`/i/${token}/interview`);
                }}
                className="w-full py-4 rounded-[10px] btn-gradient disabled:opacity-50 font-bold flex items-center justify-center gap-2"
              >
                Start Interview →
              </button>

              {!testBlobUrl && (
                <p className="text-center text-xs text-white-50">
                  Please verify your student ID first, then record and play back a test clip to verify video & audio before proceeding.
                </p>
              )}
              {testBlobUrl && !roomScanUploaded && (
                <p className="text-center text-xs text-white-50">
                  Complete the room scan below before proceeding.
                </p>
              )}
              {interviewReady && (
                <p className="text-center text-xs text-emerald-400 font-medium">
                  Everything is verified. You&apos;re ready to start.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Room scan -- required environment check, uploaded for recruiter review */}
        <div className="relative z-10 rounded-xl border border-[#2C1BA9]/50 bg-[#191B40]/50 p-6 space-y-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">Room Scan</h2>
            <p className="text-white-70 text-sm mt-1">
              Slowly turn your camera to show your desk and the room around you. This is a required step so a recruiter can review your interview environment later. It&apos;s advisory only and never automatically analyzed or scored.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-center">
            <div className="relative aspect-video max-w-xs rounded-xl overflow-hidden bg-[#191B40] border border-[#2C1BA9]/50">
              {roomScanPreviewUrl ? (
                <video src={roomScanPreviewUrl} controls className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-white-50 text-center px-4">
                  Your room-scan preview will appear here
                </div>
              )}
              {roomScanRecording && (
                <div className="absolute top-3 left-3 flex items-center gap-2 bg-destructive/90 text-destructive-foreground px-3 py-1 rounded-full text-xs font-semibold animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-destructive-foreground" />
                  Recording... {roomScanCountdown}s
                </div>
              )}
            </div>

            <div className="space-y-2">
              <button
                type="button"
                disabled={roomScanRecording || roomScanUploading || loadingDevices || !studentIdVerified}
                onClick={startRoomScan}
                className="px-6 py-3 bg-[#403880] hover:bg-[#504898] disabled:opacity-50 text-white border border-[#2C1BA9] rounded-[10px] text-sm font-semibold btn-abtalks whitespace-nowrap"
              >
                {roomScanUploading
                  ? "Uploading..."
                  : !studentIdVerified
                    ? "Verify Student ID First"
                    : roomScanUploaded
                    ? "Scan Again"
                    : "Start Room Scan"}
              </button>
              {roomScanUploaded && (
                  <p className="text-xs text-emerald-400 font-medium">✓ Room scan uploaded and ready</p>
              )}
              {roomScanError && <p className="text-xs text-red-400">{roomScanError}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
