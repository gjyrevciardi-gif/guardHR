"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, Clipboard, ClipboardList, ExternalLink, FileCheck2, Loader2, Trash2, Video, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CallStrip } from "@/components/CallStrip";
import { HostNotes } from "@/components/HostNotes";
import { MonitoringCard } from "@/components/MonitoringCard";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SeverityMark } from "@/components/SeverityMark";
import { SignalCard } from "@/components/SignalCard";
import { SignalSeal } from "@/components/SignalSeal";
import { StatusBadge } from "@/components/StatusBadge";
import { ApiError, api } from "@/lib/api";
import { dateTime, eventLabels, formatDuration, parseApiDate, sessionStatusLabels, severityLabels } from "@/lib/format";
import { InterviewSession, Severity } from "@/lib/types";

const outcomes = [
  { value: "Review completed", label: "Shqyrtimi u përfundua" },
  { value: "Insufficient evidence", label: "Prova të pamjaftueshme" },
];

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("Review completed");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [offline, setOffline] = useState(false);
  const [alerts, setAlerts] = useState<Array<{ id: string; title: string; message: string }>>([]);
  const knownEventIds = useRef<Set<string>>(new Set());
  const initializedEvents = useRef(false);
  const reviewLoaded = useRef(false);

  const pushAlert = useCallback((alert: { id: string; title: string; message: string }) => {
    setAlerts((current) => [alert, ...current.filter((item) => item.id !== alert.id)].slice(0, 4));
    window.setTimeout(() => {
      setAlerts((current) => current.filter((item) => item.id !== alert.id));
    }, 9000);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api<InterviewSession>(`/sessions/${id}`);
      const nextIds = new Set(data.events.map((event) => event.id));
      if (initializedEvents.current) {
        data.events
          .filter((event) => !knownEventIds.current.has(event.id) && event.severity !== "info")
          .forEach((event) => {
            const label = eventLabels[event.event_type] || event.event_type;
            pushAlert({
              id: event.id,
              title: label,
              message: `${label} · ${event.duration_seconds != null ? `${event.duration_seconds.toFixed(1)} s` : "pa kohëzgjatje"} · ${dateTime(event.started_at)}`,
            });
          });
      }
      knownEventIds.current = nextIds;
      initializedEvents.current = true;
      setSession(data);
      setOffline(false);
      const prior = data.reviews.at(-1);
      if (prior && !reviewLoaded.current) { // prefill once: later polls must not overwrite what the host is typing
        reviewLoaded.current = true;
        setNotes(prior.notes);
        setOutcome(prior.outcome);
      }
    } catch (err) {
      // 401 is handled by api() (redirect to /login). A missing call goes back to the list; anything else keeps the last data.
      if (err instanceof ApiError && err.status === 404) router.replace("/dashboard");
      else if (!(err instanceof ApiError && err.status === 401)) setOffline(true);
    }
  }, [id, pushAlert, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function removeSession() {
    if (!window.confirm("Ta fshij këtë call përgjithmonë? Eventet, përgjigjet dhe review-t fshihen dhe veprimi nuk kthehet.")) return;
    try {
      await api(`/sessions/${id}`, { method: "DELETE" });
      router.replace("/dashboard");
    } catch (err) {
      pushAlert({ id: `delete-error-${Date.now()}`, title: "Fshirja dështoi", message: err instanceof Error ? err.message : "Call-i nuk u fshi." });
    }
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await api(`/sessions/${id}/reviews`, { method: "POST", body: JSON.stringify({ notes, outcome }) });
      setMessage("Shqyrtimi u ruajt dhe u regjistrua.");
      await load();
    } catch (err) {
      pushAlert({ id: `review-error-${Date.now()}`, title: "Shqyrtimi nuk u ruajt", message: err instanceof Error ? err.message : "Provo përsëri." });
    } finally {
      setSaving(false);
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      pushAlert({ id: `copy-${Date.now()}`, title: "Linku nuk u kopjua", message: "Zgjidhe tekstin dhe kopjoje me dorë." });
    }
  }

  if (!session) return <AppShell>{offline && <OfflineBanner />}<div className="mt-16 flex items-center justify-center gap-3 text-muted" role="status"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Duke ngarkuar…</div></AppShell>;

  const candidateLink = `${window.location.origin}/join/${session.public_token}`;
  const severityCounts = session.events.reduce<Record<string, number>>((counts, event) => ({ ...counts, [event.severity]: (counts[event.severity] || 0) + 1 }), {});
  const monitoringIsWeak = session.monitoring.quality === "none" || session.monitoring.quality === "partial";
  const live = session.status === "in_progress";
  const durationSeconds = session.started_at ? ((session.ended_at ? parseApiDate(session.ended_at).getTime() : Date.now()) - parseApiDate(session.started_at).getTime()) / 1000 : null;
  const initials = session.candidate.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const reviewed = session.review_status === "Review completed" || session.review_status === "Insufficient evidence";

  return (
    <AppShell>
      {offline && <OfflineBanner />}
      {/* Always mounted: a live region is only announced if it exists before its content changes. */}
      <div role="status" aria-live="polite" className="fixed right-5 top-20 z-50 w-[min(360px,calc(100vw-2.5rem))] space-y-3">
        {alerts.map((alert) => (
          <div key={alert.id} className="rounded-2xl border border-amber-200 bg-white p-4 shadow-lift">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-amber-100 p-2 text-amber-700"><AlertTriangle size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-navy">{alert.title}</p>
                <p className="mt-1 text-sm leading-5 text-slate-600">{alert.message}</p>
              </div>
              <button onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))} className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-shell-100 hover:text-slate-700" aria-label="Mbyll njoftimin">
                <X size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Link href="/dashboard" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-600 hover:text-teal">
        <ArrowLeft size={17} aria-hidden="true" /> Paneli
      </Link>

      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between animate-rise">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-shell-200 text-lg font-bold text-teal" aria-hidden="true">{initials}</span>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{session.candidate.full_name}</h1>
              <StatusBadge status={session.review_status} signalLevel={session.signal_level} monitoring={session.monitoring} />
            </div>
            <p className="mt-1.5 text-muted">{session.title} · {session.candidate.email || "Pa email"}</p>
            <p className="mt-1 text-xs text-muted">{sessionStatusLabels[session.status] ?? session.status} · krijuar {dateTime(session.created_at)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Link href={`/sessions/${session.id}/room`} className="btn-primary">
            <Video size={17} aria-hidden="true" /> {live ? "Hyr në call si host" : "Hap dhomën"}
          </Link>
          <button type="button" onClick={() => void removeSession()} className="btn-secondary text-red-700">
            <Trash2 size={16} aria-hidden="true" /> Fshi
          </button>
        </div>
      </header>

      {session.invite_status === "failed" && (
        <p role="alert" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Emaili i ftesës nuk u dërgua. Kopjo linkun më poshtë dhe dërgoja pjesëmarrësit manualisht.</p>
      )}

      <section aria-label="Përmbledhje" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 animate-rise">
        <Fact label="Kohëzgjatja" value={durationSeconds !== null ? formatDuration(durationSeconds) : "Ende pa filluar"} hint={live ? "ende në vazhdim" : undefined} />
        <Fact label="Sinjale të vëzhguara" value={String(session.event_count)}>
          {session.signal_level !== "none" && <SeverityMark severity={session.signal_level} />}
        </Fact>
        <Fact label="Monitori aktiv" value={session.monitoring.coverage_percent !== null ? `${session.monitoring.coverage_percent}%` : "Nuk matet"} hint={monitoringIsWeak ? "jo i plotë" : undefined} />
        <Fact
          label="Testi"
          value={session.test_submission ? `${session.test_submission.score}/${session.test_submission.total}` : session.test ? "Pa dorëzuar" : "Pa test"}
          hint={session.test_submission ? dateTime(session.test_submission.submitted_at) : session.test?.title}
        />
      </section>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="card p-6 animate-rise" aria-labelledby="strip-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="strip-title" className="section-title">Rrjedha e call-it</h2>
              <SignalSeal />
            </div>
            {session.started_at ? (
              <div className="mt-5"><CallStrip events={session.events} startedAt={session.started_at} endedAt={session.ended_at} monitoring={session.monitoring} /></div>
            ) : (
              <p className="mt-5 rounded-xl border border-dashed border-line-strong p-5 text-sm text-muted">Call-i ende nuk ka filluar. Kur kandidati të hyjë, këtu shfaqet rrjedha e tij në kohë.</p>
            )}
          </section>

          <section className="card p-6 animate-rise" aria-labelledby="signals-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="signals-title" className="section-title">Sinjalet e vëzhguara</h2>
                <p className="mt-1.5 pl-[1.15rem] text-sm text-muted">Rifreskohet vetë. Çdo sinjal tregon çfarë raportoi browser-i dhe çfarë nuk provon.</p>
              </div>
              {session.events.length > 0 && (
                <p className="flex flex-wrap gap-2 text-xs" aria-label="Përmbledhje sipas rëndësisë">
                  {(["high", "medium", "low", "info"] as Severity[]).filter((level) => severityCounts[level]).map((level) => (
                    <span key={level} className="inline-flex items-center gap-1"><SeverityMark severity={level} /><span className="sr-only">{severityLabels[level]}: </span><span className="font-mono font-semibold tabular-nums">{severityCounts[level]}</span></span>
                  ))}
                </p>
              )}
            </div>

            {session.events.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-line-strong p-10 text-center">
                {monitoringIsWeak ? (
                  <>
                    <p className="font-semibold text-amber-900">Asnjë sinjal i regjistruar, por monitorimi nuk ishte i plotë</p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">Kjo nuk do të thotë se nuk ndodhi asgjë. Shih «Besueshmëria e monitorimit».</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-emerald-700">Asnjë sinjal i vëzhguar</p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted">Monitori raportoi dhe nuk pa asgjë të veçantë. Edhe kjo mbetet vetëm një indikacion.</p>
                  </>
                )}
              </div>
            ) : (
              <ol className="mt-5 space-y-3">
                {[...session.events].reverse().map((item) => <li key={item.id}><SignalCard event={item} /></li>)}
              </ol>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <MonitoringCard monitoring={session.monitoring} status={session.status} />

          <section className="card p-6 animate-rise" aria-labelledby="notes-title">
            <h2 id="notes-title" className="section-title">Shënimet e tua</h2>
            <div className="mt-4"><HostNotes sessionId={session.id} initial={session.host_notes} /></div>
          </section>

          <form onSubmit={review} className="card p-6 animate-rise" aria-labelledby="review-title">
            <div className="flex items-center justify-between gap-3">
              <h2 id="review-title" className="section-title">Përfundimi i shqyrtimit</h2>
              {reviewed && <span className="chip bg-shell-200 text-teal ring-teal/20"><Check size={12} aria-hidden="true" /> E ruajtur</span>}
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">Sistemi nuk akuzon dhe nuk vendos. Këtu shkruan ti çfarë konkludove dhe pse; regjistrohet kush e shqyrtoi dhe kur.</p>
            <label htmlFor="review-outcome" className="label mt-5">Rezultati</label>
            <select id="review-outcome" className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {outcomes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <label htmlFor="review-notes" className="label mt-4">Arsyetimi</label>
            <textarea id="review-notes" className="input min-h-32 resize-y" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Konteksti dhe arsyetimi i shqyrtimit…" required minLength={3} />
            {session.host_notes && !notes && (
              <button type="button" onClick={() => setNotes(session.host_notes ?? "")} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal hover:underline"><ClipboardList size={15} aria-hidden="true" /> Përdor shënimet e punës</button>
            )}
            {message && <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{message}</p>}
            <button className="btn-primary mt-4 w-full" disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FileCheck2 size={16} aria-hidden="true" />} Ruaj shqyrtimin
            </button>
          </form>

          <section className="card p-6 animate-rise" aria-labelledby="details-title">
            <h2 id="details-title" className="section-title">Detajet e call-it</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Statusi" value={sessionStatusLabels[session.status] ?? session.status} />
              <Row label="Filluar" value={dateTime(session.started_at)} />
              <Row label="Përfunduar" value={dateTime(session.ended_at)} />
              <Row label="Pranoi kushtet" value={dateTime(session.consented_at)} />
              <Row label="Ndarja e ekranit" value={session.require_screen_share ? "E kërkuar" : "Opsionale"} />
              <Row label="Email-i i verifikuar" value={session.verified_at ? dateTime(session.verified_at) : session.verify_candidate_email ? "Ende jo" : "Nuk kërkohej"} />
              <Row label="Linku skadon" value={dateTime(session.expires_at)} />
            </dl>
            <div className="mt-5 flex items-center gap-1 rounded-xl border border-line bg-shell-100 p-2 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{candidateLink}</code>
              <button onClick={() => void copyLink(candidateLink)} aria-label={copied ? "Linku u kopjua" : "Kopjo linkun"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-white">{copied ? <Check size={17} className="text-moss" /> : <Clipboard size={17} />}</button>
              <a href={candidateLink} target="_blank" rel="noopener noreferrer" aria-label="Hap linkun në skedë të re" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-white"><ExternalLink size={17} /></a>
            </div>
          </section>

          {session.test && (
            <section className="card p-6 animate-rise" aria-labelledby="test-title">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="test-title" className="section-title">Testi</h2>
                  <p className="mt-3 text-sm font-semibold">{session.test.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{session.test.question_count} pyetje</p>
                </div>
                <Link href={`/tests/${session.test.id}`} className="btn-secondary">Hap <ExternalLink size={15} aria-hidden="true" /></Link>
              </div>
              {session.test_submission ? (
                <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Pjesëmarrësi e dorëzoi testin: <strong className="font-mono">{session.test_submission.score}/{session.test_submission.total}</strong><span className="mt-1 block text-xs">Dorëzuar: {dateTime(session.test_submission.submitted_at)}</span></p>
              ) : (
                <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Pjesëmarrësi ende nuk e ka dorëzuar testin.</p>
              )}
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Fact({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-xl font-bold tabular-nums">{value}{children}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-muted">{label}</dt><dd className="text-right font-medium">{value}</dd></div>;
}
