"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, LockKeyhole } from "lucide-react";
import { api, saveToken } from "@/lib/api";
import { User } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("hr@example.com");
  const [password, setPassword] = useState("ChangeMe123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await api<{ access_token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false);
      saveToken(response.access_token); router.push("/dashboard");
    } catch (err) { setError(err instanceof Error ? err.message : "Login dështoi"); }
    finally { setLoading(false); }
  }

  return <main className="grid min-h-screen lg:grid-cols-2">
    <section className="hidden bg-navy p-16 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="flex items-center gap-3 text-xl font-bold"><ShieldCheck/> InterviewGuard</div>
      <div className="max-w-xl">
        <p className="mb-5 text-sm font-semibold uppercase tracking-[.24em] text-teal-300">Integritet me mbikëqyrje njerëzore</p>
        <h1 className="text-5xl font-semibold leading-tight">Sinjale të qarta. Vendime njerëzore.</h1>
        <p className="mt-6 text-lg leading-8 text-slate-300">Ngjarjet dokumentohen si kontekst për shqyrtim. Platforma nuk etiketon dhe nuk refuzon automatikisht kandidatë.</p>
      </div>
      <p className="text-sm text-slate-400">Privacy-first · Neutral labels · Manual review</p>
    </section>
    <section className="flex items-center justify-center bg-mist p-6">
      <form onSubmit={submit} className="card w-full max-w-md p-8 sm:p-10">
        <span className="mb-6 inline-flex rounded-2xl bg-teal/10 p-3 text-teal"><LockKeyhole/></span>
        <h2 className="text-3xl font-bold text-ink">Hyrje për HR</h2>
        <p className="mb-8 mt-2 text-sm text-slate-500">Përdor kredencialet e organizatës.</p>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input mb-5" type="email" value={email} onChange={e => setEmail(e.target.value)} required/>
        <label className="label" htmlFor="password">Fjalëkalimi</label>
        <input id="password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required/>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="btn-primary mt-6 w-full" disabled={loading}>{loading ? "Duke hyrë…" : "Hyr në dashboard"}</button>
      </form>
    </section>
  </main>;
}
