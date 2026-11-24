"use client";

import { useCallback, useEffect, useRef } from "react";
import { ExamEventDraft } from "@/lib/types";

const MAX_EVENTS = 300; // the API refuses more than this per submission
const REPEAT_MS = 1000; // a held key must not fill the list

const iso = (ms: number) => new Date(ms).toISOString();
const inField = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("textarea, input");

/**
 * Records what a candidate does around a public exam, and blocks copying the questions.
 *
 * Recorded (never the text itself): the page or tab losing the screen, text pasted in, copy / cut of the
 * questions, printing, and the Print Screen key. Blocked: copy, cut, right-click and drag outside the answer boxes.
 * Pasting is recorded, not blocked: these are signals for the host to review, not verdicts.
 *
 * None of this stops a screenshot or a photo of the screen: the browser has no such control. The watermark and the
 * recorded signals are what the host gets instead. `collect()` returns the list to send with the submission.
 */
export function useExamGuard(active: boolean) {
  const events = useRef<ExamEventDraft[]>([]);
  const away = useRef<{ start: number; source: string } | null>(null);

  const add = useCallback((event: ExamEventDraft) => {
    if (events.current.length < MAX_EVENTS) events.current.push(event);
  }, []);

  const closeAway = useCallback(() => {
    const current = away.current;
    if (!current) return;
    away.current = null;
    const end = Date.now();
    add({ event_type: "tab_hidden", started_at: iso(current.start), ended_at: iso(end), duration_seconds: (end - current.start) / 1000, metadata: { source: current.source, content_stored: false } });
  }, [add]);

  useEffect(() => {
    if (!active) return;
    const last: Record<string, number> = {};
    let blurTimer: number | undefined;

    const clipboard = (operation: string, metadata: Record<string, unknown> = {}) => {
      const now = Date.now();
      if ((last[operation] ?? 0) + REPEAT_MS > now) return;
      last[operation] = now;
      add({ event_type: "copy_paste", started_at: iso(now), ended_at: null, duration_seconds: null, metadata: { operation, content_stored: false, ...metadata } });
    };

    // One absence is one event, from the moment the page lost the screen until it had it back.
    const leave = (source: string) => {
      if (!away.current) away.current = { start: Date.now(), source };
      else if (source === "visibilitychange") away.current.source = source; // hiding the tab supersedes a focus loss
    };
    const back = () => { if (!document.hidden && document.hasFocus()) closeAway(); };
    const visibility = () => { window.clearTimeout(blurTimer); if (document.hidden) leave("visibilitychange"); else back(); };
    const blur = () => { window.clearTimeout(blurTimer); blurTimer = window.setTimeout(() => { if (!document.hasFocus()) leave("window_blur"); }, 700); };
    const focus = () => { window.clearTimeout(blurTimer); back(); };

    const paste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      clipboard("paste", {
        target: inField(event.target) ? "answer" : "page",
        char_count: text.length || null,
        line_count: text ? text.split(/\r\n|\r|\n/).length : null,
        looks_like_code: !!text && /[{;}=<>]|\b(function|const|let|var|class|def|import|return)\b/.test(text),
      });
    };
    const copyOrCut = (event: ClipboardEvent) => {
      if (inField(event.target)) return; // editing one's own answer is not taking the questions out
      event.preventDefault();
      clipboard(event.type, { blocked: true });
    };
    const blockMenu = (event: Event) => { if (!inField(event.target)) event.preventDefault(); };
    const keyup = (event: KeyboardEvent) => { if (event.key === "PrintScreen") clipboard("screenshot_key"); };
    const beforePrint = () => clipboard("print");

    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("paste", paste);
    document.addEventListener("copy", copyOrCut);
    document.addEventListener("cut", copyOrCut);
    document.addEventListener("contextmenu", blockMenu);
    document.addEventListener("dragstart", blockMenu);
    document.addEventListener("keyup", keyup);
    window.addEventListener("beforeprint", beforePrint);
    return () => {
      window.clearTimeout(blurTimer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("paste", paste);
      document.removeEventListener("copy", copyOrCut);
      document.removeEventListener("cut", copyOrCut);
      document.removeEventListener("contextmenu", blockMenu);
      document.removeEventListener("dragstart", blockMenu);
      document.removeEventListener("keyup", keyup);
      window.removeEventListener("beforeprint", beforePrint);
    };
  }, [active, add, closeAway]);

  /** Closes an absence that is still open and returns everything recorded so far. */
  const collect = useCallback(() => {
    closeAway();
    return [...events.current];
  }, [closeAway]);

  return { collect };
}
