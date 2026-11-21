"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Lock, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { timeOnly } from "@/lib/format";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error" };

/**
 * The host's private working notes. They save themselves shortly after typing stops and once more when the page is
 * left, so nothing is lost mid-call. `initial` is read once: later polls must never overwrite what is being typed.
 */
export function HostNotes({ sessionId, initial, tone = "themed", rows = 8 }: { sessionId: string; initial: string | null; tone?: "themed" | "stage"; rows?: number }) {
  const [value, setValue] = useState(initial ?? "");
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const latest = useRef(value);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const stage = tone === "stage";

  async function save() {
    if (!dirty.current) return;
    dirty.current = false;
    setState({ kind: "saving" });
    try {
      const result = await api<{ saved_at: string }>(`/sessions/${sessionId}/notes`, { method: "PUT", body: JSON.stringify({ notes: latest.current }) });
      setState({ kind: "saved", at: result.saved_at });
    } catch {
      dirty.current = true; // keep the text and try again on the next edit
      setState({ kind: "error" });
    }
  }

  function change(next: string) {
    setValue(next);
    latest.current = next;
    dirty.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 900);
  }

  useEffect(() => {
    const flush = () => { if (timer.current) window.clearTimeout(timer.current); void save(); };
    const hide = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save only reads refs; subscribe once per call
  }, [sessionId]);

  const muted = stage ? "text-stage-muted" : "text-muted";
  return (
    <div>
      <label htmlFor="host-notes" className={`flex items-center gap-2 text-sm font-semibold ${stage ? "text-stage-ink" : "text-slate-700"}`}>
        <Lock size={14} aria-hidden="true" /> Shënime pune <span className={`font-normal ${muted}`}>· private, vetëm ti i sheh</span>
      </label>
      <textarea
        id="host-notes"
        rows={rows}
        maxLength={10000}
        value={value}
        onChange={(event) => change(event.target.value)}
        placeholder="Çfarë po vëren, pyetje për më vonë, kontekst për sinjalet…"
        className={stage ? "mt-2 w-full resize-y rounded-xl border border-stage-line bg-stage px-3 py-2.5 text-sm leading-6 text-stage-ink outline-none placeholder:text-stage-muted focus:border-stage-accent" : "input mt-2 resize-y leading-6"}
      />
      <p className={`mt-1.5 flex min-h-5 items-center gap-1.5 text-xs ${muted}`} role="status" aria-live="polite">
        {state.kind === "saving" && <><Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Duke ruajtur…</>}
        {state.kind === "saved" && <><Check size={12} aria-hidden="true" /> U ruajt në {timeOnly(state.at)}</>}
        {state.kind === "error" && <span className={`inline-flex items-center gap-1.5 font-semibold ${stage ? "text-amber-300" : "text-amber-900"}`}><TriangleAlert size={12} aria-hidden="true" /> Nuk u ruajt. Teksti mbetet këtu; provo përsëri duke shkruar.</span>}
        {state.kind === "idle" && "Ruhen automatikisht."}
      </p>
    </div>
  );
}
