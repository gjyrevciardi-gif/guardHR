"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, FileUp, Plus, Save, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ExamOptions } from "@/components/ExamOptions";
import { firstBadAddress, parseInvited } from "@/lib/invited";
import { api } from "@/lib/api";
import { useRequireSession } from "@/lib/session";
import { QuestionType, Test } from "@/lib/types";

type DraftQuestion = {
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

export default function NewTestPage() {
  const [formMode, setFormMode] = useState(false);
  const [title, setTitle] = useState("Test i ri");
  const [description, setDescription] = useState("");
  const [timeLimit, setTimeLimit] = useState("");
  const [shuffle, setShuffle] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState(false);
  const [invited, setInvited] = useState("");
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion(false)]);
  const [created, setCreated] = useState<Test | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [questionCount, setQuestionCount] = useState(10);

  useRequireSession();

  function setMode(nextFormMode: boolean) {
    setFormMode(nextFormMode);
    setTitle(nextFormMode ? "Formular regjistrimi" : "Test i ri");
    setQuestions((current) => current.map((question) => ({
      ...question,
      correct_option_index: nextFormMode || question.question_type === "short_text" ? null : question.correct_option_index ?? 0,
    })));
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

  async function generateFromFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("question_count", String(questionCount));
      setCreated(await api<Test>("/tests/generate-from-file", { method: "POST", body: formData }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Testi nuk u krijua nga dokumenti");
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const invitedList = !formMode && verifyEmail ? parseInvited(invited) : [];
      const badAddress = firstBadAddress(invitedList);
      if (badAddress) throw new Error(`“${badAddress}” nuk duket si adresë email. Kontrollo listën e të ftuarve.`);
      const payload = {
        title,
        description: description.trim() || null,
        form_mode: formMode,
        is_public: true,
        time_limit_minutes: formMode || !timeLimit.trim() ? null : Number(timeLimit),
        shuffle: !formMode && shuffle,
        verify_candidate_email: !formMode && verifyEmail,
        invited_emails: invitedList,
        questions: questions.map((question) => ({
          question_type: question.question_type,
          prompt: question.prompt,
          options: question.question_type === "multiple_choice" ? question.options.map((option) => option.trim()).filter(Boolean) : [],
          correct_option_index: question.question_type === "multiple_choice" ? question.correct_option_index : null,
        })),
      };
      setCreated(await api<Test>("/tests", { method: "POST", body: JSON.stringify(payload) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Testi ose formulari nuk u krijua");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <Link href="/tests" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-teal min-h-11">
        <ArrowLeft size={17} aria-hidden="true" /> Testet dhe formularët
      </Link>

      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold">{formMode ? "Krijo formular publik" : "Krijo test me zgjedhje të shumëfishta"}</h1>
        <p className="mt-2 text-muted">
          Krijo një test për call ose një formular të pavarur që e ndan me link.
        </p>

        {created ? (
          <section className="card mt-8 p-8 text-center">
            <h2 className="text-2xl font-bold">{created.form_mode ? "Formulari u krijua" : "Testi u krijua"}</h2>
            <p className="mt-2 text-muted">{created.title} - {created.question_count} pyetje</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href={`/tests/${created.id}`} className="btn-primary">
                <Eye size={18} aria-hidden="true" /> Shqyrto, ndrysho ose ndaj
              </Link>
              <a href={`/forms/${created.public_token}`} target="_blank" className="btn-secondary">Hap linkun publik</a>
              <button onClick={() => { setCreated(null); setQuestions([emptyQuestion(formMode)]); }} className="btn-secondary">
                Krijo një tjetër
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="card mt-8 p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode(false)}
                  className={`rounded-xl border p-5 text-left transition ${!formMode ? "border-shell-500 bg-shell-100 text-navy" : "border-line bg-white text-slate-600 hover:bg-shell-100"}`}
                >
                  <p className="font-bold">Test me pikë</p>
                  <p className="mt-2 text-sm leading-6">Për pyetje me përgjigje të sakta: llogaritet rezultati dhe e shqyrton pas dorëzimit.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode(true)}
                  className={`rounded-xl border p-5 text-left transition ${formMode ? "border-shell-500 bg-shell-100 text-navy" : "border-line bg-white text-slate-600 hover:bg-shell-100"}`}
                >
                  <p className="font-bold">Formular publik</p>
                  <p className="mt-2 text-sm leading-6">Për regjistrime, mendime, pjesëmarrje, pyetësorë ose pyetje me përgjigje të lirë.</p>
                </button>
              </div>
            </section>

            {!formMode && (
              <section className="card mt-6 p-7">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="rounded-xl bg-teal/10 p-3 text-teal"><FileUp aria-hidden="true" /></span>
                    <div>
                      <h2 className="text-xl font-bold">Krijo pyetjet nga një dokument</h2>
                      <p className="mt-1 text-sm text-muted">
                        Ngarko PDF, DOCX, TXT ose MD. Pyetjet nxirren automatikisht nga teksti.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <label className="block text-sm font-semibold text-slate-600">
                      Pyetje
                      <input className="input mt-1 w-28" type="number" min={2} max={50} value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} />
                    </label>
                    <label className="btn-primary cursor-pointer">
                      <FileUp size={17} aria-hidden="true" /> {uploading ? "Duke krijuar…" : "Ngarko dokument"}
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                        disabled={uploading}
                        onChange={(event) => void generateFromFile(event.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                </div>
                <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  Nëse dokumenti nuk ka çelës përgjigjesh, kontrollo përgjigjet e sakta te faqja e testit para se ta përdorësh në call.
                </p>
              </section>
            )}

            <form onSubmit={submit} className="card mt-6 space-y-6 p-7">
              <div>
                <label htmlFor="test-title" className="label">Titulli</label>
                <input id="test-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} />
              </div>

              <div>
                <label htmlFor="test-description" className="label">Përshkrimi ose udhëzimet</label>
                <textarea id="test-description" className="input min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>

              {!formMode && <ExamOptions timeLimit={timeLimit} onTimeLimit={setTimeLimit} shuffle={shuffle} onShuffle={setShuffle} verifyEmail={verifyEmail} onVerifyEmail={setVerifyEmail} invited={invited} onInvited={setInvited} />}

              <div className="space-y-4">
                {questions.map((question, questionIndex) => (
                  <section key={questionIndex} className="rounded-xl border border-line bg-shell-100 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="font-bold">Pyetja {questionIndex + 1}</h2>
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

              <button className="btn-primary w-full" disabled={loading}>
                <Save size={18} aria-hidden="true" /> {loading ? "Duke ruajtur…" : formMode ? "Ruaj formularin" : "Ruaj testin"}
              </button>
            </form>
          </>
        )}
      </div>
    </AppShell>
  );
}
