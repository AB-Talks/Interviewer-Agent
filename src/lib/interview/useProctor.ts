"use client";

import { useCallback, useEffect, useRef } from "react";

// Proctoring events are advisory only -- never auto-reject a candidate on
// these signals (CLAUDE.md). Taxonomy/severity/batching per PLAN.md §10:
// buffer client-side, flush every 5s or 20 events, sendBeacon on pagehide.
export type ProctorEventType =
  | "tab_hidden"
  | "tab_visible"
  | "window_blur"
  | "window_focus"
  | "fullscreen_exited"
  | "paste_into_field"
  | "devtools_shortcut"
  | "long_silence"
  | "network_drop"
  | "network_restored"
  | "camera_stream_ended"
  | "no_face_detected"
  | "multiple_faces_detected"
  | "face_detected";

export interface ProctorEvent {
  type: ProctorEventType;
  severity: number;
  meta?: Record<string, unknown>;
  at: number;
  offsetMs: number;
}

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_MAX_EVENTS = 20;

export function useProctor(token: string, enabled: boolean) {
  const bufferRef = useRef<ProctorEvent[]>([]);
  const startedAtRef = useRef<number>(Date.now());

  const flush = useCallback(
    (useBeacon = false) => {
      if (bufferRef.current.length === 0) return;
      const events = bufferRef.current;
      bufferRef.current = [];
      const body = JSON.stringify({ token, events });
      if (useBeacon && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/proctor/events", body);
      } else {
        fetch("/api/proctor/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {
          // Advisory signal -- a dropped batch is not worth retrying or surfacing.
        });
      }
    },
    [token],
  );

  const push = useCallback(
    (type: ProctorEventType, severity: number, meta?: Record<string, unknown>) => {
      bufferRef.current.push({
        type,
        severity,
        meta,
        at: Date.now(),
        offsetMs: Date.now() - startedAtRef.current,
      });
      if (bufferRef.current.length >= FLUSH_MAX_EVENTS) flush();
    },
    [flush],
  );

  useEffect(() => {
    if (!enabled) return;
    startedAtRef.current = Date.now();
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const onVisibility = () => {
      // visibilitychange fires on mobile for every notification/screen-lock --
      // downgrade severity there rather than flagging every candidate.
      push(document.hidden ? "tab_hidden" : "tab_visible", document.hidden ? (isMobile ? 1 : 2) : 0);
    };
    const onBlur = () => push("window_blur", 2);
    const onFocus = () => push("window_focus", 0);
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) push("fullscreen_exited", 1);
    };
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        push("paste_into_field", 2);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      if (e.key === "F12" || (e.ctrlKey && e.shiftKey && (key === "I" || key === "J" || key === "C"))) {
        push("devtools_shortcut", 1);
      }
    };
    const onOffline = () => push("network_drop", 1);
    const onOnline = () => push("network_restored", 0);
    const onPageHide = () => flush(true);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);

    const interval = setInterval(() => flush(), FLUSH_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
      clearInterval(interval);
      flush(true);
    };
  }, [enabled, push, flush]);

  return { push };
}
