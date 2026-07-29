import { ReviewStatus } from "@/lib/types";

const styles: Record<ReviewStatus, string> = {
  "No events detected": "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  "Requires review": "bg-amber-50 text-amber-800 ring-amber-600/20",
  "Review completed": "bg-blue-50 text-blue-700 ring-blue-600/20",
  "Insufficient evidence": "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[status]}`}>{status}</span>;
}

