"use client";

import { useState } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { api } from "@/lib/api";
import { Test, TestSubmission } from "@/lib/types";

export function CandidateTestPanel({ token, test }: { token: string; test: Test }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submission, setSubmission] = useState<TestSubmission | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError("");
    try {
      setSubmission(await api<TestSubmission>(`/public/sessions/${token}/test-submission`, { method: "POST", body: JSON.stringify({ answers }) }, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Testi nuk u dorëzua");
    } finally {
      setLoading(false);
    }
  }

  if (submission) {
    return (
      <section className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-5">
        <div className="flex items-center gap-2 text-emerald-100"><CheckCircle2 size={18} /><h2 className="font-semibold">Testi u dorëzua</h2></div>
        <p className="mt-2 text-xs leading-5 text-slate-300">Rezultati: {submission.score}/{submission.total}. Host-i e sheh bashkë me activity signals tjera.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center gap-2"><ClipboardList className="text-teal-300" size={18} /><h2 className="font-semibold">{test.title}</h2></div>
      {test.description && <p className="mt-2 text-xs leading-5 text-slate-400">{test.description}</p>}
      <div className="mt-4 max-h-96 space-y-4 overflow-auto pr-1">
        {test.questions.map((question) => (
          <div key={question.id} className="rounded-xl border border-white/10 bg-black/15 p-3">
            <p className="text-sm font-semibold">{question.position}. {question.prompt}</p>
            <div className="mt-3 space-y-2">
              {question.options.map((option, index) => (
                <label key={index} className="flex cursor-pointer items-start gap-2 rounded-lg bg-white/5 p-2 text-sm text-slate-200 hover:bg-white/10">
                  <input
                    type="radio"
                    className="mt-1 accent-teal"
                    name={question.id}
                    checked={answers[question.id] === index}
                    onChange={() => setAnswers((current) => ({ ...current, [question.id]: index }))}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-400/10 p-2 text-xs text-red-200">{error}</p>}
      <button onClick={submit} disabled={loading || Object.keys(answers).length < test.questions.length} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {loading ? "Duke dorëzuar..." : "Dorëzo testin"}
      </button>
    </section>
  );
}
