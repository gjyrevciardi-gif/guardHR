"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { User } from "@/lib/types";

function Feedback({ ok, fail }: { ok: string; fail: string }) {
  return (
    <>
      {ok && <p role="status" className="mt-4 text-sm font-semibold text-emerald-700">{ok}</p>}
      {fail && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{fail}</p>}
    </>
  );
}

function Spinner() {
  return <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [fail, setFail] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setOk(""); setFail("");
    try {
      await api("/auth/password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) });
      setCurrent(""); setNext("");
      setOk("Fjalëkalimi u ndryshua. Pajisjet e tjera u shkyçën; kjo mbetet e kyçur.");
      onChanged();
    } catch (err) { setFail(errorText(err, "Fjalëkalimi nuk u ndryshua.")); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} aria-labelledby="password-title">
      <h3 id="password-title" className="flex items-center gap-2 font-semibold"><KeyRound size={16} aria-hidden="true" /> Fjalëkalimi</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="current-password" className="label">Fjalëkalimi aktual</label>
          <input id="current-password" className="input" type="password" autoComplete="current-password" maxLength={128} value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="change-password" className="label">Fjalëkalimi i ri</label>
          <input id="change-password" className="input" type="password" autoComplete="new-password" minLength={8} maxLength={128} aria-describedby="change-password-hint" value={next} onChange={(e) => setNext(e.target.value)} required />
          <p id="change-password-hint" className="mt-2 text-xs text-muted">Të paktën 8 shkronja ose shifra.</p>
        </div>
      </div>
      <button className="btn-primary mt-4" disabled={busy}>{busy && <Spinner />} Ndrysho fjalëkalimin</button>
      <Feedback ok={ok} fail={fail} />
    </form>
  );
}

function Devices() {
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");

  async function revoke() {
    if (!window.confirm("Të dalësh nga të gjitha pajisjet, përfshirë këtë? Do të kyçesh përsëri këtu.")) return;
    setBusy(true); setFail("");
    try {
      await api("/auth/logout-everywhere", { method: "POST" });
      window.location.replace("/login");
    } catch (err) { setFail(errorText(err, "Veprimi dështoi.")); setBusy(false); }
  }

  return (
    <div>
      <h3 className="flex items-center gap-2 font-semibold"><LogOut size={16} aria-hidden="true" /> Pajisjet</h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Një sesion mbetet i hapur për disa orë. Nëse e ke përdorur llogarinë në një kompjuter që nuk e kontrollon, dil nga të gjitha pajisjet menjëherë.</p>
      <button className="btn-secondary mt-4" onClick={() => void revoke()} disabled={busy}>{busy ? <Spinner /> : <LogOut size={16} aria-hidden="true" />} Dil nga të gjitha pajisjet</button>
      <Feedback ok="" fail={fail} />
    </div>
  );
}

