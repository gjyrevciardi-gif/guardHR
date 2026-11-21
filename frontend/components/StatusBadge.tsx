import { reviewStatusLabels } from "@/lib/format";
import { Monitoring, ReviewStatus, SignalLevel } from "@/lib/types";

const styles: Record<ReviewStatus, string> = {
  "No events detected": "bg-emerald-50 text-emerald-700 ring-emerald-700/20",
  "Requires review": "bg-amber-100 text-amber-900 ring-amber-900/25",
  "Review completed": "bg-shell-200 text-teal ring-teal/20",
  "Insufficient evidence": "bg-slate-100 text-slate-600 ring-slate-600/20",
};

/**
 * "No events detected" is only reassuring when the monitor actually ran and nothing minor was seen, so with
 * `signalLevel` and `monitoring` the badge says what the host can really conclude.
 */
export function StatusBadge({ status, signalLevel, monitoring }: { status: ReviewStatus; signalLevel?: SignalLevel; monitoring?: Monitoring }) {
  let label: string = reviewStatusLabels[status] ?? status;
  let style = styles[status];
  if (status === "No events detected" && signalLevel) {
    if (signalLevel === "medium") { label = "Sinjal për t'u parë"; style = "bg-amber-50 text-amber-900 ring-amber-900/20"; }
    else if (signalLevel === "low" || signalLevel === "info") { label = "Vetëm sinjale të vogla"; style = "bg-slate-100 text-slate-700 ring-slate-700/20"; }
    else if (monitoring?.quality === "none" || monitoring?.quality === "partial") { label = "Pa sinjale · monitorim jo i plotë"; style = "bg-amber-50 text-amber-900 ring-amber-900/20"; }
  }
  return <span className={`chip ${style}`}>{label}</span>;
}
