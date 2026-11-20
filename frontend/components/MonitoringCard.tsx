import { CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import { dateTime, parseApiDate } from "@/lib/format";
import { Monitoring } from "@/lib/types";

const STALE_SECONDS = 60; // the monitor reports every 10 s

const headline: Record<Monitoring["quality"], string> = {
  good: "Monitori raportoi pothuajse gjatë gjithë call-it",
  partial: "Monitori raportoi vetëm një pjesë të call-it",
  none: "Monitori nuk raportoi fare",
  unknown: "Mbulimi ende nuk matet",
};

const messages: Record<Monitoring["quality"], string> = {
  good: "Mungesa e sinjaleve është indikacion, jo provë.",
  partial: "Për pjesën tjetër nuk dihet çfarë ndodhi, prandaj mungesa e sinjaleve aty nuk ka vlerë.",
  none: "\"Pa sinjale\" nuk ka vlerë për këtë call: monitori mund të mos ketë punuar fare.",
  unknown: "Call-i duhet të ketë ecur të paktën 30 sekonda, ose është regjistruar para se mbulimi të matej.",
};

export function MonitoringCard({ monitoring, status }: { monitoring: Monitoring; status: string }) {
  const { quality, coverage_percent: coverage, face_percent: face, gaps, last_seen_at: lastSeen } = monitoring;
  const silentFor = lastSeen ? (Date.now() - parseApiDate(lastSeen).getTime()) / 1000 : null;
  const silentNow = status === "in_progress" && silentFor !== null && silentFor > STALE_SECONDS;
  const bad = quality === "none" || quality === "partial";
  const Icon = quality === "good" ? CheckCircle2 : bad ? TriangleAlert : CircleDashed;
  return (
    <section className={`card p-6 ${bad ? "ring-2 ring-amber-400" : ""}`} aria-labelledby="monitoring-title">
      <h2 id="monitoring-title" className="section-title">Besueshmëria e monitorimit</h2>
      <p className={`mt-4 flex items-start gap-2.5 text-sm font-semibold ${bad ? "text-amber-900" : "text-navy"}`}>
        <Icon size={18} aria-hidden="true" className={`mt-0.5 shrink-0 ${quality === "good" ? "text-moss" : bad ? "text-amber-700" : "text-muted"}`} />
        {headline[quality]}
      </p>
      {coverage !== null && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm"><span className="text-slate-600">Monitori aktiv</span><strong className="font-mono text-lg tabular-nums">{coverage}%</strong></div>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full border border-line bg-white" role="progressbar" aria-valuenow={coverage} aria-valuemin={0} aria-valuemax={100} aria-label="Pjesa e call-it e monitoruar">
            <span className={bad ? "bg-amber-500" : "bg-moss"} style={{ width: `${coverage}%` }} />
            <span className="hatch flex-1" />
          </div>
          <dl className="mt-3 space-y-1 text-sm text-slate-600">
            <div className="flex justify-between"><dt>Detektimi i fytyrës aktiv</dt><dd className="font-mono tabular-nums">{face}%</dd></div>
            <div className="flex justify-between"><dt>Ndërprerje të monitorit</dt><dd className="font-mono tabular-nums">{gaps}</dd></div>
          </dl>
        </div>
      )}
      <p className="mt-4 text-sm leading-6 text-slate-600">{messages[quality]}</p>
      {lastSeen && <p className="mt-2 text-xs text-muted">Sinjali i fundit: {dateTime(lastSeen)}</p>}
      {silentNow && <p role="alert" className="mt-2 text-sm font-semibold text-amber-900">Monitori nuk po raporton për më shumë se {Math.round(silentFor! / 60) || 1} min: kandidati mund ta ketë mbyllur faqen.</p>}
      <p className="mt-3 text-xs leading-5 text-muted">Të dhënat vijnë nga browser-i i kandidatit. Nuk mund të zbulojnë pajisje të dyta dhe nuk janë provë.</p>
    </section>
  );
}
