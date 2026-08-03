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

export const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("sq-AL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "-";
