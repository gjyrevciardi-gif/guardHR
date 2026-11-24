import type { EventType, ExamEvent, ReviewStatus, Severity } from "@/lib/types";

/**
 * What every signal means, in one place, so the live room, the review page and the demo never disagree.
 * `meaning` says what the browser reported; `caution` says what it does NOT show. Both are always displayed together:
 * a signal is a reason to look, never a finding.
 */
export const signalInfo: Record<EventType, { label: string; meaning: string; caution: string }> = {
  tab_hidden: {
    label: "Doli nga faqja e call-it",
    meaning: "Browser-i raportoi se skeda ose dritarja e call-it nuk ishte e dukshme ose pa fokus.",
    caution: "Mund të ketë qenë një njoftim, një klikim aksidental ose një problem teknik. Nuk tregon çfarë pa ose bëri pjesëmarrësi.",
  },
  fullscreen_exit: {
    label: "Doli nga ekrani i plotë",
    meaning: "Pjesëmarrësi doli nga modaliteti fullscreen.",
    caution: "Shumë njerëz e mbyllin pa dashje me tastin Esc.",
  },
  camera_disabled: {
    label: "Kamera u ndal",
    meaning: "Kamera u fik ose u shkëput gjatë call-it.",
    caution: "Mund të jetë problem me pajisjen, lejen ose kabllon.",
  },
  face_not_visible: {
    label: "Fytyra nuk u pa",
    meaning: "Detektori në browser nuk gjeti fytyrë për më shumë se 5 sekonda.",
    caution: "Ndriçimi, këndi i kamerës ose një lëvizje e shkurtër mjafton. Detektori gabon.",
  },
  multiple_people: {
    label: "U panë disa persona",
    meaning: "Detektori numëroi më shumë se një fytyrë ose person në kornizë.",
    caution: "Mund të jetë dikush që kalon, një portret ose një gabim i detektorit.",
  },
  phone_detected: {
    label: "U dallua një telefon",
    meaning: "Modeli i vizionit mendoi se një objekt në kornizë është telefon.",
    caution: "Modeli gabon me objekte të ngjashme. Edhe një telefon në kornizë ka shpjegime krejt të pafajshme.",
  },
  screen_share_stopped: {
    label: "Ndarja e ekranit u ndal",
    meaning: "Ndarja e ekranit përfundoi gjatë call-it.",
    caution: "Mund ta ketë ndalur browser-i ose sistemi pa dashje.",
  },
  copy_paste: {
    label: "Copy / paste",
    meaning: "U përdor copy, cut ose paste. Ruhet vetëm numri i rreshtave dhe i shkronjave, jo teksti.",
    caution: "Është gjest normal, p.sh. kur shkruhet emri ose email-i.",
  },
  connection_interruption: {
    label: "Ndërprerje lidhjeje",
    meaning: "Lidhja me internetin ra disa herë brenda pak minutash.",
    caution: "Është problem rrjeti dhe nuk lidhet me sjelljen e pjesëmarrësit.",
  },
  window_resized: {
    label: "Dritarja u ndryshua",
    meaning: "Madhësia e dritares ndryshoi ndjeshëm krahasuar me fillimin e call-it.",
    caution: "Ndryshimi i madhësisë është normal, p.sh. kur ndahet ekrani ose rrotullohet pajisja.",
  },
  multiple_monitors: {
    label: "U zbulua ekran shtesë",
    meaning: "Browser-i raporton se kompjuteri ka më shumë se një ekran.",
    caution: "Shumë njerëz punojnë me dy ekrane. Kjo nuk tregon çfarë shfaqet në to.",
  },
};

export const eventLabels: Record<string, string> = Object.fromEntries(Object.entries(signalInfo).map(([type, info]) => [type, info.label]));

// Text labels as well as colours and shapes: severity must not depend on colour alone.
export const severityLabels: Record<Severity, string> = { high: "I lartë", medium: "I mesëm", low: "I vogël", info: "Info" };
// Amber, never red: red means "the product failed", it is not used to describe a person.
export const severityStyles: Record<Severity, string> = {
  high: "bg-amber-800 text-white ring-amber-800",
  medium: "bg-amber-100 text-amber-900 ring-amber-900/25",
  low: "bg-slate-100 text-slate-700 ring-slate-700/20",
  info: "bg-white text-slate-600 ring-line-strong",
};

/** The API's review statuses are English constants; this is what the host reads. */
export const reviewStatusLabels: Record<ReviewStatus, string> = {
  "No events detected": "Pa sinjale",
  "Requires review": "Kërkon shqyrtim",
  "Review completed": "Shqyrtuar",
  "Insufficient evidence": "Prova të pamjaftueshme",
};

export const sessionStatusLabels: Record<string, string> = {
  scheduled: "E planifikuar",
  consented: "Pranoi kushtet",
  in_progress: "Në vazhdim",
  completed: "Përfunduar",
  expired: "Skaduar",
};

// The API sends UTC. Postgres values carry an offset, SQLite (development) ones do not, and a bare
// "2026-01-01T12:00:00" would be read as local time, so assume UTC when there is no offset.
export const parseApiDate = (value: string) => new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);

// Written out instead of Intl: headless and minimal browsers ship no Albanian locale data and silently fall back to English.
const months = ["jan", "shk", "mar", "pri", "maj", "qer", "kor", "gus", "sht", "tet", "nën", "dhj"];
const pad = (n: number) => String(n).padStart(2, "0");

