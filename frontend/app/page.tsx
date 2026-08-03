import Link from "next/link";
import { Activity, ClipboardCheck, LogIn, Mail, ShieldCheck, UserRound } from "lucide-react";
import { NemoMark } from "@/components/NemoMark";
import { OceanShowcase } from "@/components/OceanShowcase";

const steps = [
  {
    icon: Mail,
    title: "Host sends invite",
    text: "Host/Admin krijon call, shton test opsional dhe dergon linkun ne email.",
  },
  {
    icon: UserRound,
    title: "Participant joins simply",
    text: "Pjesemarresi hyn pa account, pranon consent dhe futet ne room nga linku.",
  },
  {
    icon: Activity,
    title: "Signals show live",
    text: "Tab change, minimize, copy/paste dhe resize shfaqen si sinjale per review manual.",
  },
];

const principles = ["No automatic accusations", "Visible only to host", "Consent-first flow", "Manual review always"];

export default function Home() {
  return (
    <main className="constellation relative min-h-screen overflow-hidden px-5 py-6 text-navy">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 top-28 h-72 w-72 rounded-full bg-sky-200/45 blur-3xl" />
        <div className="absolute right-0 top-40 h-96 w-96 rounded-full bg-cyan-100/70 blur-3xl" />
      </div>

      <nav className="relative z-20 mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/80 bg-white/90 px-5 py-3 shadow-soft backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-3 text-sm font-black tracking-tight">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-100">
            <NemoMark className="h-8 w-10" />
          </span>
          Nemo Call
        </Link>
        <div className="hidden items-center gap-9 text-sm font-medium text-slate-600 md:flex">
          <a href="#how-it-works" className="transition hover:text-teal">How it works</a>
          <a href="#principles" className="transition hover:text-teal">Principles</a>
          <a href="#participants" className="transition hover:text-teal">Participants</a>
        </div>
        <Link href="/login" className="rounded-full bg-sky-100 px-5 py-2.5 text-sm font-bold text-teal transition hover:bg-sky-200">
          Host sign in
        </Link>
      </nav>

      <section className="relative z-10 mx-auto grid max-w-7xl gap-12 py-14 lg:grid-cols-[1.02fr_.98fr] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/85 px-3 py-2 font-mono text-xs lowercase tracking-widest text-slate-600 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            blue nemo mode - live activity signals
          </span>

          <h1 className="display-tech mt-9 max-w-4xl text-5xl font-black leading-[1.02] text-navy sm:text-7xl">
            Calm calls.
            <br />
            <span className="text-teal">Clear signals.</span>
          </h1>

          <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600">
            Nemo Call eshte nje call room me test optional ku host-i sheh live activity signals:
            tab/app change, minimize, copy/paste, resize dhe lidhje te nderprera. Sistemi nuk jep verdict;
            vetem i organizon sinjalet per review manual.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="btn-primary">Create host account</Link>
            <Link href="/login" className="btn-secondary"><LogIn size={16} /> Login</Link>
          </div>

          <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
            <div className="rounded-3xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur-xl">
              <p className="text-2xl font-black text-navy">0</p>
              <p className="text-xs font-semibold text-slate-500">automatic rejections</p>
            </div>
            <div className="rounded-3xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur-xl">
              <p className="text-2xl font-black text-navy">live</p>
              <p className="text-xs font-semibold text-slate-500">host-side popups</p>
            </div>
            <div className="rounded-3xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur-xl">
              <p className="text-2xl font-black text-navy">simple</p>
              <p className="text-xs font-semibold text-slate-500">participant UI</p>
            </div>
          </div>
        </div>

        <OceanShowcase />
      </section>

      <section id="how-it-works" className="relative z-10 mx-auto max-w-7xl pb-12">
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="card p-6">
                <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-teal">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="text-lg font-black text-navy">{step.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{step.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="principles" className="relative z-10 mx-auto flex max-w-7xl flex-col gap-4 pb-16 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.28em] text-teal">Review, not verdict</p>
          <h2 className="mt-3 text-3xl font-black text-navy">Nemo keeps the water calm.</h2>
        </div>
        <div id="participants" className="flex flex-wrap gap-3">
          {principles.map((item) => (
            <span key={item} className="rounded-full border border-white/80 bg-white/75 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-xl">
              <ShieldCheck className="mr-2 inline h-4 w-4 text-teal" />
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto mb-8 grid max-w-7xl gap-4 lg:grid-cols-2">
        <div className="card p-6">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-sky-100 p-3 text-teal"><UserRound /></span>
            <div>
              <h2 className="font-black">Participant flow</h2>
              <p className="text-sm text-slate-600">No account required</p>
            </div>
          </div>
          <div className="mt-5 space-y-3 text-sm text-navy">
            <p className="rounded-2xl bg-sky-50 p-3">1. Open email invite link /join/...</p>
            <p className="rounded-2xl bg-sky-50 p-3">2. Read consent and start session</p>
            <p className="rounded-2xl bg-sky-50 p-3">3. Join call and complete the test in a simple UI</p>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-sky-100 p-3 text-teal"><ClipboardCheck /></span>
            <div>
              <h2 className="font-black">Host/Admin flow</h2>
              <p className="text-sm text-slate-600">Account required</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Link href="/register" className="btn-primary">Register</Link>
            <Link href="/login" className="btn-secondary">Sign in</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
