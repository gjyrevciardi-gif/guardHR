"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarClock, CheckCircle2, ChevronRight, ClipboardList, Loader2, Plus, Radio, Search, ShieldAlert, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SeverityMark } from "@/components/SeverityMark";
import { SignalSeal } from "@/components/SignalSeal";
import { StatusBadge } from "@/components/StatusBadge";
import { ApiError, api } from "@/lib/api";
import { AttentionItem, attentionItems, dailyActivity, matchesView, reviewProgress, ViewId, views } from "@/lib/dashboard";
import { auditLabel, longDate, relativeTime, sessionStatusLabels } from "@/lib/format";
import { AuditLog, InterviewSession, User } from "@/lib/types";

const VIEW_KEY = "ng-dashboard-view";
const hiddenFromFeed = new Set(["session.viewed", "test.viewed", "auth.login", "auth.register"]);

function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 12 ? "Mirëmëngjes" : hour < 18 ? "Mirëdita" : "Mirëmbrëma";
}

export default function DashboardPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewId>("all");
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState<Date | null>(null); // set after mount: the server's clock and zone would not match the reader's

  const load = useCallback(async () => {
    try {
      const [me, rows, audit] = await Promise.all([api<User>("/auth/me"), api<InterviewSession[]>("/sessions"), api<AuditLog[]>("/audit-logs")]);
      setUser(me); setSessions(rows); setLogs(audit); setOffline(false); setNow(new Date());
    } catch (err) {
      // Only an expired session ends up on /login; a network blip or a 5xx keeps the last data on screen.
      if (err instanceof ApiError && err.status === 401) router.replace("/login"); else setOffline(true);
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY) as ViewId | null;
      if (saved && views.some((item) => item.id === saved)) setView(saved);
    } catch { /* storage can be blocked; the view then resets to "all" */ }
  }, []);

  function chooseView(next: ViewId) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* per-visit only */ }
  }

  const clock = now?.getTime() ?? 0;
  const attention = useMemo(() => attentionItems(sessions, clock || Date.now()), [sessions, clock]);
  const activity = useMemo(() => dailyActivity(sessions, 14, now ?? new Date()), [sessions, now]);
  const progress = useMemo(() => reviewProgress(sessions), [sessions]);
  const counts = useMemo(() => Object.fromEntries(views.map((item) => [item.id, sessions.filter((session) => matchesView(session, item.id, clock || Date.now())).length])) as Record<ViewId, number>, [sessions, clock]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sessions.filter((session) => matchesView(session, view, clock || Date.now()) && `${session.title} ${session.candidate.full_name} ${session.candidate.email || ""}`.toLowerCase().includes(needle));
  }, [sessions, view, query, clock]);
  const feed = logs.filter((log) => !hiddenFromFeed.has(log.action)).slice(0, 6);

  const firstName = user?.full_name.split(" ")[0] ?? "";
  const summary = !sessions.length
    ? "Krijo call-in e parë për të nisur."
    : counts.live || counts.review
      ? [counts.live ? `${counts.live} në vazhdim` : "", counts.review ? `${counts.review} kërkojnë shqyrtim` : ""].filter(Boolean).join(" · ")
      : "Asgjë nuk pret shqyrtimin tënd.";

  return (
    <AppShell>
      {offline && <OfflineBanner />}
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end animate-rise">
        <div>
          <p className="eyebrow">{now ? longDate(now) : " "}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{now && user ? `${greeting(now)}, ${firstName}` : "Paneli"}</h1>
          <p className="mt-2 text-muted">{loading ? "Duke ngarkuar…" : summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/tests/new" className="btn-secondary"><ClipboardList size={17} aria-hidden="true" /> Test i ri</Link>
          <Link href="/sessions/new" className="btn-primary"><Plus size={17} aria-hidden="true" /> Call i ri</Link>
        </div>
      </div>

      {loading ? (
        <div className="mt-16 flex items-center justify-center gap-3 text-muted" role="status"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Duke ngarkuar…</div>
      ) : sessions.length === 0 ? (
        <FirstRun />
      ) : (
        <>
          <section aria-label="Përmbledhje" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile icon={<Radio size={18} />} label="Në vazhdim tani" value={counts.live} live={counts.live > 0} />
            <Tile icon={<ShieldAlert size={18} />} label="Kërkojnë shqyrtim" value={counts.review} />
            <Tile icon={<CalendarClock size={18} />} label="Të planifikuara" value={counts.upcoming} />
            <div className="card p-5">
              <p className="flex items-center gap-2 text-sm text-slate-600"><span className="rounded-lg bg-shell-200 p-2 text-teal"><CheckCircle2 size={18} aria-hidden="true" /></span> Shqyrtimi</p>
              <p className="mt-3 font-mono text-3xl font-bold tabular-nums">{progress.reviewed}<span className="text-lg text-muted">/{progress.completed}</span></p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-shell-200" role="progressbar" aria-label="Call-e të përfunduara të shqyrtuara" aria-valuemin={0} aria-valuemax={progress.completed} aria-valuenow={progress.reviewed}>
                <div className="h-full rounded-full bg-moss" style={{ width: progress.completed ? `${(progress.reviewed / progress.completed) * 100}%` : "0%" }} />
              </div>
              <p className="mt-2 text-xs text-muted">{progress.completed ? "call-e të përfunduara të shqyrtuara" : "Ende nuk ka call të përfunduar"}</p>
            </div>
          </section>

          <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <section className="card p-6 animate-rise" aria-labelledby="attention-title">
              <h2 id="attention-title" className="section-title">Kërkon vëmendjen tënde</h2>
              {attention.length === 0 ? (
                <p className="mt-5 flex items-center gap-3 rounded-xl bg-shell-100 p-4 text-sm text-slate-700"><CheckCircle2 className="shrink-0 text-moss" aria-hidden="true" /> Gjithçka është në rregull: asnjë call nuk pret veprim nga ti.</p>
              ) : (
                <ul className="mt-4 divide-y divide-line">{attention.slice(0, 6).map((item) => <AttentionRow key={item.id} item={item} />)}</ul>
              )}
              <SignalSeal className="mt-5" />
            </section>

            <div className="space-y-6">
              <section className="card p-6 animate-rise" aria-labelledby="activity-title">
                <h2 id="activity-title" className="section-title">14 ditët e fundit</h2>
                <ActivityChart buckets={activity} />
              </section>
              <section className="card p-6 animate-rise" aria-labelledby="feed-title">
                <h2 id="feed-title" className="section-title">Aktiviteti i fundit</h2>
                {feed.length === 0 ? <p className="mt-4 text-sm text-muted">Ende nuk ka aktivitet.</p> : (
                  <ul className="mt-3 divide-y divide-line">
                    {feed.map((log) => (
                      <li key={log.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                        <span className={log.action.endsWith("failed") || log.action.endsWith("locked") ? "font-semibold text-amber-900" : ""}>{auditLabel(log.action)}</span>
                        <time dateTime={log.created_at} className="shrink-0 font-mono text-xs text-muted">{relativeTime(log.created_at, now ?? undefined)}</time>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href="/settings" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-teal hover:underline">Regjistri i plotë <ArrowRight size={14} aria-hidden="true" /></Link>
              </section>
            </div>
          </div>

          <section className="card mt-6 overflow-hidden animate-rise" aria-labelledby="calls-title">
            <div className="flex flex-col gap-4 border-b border-line p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 id="calls-title" className="section-title">Call-et</h2>
                <p className="mt-1 pl-[1.15rem] text-sm text-muted">Pamja e zgjedhur ruhet për herën tjetër.</p>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-3.5 text-muted" size={17} aria-hidden="true" />
                <input className="input pl-10 lg:w-72" type="search" aria-label="Kërko pjesëmarrës" placeholder="Kërko emër, call ose email…" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
            </div>
            <div role="group" aria-label="Pamjet" className="flex gap-2 overflow-x-auto border-b border-line px-5 py-3">
              {views.map((item) => (
                <button key={item.id} type="button" onClick={() => chooseView(item.id)} aria-pressed={view === item.id} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition ${view === item.id ? "bg-teal text-white" : "text-slate-600 hover:bg-shell-100"}`}>
                  {item.label}<span className={`rounded-full px-1.5 font-mono text-xs tabular-nums ${view === item.id ? "bg-white/20" : "bg-shell-200 text-slate-700"}`}>{counts[item.id]}</span>
                </button>
              ))}
            </div>
            {filtered.length === 0 ? (
              <div className="p-12 text-center">
                <p className="font-semibold">{query ? "Asnjë rezultat." : "Asnjë call në këtë pamje."}</p>
                <p className="mt-1 text-sm text-muted">{query ? "Provo një emër ose email tjetër." : "Zgjidh «Të gjitha» për t'i parë të gjitha."}</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">{filtered.map((session) => <CallRow key={session.id} session={session} now={now ?? undefined} />)}</ul>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}

function Tile({ icon, label, value, live = false }: { icon: React.ReactNode; label: string; value: number; live?: boolean }) {
  return (
    <div className="card p-5">
      <p className="flex items-center gap-2 text-sm text-slate-600"><span className="rounded-lg bg-shell-200 p-2 text-teal" aria-hidden="true">{icon}</span> {label}</p>
      <p className="mt-3 flex items-center gap-2 font-mono text-3xl font-bold tabular-nums">
        {value}
        {live && <span className="relative flex h-2.5 w-2.5" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-moss opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-moss" /></span>}
      </p>
    </div>
  );
}

const attentionStyle: Record<AttentionItem["kind"], { icon: React.ReactNode; ring: string }> = {
  silent: { icon: <TriangleAlert size={18} />, ring: "bg-amber-100 text-amber-900" },
  live: { icon: <Radio size={18} />, ring: "bg-shell-200 text-teal" },
  review: { icon: <ShieldAlert size={18} />, ring: "bg-amber-100 text-amber-900" },
  weak: { icon: <TriangleAlert size={18} />, ring: "bg-slate-100 text-slate-700" },
  expiring: { icon: <CalendarClock size={18} />, ring: "bg-slate-100 text-slate-700" },
};

function AttentionRow({ item }: { item: AttentionItem }) {
  const style = attentionStyle[item.kind];
  return (
    <li className="flex items-center gap-4 py-3.5">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${style.ring}`} aria-hidden="true">{style.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{item.session.candidate.full_name} <span className="font-normal text-muted">· {item.session.title}</span></p>
        <p className="text-sm text-slate-600"><strong className="font-semibold text-navy">{item.title}.</strong> {item.detail}</p>
      </div>
      <Link href={item.href} className="btn-secondary shrink-0">{item.action}</Link>
    </li>
  );
}

function ActivityChart({ buckets }: { buckets: ReturnType<typeof dailyActivity> }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const flagged = buckets.reduce((sum, bucket) => sum + bucket.withSignals, 0);
  if (total === 0) return <p className="mt-4 rounded-xl border border-dashed border-line-strong p-5 text-sm text-muted">Asnjë call në 14 ditët e fundit.</p>;
  return (
    <div className="mt-4">
      <p className="text-sm text-slate-600"><strong className="font-mono text-navy">{total}</strong> call-e, nga të cilat <strong className="font-mono text-navy">{flagged}</strong> me sinjale.</p>
      <ul className="mt-4 flex h-28 items-end gap-1.5" aria-label="Call-e për ditë">
        {buckets.map((bucket) => (
          <li key={bucket.key} className="flex h-full flex-1 flex-col justify-end" aria-label={`${bucket.date.getDate()}/${bucket.date.getMonth() + 1}: ${bucket.total} call-e, ${bucket.withSignals} me sinjale`}>
            <div className="flex flex-col justify-end overflow-hidden rounded-t-sm" style={{ height: `${(bucket.total / max) * 100}%`, minHeight: bucket.total ? 4 : 0 }}>
              <span className="bg-moss" style={{ flex: bucket.total - bucket.withSignals }} />
              <span className="bg-amber-500" style={{ flex: bucket.withSignals }} />
            </div>
            <span className={`mt-1 h-px ${bucket.total ? "bg-line-strong" : "bg-line"}`} />
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted" aria-hidden="true">
        <span>{buckets[0].date.getDate()}/{buckets[0].date.getMonth() + 1}</span>
        <span>sot</span>
      </div>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-moss" aria-hidden="true" /> pa sinjale</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" aria-hidden="true" /> me sinjale</span>
      </p>
    </div>
  );
}

const statusDot: Record<string, string> = {
  in_progress: "bg-moss",
  completed: "bg-slate-500",
  scheduled: "border border-slate-500",
  consented: "border-2 border-moss",
  expired: "bg-slate-300",
};

function CallRow({ session, now }: { session: InterviewSession; now?: Date }) {
  const initials = session.candidate.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const when = session.started_at ?? session.created_at;
  const coverage = session.monitoring.coverage_percent;
  return (
    <li>
      <Link href={`/sessions/${session.id}`} className="grid items-center gap-x-4 gap-y-2 p-5 transition hover:bg-shell-100 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-shell-200 text-sm font-bold text-teal" aria-hidden="true">{initials}</span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{session.candidate.full_name}</p>
            <p className="truncate text-sm text-muted">{session.title}{session.candidate.email ? ` · ${session.candidate.email}` : ""}</p>
          </div>
        </div>
        <div className="text-sm">
          <p className="flex items-center gap-2 font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${statusDot[session.status] ?? "bg-slate-300"}`} aria-hidden="true" />{sessionStatusLabels[session.status] ?? session.status}</p>
          <p className="text-muted">{relativeTime(when, now)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={session.review_status} signalLevel={session.signal_level} monitoring={session.monitoring} />
          {session.signal_level !== "none" && <SeverityMark severity={session.signal_level} />}
          <span className="font-mono text-xs text-muted">{session.event_count} sinjale{coverage !== null ? ` · ${coverage}% mbulim` : ""}</span>
        </div>
        <ChevronRight className="hidden text-muted sm:block" size={18} aria-hidden="true" />
      </Link>
    </li>
  );
}

function FirstRun() {
  const steps = [
    ["Krijo një call", "Shto emrin dhe email-in e kandidatit. Ftesa niset vetë."],
    ["Kandidati pranon dhe hyn", "Pa llogari: lexon çfarë regjistrohet, pranon, teston pajisjen dhe hyn."],
    ["Ti sheh sinjalet dhe vendos", "Sinjalet të ndihmojnë të shqyrtosh. Vendimin e merr vetë."],
  ];
  return (
    <section className="card mt-8 p-8 animate-rise">
      <h2 className="text-xl font-bold">Krijo call-in e parë</h2>
      <p className="mt-2 max-w-2xl text-slate-600">Këtu do të shfaqen call-et, sinjalet që kërkojnë shqyrtim dhe progresi yt. Gjithçka që sheh do të vijë nga call-et e tua reale.</p>
      <ol className="mt-6 grid gap-4 md:grid-cols-3">
        {steps.map(([title, text], index) => (
          <li key={title} className="rounded-xl border border-line bg-shell-100 p-4">
            <span className="font-mono text-xs font-semibold text-teal">0{index + 1}</span>
            <p className="mt-1 font-semibold">{title}</p>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href="/sessions/new" className="btn-primary"><Plus size={17} aria-hidden="true" /> Krijo call-in e parë</Link>
        <Link href="/tests/new" className="btn-secondary"><ClipboardList size={17} aria-hidden="true" /> Krijo një test</Link>
        <SignalSeal />
      </div>
    </section>
  );
}
