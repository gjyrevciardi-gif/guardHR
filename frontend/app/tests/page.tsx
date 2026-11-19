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
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-teal">Biblioteka e testeve</p>
          <h1 className="mt-2 text-3xl font-black text-navy">Testet & formularet</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Ketu i sheh testet/formularet, i editon pyetjet, merr link publik dhe hap review per pergjigjet e pjesemarresve.
          </p>
        </div>
        <Link href="/tests/new" className="btn-primary">
          <Plus size={18} /> Krijo test/form
        </Link>
      </div>

      <section className="card mt-8 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-slate-400" size={18} />
            <input
              className="input pl-10 sm:w-80"
              placeholder="Kërko test…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <p className="text-sm font-semibold text-slate-500">
            {filtered.length} nga {tests.length} teste
          </p>
        </div>
      </section>

      {loading ? (
        <section className="card mt-6 p-10 text-center text-slate-500">Duke ngarkuar testet...</section>
      ) : error ? (
        <section role="alert" className="card mt-6 p-10 text-center text-red-700">{error}</section>
      ) : filtered.length === 0 ? (
        <section className="card mt-6 p-10 text-center">
          <ClipboardList className="mx-auto text-teal" size={34} />
          <h2 className="mt-4 text-xl font-black">Nuk ka teste ende</h2>
          <p className="mt-2 text-sm text-slate-500">Krijo test me score ose formular publik per event/survey.</p>
          <Link href="/tests/new" className="btn-primary mt-5">Krijo te parin</Link>
        </section>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {filtered.map((test) => (
            <Link key={test.id} href={`/tests/${test.id}`} className="card group p-6 transition hover:-translate-y-0.5 hover:border-shell-400">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black text-navy">{test.title}</h2>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
                    {test.description || "Pa pershkrim"}
                  </p>
                </div>
                <span className="rounded-2xl bg-shell-200 p-3 text-teal">
                  <ClipboardList size={20} />
                </span>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="rounded-full bg-shell-100 px-3 py-1 font-bold text-teal">{test.form_mode ? "Formular" : "Test"} - {test.question_count} pyetje</span>
                <span className="text-slate-500">{dateTime(test.created_at)}</span>
              </div>
              <div className="mt-5 flex items-center gap-2 text-sm font-bold text-teal">
                Review / Edit <ArrowRight className="transition group-hover:translate-x-1" size={17} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
