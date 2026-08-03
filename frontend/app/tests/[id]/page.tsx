"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clipboard, ClipboardList, Edit3, ExternalLink, Plus, Save, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { api, getToken } from "@/lib/api";
import { dateTime, eventLabels } from "@/lib/format";
import { QuestionType, TestAnswer, TestDetail } from "@/lib/types";

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
    setQuestions(data.questions.map((question) => ({
      id: question.id,
      question_type: question.question_type,
      prompt: question.prompt,
      options: [...question.options],
      correct_option_index: question.correct_option_index,
    })));
  }, [id]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
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
      setMessage(`${updated.form_mode ? "Formulari" : "Testi"} u ruajt. Ndryshimet jane ne audit log.`);
      setMode("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ndryshimet nuk u ruajten");
    } finally {
      setSaving(false);
    }
  }

  if (!test) {
    return <AppShell><p>Duke ngarkuar...</p></AppShell>;
  }

  return (
    <AppShell>
      <Link href="/tests" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-teal">
        <ArrowLeft size={17} /> Testet & formularet
      </Link>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-teal">{test.form_mode ? "Form review center" : "Test review center"}</p>
          <h1 className="mt-2 text-3xl font-black text-navy">{test.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{test.description || "Pa pershkrim"}</p>
        </div>
        <div className="flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
          <button onClick={() => setMode("review")} className={`rounded-full px-4 py-2 text-sm font-bold transition ${mode === "review" ? "bg-sky-100 text-teal" : "text-slate-500 hover:text-navy"}`}>Review</button>
          <button onClick={() => setMode("edit")} className={`rounded-full px-4 py-2 text-sm font-bold transition ${mode === "edit" ? "bg-sky-100 text-teal" : "text-slate-500 hover:text-navy"}`}>Edit</button>
        </div>
      </div>

      <section className="card mt-8 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-black">Public share link</h2>
            <p className="mt-1 text-sm text-slate-500">
              Njerzit hyjne pa account dhe plotesojne vetem kete {test.form_mode ? "formular" : "test"}.
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:max-w-2xl">
            <code className="min-w-0 flex-1 truncate rounded-2xl bg-slate-100 px-4 py-3 text-xs">{publicLink()}</code>
            <button onClick={() => navigator.clipboard.writeText(publicLink())} className="btn-secondary"><Clipboard size={16} /> Copy</button>
            <a href={publicLink()} target="_blank" className="btn-primary">Open <ExternalLink size={16} /></a>
          </div>
        </div>
        {!test.is_public && <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">Linku publik eshte i mbyllur. Aktivizoje te Edit.</p>}
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <Metric label="Pyetje" value={String(test.question_count)} />
        <Metric label="Calls" value={String(test.sessions.length)} />
        <Metric label="Public submissions" value={String(standaloneCount)} />
        <Metric label="Mesatarja" value={averageScore == null ? "-" : `${averageScore}%`} />
      </div>

      {message && <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{message}</p>}

      {mode === "review" ? (
        <ReviewPanel test={test} />
      ) : (
        <form onSubmit={save} className="card mt-8 space-y-6 p-7">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-sky-100 p-3 text-teal"><Edit3 /></span>
            <div>
              <h2 className="text-xl font-black">Edito {formMode ? "formularin" : "testin"}</h2>
              <p className="mt-1 text-sm text-slate-500">Ndrysho titullin, pyetjet, opsionet dhe share settings.</p>
            </div>
          </div>

          {submittedCount > 0 && (
            <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <p>Ka {submittedCount} submission. Nese ndryshon pyetjet/opsionet, review i vjeter lexohet sipas versionit aktual.</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="rounded-3xl border border-slate-200 bg-white p-4">
              <input type="checkbox" checked={formMode} onChange={(event) => changeFormMode(event.target.checked)} className="mr-2 accent-teal" />
              <span className="font-bold">Formular mode</span>
              <p className="mt-2 text-xs leading-5 text-slate-500">Pyetje te lira ose MCQ pa score te detyrueshem.</p>
            </label>
            <label className="rounded-3xl border border-slate-200 bg-white p-4">
              <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="mr-2 accent-teal" />
              <span className="font-bold">Public link active</span>
              <p className="mt-2 text-xs leading-5 text-slate-500">Lejo plotesim nga linku publik.</p>
            </label>
            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <p className="font-bold">Mode</p>
              <p className="mt-2 text-sm text-slate-500">{formMode ? "Formular / survey" : "Test me score"}</p>
            </div>
          </div>

          <div>
            <label className="label">Titulli</label>
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} />
          </div>

          <div>
            <label className="label">Pershkrimi / instruksionet</label>
            <textarea className="input min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>

          <div className="space-y-4">
            {questions.map((question, questionIndex) => (
              <section key={question.id || questionIndex} className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-black">Pyetja {questionIndex + 1}</h3>
                  <div className="flex items-center gap-2">
                    <select className="input py-2" value={question.question_type} onChange={(event) => changeQuestionType(questionIndex, event.target.value as QuestionType)}>
                      <option value="multiple_choice">Multiple choice</option>
                      <option value="short_text">Short text</option>
                    </select>
                    {questions.length > 1 && (
                      <button type="button" onClick={() => setQuestions((current) => current.filter((_, i) => i !== questionIndex))} className="rounded-full p-2 text-red-500 hover:bg-red-50" aria-label="Fshij pyetjen">
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                </div>

                <label className="label mt-4">Teksti i pyetjes</label>
                <textarea className="input min-h-20" value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} required />

                {question.question_type === "multiple_choice" ? (
                  <>
                    <div className="mt-4 space-y-2">
                      {question.options.map((option, optionIndex) => (
                        <label key={optionIndex} className="flex items-center gap-3">
                          {!formMode && (
                            <input type="radio" name={`correct-${questionIndex}`} checked={question.correct_option_index === optionIndex} onChange={() => updateQuestion(questionIndex, { correct_option_index: optionIndex })} className="accent-teal" />
                          )}
                          <input className="input" placeholder={`Opsioni ${optionIndex + 1}`} value={option} onChange={(event) => updateOption(questionIndex, optionIndex, event.target.value)} required />
                          <button type="button" onClick={() => removeOption(questionIndex, optionIndex)} className="rounded-full p-2 text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="Fshij opsionin">
                            <Trash2 size={16} />
                          </button>
                        </label>
                      ))}
                    </div>
                    <button type="button" onClick={() => updateQuestion(questionIndex, { options: [...question.options, ""], correct_option_index: question.correct_option_index ?? (formMode ? null : 0) })} className="btn-secondary mt-3" disabled={question.options.length >= 8}>
                      <Plus size={16} /> Shto opsion
                    </button>
                  </>
                ) : (
                  <p className="mt-4 rounded-2xl bg-white p-3 text-sm text-slate-500">Pjesemarresi do shkruaje pergjigje te lire.</p>
                )}
              </section>
            ))}
          </div>

          <button type="button" onClick={() => setQuestions((current) => [...current, emptyQuestion(formMode)])} className="btn-secondary">
            <Plus size={16} /> Shto pyetje
          </button>

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button className="btn-primary w-full" disabled={saving}>
            <Save size={18} /> {saving ? "Duke ruajtur..." : "Ruaj ndryshimet"}
          </button>
        </form>
      )}
    </AppShell>
  );
}

function ReviewPanel({ test }: { test: TestDetail }) {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.35fr]">
      <section className="card p-6">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl bg-sky-100 p-3 text-teal"><ClipboardList /></span>
          <div>
            <h2 className="text-xl font-black">{test.form_mode ? "Form questions" : "Answer key"}</h2>
            <p className="mt-1 text-sm text-slate-500">Kjo shihet vetem nga host/admin.</p>
          </div>
        </div>
        <div className="mt-5 space-y-4">
          {test.questions.map((question) => (
            <div key={question.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-bold">{question.position}. {question.prompt}</p>
              {question.question_type === "short_text" ? (
                <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-600">Pergjigje tekst</p>
              ) : question.correct_option_index == null ? (
                <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-sm font-semibold text-teal">Multiple choice pa answer key</p>
              ) : (
                <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                  Sakte: {question.options[question.correct_option_index]}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-black">Public submissions</h2>
        {test.standalone_submissions.length === 0 ? (
          <div className="card p-8 text-center">
            <ClipboardList className="mx-auto text-teal" size={34} />
            <h3 className="mt-4 text-lg font-black">Ende nuk ka public submissions</h3>
            <p className="mt-2 text-sm text-slate-500">Shperndaje linkun publik per me mbledh pergjigje pa call.</p>
          </div>
        ) : (
          test.standalone_submissions.map((submission) => (
            <article key={submission.id} className="card p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-black">{submission.participant_name || "Anonim"}</h3>
                  <p className="text-sm text-slate-500">{submission.participant_email || "pa email"} - {dateTime(submission.submitted_at)}</p>
                </div>
                <span className="rounded-full bg-sky-50 px-3 py-1 text-sm font-bold text-teal">
                  {submission.total > 0 ? `${submission.score}/${submission.total}` : "Form"}
                </span>
              </div>
              <AnswersList test={test} answers={submission.answers} />
            </article>
          ))
        )}

        <h2 className="pt-4 text-xl font-black">Call submissions</h2>
        {test.sessions.length === 0 ? (
          <div className="card p-8 text-center">
            <ClipboardList className="mx-auto text-teal" size={34} />
            <h3 className="mt-4 text-lg font-black">Ende nuk eshte perdorur ne call</h3>
            <p className="mt-2 text-sm text-slate-500">Krijo nje call dhe zgjidhe kete test per te pare submissions ketu.</p>
            <Link href="/sessions/new" className="btn-primary mt-5">Krijo call</Link>
          </div>
        ) : (
          test.sessions.map((session) => (
            <article key={session.session_id} className="card p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-black text-navy">{session.candidate_name}</h3>
                    <StatusBadge status={session.review_status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{session.session_title} - {session.candidate_email || "pa email"}</p>
                </div>
                <Link href={`/sessions/${session.session_id}`} className="btn-secondary">
                  Timeline <ExternalLink size={16} />
                </Link>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metric label="Status" value={session.status.replace("_", " ")} />
                <Metric label="Evente" value={String(session.event_count)} />
                <Metric label="Score" value={session.score == null || !session.total ? "-" : `${session.score}/${session.total}`} />
              </div>

              {Object.keys(session.event_summary).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(session.event_summary).map(([type, count]) => (
                    <span key={type} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                      {eventLabels[type] || type}: {count}
                    </span>
                  ))}
                </div>
              )}

              {session.submitted_at && session.answers ? (
                <div className="mt-5">
                  <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 size={17} /> Dorezuar: {dateTime(session.submitted_at)}
                  </div>
                  <AnswersList test={test} answers={session.answers} />
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                  Pjesemarresi ende nuk e ka dorezuar.
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
          <div key={question.id} className={`rounded-2xl border p-4 ${correct ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50/80"}`}>
            <p className="font-semibold">{question.position}. {question.prompt}</p>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <p>
                <span className="font-bold text-slate-500">Pergjigja:</span>{" "}
                {formatAnswer(question, answer)}
              </p>
              {question.question_type === "multiple_choice" && question.correct_option_index != null && (
                <p>
                  <span className="font-bold text-slate-500">Sakte:</span>{" "}
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
  if (answer == null || answer === "") return "Pa pergjigje";
  if (question.question_type === "short_text") return String(answer);
  const index = typeof answer === "number" ? answer : Number(answer);
  return question.options[index] || `Opsioni ${index + 1}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur-xl">
      <p className="text-2xl font-black text-navy capitalize">{value}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">{label}</p>
    </div>
  );
}
