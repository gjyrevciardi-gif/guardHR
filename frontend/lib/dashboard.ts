import { parseApiDate } from "@/lib/format";
import type { InterviewSession } from "@/lib/types";

/** Everything the dashboard shows is derived here from the host's real calls: no sample numbers. */

const SILENT_SECONDS = 60; // the candidate's monitor reports every 10 s
const SOON_MS = 24 * 3600 * 1000;

export type AttentionItem = {
  id: string;
  session: InterviewSession;
  kind: "silent" | "live" | "review" | "weak" | "expiring";
  title: string;
  detail: string;
  href: string;
  action: string;
};

const rank: Record<AttentionItem["kind"], number> = { silent: 0, live: 1, review: 2, weak: 3, expiring: 4 };

export function attentionItems(sessions: InterviewSession[], now = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const session of sessions) {
    const base = { id: session.id, session };
    const lastSeen = session.monitoring.last_seen_at ? parseApiDate(session.monitoring.last_seen_at).getTime() : null;
    if (session.status === "in_progress") {
      if (lastSeen !== null && (now - lastSeen) / 1000 > SILENT_SECONDS) {
        items.push({ ...base, kind: "silent", title: "Monitori nuk po raporton", detail: "Kandidati mund ta ketë mbyllur faqen ose ka humbur lidhjen.", href: `/sessions/${session.id}/room`, action: "Hap dhomën" });
      } else {
        items.push({ ...base, kind: "live", title: "Në vazhdim tani", detail: session.event_count ? `${session.event_count} sinjale deri tani.` : "Asnjë sinjal deri tani.", href: `/sessions/${session.id}/room`, action: "Hyr si host" });
      }
    } else if (session.review_status === "Requires review") {
      items.push({ ...base, kind: "review", title: "Kërkon shqyrtim", detail: `${session.event_count} sinjale për t'u parë nga një njeri.`, href: `/sessions/${session.id}`, action: "Shqyrto" });
    } else if (session.status === "completed" && session.review_status === "No events detected" && ["none", "partial"].includes(session.monitoring.quality)) {
      items.push({ ...base, kind: "weak", title: "Pa sinjale, por monitorimi nuk ishte i plotë", detail: "Mungesa e sinjaleve këtu nuk ka vlerë: s'dihet çfarë ndodhi.", href: `/sessions/${session.id}`, action: "Shiko" });
    } else if (["scheduled", "consented"].includes(session.status)) {
      const left = parseApiDate(session.expires_at).getTime() - now;
      if (left > 0 && left < SOON_MS) items.push({ ...base, kind: "expiring", title: "Linku skadon brenda 24 orësh", detail: session.status === "consented" ? "Kandidati ka pranuar kushtet por ende nuk ka hyrë." : "Kandidati ende nuk e ka hapur linkun.", href: `/sessions/${session.id}`, action: "Hap" });
    }
  }
  return items.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

const localKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type DayBucket = { key: string; date: Date; total: number; withSignals: number };

/** Calls per day over the last `days` days (by start time, else creation time), and how many of them had signals. */
export function dailyActivity(sessions: InterviewSession[], days = 14, now = new Date()): DayBucket[] {
  const buckets: DayBucket[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    buckets.push({ key: localKey(date), date, total: 0, withSignals: 0 });
  }
  const index = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const session of sessions) {
    const bucket = index.get(localKey(parseApiDate(session.started_at ?? session.created_at)));
    if (!bucket) continue;
    bucket.total += 1;
    if (session.event_count > 0) bucket.withSignals += 1;
  }
  return buckets;
}

export function reviewProgress(sessions: InterviewSession[]) {
  const completed = sessions.filter((session) => session.status === "completed");
  const reviewed = completed.filter((session) => session.review_status === "Review completed" || session.review_status === "Insufficient evidence");
  return { completed: completed.length, reviewed: reviewed.length };
}

export const views = [
  { id: "all", label: "Të gjitha" },
  { id: "review", label: "Për shqyrtim" },
  { id: "live", label: "Në vazhdim" },
  { id: "upcoming", label: "Të planifikuara" },
  { id: "done", label: "Të përfunduara" },
] as const;
export type ViewId = (typeof views)[number]["id"];

export function matchesView(session: InterviewSession, view: ViewId, now = Date.now()) {
  switch (view) {
    case "review": return session.review_status === "Requires review";
    case "live": return session.status === "in_progress";
    case "upcoming": return ["scheduled", "consented"].includes(session.status) && parseApiDate(session.expires_at).getTime() > now;
    case "done": return session.status === "completed";
    default: return true;
  }
}
