"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { User } from "@/lib/types";
import { AuthShell } from "@/components/AuthShell";

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
    <AuthShell kicker="Qasje për host" title={<>Hyr te call-et e tua.<br />Shqyrto me qetësi.</>} blurb="Kjo kyçje është vetëm për host-et. Kandidatët hyjnë pa llogari, nga linku i ftesës që marrin me email.">
      <form onSubmit={submit} className="card w-full max-w-md p-7 sm:p-9 animate-rise">
        <h1 className="text-2xl font-bold tracking-tight">Hyrje për host</h1>
        <p className="mb-7 mt-2 text-sm leading-6 text-muted">Përdor llogarinë për të krijuar call-e dhe teste dhe për të parë sinjalet e aktivitetit.</p>

        <label className="label" htmlFor="email">Email</label>
        <input id="email" autoComplete="email" className="input mb-5" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label className="label" htmlFor="password">Fjalëkalimi</label>
        <input id="password" autoComplete="current-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button className="btn-primary mt-6 w-full" disabled={loading}>
          {loading && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {loading ? "Duke hyrë…" : "Hyr"}
        </button>

        <p className="mt-5 text-center text-sm text-muted">
          Nuk ke llogari? <Link href="/register" className="font-semibold text-teal underline underline-offset-2">Regjistrohu</Link>
        </p>
      </form>
    </AuthShell>
  );
}
