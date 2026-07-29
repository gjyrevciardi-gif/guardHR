"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, CheckCircle2, Eye, MonitorUp, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { PublicSession } from "@/lib/types";

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

  if (loading) return <Centered>Duke verifikuar linkun...</Centered>;
  if (!session) return <Centered><strong>Linku nuk mund te hapet.</strong><span className="text-sm text-slate-500">{error}</span></Centered>;
  if (session.status === "expired") return <Centered><strong>Ky link ka skaduar.</strong><span className="text-sm text-slate-500">Kontakto host-in që ta ka dërguar ftesën.</span></Centered>;

  return (
    <main className="min-h-screen bg-mist px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-center gap-3 font-bold text-navy">
          <span className="rounded-xl bg-navy p-2 text-white"><ShieldCheck size={20} /></span>
          Nemo Call
        </div>
        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-7 sm:p-9">
            <p className="text-sm font-semibold text-teal">JOIN CALL · CONSENT</p>
            <h1 className="mt-2 text-3xl font-bold">Para se të hysh në Nemo Call</h1>
            <p className="mt-3 text-slate-600">
              Përshëndetje {session.candidate_name}. Për call-in "{session.title}", sistemi regjistron sinjale aktiviteti që i shfaqen host-it live.
            </p>
          </div>
          <div className="grid gap-4 p-7 sm:grid-cols-2 sm:p-9">
            <Info icon={<Eye />} title="Fokusi në faqe">Regjistrohet kur dilni nga faqja, kaloni në tab/app tjetër, minimizoni ose humbet fokusi i dritares.</Info>
            <Info icon={<MonitorUp />} title="Aktiviteti i browser-it">Regjistrohen resize dritareje, fullscreen exit, copy/paste dhe ndërprerje lidhjeje.</Info>
            <Info icon={<Camera />} title="Kamera dhe mikrofoni">Janë opsionale për call live. Video/audio nuk ruhen në këtë MVP.</Info>
            <Info icon={<Trash2 />} title="Ruajtja e te dhenave">Eventet kane retention policy te organizates dhe pastrohen pas afatit.</Info>
          </div>
          <div className="mx-7 mb-7 rounded-xl border border-teal/20 bg-teal/5 p-4 text-sm leading-6 text-slate-700 sm:mx-9">
            <strong>Nuk përdoret</strong> emotion recognition, lie detection, analizë personaliteti ose akuzim automatik. Eventet janë sinjale për host-in.
          </div>
          <div className="border-t border-slate-200 bg-slate-50 p-7 sm:p-9">
            <p className="mb-4 text-sm text-slate-500">Linku skadon: {dateTime(session.expires_at)}</p>
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

function Info({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 p-4"><span className="text-teal">{icon}</span><h2 className="mt-3 font-semibold">{title}</h2><p className="mt-1 text-sm leading-5 text-slate-500">{children}</p></div>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-mist p-6 text-center">{children}</main>;
}
