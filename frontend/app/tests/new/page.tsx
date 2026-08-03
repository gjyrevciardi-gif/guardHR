"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, FileUp, Plus, Save, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { api, getToken } from "@/lib/api";
import { Test } from "@/lib/types";

type DraftQuestion = { prompt: string; options: string[]; correct_option_index: number };

const emptyQuestion = (): DraftQuestion => ({
  prompt: "",
  options: ["", ""],
  correct_option_index: 0,
});

export default function NewTestPage() {
  const router = useRouter();
  const [title, setTitle] = useState("Nemo Call test");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);
  const [created, setCreated] = useState<Test | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [questionCount, setQuestionCount] = useState(10);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  function updateQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((current) => current.map((question, i) => i === index ? { ...question, ...patch } : question));
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
      const correct_option_index = Math.min(question.correct_option_index, options.length - 1);
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
      setError(err instanceof Error ? err.message : "Nuk u gjenerua testi nga dokumenti");
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload = {
        title,
        description: description.trim() || null,
        questions: questions.map((question) => ({
          prompt: question.prompt,
          options: question.options.map((option) => option.trim()).filter(Boolean),
          correct_option_index: question.correct_option_index,
        })),
      };
      setCreated(await api<Test>("/tests", { method: "POST", body: JSON.stringify(payload) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Testi nuk u krijua");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <Link href="/tests" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-teal">
        <ArrowLeft size={17} /> Testet
      </Link>

      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-black">Krijo test me zgjedhje</h1>
        <p className="mt-2 text-slate-500">
          Krijo manualisht ose ngarko PDF/DOCX/TXT dhe Nemo Call e gjeneron testin automatikisht.
        </p>

        {created ? (
          <section className="card mt-8 p-8 text-center">
            <h2 className="text-2xl font-black">Testi u krijua</h2>
            <p className="mt-2 text-slate-500">{created.title} - {created.question_count} pyetje</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href={`/tests/${created.id}`} className="btn-primary">
                <Eye size={18} /> Review / Edit
              </Link>
              <Link href="/sessions/new" className="btn-secondary">Krijo call me kete test</Link>
              <button onClick={() => { setCreated(null); setQuestions([emptyQuestion()]); }} className="btn-secondary">
                Krijo tjeter
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="card mt-8 p-7">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                  <span className="rounded-2xl bg-teal/10 p-3 text-teal"><FileUp /></span>
                  <div>
                    <h2 className="text-xl font-black">Auto-generate nga dokumenti</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Ngarko PDF, DOCX, TXT ose MD. Tema/titulli dhe pyetjet krijohen automatikisht.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="block text-sm font-semibold text-slate-600">
                    Pyetje
                    <input className="input mt-1 w-28" type="number" min={2} max={50} value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} />
                  </label>
                  <label className="btn-primary cursor-pointer">
                    <FileUp size={17} /> {uploading ? "Duke gjeneruar..." : "Ngarko dokument"}
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
              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                Importi tani provon se pari me i kapur pyetjet ekzistuese nga dokumenti. Nese PDF-i nuk ka answer key, kontrollo pergjigjet ne Review/Edit para se ta perdoresh ne call.
              </p>
            </section>

            <form onSubmit={submit} className="card mt-6 space-y-6 p-7">
              <div>
                <label className="label">Titulli i testit</label>
                <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} />
              </div>

              <div>
                <label className="label">Pershkrimi / instruksionet</label>
                <textarea className="input min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>

              <div className="space-y-4">
                {questions.map((question, questionIndex) => (
                  <section key={questionIndex} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="font-black">Pyetja {questionIndex + 1}</h2>
                      {questions.length > 1 && (
                        <button type="button" onClick={() => setQuestions((current) => current.filter((_, i) => i !== questionIndex))} className="rounded-full p-2 text-red-500 hover:bg-red-50" aria-label="Fshij pyetjen">
                          <Trash2 size={17} />
                        </button>
                      )}
                    </div>

                    <label className="label mt-4">Teksti i pyetjes</label>
                    <textarea className="input min-h-20" value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} required />

                    <div className="mt-4 space-y-2">
                      {question.options.map((option, optionIndex) => (
                        <label key={optionIndex} className="flex items-center gap-3">
                          <input type="radio" name={`correct-${questionIndex}`} checked={question.correct_option_index === optionIndex} onChange={() => updateQuestion(questionIndex, { correct_option_index: optionIndex })} className="accent-teal" />
                          <input className="input" placeholder={`Opsioni ${optionIndex + 1}`} value={option} onChange={(event) => updateOption(questionIndex, optionIndex, event.target.value)} required />
                          <button type="button" onClick={() => removeOption(questionIndex, optionIndex)} className="rounded-full p-2 text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="Fshij opsionin">
                            <Trash2 size={16} />
                          </button>
                        </label>
                      ))}
                    </div>

                    <button type="button" onClick={() => updateQuestion(questionIndex, { options: [...question.options, ""] })} className="btn-secondary mt-3" disabled={question.options.length >= 8}>
                      <Plus size={16} /> Shto opsion
                    </button>
                  </section>
                ))}
              </div>

              <button type="button" onClick={() => setQuestions((current) => [...current, emptyQuestion()])} className="btn-secondary">
                <Plus size={16} /> Shto pyetje
              </button>

              {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

              <button className="btn-primary w-full" disabled={loading}>
                <Save size={18} /> {loading ? "Duke ruajtur..." : "Ruaj testin"}
              </button>
            </form>
          </>
        )}
      </div>
    </AppShell>
  );
}
