"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
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
  const [title, setTitle] = useState("Test teknik");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);
  const [created, setCreated] = useState<Test | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  return (
    <AppShell>
      <Link href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
        <ArrowLeft size={17} /> Dashboard
      </Link>
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold">Krijo test me zgjedhje</h1>
        <p className="mt-2 text-slate-500">Pyetjet lidhen me call-in dhe pjesëmarrësi i plotëson brenda Nemo Call.</p>

        {created ? (
          <section className="card mt-8 p-8 text-center">
            <h2 className="text-2xl font-bold">Testi u krijua</h2>
            <p className="mt-2 text-slate-500">{created.title} · {created.question_count} pyetje</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/sessions/new" className="btn-primary">Krijo call me këtë test</Link>
              <button onClick={() => { setCreated(null); setQuestions([emptyQuestion()]); }} className="btn-secondary">Krijo tjetër</button>
            </div>
          </section>
        ) : (
          <form onSubmit={submit} className="card mt-8 space-y-6 p-7">
            <div>
              <label className="label">Titulli i testit</label>
              <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} />
            </div>
            <div>
              <label className="label">Përshkrimi / instruksionet</label>
              <textarea className="input min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <div className="space-y-4">
              {questions.map((question, questionIndex) => (
                <section key={questionIndex} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-bold">Pyetja {questionIndex + 1}</h2>
                    {questions.length > 1 && (
                      <button type="button" onClick={() => setQuestions((current) => current.filter((_, i) => i !== questionIndex))} className="text-red-600">
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
                      </label>
                    ))}
                  </div>
                  <button type="button" onClick={() => updateQuestion(questionIndex, { options: [...question.options, "" ] })} className="btn-secondary mt-3" disabled={question.options.length >= 8}>
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
        )}
      </div>
    </AppShell>
  );
}
