"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { api, saveToken } from "@/lib/api";
import { User } from "@/lib/types";
import { NemoMark } from "@/components/NemoMark";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("hr@example.com");
  const [password, setPassword] = useState("ChangeMe123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await api<{ access_token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }, false);
      saveToken(response.access_token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login deshtoi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="constellation relative hidden overflow-hidden p-16 text-navy lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="relative z-10 flex items-center gap-3 text-xl font-black">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/75 shadow-sm">
            <NemoMark className="h-9 w-11" />
          </span>
          Nemo Call
        </Link>

        <div className="relative z-10 max-w-xl">
          <p className="mb-5 text-sm font-bold uppercase tracking-[.24em] text-teal">Host access</p>
          <h1 className="display-tech text-5xl font-black leading-tight">
            Create calls.
            <br />
            Watch signals.
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-600">
            Ky login eshte vetem per host/admin. Pjesemarresit hyjne pa account permes email invite link.
          </p>
          <div className="mt-10 rounded-[2rem] border border-white/80 bg-white/65 p-8 shadow-soft backdrop-blur-xl">
            <NemoMark animated className="mx-auto h-40 w-64" />
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
            S'ke host account? <Link href="/register" className="font-semibold text-teal">Regjistrohu</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
