"use client";

import Link from "next/link";
import { ArrowLeft, Check, Eye, ShieldCheck, Video } from "lucide-react";
import { EmailVerification } from "@/components/EmailVerification";
import { ShellMark } from "@/components/ShellMark";
import { SystemCheck } from "@/components/SystemCheck";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/Wordmark";
import type { RoomSession } from "@/lib/types";

type Role = "candidate" | "hr";

interface Props {
  token: string;
  role: Role;
  session: RoomSession;
  verified: boolean;
  onVerified: () => void;
  devices: MediaDeviceInfo[];
  cameraDeviceId: string;
  micDeviceId: string;
  onCamera: (id: string) => void;
  onMic: (id: string) => void;
  onPermissionGranted: () => void;
  onJoin: () => void;
  error: string;
  mediaBlocked: boolean;
  mediaBlockedMessage: string;
  backHref?: string;
}

/** The step before the call: a calm page on the app theme, not the dark stage, so a first-time candidate is never dropped into a video room cold. */
export function Lobby(props: Props) {
  const { role, session, verified, devices, cameraDeviceId, micDeviceId, error, mediaBlocked, mediaBlockedMessage, backHref } = props;
  const candidate = role === "candidate";
  const steps = [
    { label: "Pranimi", done: true },
    ...(session.verification_required ? [{ label: "Verifikimi", done: verified }] : []),
    { label: "Pajisjet", done: false },
    { label: "Hyrja", done: false },
  ];
  const current = steps.findIndex((step) => !step.done);

  return (
    <main id="main" className="min-h-screen bg-canvas text-navy">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-2.5">
          <div className="flex items-center gap-3">
            {backHref && (
              <Link href={backHref} className="btn-ghost !px-3" aria-label="Kthehu te call-i"><ArrowLeft size={17} aria-hidden="true" /></Link>
            )}
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-shell-200"><ShellMark className="h-6 w-6" /></span>
            <span className="font-bold"><Wordmark /></span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8">
        {candidate && (
          <ol className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Hapat para hyrjes">
            {steps.map((step, index) => (
              <li key={step.label} className="flex items-center gap-2" aria-current={index === current ? "step" : undefined}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${step.done ? "bg-moss text-white" : index === current ? "bg-teal text-white" : "border border-line-strong text-muted"}`}>
                  {step.done ? <Check size={14} aria-hidden="true" /> : index + 1}
                </span>
                <span className={step.done || index === current ? "font-semibold" : "text-muted"}>{step.label}</span>
                {index < steps.length - 1 && <span className="mx-1 h-px w-6 bg-line-strong" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <section className="card p-6 sm:p-8 animate-rise" aria-labelledby="lobby-title">
            <p className="eyebrow">{session.title}</p>
            <h1 id="lobby-title" className="mt-1 text-3xl font-bold tracking-tight">{candidate ? `Gati për të hyrë, ${session.candidate_name.split(" ")[0]}?` : "Hyr si host"}</h1>
            <p className="mt-2 text-slate-600">
              {candidate
                ? "Kontrollo kamerën dhe mikrofonin, pastaj hyr. Kamera dhe mikrofoni janë opsionale: mund të hysh edhe pa to."
                : `Kandidati është ${session.candidate_name}. Kontrollo pajisjet e tua para se të hysh.`}
            </p>
            {mediaBlocked && <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{mediaBlockedMessage}</p>}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <DeviceSelect label="Kamera" kind="videoinput" devices={devices} value={cameraDeviceId} onChange={props.onCamera} />
              <DeviceSelect label="Mikrofoni" kind="audioinput" devices={devices} value={micDeviceId} onChange={props.onMic} />
            </div>
            <div className="mt-6 border-t border-line pt-6">
              <SystemCheck requireScreenShare={session.require_screen_share} cameraDeviceId={cameraDeviceId} micDeviceId={micDeviceId} onPermissionGranted={props.onPermissionGranted} />
            </div>
          </section>

          <div className="space-y-6">
            {!verified && (
              <section className="card p-6 sm:p-8 animate-rise" aria-label="Verifikimi i email-it">
                <EmailVerification sendPath={`/public/sessions/${props.token}/verification`} confirmPath={`/public/sessions/${props.token}/verification/confirm`} emailHint={session.candidate_email_hint} onVerified={() => props.onVerified()} />
              </section>
            )}

            <section className="card p-6 sm:p-8 animate-rise" aria-labelledby="join-title">
              <h2 id="join-title" className="section-title">{candidate ? "Çfarë ndodh kur hyn" : "Çfarë sheh kur hyn"}</h2>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                {candidate ? (
                  <>
                    <li className="flex gap-3"><Video size={17} className="mt-1 shrink-0 text-teal" aria-hidden="true" /><span>Takon host-in në video. Pamjet dhe zëri <strong className="text-navy">nuk regjistrohen</strong>.</span></li>
                    <li className="flex gap-3"><Eye size={17} className="mt-1 shrink-0 text-teal" aria-hidden="true" /><span>Browser-i raporton sinjale si dalja nga faqja ose copy/paste, siç e pranove në hapin e parë.</span></li>
                    <li className="flex gap-3"><ShieldCheck size={17} className="mt-1 shrink-0 text-teal" aria-hidden="true" /><span>Sinjalet i shqyrton një njeri. Asnjë vendim nuk merret automatikisht.</span></li>
                  </>
                ) : (
                  <>
                    <li className="flex gap-3"><Video size={17} className="mt-1 shrink-0 text-teal" aria-hidden="true" /><span>Video dhe zëri me kandidatin, plus ekranin e tij nëse e ndan.</span></li>
                    <li className="flex gap-3"><Eye size={17} className="mt-1 shrink-0 text-teal" aria-hidden="true" /><span>Sinjalet live, shëndeti i monitorit, shënimet e tua private dhe lista e gatishmërisë.</span></li>
                    <li className="flex gap-3"><ShieldCheck size={17} className="mt-1 shrink-0 text-teal" aria-hidden="true" /><span>Çdo sinjal vjen me shpjegim të asaj që nuk provon.</span></li>
                  </>
                )}
              </ul>
              <button onClick={props.onJoin} disabled={!verified} aria-describedby={verified ? undefined : "join-blocked"} className="btn-primary mt-6 w-full !min-h-12 text-base">
                <Eye size={18} aria-hidden="true" /> Hyr në call
              </button>
              {!verified && <p id="join-blocked" className="mt-2 text-xs text-muted">Verifiko email-in për të hyrë.</p>}
              {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function DeviceSelect({ label, kind, devices, value, onChange }: { label: string; kind: MediaDeviceKind; devices: MediaDeviceInfo[]; value: string; onChange: (value: string) => void }) {
  const rows = devices.filter((device) => device.kind === kind);
  const id = `device-${kind}`;
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="input">
        <option value="">Parazgjedhja</option>
        {rows.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>
        ))}
      </select>
    </div>
  );
}
