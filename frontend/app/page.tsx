import Link from "next/link";
import { ClipboardCheck, LogIn, ShieldCheck, UserRound } from "lucide-react";

export default function Home() {
  return (
    <main className="constellation min-h-screen overflow-hidden bg-navy px-5 py-6 text-white">
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/10 bg-[#07111f]/80 px-5 py-3 shadow-soft backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-3 text-sm font-bold">
          <span className="rounded-full border border-teal/40 bg-teal/10 p-1.5 text-teal"><ShieldCheck size={16} /></span>
          Nemo Call
        </Link>
        <div className="hidden items-center gap-8 text-sm text-slate-400 md:flex">
          <span>How it works</span>
          <span>Principles</span>
          <span>Participants</span>
        </div>
        <Link href="/login" className="rounded-full border border-teal/40 bg-teal/10 px-5 py-2 text-sm font-semibold text-teal">
          Host sign in
        </Link>
      </nav>

      <section className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-7xl flex-col justify-between py-14">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs lowercase tracking-widest text-slate-400">
              <span className="h-2 w-2 rounded-full bg-teal shadow-[0_0_18px_rgba(0,215,230,.8)]" />
              call platform · live activity signals
            </span>
            <h1 className="display-tech mt-10 text-5xl font-black leading-[0.95] text-white sm:text-7xl lg:text-8xl">
              Integrity signals.
              <br />
              <span className="text-teal">Never verdicts.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-slate-400">
              Pjesëmarrësi hyn pa account përmes linkut që i vjen në email. Host/Admin krijon call, shton test dhe sheh live signals si tab/minimize/copy-paste.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn-primary">Create host account</Link>
              <Link href="/login" className="btn-secondary"><LogIn size={16} /> Login</Link>
            </div>
          </div>

          <div className="card p-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex items-center gap-3">
                <span className="rounded-2xl bg-teal/10 p-3 text-teal"><UserRound /></span>
                <div>
                  <h2 className="font-bold">Participant flow</h2>
                  <p className="text-sm text-slate-400">No account required</p>
                </div>
              </div>
              <div className="mt-5 space-y-3 text-sm text-slate-300">
                <p className="rounded-2xl bg-white/5 p-3">1. Open email invite link `/join/...`</p>
                <p className="rounded-2xl bg-white/5 p-3">2. Read consent and start session</p>
                <p className="rounded-2xl bg-white/5 p-3">3. Join call and complete test in simple UI</p>
              </div>
            </div>
            <div className="mt-4 rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex items-center gap-3">
                <span className="rounded-2xl bg-teal/10 p-3 text-teal"><ClipboardCheck /></span>
                <div>
                  <h2 className="font-bold">Host/Admin flow</h2>
                  <p className="text-sm text-slate-400">Account required</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Link href="/register" className="btn-primary">Register</Link>
                <Link href="/login" className="btn-secondary">Sign in</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap gap-x-10 gap-y-3 font-mono text-xs text-slate-400">
          <span>✓ Invite-only links by email</span>
          <span>✓ Live call activity signals</span>
          <span>✓ Participant consent on record</span>
          <span>✓ No automatic accusations</span>
        </div>
      </section>
    </main>
  );
}
