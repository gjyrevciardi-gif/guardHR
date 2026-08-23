import { ReviewStatus } from "@/lib/types";

const styles: Record<ReviewStatus, string> = {
  "No events detected": "bg-emerald-50 text-emerald-700 ring-emerald-700/20",
  "Requires review": "bg-amber-100 text-amber-800 ring-amber-800/20",
  "Review completed": "bg-[#dfe9e4] text-teal ring-teal/20",
  "Insufficient evidence": "bg-[#ecefe9] text-[#6b7c70] ring-[#6b7c70]/25",
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[status]}`}>{status}</span>;
}
