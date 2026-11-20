"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ApiError, api } from "@/lib/api";
import { auditLabel, dateTime } from "@/lib/format";
import { AuditLog, User } from "@/lib/types";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [retention, setRetention] = useState(30);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<"save" | "purge" | null>(null);

  const load = useCallback(async () => {
    try {
      const [me, rows] = await Promise.all([api<User>("/auth/me"), api<AuditLog[]>("/audit-logs")]);
      setUser(me);
      setRetention(me.retention_days);
      setLogs(rows);
      setOffline(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else setOffline(true);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function saveRetention() {
    setBusy("save"); setMessage(""); setFailure("");
    try {
      const updated = await api<User>("/settings/retention", { method: "PUT", body: JSON.stringify({ retention_days: retention }) });
      setUser(updated);
      setMessage(`Ruajtja u caktua në ${updated.retention_days} ditë.`);
      await load();
    } catch (err) { setFailure(err instanceof Error ? err.message : "Afati nuk u ruajt."); }
    finally { setBusy(null); }
  }

  async function purgeRetention() {
    if (!window.confirm("Të fshihen tani eventet dhe përgjigjet e testeve që kanë kaluar afatin? Veprimi nuk kthehet.")) return;
    setBusy("purge"); setMessage(""); setFailure("");
    try {
      const result = await api<{ deleted_events: number; deleted_submissions: number }>("/settings/retention/purge", { method: "POST" });
      setMessage(`U fshinë ${result.deleted_events} evente dhe ${result.deleted_submissions} përgjigje testesh përtej afatit.`);
      await load();
    } catch (err) { setFailure(err instanceof Error ? err.message : "Pastrimi dështoi."); }
    finally { setBusy(null); }
  }

  return (
    <AppShell>
      {offline && <OfflineBanner />}
      <div className="animate-rise">
        <p className="eyebrow">Llogaria</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Cilësimet</h1>
        <p className="mt-2 text-muted">{user ? `${user.full_name} · ${user.email}` : "Duke ngarkuar…"}</p>
      </div>

      <section className="card mt-8 p-6 animate-rise" aria-labelledby="retention-title">
        <h2 id="retention-title" className="section-title">Ruajtja e të dhënave</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Eventet, përgjigjet e testeve dhe adresat IP të call-eve të përfunduara fshihen automatikisht pas kësaj periudhe. Video dhe zëri nuk ruhen fare.
          Fshirja ndodh çdo ditë dhe kur nis serveri; mund ta nisësh edhe vetë.
        </p>
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="retention-days" className="label">Ruaj për (ditë)</label>
            <input id="retention-days" className="input w-32" type="number" min={1} max={365} value={retention} onChange={(event) => setRetention(Number(event.target.value))} />
          </div>
          <button className="btn-primary" onClick={() => void saveRetention()} disabled={busy !== null}>
            {busy === "save" && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />} Ruaj afatin
          </button>
          <button className="btn-secondary" onClick={() => void purgeRetention()} disabled={busy !== null}>
            {busy === "purge" ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />} Pastro tani
          </button>
        </div>
        {message && <p role="status" className="mt-4 text-sm font-semibold text-emerald-700">{message}</p>}
        {failure && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{failure}</p>}
        <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted"><ShieldCheck size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-teal" />Afati vlen për llogarinë tënde. Një call që fshihet me dorë hiqet menjëherë me gjithçka që ka brenda.</p>
      </section>

      <section className="card mt-6 p-6 animate-rise" aria-labelledby="audit-title">
        <h2 id="audit-title" className="section-title">Regjistri i veprimeve</h2>
        <p className="mt-3 text-sm text-slate-600">Veprimet e fundit të llogarisë tënde: kush bëri çfarë, kur dhe nga cila adresë.</p>
        {logs.length === 0 ? (
          <p className="mt-6 flex items-center gap-2 rounded-xl border border-dashed border-line-strong p-5 text-sm text-muted"><History size={18} aria-hidden="true" /> Ende nuk ka veprime të regjistruara.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {logs.slice(0, 30).map((log) => (
              <li key={log.id} className="flex flex-col justify-between gap-1 py-3 text-sm sm:flex-row sm:items-center">
                <span className="font-semibold">{auditLabel(log.action)}</span>
                <span className="font-mono text-xs tabular-nums text-muted">{dateTime(log.created_at)} · {log.ip_address || "IP e panjohur"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
