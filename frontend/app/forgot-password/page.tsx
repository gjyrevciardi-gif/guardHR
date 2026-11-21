"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSent(false);
    try {
      await api("/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email }) });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kërkesa dështoi. Provo përsëri.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell kicker="Qasje për host" title={<>Harrove fjalëkalimin?<br />Do ta rivendosim.</>} blurb="Të dërgojmë një link me email për të vendosur një fjalëkalim të ri. Pasi ta ndryshosh, del nga të gjitha pajisjet.">
      <form onSubmit={submit} className="card w-full max-w-md p-7 sm:p-9 animate-rise">
        <h1 className="text-2xl font-bold tracking-tight">Rivendos fjalëkalimin</h1>
        <p className="mb-7 mt-2 text-sm leading-6 text-muted">Shkruaj email-in e llogarisë. Nëse ekziston, do të marrësh një link që vlen 60 minuta dhe përdoret vetëm një herë.</p>

        <label className="label" htmlFor="email">Email</label>
        <input id="email" autoComplete="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <div aria-live="polite">
          {sent && <p role="status" className="mt-4 rounded-xl border border-line-strong bg-shell-100 p-3 text-sm leading-6">Nëse ekziston një llogari me këtë email, kemi dërguar një link për ndryshimin e fjalëkalimit. Kontrollo edhe dosjen e spam-it.</p>}
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button className="btn-primary mt-6 w-full" disabled={loading}>
          {loading && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {loading ? "Duke dërguar…" : sent ? "Dërgo përsëri" : "Dërgo linkun"}
        </button>

        <p className="mt-5 text-center text-sm text-muted">
          <Link href="/login" className="inline-block py-1 font-semibold text-teal underline underline-offset-2">Kthehu te hyrja</Link>
        </p>
      </form>
    </AuthShell>
  );
}
