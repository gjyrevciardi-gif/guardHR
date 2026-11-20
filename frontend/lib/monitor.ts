import { parseApiDate } from "@/lib/format";
import type { Monitoring } from "@/lib/types";

/** The monitor reports every 10 s; a minute of silence is long enough to say something is wrong. */
export const SILENT_AFTER_SECONDS = 60;

export type MonitorHealth = {
  /** active = reporting now, silent = was reporting and stopped, waiting = nothing yet, ended = call is over */
  state: "active" | "silent" | "waiting" | "ended";
  label: string;
  detail: string;
};

/**
 * What the host can conclude about the candidate's monitor right now. This is the line between "nothing was observed"
 * and "nothing could be observed": only `active` means a quiet call is a quiet call.
 */
export function monitorHealth(monitoring: Monitoring, status: string, now: number): MonitorHealth {
  if (status === "completed" || status === "expired") return { state: "ended", label: "Call-i ka përfunduar", detail: monitoring.coverage_percent !== null ? `Monitori raportoi ${monitoring.coverage_percent}% të kohës.` : "Mbulimi i monitorit nuk u mat." };
  if (!monitoring.last_seen_at) {
    return status === "in_progress"
      ? { state: "waiting", label: "Monitori ende nuk ka raportuar", detail: "Mund të duhen disa sekonda pasi kandidati hyn. Pa raport, mungesa e sinjaleve nuk ka vlerë." }
      : { state: "waiting", label: "Në pritje të kandidatit", detail: "Monitori nis kur kandidati hyn në call." };
  }
  const silentFor = (now - parseApiDate(monitoring.last_seen_at).getTime()) / 1000;
  if (silentFor <= SILENT_AFTER_SECONDS) {
    return { state: "active", label: "Monitori aktiv", detail: monitoring.coverage_percent !== null ? `Ka raportuar ${monitoring.coverage_percent}% të kohës deri tani.` : "Po raporton." };
  }
  return { state: "silent", label: "Monitori nuk raporton", detail: `Heshtje prej ${Math.max(1, Math.round(silentFor / 60))} min: kandidati mund ta ketë mbyllur faqen ose ka humbur lidhjen. Sa kohë heshtet, mungesa e sinjaleve nuk ka vlerë.` };
}
