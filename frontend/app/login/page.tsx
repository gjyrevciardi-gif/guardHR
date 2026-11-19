"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { api } from "@/lib/api";
import { User } from "@/lib/types";
import { ShellMark } from "@/components/ShellMark";
import { Wordmark } from "@/components/Wordmark";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hyrja dështoi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="shell-field relative hidden overflow-hidden p-16 text-navy lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="relative z-10 flex items-center gap-3 text-xl font-black">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/75 shadow-sm">
            <ShellMark className="h-8 w-8" />
          </span>
          <Wordmark />
        </Link>

        <div className="relative z-10 max-w-xl">
          <p className="mb-5 text-sm font-bold uppercase tracking-[.24em] text-teal">Qasje për host</p>
          <h1 className="display-tech text-5xl font-black leading-tight">
            Krijo call-e.
            <br />
            Ndiq sinjalet.
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-600">
            Ky kyçje është vetëm për host/admin. Pjesëmarrësit hyjnë pa llogari përmes linkut të ftesës në email.
          </p>
          <div className="mt-10 rounded-[2rem] border border-white/80 bg-white/65 p-8 shadow-soft backdrop-blur-xl">
            <ShellMark animated className="mx-auto h-48 w-48" />
          </div>
        </div>

        <p className="relative z-10 text-sm font-semibold text-slate-600">
          Invite links - Live signals - No automatic accusations
        </p>
      </section>

      <section className="flex items-center justify-center bg-mist p-6">
        <form onSubmit={submit} className="card w-full max-w-md p-8 sm:p-10">
          <span className="mb-6 inline-flex rounded-2xl bg-teal/10 p-3 text-teal"><LockKeyhole /></span>
          <h2 className="text-3xl font-black text-ink">Hyrje per host</h2>
          <p className="mb-8 mt-2 text-sm leading-6 text-slate-500">
            Perdor account-in per te krijuar call/teste dhe per te pare live activity signals.
          </p>

          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input mb-5" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

          <label className="label" htmlFor="password">Fjalekalimi</label>
          <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button className="btn-primary mt-6 w-full" disabled={loading}>
            {loading ? "Duke hyre..." : "Hyr ne dashboard"}
          </button>

          <p className="mt-5 text-center text-sm text-slate-500">
            S&apos;ke host account? <Link href="/register" className="font-semibold text-teal">Regjistrohu</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
