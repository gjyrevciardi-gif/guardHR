"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, CheckCircle2, Eye, MonitorUp, ShieldCheck, Trash2, Video } from "lucide-react";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { PublicSession } from "@/lib/types";
import { Wordmark } from "@/components/Wordmark";

export default function ConsentPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [session, setSession] = useState<PublicSession | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<PublicSession>(`/public/sessions/${token}`, {}, false)
      .then(setSession)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function continueToRoom() {
    if (!session) return;
    try {
      if (!session.consented_at) await api(`/public/sessions/${token}/consent`, { method: "POST", body: JSON.stringify({ accepted }) }, false);
      router.push(`/interview/${token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Consent-i nuk u ruajt");
    }
  }

  const kept = session ? `Fshihen ${session.retention_days} ditë pas përfundimit të call-it.` : "";

  if (loading) return <Centered>Duke verifikuar linkun...</Centered>;
  if (!session) return <Centered><strong>Linku nuk mund te hapet.</strong><span className="text-sm text-slate-500">{error}</span></Centered>;
  if (session.status === "expired") return <Centered><strong>Ky link ka skaduar.</strong><span className="text-sm text-slate-500">Kontakto host-in që ta ka dërguar ftesën.</span></Centered>;

  return (
    <main className="min-h-screen bg-mist px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-center gap-3 font-bold text-navy">
          <span className="rounded-xl bg-navy p-2 text-white"><ShieldCheck size={20} /></span>
          <Wordmark />
        </div>
        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-7 sm:p-9">
            <p className="text-sm font-semibold text-teal">JOIN CALL · CONSENT</p>
            <h1 className="mt-2 text-3xl font-bold">Para se të hysh në call</h1>
            <p className="mt-3 text-slate-600">
              Përshëndetje {session.candidate_name}. Për call-in &quot;{session.title}&quot;, sistemi regjistron sinjale aktiviteti që i shfaqen host-it live.
            </p>
          </div>
          <div className="px-7 pt-7 sm:px-9">
            <p className="text-sm leading-6 text-slate-600">Përgjegjës për këto të dhëna është organizatori i call-it: <strong>{session.host_name}</strong>. Më poshtë: çfarë mblidhet, pse, dhe sa kohë ruhet.</p>
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
            <Info icon={<Trash2 />} title="Prova e pranimit" why="Të provohet se e ke pranuar këtë informacion." kept={kept}>
              Ruhen koha dhe adresa IP e pranimit, dhe përgjigjet e testit nëse ky call ka test.
            </Info>
          </div>
          <div className="mx-7 mb-7 rounded-xl border border-teal/20 bg-teal/5 p-4 text-sm leading-6 text-slate-700 sm:mx-9">
            <strong>Nuk përdoret</strong> emotion recognition, lie detection, analizë personaliteti ose akuzim automatik. Eventet janë sinjale për host-in.
          </div>
          <div className="border-t border-slate-200 bg-slate-50 p-7 sm:p-9">
            <p className="mb-4 text-sm text-slate-500">Linku skadon: {dateTime(session.expires_at)} · <Link href="/privacy" target="_blank" className="font-semibold text-teal underline">Politika e privatësisë</Link></p>
            {!session.consented_at && (
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-teal" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
                <span className="text-sm leading-6">E kam lexuar informacionin dhe pranoj sinjalet e aktivitetit gjatë këtij call/test.</span>
              </label>
            )}
            <button onClick={continueToRoom} disabled={!session.consented_at && !accepted} className="btn-primary mt-6 w-full">
              <CheckCircle2 size={18} /> {session.consented_at ? "Vazhdo në call" : "Pranoj dhe vazhdoj"}
            </button>
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

function Info({ icon, title, why, kept, children }: { icon: React.ReactNode; title: string; why: string; kept: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <span className="text-teal">{icon}</span>
      <h2 className="mt-3 font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-5 text-slate-600">{children}</p>
      <p className="mt-2 text-sm leading-5 text-slate-600"><strong>Pse:</strong> {why}</p>
      <p className="mt-1 text-sm leading-5 text-slate-600"><strong>Ruajtja:</strong> {kept}</p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-mist p-6 text-center">{children}</main>;
}