function groups(secret: string) {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

function TwoStep({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [fail, setFail] = useState("");

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true); setOk(""); setFail("");
    try { await action(); } catch (err) { setFail(errorText(err, failure)); }
    finally { setBusy(false); }
  }

  const start = () => run(async () => setSetup(await api("/auth/mfa/setup", { method: "POST" })), "Konfigurimi nuk nisi.");

  const enable = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const result = await api<{ recovery_codes: string[] }>("/auth/mfa/enable", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      setRecovery(result.recovery_codes); setSetup(null); setCode("");
    }, "Kodi nuk u konfirmua.");
  };

  const disable = (event: FormEvent) => {
    event.preventDefault();
    if (!window.confirm("Të çaktivizohet verifikimi në dy hapa? Llogaria do të mbrohet vetëm nga fjalëkalimi.")) return Promise.resolve();
    return run(async () => {
      await api("/auth/mfa/disable", { method: "POST", body: JSON.stringify({ password, code: code.trim() }) });
      setPassword(""); setCode(""); setOk("Verifikimi në dy hapa u çaktivizua.");
      onChanged();
    }, "Veprimi dështoi.");
  };

  function finish() {
    setRecovery(null);
    setOk("Verifikimi në dy hapa është aktiv.");
    onChanged();
  }

  return (
    <div>
      <h3 id="mfa-title" className="flex items-center gap-2 font-semibold"><ShieldAlert size={16} aria-hidden="true" /> Verifikimi në dy hapa</h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
        Përveç fjalëkalimit, hyrja kërkon një kod 6-shifror nga një aplikacion vërtetimi (Google Authenticator, Microsoft Authenticator, Aegis, 1Password…). Një fjalëkalim i vjedhur nuk mjafton më.
      </p>
      {user.mfa_setup_required && !recovery && (
        <p role="note" className="mt-3 max-w-3xl rounded-xl border border-gold/50 bg-gold/10 p-3 text-sm leading-6">
          Si administrator duhet ta aktivizosh para se të krijosh llogari ose të përdorësh funksionet e administratorit. Mund të hysh dhe ta aktivizosh këtu.
        </p>
      )}

      {recovery ? (
        <div className="mt-4 max-w-xl">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} aria-hidden="true" /> Verifikimi u aktivizua. Ruaji këto kode tani.</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">Çdo kod përdoret një herë dhe të lejon të hysh nëse humb telefonin. Shfaqen vetëm këtu, vetëm tani; ruaji në një menaxher fjalëkalimesh ose printoji.</p>
          <ul aria-label="Kodet e rikuperimit" className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
            {recovery.map((item) => <li key={item} className="select-all rounded-lg border border-line-strong bg-shell-100 px-3 py-2 tabular-nums">{item}</li>)}
          </ul>
          <button className="btn-primary mt-4" onClick={finish}>I ruajta, vazhdo</button>
        </div>
      ) : user.mfa_enabled ? (
        <form onSubmit={(event) => void disable(event)} className="mt-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} aria-hidden="true" /> Aktiv</p>
          <p className="mt-2 text-sm text-slate-600">Për ta çaktivizuar duhen fjalëkalimi dhe një kod aktual (ose një kod rikuperimi).</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="disable-password" className="label">Fjalëkalimi</label>
              <input id="disable-password" className="input" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="disable-code" className="label">Kodi</label>
              <input id="disable-code" className="input font-mono" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} maxLength={32} value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
          </div>
          <button className="btn-secondary mt-4" disabled={busy}>{busy && <Spinner />} Çaktivizo</button>
        </form>
      ) : setup ? (
        <form onSubmit={(event) => void enable(event)} className="mt-4 max-w-xl">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
            <li>Në aplikacionin e vërtetimit shto një llogari të re dhe zgjidh futjen me dorë të çelësit.</li>
            <li>
              Shkruaj këtë çelës: <code className="select-all break-all rounded-md bg-shell-100 px-2 py-1 font-mono text-navy">{groups(setup.secret)}</code>
              <span className="block text-xs text-muted">Në telefon mund ta hapësh edhe me <a className="font-semibold text-teal underline underline-offset-2" href={setup.otpauth_uri}>këtë link</a>. Mos e ndaj me askënd.</span>
            </li>
            <li>Shkruaj kodin 6-shifror që shfaq aplikacioni.</li>
          </ol>
          <label htmlFor="enable-code" className="label mt-4">Kodi nga aplikacioni</label>
          <input id="enable-code" className="input w-48 font-mono tracking-widest" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="btn-primary" disabled={busy}>{busy && <Spinner />} Konfirmo dhe aktivizo</button>
            <button type="button" className="btn-secondary" onClick={() => { setSetup(null); setCode(""); setFail(""); }} disabled={busy}>Anulo</button>
          </div>
        </form>
      ) : (
        <button className="btn-primary mt-4" onClick={() => void start()} disabled={busy}>{busy && <Spinner />} Aktivizo verifikimin në dy hapa</button>
      )}
      <Feedback ok={ok} fail={fail} />
    </div>
  );
}

export function SecuritySettings({ user, onChanged }: { user: User; onChanged: () => void }) {
  return (
    <section className="card mt-6 p-6 animate-rise" aria-labelledby="security-title">
      <h2 id="security-title" className="section-title">Siguria e llogarisë</h2>
      <div className="mt-5 space-y-8 divide-y divide-line [&>*:not(:first-child)]:pt-8">
        <ChangePassword onChanged={onChanged} />
        <Devices />
        <TwoStep user={user} onChanged={onChanged} />
      </div>
    </section>
  );
}
