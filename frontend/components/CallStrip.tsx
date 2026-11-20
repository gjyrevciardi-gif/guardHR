import { clock, parseApiDate, severityLabels, signalInfo, timeOnly } from "@/lib/format";
import type { IntegrityEvent, Monitoring } from "@/lib/types";
import { SeverityShape } from "@/components/SeverityMark";

type StripEvent = Pick<IntegrityEvent, "id" | "event_type" | "severity" | "started_at" | "duration_seconds">;

interface Props {
  events: StripEvent[];
  startedAt: string | null;
  endedAt: string | null;
  monitoring?: Monitoring;
  /** Reference time for a call that is still running. */
  now?: number;
  tone?: "themed" | "stage";
  /** Hide the legend when the surrounding page already explains the three states. */
  compact?: boolean;
}

const heights = { high: "100%", medium: "72%", low: "48%", info: "28%" } as const;
const markColors = { high: "bg-amber-800", medium: "bg-amber-500", low: "bg-slate-500", info: "bg-slate-400" } as const;

/**
 * The product's signature element: one call as a line of time. Three states are drawn differently on purpose:
 *   calm band        = normal activity while the monitor was reporting
 *   marker           = a signal the browser observed (taller = more significant)
 *   diagonal hatch   = the monitor was NOT reporting, so nothing can be said about that part
 * The hatched part of the coverage bar is a share of the call; the API stores how many gaps there were, not where.
 */
export function CallStrip({ events, startedAt, endedAt, monitoring, now = Date.now(), tone = "themed", compact = false }: Props) {
  const stage = tone === "stage";
  const times = events.map((event) => parseApiDate(event.started_at).getTime());
  const start = startedAt ? parseApiDate(startedAt).getTime() : times.length ? Math.min(...times) : now;
  const lastEvent = events.reduce((latest, event) => Math.max(latest, parseApiDate(event.started_at).getTime() + (event.duration_seconds ?? 0) * 1000), start);
  const end = endedAt ? parseApiDate(endedAt).getTime() : startedAt ? Math.max(now, lastEvent) : Math.max(lastEvent, start + 60_000);
  const span = Math.max(end - start, 60_000);
  const position = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / span) * 100));

  const counts = events.reduce<Record<string, number>>((all, event) => ({ ...all, [event.severity]: (all[event.severity] ?? 0) + 1 }), {});
  const coverage = monitoring?.coverage_percent ?? null;
  const summary = [
    events.length
      ? `${events.length} sinjale: ${(["high", "medium", "low", "info"] as const).filter((level) => counts[level]).map((level) => `${counts[level]} ${severityLabels[level].toLowerCase()}`).join(", ")}`
      : "Asnjë sinjal i vëzhguar",
    coverage !== null ? `monitori raportoi ${coverage}% të kohës` : "mbulimi i monitorit ende nuk matet",
  ].join("; ");

  const muted = stage ? "text-stage-muted" : "text-muted";
  const base = stage ? "bg-white/10" : "bg-shell-200";
  const track = stage ? "border-stage-line" : "border-line";
  const hatch = stage ? "hatch-stage" : "hatch";

  return (
    <figure className="m-0">
      <div role="img" aria-label={summary}>
        <div className={`relative h-12 overflow-hidden rounded-lg border ${track} ${base}`}>
          {events.map((event) => {
            const at = parseApiDate(event.started_at).getTime();
            const width = Math.max(((event.duration_seconds ?? 0) * 1000 / span) * 100, 0.7);
            return (
              <span
                key={event.id}
                title={`${signalInfo[event.event_type]?.label ?? event.event_type} · ${severityLabels[event.severity]} · ${timeOnly(event.started_at)}`}
                className={`absolute bottom-0 rounded-t-sm ${markColors[event.severity]}`}
                style={{ left: `${Math.min(position(at), 100 - width)}%`, width: `${width}%`, minWidth: 3, height: heights[event.severity] }}
              />
            );
          })}
        </div>
        <div className={`mt-1.5 flex justify-between font-mono text-[11px] tabular-nums ${muted}`} aria-hidden="true">
          <span>{timeOnly(new Date(start))}</span>
          <span>{clock((end - start) / 1000)}</span>
          <span>{endedAt ? timeOnly(new Date(end)) : "tani"}</span>
        </div>
        <div className={`mt-2.5 flex h-2 overflow-hidden rounded-full border ${track} ${stage ? "bg-white/5" : "bg-white"}`}>
          {coverage !== null ? (
            <>
              <span className={stage ? "bg-stage-accent" : "bg-moss"} style={{ width: `${coverage}%` }} />
              <span className={`flex-1 ${hatch}`} />
            </>
          ) : (
            <span className={`flex-1 ${hatch}`} />
          )}
        </div>
      </div>
      {!compact && (
        <figcaption className={`mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs ${muted}`}>
          <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-4 rounded-sm border ${track} ${base}`} aria-hidden="true" />Aktivitet normal</span>
          <span className="inline-flex items-center gap-1.5"><SeverityShape severity="medium" />Sinjal i vëzhguar</span>
          <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-4 rounded-sm border ${track} ${hatch}`} aria-hidden="true" />Pa monitorim: nuk dihet çfarë ndodhi</span>
        </figcaption>
      )}
    </figure>
  );
}
