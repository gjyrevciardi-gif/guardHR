"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ScanSearch, XCircle } from "lucide-react";
import {
  CheckResult,
  MIC_SILENCE_TIMEOUT_MS,
  checkBrowserSupport,
  checkFaceModel,
  classifyIce,
  classifyLatency,
  describeMediaError,
  measureLatency,
  probeIce,
} from "@/lib/systemCheck";

type Props = {
  requireScreenShare: boolean;
  cameraDeviceId: string;
  micDeviceId: string;
  /** Called once the browser has granted access, so the device lists can show real names. */
  onPermissionGranted: () => void;
};

type Row = "browser" | "camera" | "mic" | "network" | "video" | "face";
const labels: Record<Row, string> = { browser: "Browser-i", camera: "Kamera", mic: "Mikrofoni", network: "Lidhja me serverin", video: "Rrjeti për video", face: "Monitorimi i fytyrës" };
const order: Row[] = ["browser", "camera", "mic", "network", "video", "face"];
const idle: CheckResult = { status: "idle", message: "" };
const initial = Object.fromEntries(order.map((row) => [row, idle])) as Record<Row, CheckResult>;

/** Mic input level 0-100 from time-domain samples (RMS, scaled so ordinary speech reaches roughly 40-80). */
function levelFrom(data: Uint8Array): number {
  let sum = 0;
  for (const value of data) sum += (value - 128) ** 2;
  return Math.min(100, Math.round(Math.sqrt(sum / data.length) * 5));
}