export const timeOnly = (value: string | Date) => {
  const d = typeof value === "string" ? parseApiDate(value) : value;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const dateOnly = (value: string | Date) => {
  const d = typeof value === "string" ? parseApiDate(value) : value;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

/** "20 nën 2026, 22:41" (24-hour clock, as in Kosovo). */
export const dateTime = (value: string | null) => (value ? `${dateOnly(value)}, ${timeOnly(value)}` : "-");

const weekdays = ["e diel", "e hënë", "e martë", "e mërkurë", "e enjte", "e premte", "e shtunë"];
const monthNames = ["janar", "shkurt", "mars", "prill", "maj", "qershor", "korrik", "gusht", "shtator", "tetor", "nëntor", "dhjetor"];

/** "E enjte, 20 nëntor" */
export const longDate = (d: Date) => {
  const day = weekdays[d.getDay()];
  return `${day[0].toUpperCase()}${day.slice(1)}, ${d.getDate()} ${monthNames[d.getMonth()]}`;
};

/** "tani", "para 5 min", "para 3 orësh", "dje", otherwise the date. */
export function relativeTime(value: string, now: Date = new Date()) {
  const date = parseApiDate(value);
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 0) return dateTime(value);
  if (diff < 45) return "tani";
  if (diff < 3600) return `para ${Math.max(1, Math.round(diff / 60))} min`;
  if (diff < 86400) return `para ${Math.round(diff / 3600)} orësh`;
  if (diff < 172800) return "dje";
  return dateOnly(date);
}

/** Audit actions as the host reads them. Unknown actions fall back to the raw name so nothing is hidden. */
export const auditLabels: Record<string, string> = {
  "auth.login": "Hyrje në llogari",
  "auth.login_failed": "Përpjekje e dështuar hyrjeje",
  "auth.register": "Llogaria u krijua",
  "auth.sessions_revoked": "Dolët nga të gjitha pajisjet",
  "auth.password_changed": "Fjalëkalimi u ndryshua",
  "auth.password_reset_requested": "U kërkua rivendosja e fjalëkalimit",
  "auth.password_reset_email_sent": "Linku i rivendosjes u dërgua",
  "auth.password_reset_email_failed": "Linku i rivendosjes nuk u dërgua",
  "auth.password_reset": "Fjalëkalimi u rivendos me link",
  "auth.mfa_enabled": "Verifikimi në dy hapa u aktivizua",
  "auth.mfa_disabled": "Verifikimi në dy hapa u çaktivizua",
  "candidate.consent.accepted": "Kandidati pranoi kushtet",
  "candidate.session.started": "Kandidati hyri në call",
  "candidate.session.completed": "Kandidati e përfundoi call-in",
  "candidate.test.submitted": "Kandidati dorëzoi testin",
  "candidate.verification.code_sent": "Kodi i email-it u dërgua",
  "candidate.verification.code_failed": "Kodi i email-it nuk u dërgua",
  "candidate.verification.locked": "Kodi u bllokua pas shumë gabimeve",
  "candidate.verification.succeeded": "Email-i i kandidatit u verifikua",
  "participant.invite.email_sent": "Ftesa u dërgua",
  "participant.invite.email_failed": "Ftesa nuk u dërgua",
  "retention.updated": "Afati i ruajtjes u ndryshua",
  "retention.purge.executed": "Të dhënat e vjetra u pastruan",
  "retention.purge.scheduled": "Pastrim i planifikuar u kry",
  "review.saved": "Shqyrtimi u ruajt",
  "session.created": "Call u krijua",
  "session.viewed": "Call u hap",
  "session.deleted": "Call u fshi",
  "session.auto_closed": "Call i braktisur u mbyll",
  "test.created": "Testi u krijua",
  "test.updated": "Testi u ndryshua",
  "test.deleted": "Testi u fshi",
  "test.viewed": "Testi u hap",
  "test.generated_from_file": "Testi u gjenerua nga skedari",
};
export const auditLabel = (action: string) => auditLabels[action] ?? action;

const severityRank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 };

/** One chip per kind of exam signal: how often, how long for the absences, and the highest severity among them. */
export function examSignalSummary(events: ExamEvent[]): { key: string; label: string; severity: Severity }[] {
  const groups = new Map<string, ExamEvent[]>();
  for (const event of events) {
    const key = event.event_type === "tab_hidden" ? "away" : String(event.metadata.operation ?? "copy");
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const label = (key: string, list: ExamEvent[]) => {
    const times = `${list.length}×`;
    if (key === "away") return `Doli nga faqja: ${times}, gjithsej ${formatDuration(list.reduce((sum, event) => sum + (event.duration_seconds ?? 0), 0))}`;
    if (key === "paste") return `Ngjiti tekst: ${times}`;
    if (key === "print") return `Provoi të printojë: ${times}`;
    if (key === "screenshot_key") return `Shtypi Print Screen: ${times}`;
    return `Provoi të kopjojë (u bllokua): ${times}`;
  };
  return [...groups.entries()]
    .map(([key, list]) => ({ key, label: label(key, list), severity: list.reduce<Severity>((top, event) => (severityRank[event.severity] > severityRank[top] ? event.severity : top), "info") }))
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
}

/** "45 s", "12 min", "1 orë 12 min" */
export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} orë ${rest} min` : `${hours} orë`;
}

/** "12:05" or "1:02:03" for a running timer. */
export function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
