"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, UserPlus } from "lucide-react";
import { api, saveToken } from "@/lib/api";
import { User } from "@/lib/types";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await api<{ access_token: string; user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(form),
      }, false);
      saveToken(response.access_token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regjistrimi dështoi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden bg-navy p-16 text-white lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="flex items-center gap-3 text-xl font-bold"><ShieldCheck /> InterviewGuard</Link>
        <div className="max-w-xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[.24em] text-teal-300">HR/Admin account</p>
          <h1 className="text-5xl font-semibold leading-tight">Krijo sesione dhe teste me një dashboard të qartë.</h1>
          <p className="mt-6 text-lg leading-8 text-slate-300">Kandidatët hyjnë pa account. Vetëm HR ka regjistrim për menaxhim dhe audit log.</p>
        </div>
        <p className="text-sm text-slate-400">Manual review · Neutral labels · No automatic rejection</p>
      </section>
      <section className="flex items-center justify-center bg-mist p-6">
        <form onSubmit={submit} className="card w-full max-w-md p-8 sm:p-10">
          <span className="mb-6 inline-flex rounded-2xl bg-teal/10 p-3 text-teal"><UserPlus /></span>
          <h2 className="text-3xl font-bold text-ink">Register për HR</h2>
          <p className="mb-8 mt-2 text-sm text-slate-500">Ky account përdoret për krijim meeting, teste dhe review.</p>
          <label className="label" htmlFor="name">Emri</label>
          <input id="name" className="input mb-5" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required minLength={2} />
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input mb-5" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <label className="label" htmlFor="password">Fjalëkalimi</label>
          <input id="password" className="input" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button className="btn-primary mt-6 w-full" disabled={loading}>{loading ? "Duke krijuar..." : "Krijo account"}</button>
          <p className="mt-5 text-center text-sm text-slate-500">
            Ke account? <Link href="/login" className="font-semibold text-teal">Hyr këtu</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