export function SystemCheck({ requireScreenShare, cameraDeviceId, micDeviceId, onPermissionGranted }: Props) {
  const [results, setResults] = useState<Record<Row, CheckResult>>(initial);
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(0);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cleanupRef = useRef<() => void>(() => undefined);
  const runId = useRef(0);

  const set = useCallback((row: Row, result: CheckResult) => setResults((current) => ({ ...current, [row]: result })), []);

  const stop = useCallback(() => {
    runId.current += 1; // lets an in-flight run notice it was cancelled
    cleanupRef.current();
    cleanupRef.current = () => undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setPreview(null);
    setLevel(0);
  }, []);

  // Release the camera and microphone when the candidate joins (this component unmounts) or leaves the page.
  useEffect(() => stop, [stop]);

  async function openMedia(): Promise<MediaStream | null> {
    const video = { width: { ideal: 640 }, height: { ideal: 480 }, ...(cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : {}) };
    const audio = micDeviceId ? { deviceId: { exact: micDeviceId } } : true;
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio });
    } catch {
      // One missing device must not hide the other: test them separately to say which one failed.
    }
    const parts: MediaStreamTrack[] = [];
    try {
      parts.push(...(await navigator.mediaDevices.getUserMedia({ video })).getTracks());
    } catch (err) {
      set("camera", { status: "fail", message: describeMediaError(err, "camera") });
    }
    try {
      parts.push(...(await navigator.mediaDevices.getUserMedia({ audio })).getTracks());
    } catch (err) {
      set("mic", { status: "fail", message: describeMediaError(err, "mic") });
    }
    return parts.length ? new MediaStream(parts) : null;
  }

  function watchMicrophone(stream: MediaStream, id: number) {
    const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) {
      set("mic", { status: "warn", message: "Mikrofoni u hap, por browser-i nuk lejon të shohim nivelin e zërit." });
      return;
    }
    const context = new Context();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const started = performance.now();
    let heard = false;
    let frame = 0;
    set("mic", { status: "running", message: "Fol ose prek tavolinën: shiriti më poshtë duhet të lëvizë." });
    const tick = () => {
      if (id !== runId.current) return;
      analyser.getByteTimeDomainData(data);
      const now = levelFrom(data);
      setLevel(now);
      if (!heard && now >= 12) {
        heard = true;
        set("mic", { status: "pass", message: "Mikrofoni po të dëgjon." });
      } else if (!heard && performance.now() - started > MIC_SILENCE_TIMEOUT_MS) {
        heard = true; // stop re-evaluating, keep the meter running
        set("mic", { status: "warn", message: "Nuk po dëgjohet zë. Kontrollo që mikrofoni nuk është i heshtur ose zgjidh një tjetër." });
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    cleanupRef.current = () => {
      window.cancelAnimationFrame(frame);
      void context.close();
    };
  }

  async function run() {
    stop();
    const id = runId.current;
    setRunning(true);
    setResults(Object.fromEntries(order.map((row) => [row, { status: "running", message: "" }])) as Record<Row, CheckResult>);

    const browser = checkBrowserSupport(requireScreenShare);
    set("browser", browser);

    // Each probe reports as soon as it finishes; the slow ICE gathering must not hold the others back.
    const network = Promise.all([
      measureLatency().then((latency) => id === runId.current && set("network", classifyLatency(latency))),
      probeIce().catch(() => new Set<string>()).then((ice) => id === runId.current && set("video", classifyIce(ice))),
      checkFaceModel().then((face) => id === runId.current && set("face", face)),
    ]);

    if (browser.status === "fail") {
      set("camera", { status: "fail", message: "Nuk mund të testohet në këtë browser." });
      set("mic", { status: "fail", message: "Nuk mund të testohet në këtë browser." });
    } else {
      const stream = await openMedia();
      if (id !== runId.current) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      if (stream) {
        streamRef.current = stream;
        onPermissionGranted();
        if (stream.getVideoTracks().length) setPreview(stream);
        if (stream.getAudioTracks().length) watchMicrophone(stream, id);
      }
    }
    await network;
    if (id === runId.current) setRunning(false);
  }

  // Attach the stream once the <video> is mounted and decide whether the camera really produces a picture.
  useEffect(() => {
    const video = videoRef.current;
    if (!preview || !video) return;
    let cancelled = false;
    video.srcObject = preview;
    void video.play().catch(() => undefined);
    const started = performance.now();
    const poll = () => {
      if (cancelled) return;
      if (video.videoWidth > 0) {
        set("camera", { status: "pass", message: `Kamera punon (${video.videoWidth}×${video.videoHeight}).` });
      } else if (performance.now() - started > 4000) {
        set("camera", { status: "warn", message: "Kamera u hap, por nuk po jep figurë. Provo një kamerë tjetër." });
      } else {
        window.setTimeout(poll, 100);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [preview, set]);

  const done = !running && order.every((row) => results[row].status !== "idle" && results[row].status !== "running");
  const problems = order.filter((row) => results[row].status === "fail");
  const warnings = order.filter((row) => results[row].status === "warn");

  return (
    <div className="text-left">
      <h2 className="flex items-center gap-2 text-base font-bold"><ScanSearch size={18} className="text-teal" aria-hidden="true" /> Kontrollo pajisjen</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">Testo kamerën, mikrofonin dhe lidhjen para se të hysh. Asgjë nuk dërgohet ose ruhet gjatë këtij testi.</p>
      <button type="button" onClick={() => void run()} disabled={running} className="btn-primary mt-3 w-full">
        {running ? <Loader2 size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ScanSearch size={17} aria-hidden="true" />}
        {running ? "Po testohet…" : done ? "Testo përsëri" : "Testo pajisjen"}
      </button>

      {preview && (
        <video ref={videoRef} muted playsInline autoPlay aria-label="Pamje paraprake e kamerës" className="mt-3 aspect-video w-full rounded-xl border border-line bg-black object-cover [transform:scaleX(-1)]" />
      )}
      {preview && (
        <div className="mt-3">
          <div role="meter" aria-label="Niveli i mikrofonit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} className="h-2 overflow-hidden rounded-full bg-shell-200">
            <div className="h-full rounded-full bg-moss transition-[width] duration-100 motion-reduce:transition-none" style={{ width: `${level}%` }} />
          </div>
        </div>
      )}

      <ul className="mt-4 space-y-2 text-sm" aria-live="polite">
        {order.map((row) => {
          const { status, message } = results[row];
          if (status === "idle") return null;
          return (
            <li key={row} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0" aria-hidden="true">
                {status === "running" && <Loader2 size={16} className="animate-spin text-slate-600 motion-reduce:animate-none" />}
                {status === "pass" && <CheckCircle2 size={16} className="text-moss" />}
                {status === "warn" && <AlertTriangle size={16} className="text-amber-700" />}
                {status === "fail" && <XCircle size={16} className="text-red-700" />}
              </span>
              <span className="min-w-0">
                <span className="font-semibold">{labels[row]}</span>
                <span className="sr-only">{{ running: ": po testohet", pass: ": në rregull", warn: ": kujdes", fail: ": problem", idle: "" }[status]}</span>
                {message && <span className="block text-xs leading-5 text-slate-600">{message}</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {done && (
        <p className={`mt-3 rounded-xl border p-3 text-xs leading-5 ${problems.length ? "border-red-200 bg-red-50 text-red-700" : warnings.length ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
          {problems.length
            ? "Ka probleme që duhet zgjidhur. Mund të hysh gjithsesi, por host-i mund të mos të shohë ose të mos të dëgjojë."
            : warnings.length
              ? "Mund të hysh, por kontrollo kujdesin më sipër nëse ke ndonjë problem gjatë call-it."
              : "Gjithçka është në rregull. Mund të hysh në call."}
        </p>
      )}
    </div>
  );
}
