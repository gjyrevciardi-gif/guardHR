"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { api } from "@/lib/api";

type Props = {
  token: string;
  /** Masked address the code goes to, e.g. a**@example.com. */
  emailHint: string | null;
  onVerified: () => void;
};

type Sent = { email_hint: string; expires_in_seconds: number; resend_after_seconds: number };

/** Step shown in the candidate's pre-join panel when the host asked for an email code. */
export function EmailVerification({ token, emailHint, onVerified }: Props) {
  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "confirm" | null>(null);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    setBusy("send");
    setError("");
    try {
      const result = await api<Sent>(`/public/sessions/${token}/verification`, { method: "POST" }, false);
      setSent(result);
      setCooldown(result.resend_after_seconds);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kodi nuk u dërgua.");
    } finally {
      setBusy(null);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy("confirm");
    setError("");
    try {
      await api(`/public/sessions/${token}/verification/confirm`, { method: "POST", body: JSON.stringify({ code }) }, false);
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kodi nuk u verifikua.");
    } finally {
      setBusy(null);
    }
  }

  const target = sent?.email_hint ?? emailHint ?? "email-in tënd";

  return (
    <div className="text-left">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <MailCheck size={17} className="text-teal" aria-hidden="true" /> Verifiko email-in
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Host-i kërkon një kod njëpërdorimsh. Do ta dërgojmë te <strong className="font-semibold text-navy">{target}</strong>. Kodi vlen 10 minuta.
      </p>

      {!sent ? (
        <button type="button" onClick={() => void sendCode()} disabled={busy !== null} className="btn-primary mt-3 w-full">
          {busy === "send" && <Loader2 size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {busy === "send" ? "Po dërgohet…" : "Dërgo kodin"}
        </button>
      ) : (
        <form onSubmit={(event) => void confirm(event)} className="mt-3 space-y-3">
          <p role="status" className="text-sm leading-5 text-emerald-700">
            Kodi u dërgua. Kontrollo edhe dosjen e spam-it.
          </p>
          <div>
            <label htmlFor="verification-code" className="label">
              Kodi 6-shifror
            </label>
            <input
              id="verification-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="input min-h-11 text-center font-mono text-lg tracking-[0.4em]"
              aria-describedby={error ? "verification-error" : undefined}
              required
            />
          </div>
          <button type="submit" disabled={code.length !== 6 || busy !== null} className="btn-primary w-full">
            {busy === "confirm" && <Loader2 size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {busy === "confirm" ? "Po verifikohet…" : "Verifiko"}
          </button>
          <button
            type="button"
            onClick={() => void sendCode()}
            disabled={cooldown > 0 || busy !== null}
            className="min-h-11 w-full rounded-full text-xs font-semibold text-slate-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
          >
            {cooldown > 0 ? `Dërgo përsëri pas ${cooldown}s` : "Dërgo kodin përsëri"}
          </button>
        </form>
      )}
      {error && (
        <p id="verification-error" role="alert" className="mt-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
