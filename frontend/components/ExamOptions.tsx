"use client";

type Props = {
  timeLimit: string;
  onTimeLimit: (value: string) => void;
  shuffle: boolean;
  onShuffle: (value: boolean) => void;
  verifyEmail: boolean;
  onVerifyEmail: (value: boolean) => void;
  invited: string;
  onInvited: (value: string) => void;
};

/** What only a public exam link has: a time limit, a per-candidate order, and an email code before the questions. Shown when creating a test and when editing it. */
export function ExamOptions({ timeLimit, onTimeLimit, shuffle, onShuffle, verifyEmail, onVerifyEmail, invited, onInvited }: Props) {
  return (
    <fieldset className="grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2">
      <legend className="px-1 text-sm font-bold">Për linkun publik</legend>
      <div>
        <label htmlFor="test-time-limit" className="label">Koha në minuta (bosh = pa kufi)</label>
        <input id="test-time-limit" className="input" type="number" inputMode="numeric" min={1} max={480} step={1} value={timeLimit} onChange={(event) => onTimeLimit(event.target.value)} aria-describedby="test-time-limit-help" />
        <p id="test-time-limit-help" className="mt-2 text-xs leading-5 text-muted">Numërohet nga çasti që kandidati e nis, edhe nëse rihap faqen. Një dorëzim i vonuar pranohet dhe shënohet; pas kohës nuk jepen më pyetjet.</p>
      </div>
      <label className="cursor-pointer rounded-xl border border-line p-4">
        <input type="checkbox" checked={shuffle} onChange={(event) => onShuffle(event.target.checked)} className="mr-2 accent-teal" />
        <span className="font-bold">Përzie pyetjet dhe opsionet</span>
        <span className="mt-2 block text-xs leading-5 text-muted">Çdo kandidat i sheh në renditje tjetër, kështu që “pyetja 3 është B” nuk i hyn punës tjetrit. Pikët llogariten sipas çelësit tënd.</span>
      </label>
      <label className="cursor-pointer rounded-xl border border-line p-4 sm:col-span-2">
        <input type="checkbox" checked={verifyEmail} onChange={(event) => onVerifyEmail(event.target.checked)} className="mr-2 accent-teal" />
        <span className="font-bold">Verifiko email-in e kandidatit me kod</span>
        <span className="mt-2 block text-xs leading-5 text-muted">Pyetjet jepen vetëm pasi kandidati të shkruajë një kod 6-shifror që i vjen te email-i që ka dhënë. Provon se e lexon atë kuti postare, jo kush është personi. Kërkon SMTP që funksionon (shih docs/deployment.md): me një server emaili të prishur askush nuk e nis testin. Kush rifreskon faqen kërkon një kod të ri.</span>
      </label>
      {verifyEmail && (
        <div className="sm:col-span-2">
          <label htmlFor="test-invited" className="label">Adresat e ftuara (opsionale, një në rresht)</label>
          <textarea id="test-invited" className="input min-h-28" value={invited} onChange={(event) => onInvited(event.target.value)} aria-describedby="test-invited-help" spellCheck={false} autoComplete="off" />
          <p id="test-invited-help" className="mt-2 text-xs leading-5 text-muted">Bosh: kushdo që ka linkun mund të kërkojë kod, edhe me një kuti postare të përkohshme. Me listë: vetëm këto adresa marrin kod. Kandidati që shkruan një adresë tjetër merr mesazh se nuk është i ftuar, dhe nuk i dërgohet asgjë. Lista është e hostit dhe nuk shfaqet te kandidatët; fshihet bashkë me testin. Deri në 500 adresa.</p>
        </div>
      )}
    </fieldset>
  );
}
