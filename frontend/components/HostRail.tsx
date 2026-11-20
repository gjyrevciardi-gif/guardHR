"use client";

import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { Activity, CheckCircle2, Circle, ClipboardCheck, StickyNote, TriangleAlert, UserRound } from "lucide-react";
import { CallStrip } from "@/components/CallStrip";
import { HostNotes } from "@/components/HostNotes";
import { SignalCard } from "@/components/SignalCard";
import { SignalSeal } from "@/components/SignalSeal";
import { ApiError, api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { monitorHealth } from "@/lib/monitor";
import type { InterviewSession } from "@/lib/types";

type TabId = "signals" | "candidate" | "notes" | "checklist";

interface Props {
  sessionId: string;
  now: number;
  /** What this browser sees of the candidate right now (the API cannot know). */
  live: { peerPresent: boolean; remoteCamera: boolean; remoteScreen: boolean };
  onSession: (session: InterviewSession) => void;
}

type Item = { id: string; label: string; state: "done" | "todo" | "warn"; hint?: string };

/** The host's side of the room: live signals, who the candidate is, private notes and a readiness list built from real state. */
export function HostRail({ sessionId, now, live, onSession }: Props) {
  const [data, setData] = useState<InterviewSession | null>(null);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<TabId>("signals");
  const [seen, setSeen] = useState(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(async () => {
    try {
      const next = await api<InterviewSession>(`/sessions/${sessionId}`);
      setData(next);
      setOffline(false);
      onSession(next);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) setOffline(true);
    }
  }, [sessionId, onSession]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  const total = data?.events.length ?? 0;
  useEffect(() => { if (tab === "signals") setSeen(total); }, [tab, total]);
  const unread = tab === "signals" ? 0 : Math.max(0, total - seen);

  const health = data ? monitorHealth(data.monitoring, data.status, now) : null;
  const items: Item[] = data && health ? [
    { id: "consent", label: "Kandidati pranoi kushtet", state: data.consented_at ? "done" : "todo" },
    ...(data.verify_candidate_email ? [{ id: "email", label: "Email-i i kandidatit u verifikua", state: data.verified_at ? "done" : "todo" } as Item] : []),
    { id: "peer", label: "Kandidati është në dhomë", state: live.peerPresent ? "done" : "todo", hint: "Prit që të hapë linkun dhe të shtypë «Hyr në call»." },
    { id: "camera", label: "Kamera e kandidatit është e hapur", state: live.remoteCamera ? "done" : live.peerPresent ? "warn" : "todo", hint: live.peerPresent ? "Kandidati është lidhur por nuk po dërgon figurë." : undefined },
    ...(data.require_screen_share ? [{ id: "screen", label: "Kandidati po ndan ekranin", state: live.remoteScreen ? "done" : live.peerPresent ? "warn" : "todo", hint: "Ky call e kërkon ndarjen e ekranit." } as Item] : []),
    { id: "monitor", label: "Monitori po raporton", state: health.state === "active" ? "done" : health.state === "silent" ? "warn" : "todo", hint: health.state === "active" ? undefined : health.detail },
    ...(data.test ? [{ id: "test", label: `Testi «${data.test.title}» u dorëzua`, state: data.test_submission ? "done" : "todo" } as Item] : []),
  ] : [];
  const ready = items.filter((item) => item.state === "done").length;

  const tabs: { id: TabId; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "signals", label: "Sinjale", icon: <Activity size={15} />, badge: unread },
    { id: "candidate", label: "Kandidati", icon: <UserRound size={15} /> },
    { id: "notes", label: "Shënime", icon: <StickyNote size={15} /> },
    { id: "checklist", label: "Lista", icon: <ClipboardCheck size={15} /> },
  ];

  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  }

  if (!data || !health) {
    return <p className="p-5 text-sm text-stage-muted" role="status">{offline ? "Nuk lidhet me serverin. Po provoj përsëri…" : "Duke ngarkuar…"}</p>;
  }

  const healthStyle = {
    active: "border-stage-accent/40 bg-stage-accent/10",
    silent: "border-amber-300/50 bg-amber-300/10",
    waiting: "border-stage-line bg-white/5",
    ended: "border-stage-line bg-white/5",
  }[health.state];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Paneli i host-it" className="flex border-b border-stage-line px-2">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => { tabRefs.current[item.id] = el; }}
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => onKey(event, index)}
            className={`relative inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 px-2 text-xs font-semibold transition ${tab === item.id ? "text-stage-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-gold" : "text-stage-muted hover:text-stage-ink"}`}
          >
            <span aria-hidden="true">{item.icon}</span>{item.label}
            {item.badge ? <span className="rounded-full bg-gold px-1.5 font-mono text-[10px] font-bold text-gold-ink" aria-label={`${item.badge} të reja`}>{item.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section role="tabpanel" id="panel-signals" aria-labelledby="tab-signals" hidden={tab !== "signals"} className="space-y-4">
          <h2 className="sr-only">Sinjalet e call-it</h2>
          <div className={`rounded-xl border p-3.5 ${healthStyle}`}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              {health.state === "active" && <span className="relative flex h-2.5 w-2.5" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stage-accent opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-stage-accent" /></span>}
              {health.state === "silent" && <TriangleAlert size={15} className="text-amber-300" aria-hidden="true" />}
              {health.state === "waiting" && <Circle size={15} className="text-stage-muted" aria-hidden="true" />}
              {health.label}
            </p>
            <p className="mt-1 text-xs leading-5 text-stage-muted">{health.detail}</p>
          </div>

          {data.started_at ? (
            <CallStrip tone="stage" events={data.events} startedAt={data.started_at} endedAt={data.ended_at} monitoring={data.monitoring} now={now} />
          ) : (
            <p className="rounded-xl border border-dashed border-stage-line p-4 text-xs leading-5 text-stage-muted">Rrjedha e call-it shfaqet pasi kandidati të hyjë.</p>
          )}
          <SignalSeal tone="stage" />

          {data.events.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stage-line p-5 text-center text-sm leading-6 text-stage-muted">
              {health.state === "active" ? "Asnjë sinjal deri tani. Monitori po raporton." : "Asnjë sinjal i regjistruar, por monitori nuk po raporton: kjo nuk do të thotë se gjithçka është në rregull."}
            </p>
          ) : (
            <ol className="space-y-2.5">
              {[...data.events].reverse().slice(0, 40).map((event) => <li key={event.id}><SignalCard event={event} tone="stage" /></li>)}
            </ol>
          )}
        </section>

        <section role="tabpanel" id="panel-candidate" aria-labelledby="tab-candidate" hidden={tab !== "candidate"}>
          <dl className="space-y-3 text-sm">
            <Row label="Emri" value={data.candidate.full_name} />
            <Row label="Email" value={data.candidate.email || "Pa email"} />
            <Row label="Call-i" value={data.title} />
            <Row label="Pranoi kushtet" value={dateTime(data.consented_at)} />
            <Row label="Email-i i verifikuar" value={data.verified_at ? dateTime(data.verified_at) : data.verify_candidate_email ? "Ende jo" : "Nuk kërkohej"} />
            <Row label="Ndarja e ekranit" value={data.require_screen_share ? "E kërkuar" : "Opsionale"} />
            <Row label="Testi" value={data.test ? (data.test_submission ? `${data.test_submission.score}/${data.test_submission.total} · dorëzuar` : "Pa dorëzuar") : "Pa test"} />
            <Row label="Linku skadon" value={dateTime(data.expires_at)} />
          </dl>
        </section>

        <section role="tabpanel" id="panel-notes" aria-labelledby="tab-notes" hidden={tab !== "notes"}>
          {/* Always mounted (only hidden): remounting would show the last poll instead of what was just typed. */}
          <HostNotes sessionId={sessionId} initial={data.host_notes} tone="stage" rows={14} />
        </section>

        <section role="tabpanel" id="panel-checklist" aria-labelledby="tab-checklist" hidden={tab !== "checklist"}>
          <p className="text-sm font-semibold">{ready} nga {items.length} gati</p>
          <p className="mt-1 text-xs leading-5 text-stage-muted">Lista vjen nga gjendja reale e dhomës, jo nga një formular që plotëson vetë.</p>
          <ul className="mt-3 space-y-2">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-2.5 rounded-xl border border-stage-line bg-stage-raised p-3 text-sm">
                {item.state === "done" && <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-stage-accent" aria-hidden="true" />}
                {item.state === "warn" && <TriangleAlert size={17} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />}
                {item.state === "todo" && <Circle size={17} className="mt-0.5 shrink-0 text-stage-muted" aria-hidden="true" />}
                <span>
                  {item.label}
                  <span className="sr-only">{item.state === "done" ? ": gati" : item.state === "warn" ? ": kujdes" : ": ende jo"}</span>
                  {item.state !== "done" && item.hint && <span className="mt-0.5 block text-xs leading-5 text-stage-muted">{item.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {offline && <p className="border-t border-stage-line px-4 py-2 text-xs text-amber-300" role="status">Lidhja me serverin u ndërpre; të dhënat mund të jenë të vjetra.</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-stage-muted">{label}</dt><dd className="text-right font-medium">{value}</dd></div>;
}
