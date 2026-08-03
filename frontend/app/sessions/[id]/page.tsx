"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Clipboard, ExternalLink, FileCheck2, Video, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { dateTime, eventLabels } from "@/lib/format";
import { InterviewSession } from "@/lib/types";

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("Review completed");
  const [message, setMessage] = useState("");
  const [alerts, setAlerts] = useState<Array<{ id: string; title: string; message: string }>>([]);
  const knownEventIds = useRef<Set<string>>(new Set());
  const initializedEvents = useRef(false);

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
          .filter((event) => !knownEventIds.current.has(event.id))
          .forEach((event) => {
            const label = eventLabels[event.event_type] || event.event_type;
            pushAlert({
              id: event.id,
              title: label,
              message: `${label} - ${event.duration_seconds != null ? `${event.duration_seconds.toFixed(1)}s` : "pa kohezgjatje"} - ${dateTime(event.started_at)}`,
            });
          });
      }
      knownEventIds.current = nextIds;
      initializedEvents.current = true;
      setSession(data);
      const prior = data.reviews.at(-1);
      if (prior) {
        setNotes(prior.notes);
        setOutcome(prior.outcome);
      }
    } catch {
      router.replace("/dashboard");
    }
  }, [id, pushAlert, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function review(event: FormEvent) {
    event.preventDefault();
    await api(`/sessions/${id}/reviews`, { method: "POST", body: JSON.stringify({ notes, outcome }) });
    setMessage("Review u ruajt ne audit log.");
    await load();
  }

  if (!session) return <AppShell><p>Duke ngarkuar...</p></AppShell>;

  const candidateLink = `${window.location.origin}/join/${session.public_token}`;

  return (
    <AppShell>
      {alerts.length > 0 && (
        <div className="fixed right-5 top-5 z-50 w-[min(360px,calc(100vw-2.5rem))] space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="rounded-2xl border border-amber-200 bg-white p-4 shadow-2xl">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-amber-100 p-2 text-amber-700"><AlertTriangle size={18} /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{alert.title}</p>
                  <p className="mt-1 text-sm leading-5 text-slate-600">{alert.message}</p>
                </div>
                <button onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Mbyll njoftimin">
                  <X size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Link href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-teal">
        <ArrowLeft size={17} /> Dashboard
      </Link>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-black">{session.candidate.full_name}</h1>
            <StatusBadge status={session.review_status} />
          </div>
          <p className="mt-2 text-slate-500">{session.title} - {session.candidate.email || "Pa email"}</p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div className="text-sm text-slate-500">Krijuar {dateTime(session.created_at)}</div>
          <Link href={`/sessions/${session.id}/room`} className="btn-primary">
            <Video size={18} /> Hyr ne Nemo Call si host
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="card p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">Live activity timeline</h2>
              <p className="text-sm text-slate-500">Rifreskohet automatikisht. Sinjale per host-in, jo akuza automatike.</p>
            </div>
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold">{session.events.length} evente</span>
          </div>

          {session.events.length === 0 ? (
            <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-10 text-center">
              <p className="font-semibold text-emerald-700">No events detected</p>
              <p className="mt-1 text-sm text-slate-500">Nuk ka activity signals te regjistruara ne kete call.</p>
            </div>
          ) : (
            <ol className="relative mt-8 border-l border-slate-200">
              {session.events.map((item) => (
                <li key={item.id} className="mb-7 ml-6">
                  <span className="absolute -left-2 mt-1.5 h-4 w-4 rounded-full border-4 border-white bg-teal" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{eventLabels[item.event_type] || item.event_type}</h3>
                    <time className="text-xs text-slate-500">{dateTime(item.started_at)}</time>
                  </div>
                  <div className="mt-2 flex gap-4 text-xs text-slate-500">
                    <span>Kohezgjatja: {item.duration_seconds != null ? `${item.duration_seconds.toFixed(1)}s` : "-"}</span>
                    <span>Confidence: {item.confidence_score != null ? `${Math.round(item.confidence_score * 100)}%` : "-"}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="font-black">Detajet e call-it</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Status" value={session.status.replace("_", " ")} />
              <Row label="Filluar" value={dateTime(session.started_at)} />
              <Row label="Perfunduar" value={dateTime(session.ended_at)} />
              <Row label="Screen sharing" value={session.require_screen_share ? "Kerkohet" : "Opsional"} />
            </dl>
            <div className="mt-5 flex items-center gap-2 rounded-xl bg-slate-100 p-3">
              <code className="min-w-0 flex-1 truncate text-xs">{candidateLink}</code>
              <button onClick={() => navigator.clipboard.writeText(candidateLink)} aria-label="Kopjo"><Clipboard size={17} /></button>
              <a href={candidateLink} target="_blank" aria-label="Hap"><ExternalLink size={17} /></a>
            </div>
          </section>

          {session.test && (
            <section className="card p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-black">Testi me zgjedhje</h2>
                  <p className="mt-2 text-sm text-slate-600">{session.test.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{session.test.question_count} pyetje</p>
                </div>
                <Link href={`/tests/${session.test.id}`} className="btn-secondary">
                  Review/Edit <ExternalLink size={16} />
                </Link>
              </div>

              {session.test_submission ? (
                <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
                  Pjesemarresi e dorezoi testin: <strong>{session.test_submission.score}/{session.test_submission.total}</strong>
                  <div className="mt-1 text-xs">Dorezuar: {dateTime(session.test_submission.submitted_at)}</div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
                  Pjesemarresi ende nuk e ka dorezuar testin.
                </div>
              )}
            </section>
          )}

          <form onSubmit={review} className="card p-6">
            <div className="flex items-center gap-2"><FileCheck2 className="text-teal" /><h2 className="font-black">Host notes</h2></div>
            <p className="mt-2 text-xs leading-5 text-slate-500">Sistemi nuk akuzon automatikisht. Sheno kontekstin e call/test signals per evidence.</p>
            <label className="label mt-5">Rezultati</label>
            <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option>Review completed</option>
              <option>Insufficient evidence</option>
            </select>
            <label className="label mt-4">Shenime</label>
            <textarea className="input min-h-32 resize-y" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Konteksti dhe arsyetimi i shqyrtimit..." required minLength={3} />
            {message && <p className="mt-3 text-sm text-emerald-700">{message}</p>}
            <button className="btn-primary mt-4 w-full">Ruaj shenimet</button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium capitalize">{value}</dd></div>;
}
