"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, ClipboardList, Loader2 } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { clearDraft, fitDraft, loadDraft, saveDraft } from "@/lib/examDraft";
import { clock } from "@/lib/format";
import { ExamStarted, Test, TestAnswer, TestQuestion, TestSubmission } from "@/lib/types";
import { useExamGuard } from "@/lib/useExamGuard";
import { EmailVerification } from "@/components/EmailVerification";
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
  const [attemptName, setAttemptName] = useState("");
  // A test that checks email: once a code is on its way the name and address stay put, because the code belongs to them.
  const [codeSent, setCodeSent] = useState(false);
  const [verifyKey, setVerifyKey] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const autoSubmitted = useRef(false);
  // Saving the answers on the server too (see the effect below).
  const answersRef = useRef<Record<string, TestAnswer>>({});
  const lastSaved = useRef("{}");
  const saveTimer = useRef<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
  const [saveRound, setSaveRound] = useState(0);
  const timeUp = remaining === 0;
  // A test (not a plain form) is an exam: it needs to know who is sitting it, tells them what is recorded, and only
  // then does the server send the questions (the link alone does not carry them).
  const exam = test ? !test.form_mode : false;
  const verifies = exam && !!test?.verify_candidate_email; // the host asked for an email code before the questions
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

  /** The server started the exam, or picked the attempt up again: show the questions. */
  function begin(result: ExamStarted) {
    setAttempt(result.attempt);
    setExamQuestions(result.questions);
    // Picking an attempt up again brings back what this tab saved; a tab that has nothing (another device, a new tab)
    // takes what the server has, which it only hands to someone who proved the mailbox.
    const local = loadDraft(result.attempt, result.questions);
    const onServer = fitDraft(result.draft, result.questions);
    lastSaved.current = JSON.stringify(onServer);
    setAnswers(Object.keys(local).length > 0 ? local : onServer);
    setAttemptName(result.participant_name);
    // The server's count of seconds left, so a wrong clock on this device cannot shorten or stretch the time.
    setDeadline(result.seconds_left == null ? null : Date.now() + result.seconds_left * 1000);
    setStarted(new Date(result.started_at));
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!canStart || verifies) return; // a test that checks email starts from the code, never from this form
    setLoading(true);
    setError("");
    try {
      begin(await api<ExamStarted>(`/public/tests/${token}/start`, {
        method: "POST",
        body: JSON.stringify({ participant_name: participantName.trim(), participant_email: participantEmail.trim() }),
      }, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Testi nuk u nis");
    } finally {
      setLoading(false);
    }
  }

  const send = useCallback(async () => {
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
  }, [test, token, exam, attempt, answers, guard, participantName, participantEmail]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  // Keep the answers in this tab until they are submitted, so a refresh or a crash does not lose them.
  useEffect(() => {
    if (!exam || !attempt) return;
    if (submission) clearDraft(attempt);
    else saveDraft(attempt, answers);
  }, [exam, attempt, answers, submission]);

  // Also keep them on the server, at most every few seconds while the candidate works, so a crash or another device loses
  // nothing and the organiser can see how far they are. A failed save is not fatal: this tab still has the answers.
  useEffect(() => {
    answersRef.current = answers;
    if (!exam || !attempt) return;
    if (submission) {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      return;
    }
    if (JSON.stringify(answers) === lastSaved.current || saveTimer.current !== null) return;
    saveTimer.current = window.setTimeout(async () => {
      saveTimer.current = null;
      const sent = JSON.stringify(answersRef.current);
      try {
        await api(`/public/tests/${token}/attempts/${attempt}/draft`, { method: "PUT", body: JSON.stringify({ answers: answersRef.current }) }, false);
        lastSaved.current = sent;
        setSaveState("saved");
      } catch (err) {
        setSaveState("failed");
        // A refusal (the attempt was released, or already submitted elsewhere) will not change on a retry; a network error or a busy server may.
        if (err instanceof ApiError && err.status < 500 && err.status !== 429) lastSaved.current = sent;
      }
      setSaveRound((round) => round + 1); // whatever was typed while this was in flight goes next, and a failed save is retried
    }, 4000);
  }, [exam, attempt, answers, submission, token, saveRound]);
  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
  }, []);

  // The countdown. Only an exam with a time limit has a deadline.
  useEffect(() => {
    if (deadline === null || submission) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, submission]);

  // When it reaches zero, what the candidate has answered so far goes in, complete or not.
  useEffect(() => {
    if (timeUp && !submission && !autoSubmitted.current) {
      autoSubmitted.current = true;
      void send();
    }
  }, [timeUp, submission, send]);

  const milestone = remaining === null ? "" : remaining === 0 ? "Koha mbaroi" : remaining <= 60 ? "Mbetet një minutë" : remaining <= 300 ? "Mbeten pesë minuta" : "";

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
          <div className="card p-7 sm:p-9">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-shell-200 p-3 text-teal"><ClipboardList aria-hidden="true" /></span>
              <div>
                <p className="eyebrow">Test publik</p>
                <h1 id="exam-title" className="mt-2 text-3xl font-bold">{test.title}</h1>
                <p className="mt-2 text-sm text-muted">
                  {test.question_count} pyetje{test.time_limit_minutes ? `, ${test.time_limit_minutes} minuta` : ""}. Pyetjet shfaqen {verifies ? "pasi të shkruash kodin që të vjen me email" : "kur ta nisësh"}.
                </p>
              </div>
            </div>

            <section aria-labelledby="exam-notice" className="mt-6 rounded-xl border border-line bg-shell-100 p-5">
              <h2 id="exam-notice" className="font-bold">Para se të nisësh</h2>
              <p className="mt-2 text-sm text-slate-700">Ky është një test njohurish. Gjatë tij kjo faqe:</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                <li>regjistron kur del nga kjo faqe ose skedë, dhe sa zgjat;</li>
                <li>regjistron kur ngjit tekst, kur shtyp Print Screen ose provon të printosh; për tekstin e ngjitur ruhet vetëm sa i gjatë ishte, jo vetë teksti;</li>
                <li>nuk të lejon të kopjosh ose të printosh pyetjet, dhe shfaq emrin tënd si filigram mbi to;</li>
                {test.time_limit_minutes && <li>ka kohë të kufizuar prej {test.time_limit_minutes} minutash nga çasti që e nis: koha vazhdon edhe nëse e mbyll ose e rifreskon faqen, dhe kur mbaron dërgohet ajo që ke përgjigjur;</li>}
                {verifies && <li>të dërgon një kod 6-shifror te email-i që jep, për të provuar se e lexon; kodi vlen 10 minuta dhe nuk ruhet i hapur. Nëse e rifreskon faqen, kërkon një kod të ri për të vazhduar;</li>}
                <li>i ruan përgjigjet që shkruan, në këtë skedë të browser-it dhe te serveri, që të mos i humbasësh nëse rifreskon faqen ose ndërron pajisje; organizatori sheh vetëm sa pyetje ke përgjigjur, jo përgjigjet, derisa t&apos;i dorëzosh;</li>
                <li>nuk përdor kamerën, mikrofonin ose ekranin tënd.</li>
              </ul>
              <p className="mt-3 text-sm text-slate-700">Këto janë sinjale për organizatorin, jo një vendim: ai i shikon së bashku me përgjigjet. Fshihen bashkë me përgjigjet pas afatit që ka caktuar. <Link href="/privacy" className="font-semibold underline" target="_blank" rel="noreferrer">Më shumë te privatësia</Link>.</p>
            </section>

            <form onSubmit={start} aria-labelledby="exam-title">
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="form-name" className="label">Emri dhe mbiemri</label>
                  <input id="form-name" autoComplete="name" className="input" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Emri yt" required minLength={2} maxLength={160} readOnly={codeSent} />
                </div>
                <div>
                  <label htmlFor="form-email" className="label">Email</label>
                  <input id="form-email" autoComplete="email" className="input" type="email" value={participantEmail} onChange={(event) => setParticipantEmail(event.target.value)} placeholder="email@example.com" required readOnly={codeSent} />
                </div>
              </div>

              <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-teal" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={codeSent} />
                <span>E kam lexuar dhe jam dakord që këto sinjale të regjistrohen gjatë testit.</span>
              </label>

              {!verifies && error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

              {!verifies && <button className="btn-primary mt-6 w-full" disabled={!canStart || loading}>{loading ? "Duke nisur…" : "Fillo testin"}</button>}
            </form>

            {verifies && (
              <div className="mt-6 rounded-xl border border-line p-5">
                {canStart ? (
                  <EmailVerification<ExamStarted>
                    key={verifyKey}
                    sendPath={`/public/tests/${token}/verification`}
                    sendBody={{ participant_email: participantEmail.trim() }}
                    confirmPath={`/public/tests/${token}/verification/confirm`}
                    confirmBody={{ participant_name: participantName.trim(), participant_email: participantEmail.trim() }}
                    emailHint={participantEmail.trim()}
                    requester="Organizatori"
                    onSent={() => setCodeSent(true)}
                    onVerified={begin}
                  />
                ) : (
                  <p className="text-sm text-muted">Shkruaj emrin dhe email-in dhe pranoje njoftimin më sipër; pastaj të dërgojmë një kod te ai email.</p>
                )}
                {codeSent && (
                  <button type="button" className="mt-3 min-h-11 w-full rounded-full text-xs font-semibold text-slate-600 underline-offset-2 hover:underline" onClick={() => { setCodeSent(false); setVerifyKey((key) => key + 1); }}>
                    Ndrysho emrin ose email-in
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={submit} noValidate={timeUp} className="card p-7 sm:p-9 print:hidden">
            {exam && started && <ExamWatermark text={`${attemptName || participantName.trim()} · ${participantEmail.trim().toLowerCase()} · ${started.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`} />}
            {exam && remaining !== null && (
              <div className="sticky top-0 z-10 mb-6 flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
                <span className="text-sm font-semibold text-muted">{timeUp ? "Koha mbaroi" : "Koha e mbetur"}</span>
                <span role="timer" aria-live="off" className={`font-mono text-lg font-bold tabular-nums ${remaining <= 60 ? "text-red-700" : "text-navy"}`}>{clock(remaining)}</span>
              </div>
            )}
            <p role="status" className="sr-only">{milestone}</p>
            <p role="status" className="sr-only">{saveState === "failed" ? "Përgjigjet nuk u ruajtën te serveri; mbeten në këtë skedë." : ""}</p>
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
                Po përgjigjesh si <strong>{attemptName || participantName.trim()}</strong>. Dalja nga kjo faqe, ngjitja e tekstit dhe printimi regjistrohen për organizatorin.
                {saveState !== "idle" && <span className="mt-1 block text-xs text-muted">{saveState === "saved" ? "Përgjigjet u ruajtën te serveri." : "Nuk u ruajtën te serveri; përgjigjet mbeten në këtë skedë."}</span>}
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

            <button className="btn-primary mt-6 w-full" disabled={loading || (!allAnswered && !timeUp)}>
              {loading ? "Duke dërguar…" : test.form_mode ? "Dërgo formularin" : "Dorëzo testin"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
