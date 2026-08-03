"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { api } from "@/lib/api";
import { Test, TestAnswer, TestSubmission } from "@/lib/types";

export function CandidateTestPanel({ token, test }: { token: string; test: Test }) {
  const [answers, setAnswers] = useState<Record<string, TestAnswer>>({});
  const [submission, setSubmission] = useState<TestSubmission | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const allAnswered = useMemo(() => test.questions.every((question) => {
    const answer = answers[question.id];
    if (question.question_type === "short_text") return typeof answer === "string" && answer.trim().length > 0;
    return typeof answer === "number";
  }), [answers, test.questions]);

  async function submit() {
    setLoading(true);
    setError("");
    try {
      setSubmission(await api<TestSubmission>(`/public/sessions/${token}/test-submission`, { method: "POST", body: JSON.stringify({ answers }) }, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Testi nuk u dorezua");
    } finally {
      setLoading(false);
    }
  }

  if (submission) {
    return (
      <section className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-5">
        <div className="flex items-center gap-2 text-emerald-100"><CheckCircle2 size={18} /><h2 className="font-semibold">{test.form_mode ? "Formulari u dergua" : "Testi u dorezua"}</h2></div>
        <p className="mt-2 text-xs leading-5 text-slate-300">
          {submission.total > 0 ? `Rezultati: ${submission.score}/${submission.total}. ` : ""}
          Host-i e sheh bashke me activity signals tjera.
        </p>
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
            {question.question_type === "short_text" ? (
              <textarea
                className="mt-3 min-h-24 w-full rounded-xl border border-white/10 bg-white/10 p-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-teal"
                placeholder="Shkruaj pergjigjen..."
                value={typeof answers[question.id] === "string" ? answers[question.id] : ""}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
              />
            ) : (
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
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-400/10 p-2 text-xs text-red-200">{error}</p>}
      <button onClick={submit} disabled={loading || !allAnswered} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {loading ? "Duke derguar..." : test.form_mode ? "Dergo formularin" : "Dorezo testin"}
      </button>
    </section>
  );
}
