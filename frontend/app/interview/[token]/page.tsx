"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { MeetingRoom } from "@/components/MeetingRoom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api } from "@/lib/api";
import { PublicSession } from "@/lib/types";

export default function InterviewRoom() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [session, setSession] = useState<PublicSession | null>(null);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<PublicSession>(`/public/sessions/${token}`, {}, false)
      .then((data) => {
        if (!data.consented_at) router.replace(`/join/${token}`);
        else setSession(data);
      })
      .catch((err) => setError(err.message));
  }, [router, token]);

  if (ended && session) return <Completed session={session} />;

  if (error) return <main id="main" className="flex min-h-screen items-center justify-center bg-canvas p-6 text-center font-semibold text-red-700" role="alert">{error}</main>;
  if (!session) return <main id="main" className="flex min-h-screen items-center justify-center gap-3 bg-canvas p-6 text-muted" role="status"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Duke ngarkuar…</main>;

  return <MeetingRoom token={token} role="candidate" session={session} onFinish={() => setEnded(true)} />;
}

/** The last thing a candidate sees: thanks, what happens next, and exactly what was kept. */
function Completed({ session }: { session: PublicSession }) {
  const first = session.candidate_name.split(" ")[0];
  return (
    <main id="main" className="min-h-screen bg-canvas px-5 py-10 text-navy">
      <div className="mx-auto flex max-w-xl justify-end"><ThemeToggle /></div>
      <div className="mx-auto mt-4 max-w-xl animate-rise">
        <div className="card p-8 text-center sm:p-10">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-shell-200 text-moss"><CheckCircle2 size={36} aria-hidden="true" /></span>
          <h1 className="mt-5 text-3xl font-bold tracking-tight">Faleminderit, {first}</h1>
          <p className="mt-3 text-slate-600">Call-i &quot;{session.title}&quot; përfundoi. Mund ta mbyllësh këtë dritare.</p>
        </div>

        <section className="card mt-5 p-6 sm:p-8" aria-labelledby="next-title">
          <h2 id="next-title" className="section-title">Çfarë ndodh tani</h2>
          <ul className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
            <li className="flex gap-3"><ClipboardCheck size={18} className="mt-1 shrink-0 text-teal" aria-hidden="true" /><span><strong className="text-navy">{session.host_name}</strong> do ta shqyrtojë call-in{session.test ? " dhe përgjigjet e tua" : ""}. Rezultati të komunikohet nga ata, jo nga kjo faqe.</span></li>
            <li className="flex gap-3"><ShieldCheck size={18} className="mt-1 shrink-0 text-teal" aria-hidden="true" /><span>Sinjalet e aktivitetit i lexon një njeri. Asnjë vendim nuk merret automatikisht.</span></li>
            <li className="flex gap-3"><Trash2 size={18} className="mt-1 shrink-0 text-teal" aria-hidden="true" /><span>Pamjet e kamerës dhe zëri nuk u ruajtën. Sinjalet, koha dhe adresa IP fshihen {session.retention_days} ditë pas përfundimit të call-it.</span></li>
          </ul>
          <p className="mt-6 text-sm"><Link href="/privacy" className="font-semibold text-teal underline">Politika e privatësisë</Link></p>
        </section>
      </div>
    </main>
  );
}
