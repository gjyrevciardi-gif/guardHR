"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { MeetingRoom } from "@/components/MeetingRoom";
import { api } from "@/lib/api";
import { InterviewSession, PublicSession } from "@/lib/types";

export default function HrMeetingRoom() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<InterviewSession | null>(null);

  const load = useCallback(async () => {
    try {
      setSession(await api<InterviewSession>(`/sessions/${id}`));
    } catch {
      router.replace("/dashboard");
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (!session) return <main className="flex min-h-screen items-center justify-center bg-mist p-6">Duke ngarkuar...</main>;

  const publicSession: PublicSession = {
    title: session.title,
    candidate_name: session.candidate.full_name,
    status: session.status,
    require_screen_share: session.require_screen_share,
    expires_at: session.expires_at,
    consented_at: session.consented_at,
    test: session.test,
  };

  return (
    <div>
      <div className="bg-[#0b1520] px-5 py-3">
        <Link href={`/sessions/${session.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-300">
          <ArrowLeft size={16} /> Kthehu te sesioni
        </Link>
      </div>
      <MeetingRoom token={session.public_token} role="hr" session={publicSession} />
    </div>
  );
}
