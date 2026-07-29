export const eventLabels: Record<string, string> = {
  tab_hidden: "Kandidati doli nga faqja",
  fullscreen_exit: "Dalje nga fullscreen",
  camera_disabled: "Kamera u çaktivizua",
  face_not_visible: "Fytyra nuk u pa",
  multiple_people: "Më shumë se një person",
  phone_detected: "Telefon i dalluar",
  screen_share_stopped: "Screen sharing u ndal",
  copy_paste: "Copy/paste u përdor",
  connection_interruption: "Ndërprerje lidhjeje",
  window_resized: "Dritarja u ndryshua",
  multiple_monitors: "U detektuan monitorë shtesë",
};

export const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("sq-AL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "—";
