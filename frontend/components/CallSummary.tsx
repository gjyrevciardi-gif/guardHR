"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CallStrip } from "@/components/CallStrip";
import { SeverityMark } from "@/components/SeverityMark";
import { SignalSeal } from "@/components/SignalSeal";
import { api } from "@/lib/api";
import { formatDuration, parseApiDate, severityLabels } from "@/lib/format";
import { monitorHealth } from "@/lib/monitor";
import type { InterviewSession, Severity } from "@/lib/types";

/** Shown when the host leaves the room: what was recorded so far and the next step, which is the review. */
export function CallSummary({ sessionId, onReturn }: { sessionId: string; onReturn: () => void }) {
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<InterviewSession>(`/sessions/${sessionId}`).then(setSession).catch(() => setFailed(true));
  }, [sessionId]);

  const now = Date.now();
  const health = session ? monitorHealth(session.monitoring, session.status, now) : null;
  const duration = session?.started_at ? ((session.ended_at ? parseApiDate(session.ended_at).getTime() : now) - parseApiDate(session.started_at).getTime()) / 1000 : null;
  const counts = session?.events.reduce<Record<string, number>>((all, event) => ({ ...all, [event.severity]: (all[event.severity] ?? 0) + 1 }), {}) ?? {};
  const stillRunning = session?.status === "in_progress";

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl animate-rise">
        <p className="eyebrow">Dole nga dhoma</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Përmbledhja e call-it</h1>
        {!session ? (
          <p className="mt-10 flex items-center gap-3 text-muted" role="status">{failed ? "Përmbledhja nuk u ngarkua. Mund ta shohësh te faqja e call-it." : <><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Duke ngarkuar…</>}</p>
        ) : (
          <>
            <p className="mt-2 text-muted">{session.candidate.full_name} · {session.title}</p>
            {stillRunning && <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Kandidati mund të jetë ende në call. Mund të kthehesh në dhomë kur të duash.</p>}

            <section className="card mt-6 p-6" aria-labelledby="sum-title">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="sum-title" className="section-title">Ç&apos;u regjistrua</h2>
                <SignalSeal />
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Kohëzgjatja" value={duration !== null ? formatDuration(duration) : "Pa filluar"} />
                <Stat label="Sinjale" value={String(session.event_count)} />
                <Stat label="Monitori aktiv" value={session.monitoring.coverage_percent !== null ? `${session.monitoring.coverage_percent}%` : "Nuk matet"} />
                <Stat label="Testi" value={session.test_submission ? `${session.test_submission.score}/${session.test_submission.total}` : session.test ? "Pa dorëzuar" : "Pa test"} />
              </dl>
              {session.started_at && <div className="mt-6"><CallStrip events={session.events} startedAt={session.started_at} endedAt={session.ended_at} monitoring={session.monitoring} now={now} /></div>}
              {session.event_count > 0 && (
                <p className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                  {(["high", "medium", "low", "info"] as Severity[]).filter((level) => counts[level]).map((level) => (
                    <span key={level} className="inline-flex items-center gap-1.5"><SeverityMark severity={level} /><span className="sr-only">{severityLabels[level]}: </span><span className="font-mono font-semibold">{counts[level]}</span></span>
                  ))}
                </p>
              )}
              {health && (health.state === "silent" || health.state === "waiting") && session.event_count === 0 && (
                <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Asnjë sinjal i regjistruar, por monitori nuk raportoi. Kjo nuk do të thotë se nuk ndodhi asgjë.</p>
              )}
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-600"><CheckCircle2 size={16} className="text-moss" aria-hidden="true" /> Shënimet e tua private janë ruajtur.</p>
            </section>
          </>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/sessions/${sessionId}`} className="btn-primary">Hap shqyrtimin <ArrowRight size={17} aria-hidden="true" /></Link>
          <button type="button" onClick={onReturn} className="btn-secondary"><RotateCcw size={16} aria-hidden="true" /> Kthehu në dhomë</button>
          <Link href="/dashboard" className="btn-ghost">Paneli</Link>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
