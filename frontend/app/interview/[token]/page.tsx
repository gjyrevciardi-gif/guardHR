"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { MeetingRoom } from "@/components/MeetingRoom";
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

  if (ended) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mist p-6">
        <div className="card max-w-md p-10 text-center">
          <CheckCircle2 className="mx-auto text-emerald-600" size={48} />
          <h1 className="mt-5 text-2xl font-bold">Sesioni perfundoi</h1>
          <p className="mt-3 text-slate-500">Faleminderit. Eventet teknike do te shqyrtohen manualisht nga HR.</p>
        </div>
      </main>
    );
  }

  if (error) return <main className="flex min-h-screen items-center justify-center bg-mist p-6 text-center text-red-700">{error}</main>;
  if (!session) return <main className="flex min-h-screen items-center justify-center bg-mist p-6">Duke ngarkuar...</main>;

  return <MeetingRoom token={token} role="candidate" session={session} onFinish={() => setEnded(true)} />;
}
