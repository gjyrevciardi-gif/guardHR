"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { User } from "@/lib/types";
import { AuthShell } from "@/components/AuthShell";

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
      await api<{ user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(form),
      }, false);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regjistrimi dështoi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell kicker="Llogari host" title={<>Krijo llogarinë.<br />Fto kandidatin e parë.</>} blurb="Pas regjistrimit krijon një call, dërgon ftesën me email dhe e drejton intervistën nga një dhomë e vetme. Përfundimin e shkruan gjithmonë ti.">
      <form onSubmit={submit} className="card w-full max-w-md p-7 sm:p-9 animate-rise">
        <h1 className="text-2xl font-bold tracking-tight">Krijo llogari host</h1>
        <p className="mb-7 mt-2 text-sm leading-6 text-muted">Llogaria përdoret për të krijuar call-e dhe teste dhe për të shqyrtuar sinjalet.</p>

        <label className="label" htmlFor="name">Emri</label>
        <input id="name" autoComplete="name" className="input mb-5" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required minLength={2} />

        <label className="label" htmlFor="email">Email</label>
        <input id="email" autoComplete="email" className="input mb-5" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />

        <label className="label" htmlFor="password">Fjalëkalimi</label>
        <input id="password" autoComplete="new-password" aria-describedby="password-hint" className="input" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <p id="password-hint" className="mt-2 text-xs text-muted">Të paktën 8 shkronja ose shifra.</p>

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button className="btn-primary mt-6 w-full" disabled={loading}>
          {loading && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {loading ? "Duke krijuar…" : "Krijo llogarinë"}
        </button>

        <p className="mt-5 text-center text-sm text-muted">
          Ke llogari? <Link href="/login" className="font-semibold text-teal underline underline-offset-2">Hyr këtu</Link>
        </p>
      </form>
    </AuthShell>
  );
}
