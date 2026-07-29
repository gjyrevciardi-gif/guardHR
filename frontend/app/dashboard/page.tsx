"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronRight, Clock3, History, Plus, Search, Settings2, ShieldAlert, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { api, getToken } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { AuditLog, InterviewSession, User } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [retention, setRetention] = useState(30);
  const [message, setMessage] = useState("");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const load = useCallback(async () => {
    if (!getToken()) { router.replace("/login"); return; }
    try {
      const [me, rows, logs] = await Promise.all([api<User>("/auth/me"), api<InterviewSession[]>("/sessions"), api<AuditLog[]>("/audit-logs")]);
      setUser(me); setRetention(me.retention_days); setSessions(rows); setAuditLogs(logs);
    } catch { router.replace("/login"); }
    finally { setLoading(false); }
  }, [router]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => sessions.filter(s => `${s.title} ${s.candidate.full_name} ${s.candidate.email || ""}`.toLowerCase().includes(query.toLowerCase())), [sessions, query]);
  const requiresReview = sessions.filter(s => s.review_status === "Requires review").length;

  async function saveRetention() {
    const updated = await api<User>("/settings/retention", { method: "PUT", body: JSON.stringify({ retention_days: retention }) });
    setUser(updated); setMessage(`Ruajtja u caktua në ${updated.retention_days} ditë.`);
  }
  async function purgeRetention() {
    const result = await api<{ deleted_events: number }>("/settings/retention/purge", { method: "POST" });
    setMessage(`${result.deleted_events} evente përtej afatit u fshinë.`); await load();
  }

  return <AppShell>
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div><p className="text-sm font-semibold text-teal">NEMO CALL DASHBOARD</p><h1 className="mt-1 text-3xl font-bold">Mirë se erdhe, {user?.full_name || "Host"}</h1><p className="mt-2 text-slate-500">Krijo call, fto pjesëmarrës dhe shiko live activity signals.</p></div>
      <Link href="/sessions/new" className="btn-primary"><Plus size={18}/> Call i ri</Link>
    </div>
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      <Metric icon={<CalendarDays/>} label="Gjithsej calls" value={sessions.length}/>
      <Metric icon={<ShieldAlert/>} label="Requires review" value={requiresReview}/>
      <Metric icon={<Clock3/>} label="Në progres" value={sessions.filter(s => s.status === "in_progress").length}/>
    </div>
    <section className="card mt-8 overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-bold">Calls</h2><p className="text-sm text-slate-500">Lista e call-eve të krijuara nga ju.</p></div>
        <div className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={18}/><input className="input pl-10 sm:w-72" placeholder="Kërko pjesëmarrës…" value={query} onChange={e => setQuery(e.target.value)}/></div>
      </div>
      {loading ? <p className="p-8 text-slate-500">Duke ngarkuar…</p> : filtered.length === 0 ? <div className="p-12 text-center"><p className="font-semibold">Nuk ka calls.</p><p className="mt-1 text-sm text-slate-500">Krijo call-in e parë për të dërguar email invite link.</p></div> :
      <div className="divide-y divide-slate-100">{filtered.map(session => <Link key={session.id} href={`/sessions/${session.id}`} className="grid items-center gap-4 p-5 transition hover:bg-slate-50 sm:grid-cols-[1.5fr_1fr_auto_auto]">
        <div><p className="font-semibold">{session.candidate.full_name}</p><p className="mt-1 text-sm text-slate-500">{session.title} · {session.candidate.email || "Pa email"}</p></div>
        <div className="text-sm"><p className="font-medium capitalize">{session.status.replace("_", " ")}</p><p className="text-slate-500">{dateTime(session.created_at)}</p></div>
        <div className="flex items-center gap-3"><StatusBadge status={session.review_status}/><span className="text-xs text-slate-400">{session.event_count} evente</span></div>
        <ChevronRight className="text-slate-400" size={18}/>
      </Link>)}</div>}
    </section>
    <section className="card mt-8 p-6">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-teal/10 p-2 text-teal"><Settings2 size={20}/></span><div><h2 className="font-bold">Data retention</h2><p className="text-sm text-slate-500">Eventet e call-eve të përfunduara mund të pastrohen pas kësaj periudhe. Video nuk ruhet në MVP.</p></div></div>
      <div className="mt-5 flex flex-wrap items-center gap-3"><input className="input w-28" type="number" min={1} max={365} value={retention} onChange={e => setRetention(Number(e.target.value))}/><span className="text-sm text-slate-600">ditë</span><button className="btn-secondary" onClick={saveRetention}>Ruaj politikën</button><button className="btn-secondary" onClick={purgeRetention}><Trash2 size={16}/> Ekzekuto cleanup</button>{message && <span className="text-sm text-emerald-700">{message}</span>}</div>
    </section>
    <section className="card mt-8 p-6"><div className="flex items-center gap-3"><span className="rounded-xl bg-teal/10 p-2 text-teal"><History size={20}/></span><div><h2 className="font-bold">Audit log</h2><p className="text-sm text-slate-500">Veprimet më të fundit të llogarisë host.</p></div></div><div className="mt-5 divide-y divide-white/10">{auditLogs.slice(0, 8).map(log => <div key={log.id} className="flex flex-col justify-between gap-1 py-3 text-sm sm:flex-row"><span className="font-medium">{log.action}</span><span className="text-slate-500">{dateTime(log.created_at)} · {log.ip_address || "IP e panjohur"}</span></div>)}{auditLogs.length === 0 && <p className="py-4 text-sm text-slate-500">Nuk ka veprime të regjistruara.</p>}</div></section>
  </AppShell>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="card flex items-center gap-4 p-5"><span className="rounded-xl bg-teal/10 p-3 text-teal">{icon}</span><div><p className="text-2xl font-bold">{value}</p><p className="text-sm text-slate-500">{label}</p></div></div>;
}
