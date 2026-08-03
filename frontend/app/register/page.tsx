"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { api, saveToken } from "@/lib/api";
import { User } from "@/lib/types";
import { NemoMark } from "@/components/NemoMark";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await api<{ access_token: string; user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(form),
      }, false);
      saveToken(response.access_token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regjistrimi deshtoi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="constellation relative hidden overflow-hidden p-16 text-navy lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="relative z-10 flex items-center gap-3 text-xl font-black">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/75 shadow-sm">
            <NemoMark className="h-9 w-11" />
          </span>
          Nemo Call
        </Link>

        <div className="relative z-10 max-w-xl">
          <p className="mb-5 text-sm font-bold uppercase tracking-[.24em] text-teal">Host/Admin account</p>
          <h1 className="display-tech text-5xl font-black leading-tight">
            Create the room.
            <br />
            Keep review human.
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-600">
            Host-i regjistrohet per te krijuar call, per te ftuar pjesemarres me email dhe per te shfaqur teste live.
          </p>
          <div className="mt-10 rounded-[2rem] border border-white/80 bg-white/65 p-8 shadow-soft backdrop-blur-xl">
            <NemoMark animated className="mx-auto h-40 w-64" />
          </div>
        </div>

        <p className="relative z-10 text-sm font-semibold text-slate-600">
          Email invites - Live signals - Manual review
        </p>
      </section>

      <section className="flex items-center justify-center bg-mist p-6">
        <form onSubmit={submit} className="card w-full max-w-md p-8 sm:p-10">
          <span className="mb-6 inline-flex rounded-2xl bg-teal/10 p-3 text-teal"><UserPlus /></span>
          <h2 className="text-3xl font-black text-ink">Register per host</h2>
          <p className="mb-8 mt-2 text-sm leading-6 text-slate-500">
            Ky account perdoret per krijim call, teste dhe monitorim te sinjaleve live.
          </p>

          <label className="label" htmlFor="name">Emri</label>
          <input id="name" className="input mb-5" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required minLength={2} />

          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input mb-5" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />

          <label className="label" htmlFor="password">Fjalekalimi</label>
          <input id="password" className="input" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button className="btn-primary mt-6 w-full" disabled={loading}>
            {loading ? "Duke krijuar..." : "Krijo account"}
          </button>

          <p className="mt-5 text-center text-sm text-slate-500">
            Ke account? <Link href="/login" className="font-semibold text-teal">Hyr ketu</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
