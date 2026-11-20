"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, CheckCircle2, Eye, EyeOff, Loader2, MailCheck, MonitorUp, ShieldCheck, Trash2, Video } from "lucide-react";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { PublicSession } from "@/lib/types";
import { ShellMark } from "@/components/ShellMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/Wordmark";

export default function ConsentPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [session, setSession] = useState<PublicSession | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PublicSession>(`/public/sessions/${token}`, {}, false)
      .then(setSession)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function continueToRoom() {
    if (!session) return;
    setBusy(true);
    try {
      if (!session.consented_at) await api(`/public/sessions/${token}/consent`, { method: "POST", body: JSON.stringify({ accepted }) }, false);
      router.push(`/interview/${token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Consent-i nuk u ruajt");
      setBusy(false);
    }
  }

  const kept = session ? `Fshihen ${session.retention_days} ditë pas përfundimit të call-it.` : "";

  if (loading) return <Centered><Loader2 className="animate-spin text-teal motion-reduce:animate-none" aria-hidden="true" /><span role="status">Duke verifikuar linkun...</span></Centered>;
  if (!session) return <Centered><strong>Linku nuk mund te hapet.</strong><span className="text-sm text-muted">{error}</span></Centered>;
  if (session.status === "expired") return <Centered><strong>Ky link ka skaduar.</strong><span className="text-sm text-muted">Kontakto host-in që ta ka dërguar ftesën.</span></Centered>;

  return (
    <div className="min-h-screen bg-canvas text-navy">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-5 py-2.5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-shell-200"><ShellMark className="h-6 w-6" /></span>
            <span className="font-bold"><Wordmark /></span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-4xl px-5 py-8">
        <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Hapat para hyrjes">
          <li className="flex items-center gap-2" aria-current="step"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal text-xs font-bold text-white">1</span><span className="font-semibold">Pranimi</span><span className="mx-1 h-px w-6 bg-line-strong" aria-hidden="true" /></li>
          {session.verification_required && <li className="flex items-center gap-2 text-muted"><span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-xs font-bold">2</span>Verifikimi<span className="mx-1 h-px w-6 bg-line-strong" aria-hidden="true" /></li>}
          <li className="flex items-center gap-2 text-muted"><span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-xs font-bold">{session.verification_required ? 3 : 2}</span>Pajisjet<span className="mx-1 h-px w-6 bg-line-strong" aria-hidden="true" /></li>
          <li className="flex items-center gap-2 text-muted"><span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-xs font-bold">{session.verification_required ? 4 : 3}</span>Hyrja</li>
        </ol>

        <section className="card overflow-hidden animate-rise">
          <div className="border-b border-line p-7 sm:p-9">
            <p className="eyebrow">Hyrje në call · pranim</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Para se të hysh në call</h1>
            <p className="mt-3 text-slate-600">
              Përshëndetje {session.candidate_name}. Për call-in &quot;{session.title}&quot;, sistemi regjistron sinjale aktiviteti që i shfaqen host-it live.
            </p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="Në shkurt">
              <li className="flex items-start gap-3 rounded-xl bg-shell-100 p-3.5 text-sm leading-5"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" /><span><strong>Sinjale, jo verdikte.</strong> Një njeri i shqyrton; asgjë nuk vendoset automatikisht.</span></li>
              <li className="flex items-start gap-3 rounded-xl bg-shell-100 p-3.5 text-sm leading-5"><EyeOff size={18} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" /><span><strong>Pa regjistrim.</strong> Video dhe zëri nuk ruhen; ruhen vetëm sinjalet.</span></li>
              <li className="flex items-start gap-3 rounded-xl bg-shell-100 p-3.5 text-sm leading-5"><Trash2 size={18} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" /><span><strong>Fshirje automatike</strong> {session.retention_days} ditë pas përfundimit.</span></li>
            </ul>
          </div>
          <div className="px-7 pt-7 sm:px-9">
            <p className="text-sm leading-6 text-slate-600">Përgjegjës për këto të dhëna është organizatori i call-it: <strong className="text-navy">{session.host_name}</strong>. Më poshtë: çfarë mblidhet, pse, dhe sa kohë ruhet.</p>
          </div>
          <div className="grid gap-4 p-7 sm:grid-cols-2 sm:p-9">
            <Info icon={<Eye />} title="Sinjalet e browser-it" why="Që organizatori të shqyrtojë nëse ka pasur ndërprerje gjatë call-it." kept={kept}>
              Dalja nga faqja ose kalimi në tab/app tjetër, humbja e fokusit, fullscreen, ndryshimi i madhësisë së dritares, më shumë se një monitor, ndërprerja e lidhjes dhe copy/paste. Për copy/paste dërgohet vetëm numri i rreshtave dhe i shkronjave dhe nëse duket si kod; teksti i kopjuar nuk dërgohet.
            </Info>
            <Info icon={<Camera />} title="Kamera: fytyra dhe pamje" why="Për të sinjalizuar kur fytyra nuk shihet, shihen disa persona ose zbulohet telefon." kept="Ruhen vetëm sinjalet (lloji, koha, kohëzgjatja). Pamjet nuk ruhen.">
              Fytyrat numërohen në browser-in tënd (modeli ngarkohet nga ky server, jo nga palë të treta). Çdo 5 sekonda një pamje e vogël e kamerës dërgohet te serveri për të numëruar persona dhe për të gjetur telefon; analizohet dhe hidhet menjëherë.
            </Info>
            <Info icon={<Video />} title="Video dhe zëri live" why="Që organizatori të të shohë dhe dëgjojë në call." kept="Nuk regjistrohen në këtë platformë.">
              Kamera dhe mikrofoni janë opsionale dhe transmetohen drejtpërdrejt te organizatori. Adresa jote IP i shihet organizatorit dhe shërbimit STUN të platformës që lidh kamerat.
            </Info>
            {session.require_screen_share && (
              <Info icon={<MonitorUp />} title="Ndarja e ekranit" why="Ky call kërkon që organizatori të shohë ekranin tënd." kept="Nuk regjistrohet.">
                Ekrani yt shfaqet live te organizatori për gjithë kohëzgjatjen e call-it.
              </Info>
            )}
            {session.verification_required && (
              <Info icon={<MailCheck />} title="Verifikimi i email-it" why="Që linku i përcjellë te dikush tjetër të mos mjaftojë për të hyrë në call." kept={kept}>
                Para se të hysh, do të të dërgohet një kod 6-shifror te email-i me të cilin të ftuan. Kodi ruhet vetëm si hash dhe vlen 10 minuta. Ruhen koha dhe adresa IP e verifikimit.
              </Info>
            )}
            <Info icon={<Trash2 />} title="Prova e pranimit" why="Të provohet se e ke pranuar këtë informacion." kept={kept}>
              Ruhen koha dhe adresa IP e pranimit, dhe përgjigjet e testit nëse ky call ka test.
            </Info>
          </div>
          <div className="mx-7 mb-7 rounded-xl border border-teal/20 bg-teal/5 p-4 text-sm leading-6 text-slate-700 sm:mx-9">
            <strong className="text-navy">Nuk përdoret</strong> emotion recognition, lie detection, analizë personaliteti ose akuzim automatik. Eventet janë sinjale për host-in.
          </div>
          <div className="border-t border-line bg-shell-100 p-7 sm:p-9">
            <p className="mb-4 text-sm text-muted">Linku skadon: {dateTime(session.expires_at)} · <Link href="/privacy" target="_blank" className="font-semibold text-teal underline">Politika e privatësisë</Link></p>
            {!session.consented_at && (
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-teal" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
                <span className="text-sm leading-6">E kam lexuar informacionin dhe pranoj sinjalet e aktivitetit gjatë këtij call/test.</span>
              </label>
            )}
            <button onClick={continueToRoom} disabled={busy || (!session.consented_at && !accepted)} className="btn-primary mt-6 w-full !min-h-12 text-base">
              {busy ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />} {session.consented_at ? "Vazhdo në call" : "Pranoj dhe vazhdoj"}
            </button>
            {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
          </div>
        </section>
      </main>
    </div>
  );
}

function Info({ icon, title, why, kept, children }: { icon: React.ReactNode; title: string; why: string; kept: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <span className="inline-flex rounded-lg bg-shell-200 p-2 text-teal" aria-hidden="true">{icon}</span>
      <h2 className="mt-3 font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-5 text-slate-600">{children}</p>
      <p className="mt-2 text-sm leading-5 text-slate-600"><strong className="text-navy">Pse:</strong> {why}</p>
      <p className="mt-1 text-sm leading-5 text-slate-600"><strong className="text-navy">Ruajtja:</strong> {kept}</p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-2 bg-canvas p-6 text-center">{children}</main>;
}
