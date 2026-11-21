import type { Severity } from "@/lib/types";

export const eventLabels: Record<string, string> = {
  tab_hidden: "Pjesemarresi doli nga faqja",
  fullscreen_exit: "Dalje nga fullscreen",
  camera_disabled: "Kamera u caktivizua",
  face_not_visible: "Fytyra nuk u pa",
  multiple_people: "Me shume se nje person",
  phone_detected: "Telefon i dalluar",
  screen_share_stopped: "Screen sharing u ndal",
  copy_paste: "Copy/paste u perdor",
  connection_interruption: "Nderprerje lidhjeje",
  window_resized: "Dritarja u ndryshua",
  multiple_monitors: "U detektuan monitore shtese",
};

// Text labels as well as colours: severity must not depend on colour alone.
export const severityLabels: Record<Severity, string> = { high: "I lartë", medium: "I mesëm", low: "I vogël", info: "Info" };
export const severityStyles: Record<Severity, string> = {
  high: "bg-red-100 text-red-800 ring-red-800/20",
  medium: "bg-amber-100 text-amber-900 ring-amber-900/20",
  low: "bg-slate-100 text-slate-700 ring-slate-700/20",
  info: "bg-white text-slate-600 ring-slate-300",
};

// The API sends UTC. Postgres values carry an offset, SQLite (development) ones do not, and a bare
// "2026-01-01T12:00:00" would be read as local time, so assume UTC when there is no offset.
export const parseApiDate = (value: string) => new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);

export const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("sq-AL", { dateStyle: "medium", timeStyle: "short" }).format(parseApiDate(value))
    : "-";
