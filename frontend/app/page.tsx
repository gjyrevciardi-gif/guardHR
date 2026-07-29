import Link from "next/link";
import { ClipboardCheck, LogIn, ShieldCheck, UserRound } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-mist px-5 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col justify-center">
        <div className="mb-10 flex items-center gap-3 font-bold text-navy">
          <span className="rounded-xl bg-navy p-2 text-white"><ShieldCheck size={22} /></span>
          InterviewGuard
        </div>
        <section className="grid gap-6 lg:grid-cols-[1.2fr_.8fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.22em] text-teal">HR integrity monitoring</p>
            <h1 className="mt-3 text-4xl font-bold leading-tight text-ink sm:text-6xl">
              Kandidati hyn thjeshtë. HR menaxhon me account.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
              Kandidatët nuk kanë nevojë për regjistrim. Ata hapin linkun e ftesës, japin consent dhe hyjnë në sesion.
              HR/Admin regjistrohet me email për të krijuar meeting, teste dhe review manual.
            </p>
          </div>
          <div className="card space-y-4 p-6">
            <div className="rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-teal/10 p-2 text-teal"><UserRound /></span>
                <h2 className="font-bold">Jam kandidat</h2>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Nuk krijon account. Përdor linkun që ta ka dërguar HR, p.sh. `/join/...`.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-navy/10 p-2 text-navy"><ClipboardCheck /></span>
                <h2 className="font-bold">Jam HR/Admin</h2>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Krijo account ose hyr për të menaxhuar sesione, teste, timeline dhe review.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Link href="/register" className="btn-primary justify-center">Register</Link>
                <Link href="/login" className="btn-secondary justify-center"><LogIn size={16} /> Login</Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
