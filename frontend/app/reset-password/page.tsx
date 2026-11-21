"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [linkRefused, setLinkRefused] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLinkRefused(false);
    if (password !== again) {
      setError("Dy fjalëkalimet nuk përputhen.");
      return;
    }
    setLoading(true);
    try {
      await api("/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ token, new_password: password }) });
      setDone(true);
    } catch (err) {
      setLinkRefused(err instanceof ApiError && err.status === 400); // the only 400 here is an unknown, used or expired link
      setError(err instanceof Error ? err.message : "Fjalëkalimi nuk u ndryshua. Provo përsëri.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="card w-full max-w-md p-7 sm:p-9 animate-rise">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><CheckCircle2 size={24} className="text-teal" aria-hidden="true" /> Fjalëkalimi u ndryshua</h1>
        <p role="status" className="mb-7 mt-3 text-sm leading-6 text-muted">Je larguar nga të gjitha pajisjet. Hyr me fjalëkalimin e ri.</p>
        <Link href="/login" className="btn-primary w-full">Hyr</Link>
      </div>
    );
  }

  if (token.length < 20) {
    return (
      <div className="card w-full max-w-md p-7 sm:p-9 animate-rise">
        <h1 className="text-2xl font-bold tracking-tight">Linku nuk është i plotë</h1>
        <p className="mb-7 mt-3 text-sm leading-6 text-muted">Hape linkun nga emaili i plotë ose kërko një të ri.</p>
        <Link href="/forgot-password" className="btn-primary w-full">Kërko link të ri</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-md p-7 sm:p-9 animate-rise">
      <h1 className="text-2xl font-bold tracking-tight">Fjalëkalim i ri</h1>
      <p className="mb-7 mt-2 text-sm leading-6 text-muted">Zgjidh një fjalëkalim që nuk e përdor diku tjetër. Pasi ta ruash, del nga të gjitha pajisjet.</p>

      <label className="label" htmlFor="new-password">Fjalëkalimi i ri</label>
      <input id="new-password" autoComplete="new-password" aria-describedby="new-password-hint" className="input" type="password" minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <p id="new-password-hint" className="mb-5 mt-2 text-xs text-muted">Të paktën 8 shkronja ose shifra.</p>

      <label className="label" htmlFor="repeat-password">Përsërite fjalëkalimin</label>
      <input id="repeat-password" autoComplete="new-password" className="input" type="password" minLength={8} maxLength={128} value={again} onChange={(e) => setAgain(e.target.value)} required />

      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          {linkRefused && <p className="mt-1"><Link href="/forgot-password" className="font-semibold underline underline-offset-2">Kërko link të ri</Link></p>}
        </div>
      )}

      <button className="btn-primary mt-6 w-full" disabled={loading}>
        {loading && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {loading ? "Duke ruajtur…" : "Ruaj fjalëkalimin"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell kicker="Qasje për host" title={<>Zgjidh një fjalëkalim<br />të ri.</>} blurb="Linku nga emaili funksionon vetëm një herë dhe vlen 60 minuta.">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
