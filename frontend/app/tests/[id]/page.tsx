"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clipboard, ClipboardList, Edit3, ExternalLink, Plus, Save, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { dateTime, eventLabels, examSignalSummary, formatDuration, sessionStatusLabels, severityLabels, severityStyles } from "@/lib/format";
import { ExamAttempt, QuestionType, TestAnswer, TestDetail } from "@/lib/types";

type DraftQuestion = {
  id?: string;
  question_type: QuestionType;
  prompt: string;
  options: string[];
  correct_option_index: number | null;
};

const emptyQuestion = (formMode = false): DraftQuestion => ({
  question_type: "multiple_choice",
  prompt: "",
  options: ["", ""],
  correct_option_index: formMode ? null : 0,
});

export default function TestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [test, setTest] = useState<TestDetail | null>(null);
  const [mode, setMode] = useState<"review" | "edit">("review");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formMode, setFormMode] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [timeLimit, setTimeLimit] = useState("");
  const [shuffle, setShuffle] = useState(false);
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion(false)]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const data = await api<TestDetail>(`/tests/${id}`);
    setTest(data);
    setTitle(data.title);
    setDescription(data.description || "");
    setFormMode(data.form_mode);
    setIsPublic(data.is_public);
    setTimeLimit(data.time_limit_minutes ? String(data.time_limit_minutes) : "");
    setShuffle(data.shuffle);
    setQuestions(data.questions.map((question) => ({
      id: question.id,
      question_type: question.question_type,
      prompt: question.prompt,
      options: [...question.options],
      correct_option_index: question.correct_option_index,
    })));
  }, [id]);

  useEffect(() => {
    void load().catch(() => router.replace("/tests"));
  }, [load, router]);

  const standaloneCount = test?.standalone_submissions.length || 0;
  const submittedCount = useMemo(() => (test?.sessions.filter((session) => session.submitted_at).length || 0) + standaloneCount, [standaloneCount, test]);
  const averageScore = useMemo(() => {
    const callSubmitted = test?.sessions.filter((session) => session.score != null && session.total) || [];
    const standaloneSubmitted = test?.standalone_submissions.filter((submission) => submission.total) || [];
    const all = [...callSubmitted, ...standaloneSubmitted];
    if (!all.length) return null;
    const totalPercent = all.reduce((sum, item) => sum + ((item.score || 0) / (item.total || 1)) * 100, 0);
    return Math.round(totalPercent / all.length);
  }, [test]);

  function publicLink() {
    return typeof window === "undefined" || !test ? "" : `${window.location.origin}/forms/${test.public_token}`;
  }

  function updateQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((current) => current.map((question, i) => i === index ? { ...question, ...patch } : question));
  }

  function changeQuestionType(index: number, questionType: QuestionType) {
    updateQuestion(index, {
      question_type: questionType,
      options: questionType === "multiple_choice" ? ["", ""] : [],
      correct_option_index: questionType === "multiple_choice" && !formMode ? 0 : null,
    });
  }

  function updateOption(questionIndex: number, optionIndex: number, value: string) {
    setQuestions((current) => current.map((question, i) => {
      if (i !== questionIndex) return question;
      const options = question.options.map((option, j) => j === optionIndex ? value : option);
      return { ...question, options };
    }));
  }

  function removeOption(questionIndex: number, optionIndex: number) {
    setQuestions((current) => current.map((question, i) => {
      if (i !== questionIndex || question.options.length <= 2) return question;
      const options = question.options.filter((_, j) => j !== optionIndex);
      const correct_option_index = question.correct_option_index == null ? null : Math.min(question.correct_option_index, options.length - 1);
      return { ...question, options, correct_option_index };
    }));
  }

  function changeFormMode(nextFormMode: boolean) {
    setFormMode(nextFormMode);
    setQuestions((current) => current.map((question) => ({
      ...question,
      correct_option_index: nextFormMode || question.question_type === "short_text" ? null : question.correct_option_index ?? 0,
    })));
  }

  async function removeTest() {
    const warning = test && test.sessions.length + test.standalone_submissions.length > 0
      ? "Ky test ka përgjigje të ruajtura; fshihen bashkë me të. Ta fshij përgjithmonë?"
      : "Ta fshij këtë test përgjithmonë?";
    if (!window.confirm(warning)) return;
    try {
      await api(`/tests/${id}`, { method: "DELETE" });
      router.replace("/tests");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Testi nuk u fshi.");
    }
  }

  async function releaseAttempt(attempt: ExamAttempt) {
    if (!window.confirm(`${attempt.participant_name} do të mund ta nisë testin përsëri, me kohën e plotë. Vazhdoj?`)) return;
    setError("");
    try {
      await api(`/tests/${id}/attempts/${attempt.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kandidati nuk u lejua të fillojë përsëri.");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        title,
        description: description.trim() || null,
        form_mode: formMode,
        is_public: isPublic,
        time_limit_minutes: formMode || !timeLimit.trim() ? null : Number(timeLimit),
        shuffle: !formMode && shuffle,
        questions: questions.map((question) => ({
          id: question.id,
          question_type: question.question_type,
          prompt: question.prompt,
          options: question.question_type === "multiple_choice" ? question.options.map((option) => option.trim()).filter(Boolean) : [],
          correct_option_index: question.question_type === "multiple_choice" ? question.correct_option_index : null,
        })),
      };
      const updated = await api<TestDetail>(`/tests/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      setTest(updated);
      setQuestions(updated.questions.map((question) => ({
        id: question.id,
        question_type: question.question_type,
        prompt: question.prompt,
        options: [...question.options],
        correct_option_index: question.correct_option_index,
      })));
      setMessage(`${updated.form_mode ? "Formulari" : "Testi"} u ruajt. Ndryshimet regjistrohen në audit log.`);
      setMode("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ndryshimet nuk u ruajten");
    } finally {
      setSaving(false);
    }
  }

  if (!test) {
    return <AppShell><p role="status" className="text-muted">Duke ngarkuar…</p></AppShell>;
  }

  return (
    <AppShell>
      <Link href="/tests" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-teal min-h-11">
        <ArrowLeft size={17} aria-hidden="true" /> Testet dhe formularët
      </Link>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow">{test.form_mode ? "Formular" : "Test"} · shqyrtim</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{test.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{test.description || "Pa përshkrim"}</p>
        </div>
        <div className="flex rounded-xl border border-line bg-white p-1">
          <button onClick={() => setMode("review")} aria-pressed={mode === "review"} className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition ${mode === "review" ? "bg-shell-200 text-teal" : "text-muted hover:text-navy"}`}>Shqyrto</button>
          <button onClick={() => setMode("edit")} aria-pressed={mode === "edit"} className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition ${mode === "edit" ? "bg-shell-200 text-teal" : "text-muted hover:text-navy"}`}>Ndrysho</button>
          <button onClick={() => void removeTest()} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50" aria-label="Fshi testin">Fshi</button>
        </div>
      </div>

      <section className="card mt-8 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-bold">Linku publik</h2>
            <p className="mt-1 text-sm text-muted">
              Njerëzit e hapin pa llogari dhe plotësojnë vetëm këtë {test.form_mode ? "formular" : "test"}.
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:max-w-2xl">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-slate-100 px-4 py-3 text-xs">{publicLink()}</code>
            <button onClick={() => navigator.clipboard.writeText(publicLink())} className="btn-secondary"><Clipboard size={16} aria-hidden="true" /> Kopjo</button>
            <a href={publicLink()} target="_blank" className="btn-primary">Hap <ExternalLink size={16} aria-hidden="true" /></a>
          </div>
        </div>
        {!test.is_public && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">Linku publik është i mbyllur. Aktivizoje te “Ndrysho”.</p>}
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <Metric label="Pyetje" value={String(test.question_count)} />
        <Metric label="Call-e" value={String(test.sessions.length)} />
        <Metric label="Përgjigje publike" value={String(standaloneCount)} />
        <Metric label="Mesatarja" value={averageScore == null ? "-" : `${averageScore}%`} />
      </div>

      {message && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{message}</p>}
      {error && mode === "review" && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}

      {mode === "review" ? (
        <ReviewPanel test={test} onRelease={releaseAttempt} />
      ) : (
        <form onSubmit={save} className="card mt-8 space-y-6 p-7">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-shell-200 p-3 text-teal"><Edit3 aria-hidden="true" /></span>
            <div>
              <h2 className="text-xl font-bold">Ndrysho {formMode ? "formularin" : "testin"}</h2>
              <p className="mt-1 text-sm text-muted">Ndrysho titullin, pyetjet, opsionet dhe cilësimet e ndarjes.</p>
            </div>
          </div>

          {submittedCount > 0 && (
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>Ka {submittedCount} dorëzim(e). Nëse ndryshon pyetjet ose opsionet, përgjigjet e vjetra lexohen sipas versionit aktual.</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="rounded-xl border border-line bg-white p-4">
              <input type="checkbox" checked={formMode} onChange={(event) => changeFormMode(event.target.checked)} className="mr-2 accent-teal" />
              <span className="font-bold">Formular</span>
              <p className="mt-2 text-xs leading-5 text-muted">Pyetje me përgjigje të lirë ose me zgjedhje, pa pikë të detyrueshme.</p>
            </label>
            <label className="rounded-xl border border-line bg-white p-4">
              <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="mr-2 accent-teal" />
              <span className="font-bold">Linku publik aktiv</span>
              <p className="mt-2 text-xs leading-5 text-muted">Lejo plotësimin nga linku publik.</p>
            </label>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="font-bold">Lloji</p>
              <p className="mt-2 text-sm text-muted">{formMode ? "Formular / pyetësor" : "Test me pikë"}</p>
            </div>
          </div>

          {!formMode && (
            <fieldset className="grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-bold">Për linkun publik</legend>
              <div>
                <label htmlFor="test-time-limit" className="label">Koha në minuta (bosh = pa kufi)</label>
                <input id="test-time-limit" className="input" type="number" inputMode="numeric" min={1} max={480} step={1} value={timeLimit} onChange={(event) => setTimeLimit(event.target.value)} aria-describedby="test-time-limit-help" />
                <p id="test-time-limit-help" className="mt-2 text-xs leading-5 text-muted">Numërohet nga çasti që kandidati e nis, edhe nëse rihap faqen. Një dorëzim i vonuar pranohet dhe shënohet; pas kohës nuk jepen më pyetjet.</p>
              </div>
              <label className="cursor-pointer rounded-xl border border-line p-4">
                <input type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} className="mr-2 accent-teal" />
                <span className="font-bold">Përzie pyetjet dhe opsionet</span>
                <span className="mt-2 block text-xs leading-5 text-muted">Çdo kandidat i sheh në renditje tjetër, kështu që “pyetja 3 është B” nuk i hyn punës tjetrit. Pikët llogariten sipas çelësit tënd.</span>
              </label>
            </fieldset>
          )}

          <div>
            <label htmlFor="test-title" className="label">Titulli</label>
            <input id="test-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} />
          </div>

          <div>
            <label htmlFor="test-description" className="label">Përshkrimi ose udhëzimet</label>
            <textarea id="test-description" className="input min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>

          <div className="space-y-4">
            {questions.map((question, questionIndex) => (
              <section key={question.id || questionIndex} className="rounded-xl border border-line bg-shell-100 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-bold">Pyetja {questionIndex + 1}</h3>
                  <div className="flex items-center gap-2">
                    <select aria-label={`Lloji i pyetjes ${questionIndex + 1}`} className="input min-h-11 py-2" value={question.question_type} onChange={(event) => changeQuestionType(questionIndex, event.target.value as QuestionType)}>
                      <option value="multiple_choice">Zgjedhje e shumëfishtë</option>
                      <option value="short_text">Përgjigje e shkurtër</option>
                    </select>
                    {questions.length > 1 && (
                      <button type="button" onClick={() => setQuestions((current) => current.filter((_, i) => i !== questionIndex))} className="flex h-11 w-11 items-center justify-center rounded-xl text-red-700 hover:bg-red-50" aria-label={`Fshij pyetjen ${questionIndex + 1}`}>
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                </div>

                <label htmlFor={`question-${questionIndex}-prompt`} className="label mt-4">Teksti i pyetjes</label>
                <textarea id={`question-${questionIndex}-prompt`} className="input min-h-20" value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} required />

                {question.question_type === "multiple_choice" ? (
                  <>
                    <div className="mt-4 space-y-2">
                      {question.options.map((option, optionIndex) => (
                        <div key={optionIndex} className="flex items-center gap-3">
                          {!formMode && (
                            <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center"><input type="radio" aria-label={`Opsioni ${optionIndex + 1} është përgjigjja e saktë`} name={`correct-${questionIndex}`} checked={question.correct_option_index === optionIndex} onChange={() => updateQuestion(questionIndex, { correct_option_index: optionIndex })} className="h-6 w-6 accent-teal" /></label>
                          )}
                          <input className="input" aria-label={`Opsioni ${optionIndex + 1}`} placeholder={`Opsioni ${optionIndex + 1}`} value={option} onChange={(event) => updateOption(questionIndex, optionIndex, event.target.value)} required />
                          <button type="button" onClick={() => removeOption(questionIndex, optionIndex)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-red-50 hover:text-red-700" aria-label={`Fshij opsionin ${optionIndex + 1}`}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => updateQuestion(questionIndex, { options: [...question.options, ""], correct_option_index: question.correct_option_index ?? (formMode ? null : 0) })} className="btn-secondary mt-3" disabled={question.options.length >= 8}>
                      <Plus size={16} aria-hidden="true" /> Shto opsion
                    </button>
                  </>
                ) : (
                  <p className="mt-4 rounded-xl bg-white p-3 text-sm text-muted">Pjesëmarrësi do të shkruajë përgjigje të lirë.</p>
                )}
              </section>
            ))}
          </div>

          <button type="button" onClick={() => setQuestions((current) => [...current, emptyQuestion(formMode)])} className="btn-secondary">
            <Plus size={16} aria-hidden="true" /> Shto pyetje
          </button>

          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button className="btn-primary w-full" disabled={saving}>
            <Save size={18} aria-hidden="true" /> {saving ? "Duke ruajtur…" : "Ruaj ndryshimet"}
          </button>
        </form>
      )}
    </AppShell>
  );
}

function ReviewPanel({ test, onRelease }: { test: TestDetail; onRelease: (attempt: ExamAttempt) => void }) {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.35fr]">
      <section className="card p-6">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-shell-200 p-3 text-teal"><ClipboardList aria-hidden="true" /></span>
          <div>
            <h2 className="text-xl font-bold">{test.form_mode ? "Pyetjet e formularit" : "Çelësi i përgjigjeve"}</h2>
            <p className="mt-1 text-sm text-muted">Kjo shihet vetëm nga host-et.</p>
          </div>
        </div>
        <div className="mt-5 space-y-4">
          {test.questions.map((question) => (
            <div key={question.id} className="rounded-xl border border-line bg-shell-100 p-4">
              <p className="font-bold">{question.position}. {question.prompt}</p>
              {question.question_type === "short_text" ? (
                <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-600">Përgjigje me tekst</p>
              ) : question.correct_option_index == null ? (
                <p className="mt-3 rounded-xl bg-shell-100 px-3 py-2 text-sm font-semibold text-teal">Zgjedhje e shumëfishtë, pa çelës përgjigjesh</p>
              ) : (
                <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                  E saktë: {question.options[question.correct_option_index]}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">Përgjigje publike</h2>
        {!test.form_mode && <p className="text-sm text-muted">Sinjalet vijnë nga browser-i i kandidatit dhe janë për t&apos;u parë, jo një vendim. Mungesa e tyre nuk provon se nuk ndodhi asgjë: një browser i modifikuar mund t&apos;i heqë, dhe screenshot ose foto e ekranit nuk zbulohet.</p>}
        {!test.form_mode && (test.time_limit_minutes || test.shuffle) && (
          <p className="text-sm text-muted">
            {test.time_limit_minutes ? `Koha: ${test.time_limit_minutes} minuta nga nisja.` : ""} {test.shuffle ? "Pyetjet dhe opsionet përzihen për çdo kandidat." : ""}
          </p>
        )}
        {test.unfinished_attempts.length > 0 && (
          <section className="card p-6" aria-labelledby="unfinished-title">
            <h3 id="unfinished-title" className="text-lg font-bold">Kanë nisur, pa dorëzuar ({test.unfinished_attempts.length})</h3>
            <p className="mt-1 text-sm text-muted">Mund të jenë ende duke u përgjigjur, ose e kanë braktisur. Kush ka kaluar kohën nuk i merr më pyetjet; “Lejo përsëri” i jep një fillim të ri.</p>
            <ul className="mt-4 divide-y divide-line">
              {test.unfinished_attempts.map((attempt) => (
                <li key={attempt.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">{attempt.participant_name}</p>
                    <p className="text-sm text-muted">{attempt.participant_email} · nisur {dateTime(attempt.started_at)}{attempt.expired ? " · koha ka mbaruar" : ""}</p>
                  </div>
                  <button type="button" onClick={() => onRelease(attempt)} className="btn-secondary" aria-label={`Lejo ${attempt.participant_name} të fillojë përsëri`}>Lejo përsëri</button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {test.standalone_submissions.length === 0 ? (
          <div className="card p-8 text-center">
            <ClipboardList className="mx-auto text-teal" size={34} aria-hidden="true" />
            <h3 className="mt-4 text-lg font-bold">Ende nuk ka përgjigje publike</h3>
            <p className="mt-2 text-sm text-muted">Ndaje linkun publik për të mbledhur përgjigje pa call.</p>
          </div>
        ) : (
          test.standalone_submissions.map((submission) => (
            <article key={submission.id} className="card p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold">{submission.participant_name || "Anonim"}</h3>
                  <p className="text-sm text-muted">{submission.participant_email || "pa email"} · {dateTime(submission.submitted_at)}</p>
                </div>
                <span className="chip bg-shell-100 text-slate-700 ring-line">
                  {submission.total > 0 ? `${submission.score}/${submission.total}` : "Formular"}
                </span>
              </div>
              {(submission.duration_seconds != null || submission.over_limit_seconds != null) && (
                <ul className="mt-4 flex flex-wrap gap-2" aria-label="Koha e testit">
                  {submission.duration_seconds != null && <li className="chip bg-shell-100 text-slate-700 ring-line">Zgjati {formatDuration(submission.duration_seconds)}</li>}
                  {submission.over_limit_seconds != null && <li className="chip bg-amber-50 text-amber-900 ring-amber-900/25">{formatDuration(submission.over_limit_seconds)} mbi kufirin e kohës</li>}
                </ul>
              )}
              {submission.events.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-2" aria-label="Sinjale gjatë testit">
                  {examSignalSummary(submission.events).map((signal) => (
                    <li key={signal.key} className={`chip ${severityStyles[signal.severity]}`}>
                      <span className="sr-only">{severityLabels[signal.severity]}: </span>{signal.label}
                    </li>
                  ))}
                </ul>
              )}
              <AnswersList test={test} answers={submission.answers} />
            </article>
          ))
        )}

        <h2 className="pt-4 text-xl font-bold">Përgjigjet nga call-et</h2>
        {test.sessions.length === 0 ? (
          <div className="card p-8 text-center">
            <ClipboardList className="mx-auto text-teal" size={34} aria-hidden="true" />
            <h3 className="mt-4 text-lg font-bold">Ende nuk është përdorur në call</h3>
            <p className="mt-2 text-sm text-muted">Krijo një call dhe zgjidh këtë test; përgjigjet shfaqen këtu.</p>
            <Link href="/sessions/new" className="btn-primary mt-5">Krijo call</Link>
          </div>
        ) : (
          test.sessions.map((session) => (
            <article key={session.session_id} className="card p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-navy">{session.candidate_name}</h3>
                    <StatusBadge status={session.review_status} />
                  </div>
                  <p className="mt-1 text-sm text-muted">{session.session_title} · {session.candidate_email || "pa email"}</p>
                </div>
                <Link href={`/sessions/${session.session_id}`} className="btn-secondary">
                  Hap call-in <ExternalLink size={16} aria-hidden="true" />
                </Link>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metric label="Gjendja" value={sessionStatusLabels[session.status] ?? session.status} />
                <Metric label="Sinjale" value={String(session.event_count)} />
                <Metric label="Pikë" value={session.score == null || !session.total ? "-" : `${session.score}/${session.total}`} />
              </div>

              {Object.keys(session.event_summary).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(session.event_summary).map(([type, count]) => (
                    <span key={type} className="chip bg-amber-50 text-amber-900 ring-amber-900/25">
                      {eventLabels[type] || type}: {count}
                    </span>
                  ))}
                </div>
              )}

              {session.submitted_at && session.answers ? (
                <div className="mt-5">
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 size={17} aria-hidden="true" /> Dorëzuar: {dateTime(session.submitted_at)}
                  </div>
                  <AnswersList test={test} answers={session.answers} />
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                  Pjesëmarrësi ende nuk e ka dorëzuar.
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function AnswersList({ test, answers }: { test: TestDetail; answers: Record<string, TestAnswer> }) {
  return (
    <div className="mt-4 space-y-3">
      {test.questions.map((question) => {
        const answer = answers[question.id];
        const correct = question.question_type === "multiple_choice" && question.correct_option_index != null && answer === question.correct_option_index;
        return (
          <div key={question.id} className={`rounded-xl border p-4 ${correct ? "border-emerald-200 bg-emerald-50/60" : "border-line bg-shell-100"}`}>
            <p className="font-semibold">{question.position}. {question.prompt}</p>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <p>
                <span className="font-bold text-muted">Përgjigja:</span>{" "}
                {formatAnswer(question, answer)}
              </p>
              {question.question_type === "multiple_choice" && question.correct_option_index != null && (
                <p>
                  <span className="font-bold text-muted">E saktë:</span>{" "}
                  {question.options[question.correct_option_index]}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatAnswer(question: TestDetail["questions"][number], answer: TestAnswer | undefined) {
  if (answer == null || answer === "") return "Pa përgjigje";
  if (question.question_type === "short_text") return String(answer);
  const index = typeof answer === "number" ? answer : Number(answer);
  return question.options[index] || `Opsioni ${index + 1}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-2xl font-bold tabular-nums text-navy">{value}</p>
      <p className="mt-1 text-xs font-semibold text-muted">{label}</p>
    </div>
  );
}
