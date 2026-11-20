import { CallStrip } from "@/components/CallStrip";
import { SignalCard } from "@/components/SignalCard";
import { SignalSeal } from "@/components/SignalSeal";
import type { IntegrityEvent, Monitoring } from "@/lib/types";

// Invented on purpose and labelled as such wherever it is shown. Severities follow backend/app/signals.py:
// a short tab absence is low, a paste is medium, a reconnect or resize is info. One medium signal does not queue a call for review.
const base = { ended_at: null, duration_seconds: null, confidence_score: null, metadata: {} } satisfies Partial<IntegrityEvent>;
const events: IntegrityEvent[] = [
  { ...base, id: "a", event_type: "tab_hidden", severity: "low", started_at: "2026-03-10T10:07:20Z", duration_seconds: 8 },
  { ...base, id: "b", event_type: "copy_paste", severity: "medium", started_at: "2026-03-10T10:14:05Z", metadata: { operation: "paste", char_count: 240, line_count: 9, looks_like_code: true } },
  { ...base, id: "c", event_type: "connection_interruption", severity: "info", started_at: "2026-03-10T10:21:40Z", duration_seconds: 6 },
  { ...base, id: "d", event_type: "window_resized", severity: "info", started_at: "2026-03-10T10:27:10Z", metadata: { width_percent: 80 } },
];
const monitoring: Monitoring = { quality: "good", coverage_percent: 92, face_percent: 88, gaps: 1, last_seen_at: null };

/** A whole call drawn with the real review components and invented data, so the product can be judged before signing up. */
export function SampleCall({ showSignals = true }: { showSignals?: boolean }) {
  return (
    <section className="card p-5 sm:p-6" aria-label="Shembull i një call-i, me të dhëna shembulli">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">Shembull · të dhëna të shpikura</p>
        <SignalSeal />
      </div>
      <h2 className="mt-3 font-semibold">Frontend screening · 34 min</h2>
      <div className="mt-4">
        <CallStrip events={events} startedAt="2026-03-10T10:00:00Z" endedAt="2026-03-10T10:34:00Z" monitoring={monitoring} />
      </div>
      {showSignals && (
        <div className="mt-5 space-y-2.5">
          {events.slice(0, 3).map((event) => <SignalCard key={event.id} event={event} />)}
        </div>
      )}
    </section>
  );
}
