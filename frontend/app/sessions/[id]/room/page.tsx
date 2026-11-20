"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { CallSummary } from "@/components/CallSummary";
import { MeetingRoom } from "@/components/MeetingRoom";
import { api } from "@/lib/api";
import { InterviewSession, RoomSession } from "@/lib/types";

export default function HrMeetingRoom() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [left, setLeft] = useState(false);

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

  if (!session) return <main id="main" className="flex min-h-screen items-center justify-center gap-3 bg-canvas p-6 text-muted" role="status"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Duke ngarkuar…</main>;

  if (left) return <CallSummary sessionId={session.id} onReturn={() => setLeft(false)} />;

  const publicSession: RoomSession = {
    title: session.title,
    candidate_name: session.candidate.full_name,
    status: session.status,
    require_screen_share: session.require_screen_share,
    expires_at: session.expires_at,
    consented_at: session.consented_at,
    verification_required: false,
    candidate_email_hint: null,
    test: session.test,
  };

  return <MeetingRoom token={session.public_token} role="hr" session={publicSession} sessionId={session.id} backHref={`/sessions/${session.id}`} onFinish={() => setLeft(true)} />;
}
