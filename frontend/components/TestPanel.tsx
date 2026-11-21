"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { api } from "@/lib/api";
import { PublicTest, TestAnswer, TestSubmission } from "@/lib/types";

export function CandidateTestPanel({ token, test }: { token: string; test: PublicTest }) {
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
      setError(err instanceof Error ? err.message : "Testi nuk u dorëzua");
    } finally {
      setLoading(false);
    }
  }

  if (submission) {
    return (
      <section className="rounded-xl border border-stage-accent/30 bg-stage-accent/10 p-4">
        <div className="flex items-center gap-2 text-stage-accent"><CheckCircle2 size={18} /><h2 className="font-semibold">{test.form_mode ? "Formulari u dërgua" : "Testi u dorëzua"}</h2></div>
        <p className="mt-2 text-xs leading-5 text-stage-muted">
          {submission.total > 0 ? `Rezultati: ${submission.score}/${submission.total}. ` : ""}
          Host-i e sheh bashkë me sinjalet e tjera të aktivitetit.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-stage-line bg-stage-raised p-4">
      <div className="flex items-center gap-2"><ClipboardList className="text-stage-accent" size={18} aria-hidden="true" /><h2 className="font-semibold">{test.title}</h2></div>
      {test.description && <p className="mt-2 text-xs leading-5 text-stage-muted">{test.description}</p>}
      <div className="mt-4 max-h-96 space-y-4 overflow-auto pr-1">
        {test.questions.map((question) => (
          <div key={question.id} className="rounded-xl border border-stage-line bg-stage p-3">
            <p className="text-sm font-semibold">{question.position}. {question.prompt}</p>
            {question.question_type === "short_text" ? (
              <textarea
                aria-label={`Përgjigjja për pyetjen ${question.position}`}
                className="mt-3 min-h-24 w-full rounded-xl border border-stage-line bg-stage-raised p-3 text-sm text-stage-ink outline-none placeholder:text-stage-muted focus:border-stage-accent"
                placeholder="Shkruaj përgjigjen…"
                value={typeof answers[question.id] === "string" ? answers[question.id] : ""}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
              />
            ) : (
              <div className="mt-3 space-y-2">
                {question.options.map((option, index) => (
                  <label key={index} className="flex cursor-pointer items-start gap-2 rounded-lg bg-stage-raised p-2 text-sm text-stage-ink hover:bg-white/10">
                    <input
                      type="radio"
                      className="mt-0.5 h-6 w-6 shrink-0 accent-[#9dc88d]"
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
      {error && <p className="mt-3 rounded-lg bg-red-500/15 p-2 text-xs text-[#fecaca]">{error}</p>}
      <button onClick={submit} disabled={loading || !allAnswered} className="mt-4 flex w-full items-center justify-center gap-2 min-h-11 rounded-xl bg-stage-accent px-4 py-3 text-sm font-semibold text-[#0b1713] disabled:cursor-not-allowed disabled:opacity-50">
        {loading ? "Duke dërguar…" : test.form_mode ? "Dërgo formularin" : "Dorëzo testin"}
      </button>
    </section>
  );
}
