import { ShieldCheck } from "lucide-react";

/** The product's promise, printed wherever signals appear. */
export function SignalSeal({ tone = "themed", className = "" }: { tone?: "themed" | "stage"; className?: string }) {
  const colors = tone === "stage" ? "border-stage-line bg-white/5 text-stage-muted" : "border-line bg-shell-100 text-slate-700";
  return (
    <p className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${colors} ${className}`}>
      <ShieldCheck size={14} aria-hidden="true" className={tone === "stage" ? "text-stage-accent" : "text-teal"} />
      Sinjal për shqyrtim, jo verdikt
    </p>
  );
}
