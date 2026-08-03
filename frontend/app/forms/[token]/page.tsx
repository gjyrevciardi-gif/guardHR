"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, ClipboardList, Waves } from "lucide-react";
import { api } from "@/lib/api";
import { Test, TestAnswer, TestSubmission } from "@/lib/types";

export default function PublicFormPage() {
  const { token } = useParams<{ token: string }>();
  const [test, setTest] = useState<Test | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [participantEmail, setParticipantEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, TestAnswer>>({});
  const [submission, setSubmission] = useState<TestSubmission | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<Test>(`/public/tests/${token}`, {}, false)
      .then(setTest)
      .catch((err) => setError(err instanceof Error ? err.message : "Linku nuk eshte valid"));
  }, [token]);

  const allAnswered = useMemo(() => test?.questions.every((question) => {
    const answer = answers[question.id];
    if (question.question_type === "short_text") return typeof answer === "string" && answer.trim().length > 0;
    return typeof answer === "number";
  }) ?? false, [answers, test]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!test) return;
    setLoading(true);
    setError("");
    try {
      setSubmission(await api<TestSubmission>(`/public/tests/${token}/submissions`, {
        method: "POST",
        body: JSON.stringify({
          participant_name: participantName.trim() || null,
          participant_email: participantEmail.trim() || null,
          answers,
        }),
      }, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nuk u dergua");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="constellation min-h-screen px-5 py-6 text-navy">
      <nav className="mx-auto flex max-w-4xl items-center justify-between rounded-full border border-white/80 bg-white/90 px-5 py-3 shadow-soft backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-3 text-sm font-black">
          <span className="rounded-full bg-sky-100 p-2 text-teal"><Waves size={17} /></span>
          Nemo Call
        </Link>
        <span className="rounded-full bg-sky-100 px-4 py-2 text-xs font-bold text-teal">public link</span>
      </nav>

      <section className="mx-auto mt-10 max-w-4xl">
        {error && !test ? (
          <div className="card p-8 text-center">
            <h1 className="text-2xl font-black">Linku nuk u hap</h1>
            <p className="mt-2 text-sm text-red-600">{error}</p>
          </div>
        ) : !test ? (
          <div className="card p-8 text-center text-slate-500">Duke ngarkuar...</div>
        ) : submission ? (
          <div className="card p-10 text-center">
            <CheckCircle2 className="mx-auto text-emerald-600" size={42} />
            <h1 className="mt-4 text-3xl font-black">{test.form_mode ? "Formulari u dergua" : "Testi u dorezua"}</h1>
            <p className="mt-3 text-slate-500">
              {submission.total > 0 ? `Rezultati: ${submission.score}/${submission.total}. ` : ""}
              Faleminderit, pergjigjet u ruajten.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-7 sm:p-9">
            <div className="flex items-start gap-3">
              <span className="rounded-2xl bg-sky-100 p-3 text-teal"><ClipboardList /></span>
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.22em] text-teal">{test.form_mode ? "Public form" : "Public test"}</p>
                <h1 className="mt-2 text-3xl font-black">{test.title}</h1>
                {test.description && <p className="mt-3 text-sm leading-6 text-slate-600">{test.description}</p>}
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Emri</label>
                <input className="input" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Emri yt" />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={participantEmail} onChange={(event) => setParticipantEmail(event.target.value)} placeholder="email@example.com" />
              </div>
            </div>

            <div className="mt-8 space-y-5">
              {test.questions.map((question) => (
                <section key={question.id} className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
                  <p className="font-black">{question.position}. {question.prompt}</p>
                  {question.question_type === "short_text" ? (
                    <textarea
                      className="input mt-4 min-h-28"
                      placeholder="Shkruaj pergjigjen..."
                      value={typeof answers[question.id] === "string" ? answers[question.id] : ""}
                      onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                      required
                    />
                  ) : (
                    <div className="mt-4 space-y-2">
                      {question.options.map((option, index) => (
                        <label key={index} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm hover:border-sky-200 hover:bg-sky-50">
                          <input
                            type="radio"
                            className="mt-1 accent-teal"
                            name={question.id}
                            checked={answers[question.id] === index}
                            onChange={() => setAnswers((current) => ({ ...current, [question.id]: index }))}
                            required
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>

            {error && <p className="mt-5 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

            <button className="btn-primary mt-6 w-full" disabled={loading || !allAnswered}>
              {loading ? "Duke derguar..." : test.form_mode ? "Dergo formularin" : "Dorezo testin"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
