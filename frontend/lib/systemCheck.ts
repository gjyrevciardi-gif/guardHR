import { api } from "@/lib/api";

export type CheckStatus = "idle" | "running" | "pass" | "warn" | "fail";
export type CheckResult = { status: CheckStatus; message: string };

export const MIC_SILENCE_TIMEOUT_MS = 8000;
const ICE_TIMEOUT_MS = 4000;
const LATENCY_SAMPLES = 3;

/** Browser features the room needs. Screen share only matters when the host requires it. */
export function checkBrowserSupport(requireScreenShare: boolean): CheckResult {
  if (typeof window === "undefined") return { status: "idle", message: "" };
  if (!window.isSecureContext) {
    return { status: "fail", message: "Faqja nuk është e hapur me HTTPS. Kamera, mikrofoni dhe screen share nuk punojnë pa të." };
  }
  const missing: string[] = [];
  if (!navigator.mediaDevices?.getUserMedia) missing.push("kamera/mikrofoni");
  if (typeof RTCPeerConnection === "undefined") missing.push("video call (WebRTC)");
  if (typeof WebSocket === "undefined") missing.push("lidhja live");
  if (requireScreenShare && !navigator.mediaDevices?.getDisplayMedia) missing.push("screen share");
  if (missing.length) return { status: "fail", message: `Ky browser nuk mbështet: ${missing.join(", ")}. Përdor Chrome, Edge ose Firefox të përditësuar.` };
  return { status: "pass", message: requireScreenShare ? "Browser-i mbështet video call dhe screen share." : "Browser-i mbështet video call." };
}

/** Turns a getUserMedia failure into something a candidate can act on. */
export function describeMediaError(err: unknown, device: "camera" | "mic"): string {
  const name = err instanceof DOMException ? err.name : "";
  const noun = device === "camera" ? "kamerës" : "mikrofonit";
  if (name === "NotAllowedError" || name === "SecurityError") return `Leja për përdorimin e ${noun} u refuzua. Kliko ikonën pranë adresës së faqes dhe lejo aksesin, pastaj provo përsëri.`;
  if (name === "NotFoundError" || name === "OverconstrainedError") return device === "camera" ? "Nuk u gjet asnjë kamerë. Lidh një kamerë ose zgjidh një tjetër nga lista." : "Nuk u gjet asnjë mikrofon. Lidh një mikrofon ose zgjidh një tjetër nga lista.";
  if (name === "NotReadableError" || name === "AbortError") return `${device === "camera" ? "Kamera" : "Mikrofoni"} po përdoret nga një aplikacion tjetër (Zoom, Teams, një skedë tjetër). Mbylle dhe provo përsëri.`;
  return `${device === "camera" ? "Kamera" : "Mikrofoni"} nuk u hap. Provo një pajisje tjetër.`;
}

export function classifyLatency(medianMs: number | null): CheckResult {
  if (medianMs === null) return { status: "fail", message: "Serveri nuk u arrit. Kontrollo internetin ose provo një rrjet tjetër." };
  const ms = Math.round(medianMs);
  if (ms <= 400) return { status: "pass", message: `Serveri u arrit për ${ms} ms.` };
  if (ms <= 1500) return { status: "warn", message: `Lidhja është e ngadaltë (${ms} ms). Video mund të ngecë.` };
  return { status: "fail", message: `Lidhja është shumë e ngadaltë (${ms} ms). Provo një rrjet tjetër.` };
}

/** `types` are the ICE candidate types the browser managed to gather: host, srflx (STUN), relay (TURN). */
export function classifyIce(types: ReadonlySet<string>): CheckResult {
  if (types.has("relay")) return { status: "pass", message: "Rrjeti lejon video, edhe përmes serverit rezervë (TURN)." };
  if (types.has("srflx")) return { status: "pass", message: "Rrjeti lejon lidhje direkte për video." };
  if (types.has("host")) return { status: "warn", message: "Nuk u gjet rrugë jashtë rrjetit lokal. Video mund të mos lidhet; provo pa VPN ose në një rrjet tjetër." };
  return { status: "fail", message: "Browser-i nuk gjeti asnjë rrugë për video. Kontrollo firewall-in ose VPN-në." };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export async function measureLatency(): Promise<number | null> {
  const samples: number[] = [];
  for (let i = 0; i < LATENCY_SAMPLES; i += 1) {
    const started = performance.now();
    try {
      await api("/health", { cache: "no-store" }, false);
      samples.push(performance.now() - started);
    } catch {
      // a failed sample is dropped; no samples at all means unreachable
    }
  }
  return samples.length ? median(samples) : null;
}

/** Gathers ICE candidates against the configured STUN/TURN servers and reports which kinds arrived. */
export async function probeIce(): Promise<Set<string>> {
  const config = await api<RTCConfiguration>("/rtc-config", {}, false).catch(() => ({}) as RTCConfiguration);
  const types = new Set<string>();
  if (typeof RTCPeerConnection === "undefined") return types;
  const peer = new RTCPeerConnection(config);
  try {
    peer.createDataChannel("probe");
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, ICE_TIMEOUT_MS);
      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          window.clearTimeout(timer);
          resolve();
          return;
        }
        const match = / typ (host|srflx|prflx|relay)/.exec(event.candidate.candidate);
        if (match) types.add(match[1]);
      };
      peer
        .createOffer()
        .then((offer) => peer.setLocalDescription(offer))
        .catch(() => {
          window.clearTimeout(timer);
          resolve();
        });
    });
  } finally {
    peer.close();
  }
  return types;
}

/** The face-detection model is optional: without it the call works, but the host gets no face signals. */
export async function checkFaceModel(): Promise<CheckResult> {
  if (typeof WebAssembly !== "object") return { status: "warn", message: "Browser-i nuk mbështet WebAssembly; zbulimi i fytyrës nuk do të punojë." };
  try {
    const response = await fetch("/mediapipe/blaze_face_short_range.tflite", { method: "HEAD", cache: "force-cache" });
    if (response.ok) return { status: "pass", message: "Zbulimi i fytyrës është gati." };
  } catch {
    // falls through to the warning below
  }
  return { status: "warn", message: "Modeli i zbulimit të fytyrës nuk u ngarkua. Call-i punon, por host-i nuk merr sinjale për fytyrën." };
}
