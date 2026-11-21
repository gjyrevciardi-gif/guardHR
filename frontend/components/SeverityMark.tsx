import { severityLabels, severityStyles } from "@/lib/format";
import type { Severity } from "@/lib/types";

/** Shape + word + colour, so severity is readable without colour: triangle, diamond, dot, ring. */
export function SeverityShape({ severity, size = 10 }: { severity: Severity; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
      {severity === "high" && <polygon points="5,0.5 9.5,9 0.5,9" fill="currentColor" />}
      {severity === "medium" && <polygon points="5,0.5 9.5,5 5,9.5 0.5,5" fill="currentColor" />}
      {severity === "low" && <circle cx="5" cy="5" r="4" fill="currentColor" />}
      {severity === "info" && <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

export function SeverityMark({ severity }: { severity: Severity }) {
  return (
    <span className={`chip ${severityStyles[severity]}`}>
      <SeverityShape severity={severity} />
      {severityLabels[severity]}
    </span>
  );
}
