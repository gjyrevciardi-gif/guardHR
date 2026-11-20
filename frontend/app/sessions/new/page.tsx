"use client";

import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Clipboard, Link2, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";
import { InterviewSession, Test } from "@/lib/types";

function defaultExpiry() {
  const date = new Date(Date.now() + 7 * 86400000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function NewSessionPage() {
  const [form, setForm] = useState({
    title: "",
    candidate_name: "",
    candidate_email: "",
    expires_at: defaultExpiry(),
    require_screen_share: false,
    verify_candidate_email: true,
    test_id: "",
  });
  const [tests, setTests] = useState<Test[]>([]);
  const [created, setCreated] = useState<InterviewSession | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const candidateLink =
    created && typeof window !== "undefined" ? `${window.location.origin}/join/${created.public_token}` : "";

  useEffect(() => {
    api<Test[]>("/tests").then(setTests).catch(() => setTests([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      setCreated(
        await api<InterviewSession>("/sessions", {
          method: "POST",
          body: JSON.stringify({
            ...form,
            candidate_email: form.candidate_email.trim(),
            test_id: form.test_id || null,
            expires_at: new Date(form.expires_at).toISOString(),
          }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nuk u krijua call-i");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(candidateLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Linku nuk u kopjua. Përzgjidhe dhe kopjoje me dorë.");
    }
  }

  return (
    <AppShell>
      <Link href="/dashboard" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-600 hover:text-teal">
        <ArrowLeft size={17} aria-hidden="true" /> Paneli
      </Link>
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow">Call i ri</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Krijo call</h1>
        <p className="mt-2 text-muted">Fut të dhënat e kandidatit. Ftesa i dërgohet me email dhe linku të mbetet këtu si rezervë.</p>

        {created ? (
          <div className="card mt-8 p-8 text-center animate-rise">
            <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${created.invite_email_queued ? "bg-shell-200 text-moss" : "bg-amber-100 text-amber-900"}`}>
              {created.invite_email_queued ? <MailCheck aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
            </span>
            <h2 className="mt-5 text-2xl font-bold" role="status">
              {created.invite_email_queued ? "Call-i u krijua dhe ftesa po dërgohet" : "Call-i u krijua"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {created.invite_email_queued
                ? "Email-i dërgohet në sfond. Rezultati i dërgimit regjistrohet në audit log. Nëse nuk mbërrin, kopjo linkun më poshtë dhe dërgoje vetë."
                : "Email-i nuk u vu në radhë. Kopjo linkun dhe dërgoje vetë te kandidati."}
            </p>
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-line bg-shell-100 p-3 text-left text-sm">
              <Link2 className="shrink-0 text-teal" size={18} aria-hidden="true" />
              <code className="min-w-0 flex-1 truncate">{candidateLink}</code>
              <button type="button" onClick={copyLink} className="btn-secondary !min-h-11 !px-3">
                {copied ? <Check size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}
                {copied ? "U kopjua" : "Kopjo"}
                <span className="sr-only"> linkun</span>
              </button>
            </div>
            {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href={`/sessions/${created.id}`} className="btn-primary">
                Hap call-in
              </Link>
              <Link href="/dashboard" className="btn-secondary">
                Paneli
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="card mt-8 space-y-5 p-7">
            <div>
              <label htmlFor="session-title" className="label">Titulli</label>
              <input
                className="input"
                id="session-title"
                placeholder="p.sh. Frontend screening"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                minLength={2}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="session-name" className="label">Emri i kandidatit</label>
                <input
                  className="input"
                  id="session-name"
                  autoComplete="off"
                  value={form.candidate_name}
                  onChange={(e) => setForm({ ...form, candidate_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="session-email" className="label">Email-i i kandidatit</label>
                <input
                  className="input"
                  type="email"
                  id="session-email"
                  autoComplete="off"
                  value={form.candidate_email}
                  onChange={(e) => setForm({ ...form, candidate_email: e.target.value })}
                  required
                />
              </div>
            </div>
            <div>
              <label htmlFor="session-expires" className="label">Linku skadon më</label>
              <input
                className="input"
                type="datetime-local"
                id="session-expires"
                value={form.expires_at}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                required
              />
            </div>
            <div>
              <label htmlFor="session-test" className="label">Test brenda call-it (opsional)</label>
              <select id="session-test" className="input" value={form.test_id} onChange={(e) => setForm({ ...form, test_id: e.target.value })}>
                <option value="">Pa test</option>
                {tests.map((test) => (
                  <option key={test.id} value={test.id}>{test.title} · {test.question_count} pyetje</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-muted">
                Nuk e ke krijuar ende? <Link href="/tests/new" className="font-semibold text-teal underline underline-offset-2">Krijo një test</Link>.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-shell-100 p-4">
              <label className="flex cursor-pointer items-start gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-teal"
                  checked={form.verify_candidate_email}
                  onChange={(e) => setForm({ ...form, verify_candidate_email: e.target.checked })}
                />
                <span>
                  Verifiko email-in e kandidatit me kod njëpërdorimsh
                  <span className="mt-1 block text-xs font-normal leading-5 text-muted">
                    Para se të hyjë, kandidati shkruan një kod 6-shifror që i vjen në email. Kjo ndalon që një link i përcjellë ose i rrjedhur të mjaftojë vetëm. Nuk provon se kush është personi, vetëm se ka akses te kutia postare e ftuar.
                  </span>
                </span>
              </label>
            </div>
            <p className="rounded-xl border border-teal/20 bg-teal/5 p-4 text-sm leading-6 text-slate-600">
              Gjatë call-it regjistrohen sinjale aktiviteti: dalje nga skeda ose dritarja, ndryshim madhësie, dalje nga fullscreen, copy/paste dhe ndërprerje lidhjeje. Kamera dhe mikrofoni janë opsionale. Kandidati e lexon këtë para se të hyjë dhe duhet ta pranojë.
            </p>
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" disabled={loading}>
              {loading && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {loading ? "Duke krijuar…" : "Krijo call dhe dërgo email"}
            </button>
          </form>
        )}
      </div>
    </AppShell>
  );
}
