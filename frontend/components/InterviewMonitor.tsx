"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { api } from "@/lib/api";
import { EventType } from "@/lib/types";

interface Props {
  token: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  active: boolean;
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  onSignal: (message: string) => void;
}

export function InterviewMonitor({ token, videoRef, active, cameraStream, screenStream, onSignal }: Props) {
  const [faceReady, setFaceReady] = useState(false);
  const faceDetector = useRef<FaceDetector | null>(null);
  const episodes = useRef<Record<string, { start: number; id: Promise<string | null> }>>({});
  const faceReadyRef = useRef(false);
  const blurTimer = useRef<number | null>(null);
  const resizeTimer = useRef<number | null>(null);
  const initialWindowSize = useRef<{ width: number; height: number } | null>(null);
  const noFaceSince = useRef<number | null>(null);
  const cooldowns = useRef<Record<string, number>>({});
  const disconnects = useRef<number[]>([]);

  const report = useCallback(async (eventType: EventType, options: { startedAt?: Date; duration?: number; confidence?: number; metadata?: Record<string, unknown> } = {}): Promise<string | null> => {
    const now = new Date();
    try {
      const created = await api<{ id: string }>(`/public/sessions/${token}/events`, { method: "POST", body: JSON.stringify({ event_type: eventType, started_at: (options.startedAt || now).toISOString(), ended_at: options.duration != null ? now.toISOString() : null, duration_seconds: options.duration ?? null, confidence_score: options.confidence ?? null, metadata: options.metadata || {} }) }, false);
      onSignal(eventType);
      return created.id;
    } catch { return null; /* connection failures are handled by online/offline listeners */ }
  }, [onSignal, token]);

  const reportWithCooldown = useCallback((type: EventType, cooldownMs: number, confidence?: number, metadata?: Record<string, unknown>) => {
    const now = Date.now();
    if ((cooldowns.current[type] || 0) + cooldownMs > now) return;
    cooldowns.current[type] = now;
    void report(type, { confidence, metadata });
  }, [report]);

  useEffect(() => {
    if (!active) return;
    // One tab switch is one event: it is posted when it starts (so the host sees it live) and closed when it ends.
    const beginEpisode = (key: string, confidence: number, metadata: Record<string, unknown>) => {
      if (episodes.current[key]) return;
      episodes.current[key] = { start: Date.now(), id: report("tab_hidden", { confidence, metadata: { ...metadata, phase: "started" } }) };
    };
    const endEpisode = (key: string) => {
      const episode = episodes.current[key];
      if (!episode) return;
      delete episodes.current[key];
      const seconds = (Date.now() - episode.start) / 1000;
      void episode.id.then((id) => {
        if (id) void api(`/public/sessions/${token}/events/${id}`, { method: "PATCH", body: JSON.stringify({ ended_at: new Date().toISOString(), duration_seconds: seconds }) }, false).catch(() => undefined);
      });
    };
    const visibility = () => {
      if (document.hidden) {
        if (blurTimer.current) window.clearTimeout(blurTimer.current);
        endEpisode("blur"); // hiding the tab supersedes a window-focus loss that was already open
        beginEpisode("visibility", 1, { source: "visibilitychange", reason: "browser_tab_not_visible" });
      } else endEpisode("visibility");
    };
    const blur = () => {
      if (document.hidden || episodes.current.blur) return;
      if (blurTimer.current) window.clearTimeout(blurTimer.current);
      blurTimer.current = window.setTimeout(() => {
        if (!document.hidden && !episodes.current.visibility) beginEpisode("blur", 0.85, { source: "window_blur", reason: "candidate_left_page_focus_or_minimized" });
      }, 700);
    };
    const focus = () => {
      if (blurTimer.current) window.clearTimeout(blurTimer.current);
      endEpisode("blur");
    };
    const pageHide = () => reportWithCooldown("tab_hidden", 3000, 1, { source: "pagehide", reason: "page_closed_or_navigated" });
    const fullscreen = () => { if (!document.fullscreenElement) reportWithCooldown("fullscreen_exit", 3000); };
    const clipboard = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") || "";
      const lineCount = text ? text.split(/\r\n|\r|\n/).length : null;
      const charCount = text ? text.length : null;
      const looksLikeCode = !!text && /[{;}=<>]|\b(function|const|let|var|class|def|import|return)\b/.test(text);
      reportWithCooldown("copy_paste", 1000, event.type === "paste" ? 0.9 : 0.7, {
        operation: event.type,
        line_count: lineCount,
        char_count: charCount,
        looks_like_code: looksLikeCode,
        content_stored: false,
      });
    };
    const resize = () => {
      const initial = initialWindowSize.current;
      if (!initial) return;
      if (resizeTimer.current) window.clearTimeout(resizeTimer.current);
      resizeTimer.current = window.setTimeout(() => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const widthPercent = Math.round((width / initial.width) * 100);
        const heightPercent = Math.round((height / initial.height) * 100);
        const widthDelta = Math.abs(widthPercent - 100);
        const heightDelta = Math.abs(heightPercent - 100);
        if (widthDelta < 8 && heightDelta < 8) return;
        reportWithCooldown("window_resized", 3000, 0.8, {
          source: "window_resize",
          initial_width: initial.width,
          initial_height: initial.height,
          current_width: width,
          current_height: height,
          width_percent: widthPercent,
          height_percent: heightPercent,
        });
      }, 700);
    };
    const offline = () => {
      const cutoff = Date.now() - 5 * 60_000;
      disconnects.current = [...disconnects.current.filter(t => t > cutoff), Date.now()];
      if (disconnects.current.length >= 3) reportWithCooldown("connection_interruption", 60_000, undefined, { interruptions_in_5_minutes: disconnects.current.length });
    };
    initialWindowSize.current = { width: window.innerWidth, height: window.innerHeight };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("fullscreenchange", fullscreen);
    document.addEventListener("copy", clipboard); document.addEventListener("paste", clipboard); document.addEventListener("cut", clipboard);
    window.addEventListener("resize", resize);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("offline", offline);
    return () => { if (blurTimer.current) window.clearTimeout(blurTimer.current); if (resizeTimer.current) window.clearTimeout(resizeTimer.current); document.removeEventListener("visibilitychange", visibility); document.removeEventListener("fullscreenchange", fullscreen); document.removeEventListener("copy", clipboard); document.removeEventListener("paste", clipboard); document.removeEventListener("cut", clipboard); window.removeEventListener("resize", resize); window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); window.removeEventListener("pagehide", pageHide); window.removeEventListener("offline", offline); };
  }, [active, report, reportWithCooldown, token]);

  useEffect(() => {
    if (!active) return;

    // screen.isExtended needs no permission. getScreenDetails() was dropped: it shows the candidate a
    // "manage windows on all your displays" prompt that the consent page does not explain.
    const detectDisplays = () => {
      if ((window.screen as Screen & { isExtended?: boolean }).isExtended) {
        reportWithCooldown("multiple_monitors", 60_000, 0.7, { source: "screen.isExtended", screen_count: "unknown_more_than_one" });
      }
    };

    detectDisplays();
  }, [active, reportWithCooldown]);

  useEffect(() => {
    if (!active || !cameraStream) return;
    const ended = () => reportWithCooldown("camera_disabled", 3000);
    cameraStream.getVideoTracks().forEach(track => track.addEventListener("ended", ended));
    return () => cameraStream.getVideoTracks().forEach(track => track.removeEventListener("ended", ended));
  }, [active, cameraStream, reportWithCooldown]);

  useEffect(() => {
    if (!active || !screenStream) return;
    const ended = () => reportWithCooldown("screen_share_stopped", 3000);
    screenStream.getVideoTracks().forEach(track => track.addEventListener("ended", ended));
    return () => screenStream.getVideoTracks().forEach(track => track.removeEventListener("ended", ended));
  }, [active, reportWithCooldown, screenStream]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const detector = await FaceDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: "/mediapipe/blaze_face_short_range.tflite", delegate: "GPU" }, runningMode: "VIDEO", minDetectionConfidence: 0.5 });
        if (cancelled) { detector.close(); return; }
        faceDetector.current = detector; setFaceReady(true);
      } catch { setFaceReady(false); }
    })();
    return () => { cancelled = true; faceDetector.current?.close(); faceDetector.current = null; };
  }, [active]);

  useEffect(() => {
    if (!active || !faceReady) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !faceDetector.current) return;
      const detections = faceDetector.current.detectForVideo(video, performance.now()).detections;
      if (detections.length === 0) {
        noFaceSince.current ||= Date.now();
        if (Date.now() - noFaceSince.current > 5000) {
          const start = noFaceSince.current;
          const now = Date.now();
          if ((cooldowns.current.face_not_visible || 0) + 10000 <= now) {
            cooldowns.current.face_not_visible = now;
            void report("face_not_visible", { startedAt: new Date(start), duration: (now - start) / 1000, confidence: 0.9, metadata: { threshold_seconds: 5 } });
          }
          noFaceSince.current = now;
        }
      } else {
        noFaceSince.current = null;
        if (detections.length > 1) reportWithCooldown("multiple_people", 10000, Math.max(...detections.map(d => d.categories[0]?.score || 0)), { source: "mediapipe", count: detections.length });
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [active, faceReady, report, reportWithCooldown, videoRef]);

  useEffect(() => { faceReadyRef.current = faceReady; }, [faceReady]);

  // The host's "monitor was active X% of the call" figure comes from these: silence longer than ~45 s is a gap.
  useEffect(() => {
    if (!active) return;
    const beat = () => void api(`/public/sessions/${token}/heartbeat`, { method: "POST", body: JSON.stringify({ face_detection: faceReadyRef.current }) }, false).catch(() => undefined);
    beat();
    const timer = window.setInterval(beat, 10_000);
    return () => window.clearInterval(timer);
  }, [active, token]);

  useEffect(() => {
    if (!active) return;
    let inFlight = false; // a slow detector must not stack up uploads from the same candidate
    const analyze = async () => {
      const video = videoRef.current;
      if (inFlight || !video || video.readyState < 2) return;
      inFlight = true;
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = Math.round(640 * video.videoHeight / video.videoWidth);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.72));
      if (!blob) { inFlight = false; return; }
      const form = new FormData(); form.append("frame", blob, "frame.jpg");
      try {
        const result = await api<{ person_count: number; person_confidence: number; phone_detected: boolean; phone_confidence: number }>(`/public/sessions/${token}/analyze-frame`, { method: "POST", body: form }, false);
        if (result.person_count > 1) reportWithCooldown("multiple_people", 10000, result.person_confidence, { source: "yolo", count: result.person_count });
        if (result.phone_detected) reportWithCooldown("phone_detected", 10000, result.phone_confidence, { source: "yolo" });
      } catch { /* vision is best-effort; interview continues if model is unavailable */ }
      finally { inFlight = false; }
    };
    const timer = window.setInterval(analyze, 5000); void analyze();
    return () => window.clearInterval(timer);
  }, [active, reportWithCooldown, token, videoRef]);

  return <span className={`inline-flex items-center gap-2 text-xs ${faceReady ? "text-emerald-300" : "text-amber-300"}`}><span className={`h-2 w-2 rounded-full ${faceReady ? "bg-emerald-400" : "bg-amber-400"}`}/>{faceReady ? "Face detection active" : "Loading face detection"}</span>;
}
