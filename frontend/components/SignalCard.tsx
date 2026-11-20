import { dateTime, signalInfo, timeOnly } from "@/lib/format";
import type { IntegrityEvent } from "@/lib/types";
import { SeverityMark } from "@/components/SeverityMark";

type CardEvent = Pick<IntegrityEvent, "id" | "event_type" | "severity" | "started_at" | "duration_seconds" | "confidence_score"> & { metadata?: Record<string, unknown> };

/** Extra facts the browser sent that are safe and useful to show (never the pasted text, which is not stored). */
function facts(event: CardEvent) {
  const meta = event.metadata ?? {};
  const out: string[] = [];
  if (event.duration_seconds != null) out.push(`Zgjati ${event.duration_seconds.toFixed(1).replace(".", ",")} s`);
  if (event.confidence_score != null) out.push(`Besueshmëria e detektorit ${Math.round(event.confidence_score * 100)}%`);
  if (meta.char_count) out.push(`${String(meta.char_count)} shkronja${meta.line_count ? `, ${String(meta.line_count)} rreshta` : ""}`);
  if (meta.looks_like_code) out.push("duket si kod");
  if (meta.width_percent) out.push(`dritarja në ${String(meta.width_percent)}% të gjerësisë fillestare`);
  return out;
}

/** One observed signal with the two sentences that keep it honest: what it means, and what it does not show. */
export function SignalCard({ event, tone = "themed", showDate = false }: { event: CardEvent; tone?: "themed" | "stage"; showDate?: boolean }) {
  const info = signalInfo[event.event_type];
  const stage = tone === "stage";
  const details = facts(event);
  return (
    <article className={`rounded-xl border p-4 ${stage ? "border-stage-line bg-stage-raised" : "border-line bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${stage ? "text-stage-ink" : "text-navy"}`}>
          {info?.label ?? event.event_type}
          <SeverityMark severity={event.severity} />
        </h3>
        <time dateTime={event.started_at} className={`font-mono text-xs tabular-nums ${stage ? "text-stage-muted" : "text-muted"}`}>{showDate ? dateTime(event.started_at) : timeOnly(event.started_at)}</time>
      </div>
      {details.length > 0 && <p className={`mt-1.5 text-xs ${stage ? "text-stage-muted" : "text-muted"}`}>{details.join(" · ")}</p>}
      {info && (
        <details className="mt-2">
          <summary className={`inline-flex min-h-8 cursor-pointer items-center text-xs font-semibold underline-offset-2 hover:underline ${stage ? "text-stage-accent" : "text-teal"}`}>Çfarë do të thotë kjo</summary>
          <div className={`mt-1 space-y-1.5 text-xs leading-5 ${stage ? "text-stage-muted" : "text-slate-600"}`}>
            <p>{info.meaning}</p>
            <p><strong className={stage ? "text-stage-ink" : "text-navy"}>Çfarë nuk tregon:</strong> {info.caution}</p>
          </div>
        </details>
      )}
    </article>
  );
}
