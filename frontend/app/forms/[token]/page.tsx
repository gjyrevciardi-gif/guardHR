"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, ClipboardList, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { ExamStarted, Test, TestAnswer, TestQuestion, TestSubmission } from "@/lib/types";
import { useExamGuard } from "@/lib/useExamGuard";
import { ExamWatermark } from "@/components/ExamWatermark";
import { ShellMark } from "@/components/ShellMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/Wordmark";

export default function PublicFormPage() {
  const { token } = useParams<{ token: string }>();
  const [test, setTest] = useState<Test | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [participantEmail, setParticipantEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, TestAnswer>>({});
  const [submission, setSubmission] = useState<TestSubmission | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [started, setStarted] = useState<Date | null>(null);
  const [attempt, setAttempt] = useState("");
  const [examQuestions, setExamQuestions] = useState<TestQuestion[]>([]);
  // A test (not a plain form) is an exam: it needs to know who is sitting it, tells them what is recorded, and only
  // then does the server send the questions (the link alone does not carry them).
  const exam = test ? !test.form_mode : false;
  const questions = exam ? examQuestions : test?.questions ?? [];
  const guard = useExamGuard(exam && !!started && !submission);
  const canStart = accepted && participantName.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(participantEmail.trim());

  useEffect(() => {
    api<Test>(`/public/tests/${token}`, {}, false)
      .then(setTest)
      .catch((err) => setError(err instanceof Error ? err.message : "Linku nuk është i vlefshëm"));
  }, [token]);

  const allAnswered = questions.length > 0 && questions.every((question) => {
    const answer = answers[question.id];
    if (question.question_type === "short_text") return typeof answer === "string" && answer.trim().length > 0;
    return typeof answer === "number";
  });

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!canStart) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<ExamStarted>(`/public/tests/${token}/start`, {
        method: "POST",
        body: JSON.stringify({ participant_name: participantName.trim(), participant_email: participantEmail.trim() }),
      }, false);
      setAttempt(result.attempt);
      setExamQuestions(result.questions);
      setStarted(new Date(result.started_at));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Testi nuk u nis");
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!test) return;
    setLoading(true);
    setError("");
    try {
      setSubmission(await api<TestSubmission>(`/public/tests/${token}/submissions`, {
        method: "POST",
        // An exam is recorded for whoever started it (the attempt carries the name and email); a plain form sends them.
        body: JSON.stringify(exam
          ? { attempt, answers, events: guard.collect() }
          : { participant_name: participantName.trim() || null, participant_email: participantEmail.trim() || null, answers }),
      }, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nuk u dërgua");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-navy">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-5 py-2.5">
          <Link href="/" className="flex min-h-11 items-center gap-3 font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-shell-200"><ShellMark className="h-6 w-6" /></span>
            <Wordmark />
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-4xl px-5 py-8">
        {error && !test ? (
          <div className="card p-8 text-center">
            <h1 className="text-2xl font-bold">Linku nuk hapet</h1>
            <p className="mt-2 text-sm text-red-700">{error}</p>
          </div>
        ) : !test ? (
          <div className="card flex items-center justify-center gap-3 p-8 text-muted" role="status"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Duke ngarkuar…</div>
        ) : submission ? (
          <div className="card p-10 text-center">
            <CheckCircle2 className="mx-auto text-moss" size={42} aria-hidden="true" />
            <h1 className="mt-4 text-3xl font-bold">{test.form_mode ? "Formulari u dërgua" : "Testi u dorëzua"}</h1>
            <p className="mt-3 text-muted">
              {submission.total > 0 ? `Rezultati: ${submission.score}/${submission.total}. ` : ""}
              Faleminderit, përgjigjet u ruajtën.
            </p>
          </div>
        ) : exam && !started ? (
          <form onSubmit={start} className="card p-7 sm:p-9" aria-labelledby="exam-title">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-shell-200 p-3 text-teal"><ClipboardList aria-hidden="true" /></span>
              <div>
                <p className="eyebrow">Test publik</p>
                <h1 id="exam-title" className="mt-2 text-3xl font-bold">{test.title}</h1>
                <p className="mt-2 text-sm text-muted">{test.question_count} pyetje. Pyetjet shfaqen kur ta nisësh.</p>
              </div>
            </div>

            <section aria-labelledby="exam-notice" className="mt-6 rounded-xl border border-line bg-shell-100 p-5">
              <h2 id="exam-notice" className="font-bold">Para se të nisësh</h2>
              <p className="mt-2 text-sm text-slate-700">Ky është një test njohurish. Gjatë tij kjo faqe:</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                <li>regjistron kur del nga kjo faqe ose skedë, dhe sa zgjat;</li>
                <li>regjistron kur ngjit tekst, kur shtyp Print Screen ose provon të printosh; për tekstin e ngjitur ruhet vetëm sa i gjatë ishte, jo vetë teksti;</li>
                <li>nuk të lejon të kopjosh ose të printosh pyetjet, dhe shfaq emrin tënd si filigram mbi to;</li>
                <li>nuk përdor kamerën, mikrofonin ose ekranin tënd.</li>
              </ul>
              <p className="mt-3 text-sm text-slate-700">Këto janë sinjale për organizatorin, jo një vendim: ai i shikon së bashku me përgjigjet. Fshihen bashkë me përgjigjet pas afatit që ka caktuar. <Link href="/privacy" className="font-semibold underline" target="_blank" rel="noreferrer">Më shumë te privatësia</Link>.</p>
            </section>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="form-name" className="label">Emri dhe mbiemri</label>
                <input id="form-name" autoComplete="name" className="input" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Emri yt" required minLength={2} maxLength={160} />
              </div>
              <div>
                <label htmlFor="form-email" className="label">Email</label>
                <input id="form-email" autoComplete="email" className="input" type="email" value={participantEmail} onChange={(event) => setParticipantEmail(event.target.value)} placeholder="email@example.com" required />
              </div>
            </div>

            <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-teal" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
              <span>E kam lexuar dhe jam dakord që këto sinjale të regjistrohen gjatë testit.</span>
            </label>

            {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

            <button className="btn-primary mt-6 w-full" disabled={!canStart || loading}>{loading ? "Duke nisur…" : "Fillo testin"}</button>
          </form>
        ) : (
          <form onSubmit={submit} className="card p-7 sm:p-9 print:hidden">
            {exam && started && <ExamWatermark text={`${participantName.trim()} · ${participantEmail.trim()} · ${started.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`} />}
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-shell-200 p-3 text-teal"><ClipboardList aria-hidden="true" /></span>
              <div>
                <p className="eyebrow">{test.form_mode ? "Formular publik" : "Test publik"}</p>
                <h1 className="mt-2 text-3xl font-bold">{test.title}</h1>
                {test.description && <p className="mt-3 text-sm leading-6 text-slate-600">{test.description}</p>}
              </div>
            </div>

            {exam ? (
              <p role="note" className="mt-6 rounded-xl border border-line bg-shell-100 p-3 text-sm text-slate-700">
                Po përgjigjesh si <strong>{participantName.trim()}</strong>. Dalja nga kjo faqe, ngjitja e tekstit dhe printimi regjistrohen për organizatorin.
              </p>
            ) : (
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="form-name" className="label">Emri</label>
                  <input id="form-name" autoComplete="name" className="input" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Emri yt" />
                </div>
                <div>
                  <label htmlFor="form-email" className="label">Email</label>
                  <input id="form-email" autoComplete="email" className="input" type="email" value={participantEmail} onChange={(event) => setParticipantEmail(event.target.value)} placeholder="email@example.com" />
                </div>
              </div>
            )}

            <div className="mt-8 space-y-5">
              {questions.map((question) => (
                <section key={question.id} aria-labelledby={`q-${question.id}`} className="rounded-xl border border-line bg-shell-100 p-5">
                  <p id={`q-${question.id}`} className={exam ? "select-none font-bold" : "font-bold"}>{question.position}. {question.prompt}</p>
                  {question.question_type === "short_text" ? (
                    <textarea
                      aria-label={`Përgjigjja për pyetjen ${question.position}`}
                      className="input mt-4 min-h-28"
                      placeholder="Shkruaj përgjigjen…"
                      value={typeof answers[question.id] === "string" ? answers[question.id] : ""}
                      onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                      required
                    />
                  ) : (
                    <div className="mt-4 space-y-2">
                      {question.options.map((option, index) => (
                        <label key={index} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white p-3 text-sm hover:border-line-strong hover:bg-shell-100">
                          <input
                            type="radio"
                            className="mt-0.5 h-6 w-6 shrink-0 accent-teal"
                            name={question.id}
                            checked={answers[question.id] === index}
                            onChange={() => setAnswers((current) => ({ ...current, [question.id]: index }))}
                            required
                          />
                          <span className={exam ? "select-none" : undefined}>{option}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>

            {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

            <button className="btn-primary mt-6 w-full" disabled={loading || !allAnswered}>
              {loading ? "Duke dërguar…" : test.form_mode ? "Dërgo formularin" : "Dorëzo testin"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
