"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardList, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Test } from "@/lib/types";

export default function TestsPage() {
  const [tests, setTests] = useState<Test[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTests(await api<Test[]>("/tests"));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Testet nuk u ngarkuan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = tests.filter((test) =>
    `${test.title} ${test.description || ""}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Biblioteka e testeve</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Testet dhe formularët</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Këtu i sheh testet dhe formularët, i ndryshon pyetjet, merr linkun publik dhe shqyrton përgjigjet e pjesëmarrësve.
          </p>
        </div>
        <Link href="/tests/new" className="btn-primary">
          <Plus size={18} aria-hidden="true" /> Krijo test ose formular
        </Link>
      </div>

      <section className="card mt-8 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-muted" size={18} aria-hidden="true" />
            <input
              aria-label="Kërko test" className="input pl-10 sm:w-80"
              placeholder="Kërko test…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <p className="text-sm font-semibold text-muted">
            {filtered.length} nga {tests.length}
          </p>
        </div>
      </section>

      {loading ? (
        <section className="card mt-6 p-10 text-center text-muted" role="status">Duke ngarkuar testet…</section>
      ) : error ? (
        <section role="alert" className="card mt-6 p-10 text-center text-red-700">{error}</section>
      ) : filtered.length === 0 ? (
        <section className="card mt-6 p-10 text-center">
          <ClipboardList className="mx-auto text-teal" size={34} aria-hidden="true" />
          <h2 className="mt-4 text-xl font-bold">{query ? "Asnjë test nuk përputhet" : "Ende nuk ka teste"}</h2>
          <p className="mt-2 text-sm text-muted">Krijo një test me pikë ose një formular publik për regjistrime dhe pyetësorë.</p>
          <Link href="/tests/new" className="btn-primary mt-5">Krijo të parin</Link>
        </section>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {filtered.map((test) => (
            <Link key={test.id} href={`/tests/${test.id}`} className="card group p-6 transition hover:border-line-strong">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-navy">{test.title}</h2>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">
                    {test.description || "Pa përshkrim"}
                  </p>
                </div>
                <span className="rounded-xl bg-shell-200 p-3 text-teal">
                  <ClipboardList size={20} aria-hidden="true" />
                </span>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="chip bg-shell-100 text-slate-700 ring-line">{test.form_mode ? "Formular" : "Test"} · {test.question_count} pyetje</span>
                <span className="text-muted">{dateTime(test.created_at)}</span>
              </div>
              <div className="mt-5 flex items-center gap-2 text-sm font-bold text-teal">
                Shqyrto ose ndrysho <ArrowRight className="transition group-hover:translate-x-1 motion-reduce:transition-none" size={17} aria-hidden="true" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
