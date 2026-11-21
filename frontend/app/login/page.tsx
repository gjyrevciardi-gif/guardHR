"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ApiError, MFA_REQUIRED, api } from "@/lib/api";
import { User } from "@/lib/types";
import { AuthShell } from "@/components/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (needsCode) codeInput.current?.focus();
  }, [needsCode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, code: needsCode ? code.trim() : undefined }),
      });
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.message === MFA_REQUIRED) setNeedsCode(true);
      else setError(err instanceof Error ? err.message : "Hyrja dështoi");
    } finally {
      setLoading(false);
    }
  }

  function backToPassword() {
    setNeedsCode(false);
    setCode("");
    setError("");
  }

  return (
    <AuthShell kicker="Qasje për host" title={<>Hyr te call-et e tua.<br />Shqyrto me qetësi.</>} blurb="Kjo kyçje është vetëm për host-et. Kandidatët hyjnë pa llogari, nga linku i ftesës që marrin me email.">
      <form onSubmit={submit} className="card w-full max-w-md p-7 sm:p-9 animate-rise">
        <h1 className="text-2xl font-bold tracking-tight">{needsCode ? "Verifikimi në dy hapa" : "Hyrje për host"}</h1>
        <p className="mb-7 mt-2 text-sm leading-6 text-muted">
          {needsCode
            ? "Hap aplikacionin e vërtetimit dhe shkruaj kodin 6-shifror. Nëse nuk e ke telefonin, përdor një nga kodet e rikuperimit që ruajte kur e aktivizove."
            : "Përdor llogarinë për të krijuar call-e dhe teste dhe për të parë sinjalet e aktivitetit."}
        </p>

        {needsCode ? (
          <>
            <label className="label" htmlFor="code">Kodi i verifikimit</label>
            <input id="code" ref={codeInput} autoComplete="one-time-code" inputMode="text" autoCapitalize="none" spellCheck={false} maxLength={32} className="input font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} required />
          </>
        ) : (
          <>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" autoComplete="email" className="input mb-5" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

            <label className="label" htmlFor="password">Fjalëkalimi</label>
            <input id="password" autoComplete="current-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <p className="mt-2 text-right text-sm">
              <Link href="/forgot-password" className="inline-block py-1 font-semibold text-teal underline underline-offset-2">Harrove fjalëkalimin?</Link>
            </p>
          </>
        )}

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button className="btn-primary mt-6 w-full" disabled={loading}>
          {loading && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {loading ? "Duke hyrë…" : needsCode ? "Verifiko dhe hyr" : "Hyr"}
        </button>

        {needsCode ? (
          <button type="button" className="btn-secondary mt-3 w-full" onClick={backToPassword}>Kthehu</button>
        ) : (
          <p className="mt-5 text-center text-sm text-muted">
            Nuk ke llogari? <Link href="/register" className="font-semibold text-teal underline underline-offset-2">Regjistrohu</Link>
          </p>
        )}
      </form>
    </AuthShell>
  );
}
