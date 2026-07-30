// Client-side face-presence proctoring (PLAN.md Phase E.2). Requires the
// @mediapipe/tasks-vision dependency (added to package.json, run `npm install`
// once network access is available -- not resolvable in this sandbox).
//
// Isolated on purpose: this module is only ever loaded via a dynamic
// import() from the interview page, so the rest of the app keeps building
// even before the dependency is installed.
import type { FaceDetector as FaceDetectorType } from "@mediapipe/tasks-vision";

export type FacePresenceEvent = "no_face_detected" | "multiple_faces_detected" | "face_detected";

const MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";

let detectorPromise: Promise<FaceDetectorType> | null = null;

async function getDetector(): Promise<FaceDetectorType> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
      });
    })();
  }
  return detectorPromise;
}

/**
 * Samples the given video element every `intervalMs` and reports face-presence
 * transitions (not steady-state) via `onEvent`. Returns a stop function.
 * Advisory-only, like every other proctoring signal -- never used to gate or
 * end the interview itself.
 */
export function startFaceWatch(
  videoEl: HTMLVideoElement,
  onEvent: (type: FacePresenceEvent, severity: number) => void,
  intervalMs = 2500,
): () => void {
  let stopped = false;
  let lastState: "none" | "one" | "multiple" | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  (async () => {
    let detector: FaceDetectorType;
    try {
      detector = await getDetector();
    } catch (err) {
      console.error("[faceDetector] failed to initialize, skipping face-presence proctoring", err);
      return;
    }

    const loop = () => {
      if (stopped) return;
      try {
        if (videoEl.readyState >= 2) {
          const result = detector.detectForVideo(videoEl, performance.now());
          const count = result.detections.length;
          const state = count === 0 ? "none" : count === 1 ? "one" : "multiple";
          if (state !== lastState) {
            if (state === "none") onEvent("no_face_detected", 2);
            else if (state === "multiple") onEvent("multiple_faces_detected", 2);
            else onEvent("face_detected", 0);
            lastState = state;
          }
        }
      } catch {
        // Frame not ready or transient detector error -- skip this tick.
      }
      if (!stopped) timer = setTimeout(loop, intervalMs);
    };
    loop();
  })();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
