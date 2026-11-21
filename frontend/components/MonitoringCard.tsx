import { dateTime, parseApiDate } from "@/lib/format";
import { Monitoring } from "@/lib/types";

const STALE_SECONDS = 60; // the monitor reports every 10 s

const messages: Record<Monitoring["quality"], string> = {
  good: "Monitori raportoi pothuajse gjatë gjithë call-it. Mungesa e sinjaleve është indikacion, jo provë.",
  partial: "Monitori raportoi vetëm një pjesë të call-it. Për pjesën tjetër nuk dihet çfarë ndodhi, prandaj mungesa e sinjaleve nuk ka vlerë.",
  none: "Nuk u mor asnjë sinjal nga monitori. \"No events detected\" nuk ka vlerë për këtë call: monitori mund të mos ketë punuar fare.",
  unknown: "Ende nuk ka mjaft të dhëna për mbulimin (call-i duhet të ketë ecur 30 sekonda), ose call-i është regjistruar para se mbulimi të matej.",
};

export function MonitoringCard({ monitoring, status }: { monitoring: Monitoring; status: string }) {
  const { quality, coverage_percent: coverage, face_percent: face, gaps, last_seen_at: lastSeen } = monitoring;
  const silentFor = lastSeen ? (Date.now() - parseApiDate(lastSeen).getTime()) / 1000 : null;
  const silentNow = status === "in_progress" && silentFor !== null && silentFor > STALE_SECONDS;
  const bad = quality === "none" || quality === "partial";
  return (
    <section className={`card p-6 ${bad ? "ring-2 ring-amber-400" : ""}`} aria-labelledby="monitoring-title">
      <h2 id="monitoring-title" className="font-black">Besueshmëria e monitorimit</h2>
      {coverage !== null && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm"><span>Monitori aktiv</span><strong className="text-lg">{coverage}%</strong></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={coverage} aria-valuemin={0} aria-valuemax={100} aria-label="Pjesa e call-it e monitoruar">
            <div className={`h-full rounded-full ${bad ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${coverage}%` }} />
          </div>
          <dl className="mt-3 space-y-1 text-sm text-slate-600">
            <div className="flex justify-between"><dt>Detektimi i fytyrës aktiv</dt><dd>{face}%</dd></div>
            <div className="flex justify-between"><dt>Ndërprerje të monitorit</dt><dd>{gaps}</dd></div>
          </dl>
        </div>
      )}
      <p className={`mt-4 text-sm leading-6 ${bad ? "font-semibold text-amber-900" : "text-slate-600"}`}>{messages[quality]}</p>
      {lastSeen && <p className="mt-2 text-xs text-slate-500">Sinjali i fundit: {dateTime(lastSeen)}</p>}
      {silentNow && <p role="alert" className="mt-2 text-sm font-semibold text-amber-900">Monitori nuk po raporton për më shumë se {Math.round(silentFor! / 60) || 1} min: kandidati mund ta ketë mbyllur faqen.</p>}
      <p className="mt-3 text-xs leading-5 text-slate-500">Të dhënat vijnë nga browser-i i kandidatit. Nuk mund të zbulojnë pajisje të dyta dhe nuk janë provë.</p>
    </section>
  );
}
