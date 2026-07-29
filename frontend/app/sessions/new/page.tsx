"use client";

import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Clipboard, Link2, MailCheck } from "lucide-react";
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
    title: "Nemo Call session",
    candidate_name: "",
    candidate_email: "",
    expires_at: defaultExpiry(),
    require_screen_share: false,
    test_id: "",
  });
  const [tests, setTests] = useState<Test[]>([]);
  const [created, setCreated] = useState<InterviewSession | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
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

  return (
    <AppShell>
      <Link href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
        <ArrowLeft size={17} /> Dashboard
      </Link>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold">Krijo Nemo Call</h1>
        <p className="mt-2 text-slate-500">Fut të dhënat e pjesëmarrësit. Linku i join dërgohet në email dhe shfaqet si backup.</p>

        {created ? (
          <div className="card mt-8 p-8 text-center">
            <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${created.invite_email_sent ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {created.invite_email_sent ? <MailCheck /> : <AlertTriangle />}
            </span>
            <h2 className="mt-5 text-2xl font-bold">
              {created.invite_email_sent ? "Call-i u krijua dhe email-i u dërgua" : "Call-i u krijua"}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              {created.invite_email_sent
                ? "Pjesëmarrësi merr linkun në email dhe hyn pa account. Linku mbetet këtu si backup."
                : "Email-i nuk u dërgua. Kopjo linkun si backup ose kontrollo SMTP settings."}
            </p>
            {created.invite_email_error && (
              <p className="mt-4 rounded-xl bg-amber-50 p-3 text-left text-sm text-amber-800">
                {created.invite_email_error}
              </p>
            )}
            <div className="mt-6 flex items-center gap-2 rounded-xl bg-slate-100 p-3 text-left text-sm">
              <Link2 className="shrink-0 text-teal" size={18} />
              <code className="min-w-0 flex-1 truncate">{candidateLink}</code>
              <button
                aria-label="Kopjo linkun"
                onClick={() => navigator.clipboard.writeText(candidateLink)}
                className="rounded-lg bg-white p-2"
              >
                <Clipboard size={17} />
              </button>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <Link href={`/sessions/${created.id}`} className="btn-primary">
                Hap call-in
              </Link>
              <Link href="/dashboard" className="btn-secondary">
                Dashboard
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="card mt-8 space-y-5 p-7">
            <div>
              <label className="label">Titulli</label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                minLength={2}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="label">Emri i pjesëmarrësit</label>
                <input
                  className="input"
                  value={form.candidate_name}
                  onChange={(e) => setForm({ ...form, candidate_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Email-i i pjesëmarrësit</label>
                <input
                  className="input"
                  type="email"
                  value={form.candidate_email}
                  onChange={(e) => setForm({ ...form, candidate_email: e.target.value })}
                  required
                />
              </div>
            </div>
            <div>
              <label className="label">Linku skadon me</label>
              <input
                className="input"
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Test me zgjedhje brenda call-it (opsional)</label>
              <select className="input" value={form.test_id} onChange={(e) => setForm({ ...form, test_id: e.target.value })}>
                <option value="">Pa test</option>
                {tests.map((test) => (
                  <option key={test.id} value={test.id}>{test.title} · {test.question_count} pyetje</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                Nuk e ke krijuar ende? <a href="/tests/new" className="font-semibold text-teal">Krijo test këtu</a>.
              </p>
            </div>
            <p className="rounded-xl border border-teal/20 bg-teal/5 p-4 text-sm text-slate-600">
              Nemo Call regjistron sinjale live si tab tjetër, minimize/focus loss, resize dritareje, fullscreen exit, copy/paste dhe ndërprerje lidhjeje. Kamera/mikrofoni janë opsionale.
            </p>
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? "Duke krijuar..." : "Krijo call dhe dërgo email"}
            </button>
          </form>
        )}
      </div>
    </AppShell>
  );
}
