"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CameraOff, Eye, Maximize, Mic, MicOff, MonitorUp, PhoneOff, ShieldCheck, Users, X } from "lucide-react";
import { InterviewMonitor } from "@/components/InterviewMonitor";
import { CandidateTestPanel } from "@/components/TestPanel";
import { api, wsUrl } from "@/lib/api";
import { EventType, PublicSession } from "@/lib/types";
import { dateTime, eventLabels } from "@/lib/format";

type Role = "candidate" | "hr";
type RemoteTarget = "camera" | "screen";
type LiveEvent = {
  id: string;
  event_type: EventType;
  started_at: string;
  duration_seconds: number | null;
  confidence_score: number | null;
  metadata: Record<string, unknown>;
};

interface Props {
  token: string;
  role: Role;
  session: PublicSession;
  onFinish?: () => void;
}

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function liveEventTitle(event: LiveEvent) {
  const reason = String(event.metadata?.reason || "");
  const phase = String(event.metadata?.phase || "");
  if (event.event_type === "tab_hidden" && reason.includes("window_blur")) {
    return phase === "started" ? "Pjesëmarrësi humbi focus/minimizoi" : "Pjesëmarrësi u kthye në faqe";
  }
  if (event.event_type === "tab_hidden") {
    return phase === "started" ? "Pjesëmarrësi hapi tab/app tjetër" : "Pjesëmarrësi u kthye nga tab/app tjetër";
  }
  if (event.event_type === "fullscreen_exit") return "Pjesëmarrësi doli nga fullscreen";
  if (event.event_type === "copy_paste") return "Copy/paste u përdor";
  if (event.event_type === "camera_disabled") return "Kamera e pjesëmarrësit u ndal";
  if (event.event_type === "screen_share_stopped") return "Screen share u ndal";
  if (event.event_type === "face_not_visible") return "Fytyra nuk u pa mbi 5 sekonda";
  if (event.event_type === "multiple_people") return "U panë më shumë se një person";
  if (event.event_type === "phone_detected") return "U dallua telefon";
  if (event.event_type === "connection_interruption") return "Ndërprerje e shpeshtë lidhjeje";
  return eventLabels[event.event_type] || event.event_type;
}

function liveEventDetails(event: LiveEvent) {
  const duration = event.duration_seconds != null ? `${event.duration_seconds.toFixed(1)}s` : "live/tani";
  const confidence = event.confidence_score != null ? ` · confidence ${Math.round(event.confidence_score * 100)}%` : "";
  return `${eventLabels[event.event_type] || event.event_type} · ${duration}${confidence} · ${dateTime(event.started_at)}`;
}

function hrLiveEventTitle(event: LiveEvent) {
  const reason = String(event.metadata?.reason || "");
  const phase = String(event.metadata?.phase || "");
  const lines = event.metadata?.line_count;
  const width = event.metadata?.width_percent;
  const height = event.metadata?.height_percent;

  if (event.event_type === "tab_hidden" && reason.includes("window_blur")) {
    return phase === "started" ? "Pjesëmarrësi humbi focus/minimizoi" : "Pjesëmarrësi u kthye në faqe";
  }
  if (event.event_type === "tab_hidden") {
    return phase === "started" ? "Pjesëmarrësi hapi tab/app tjetër" : "Pjesëmarrësi u kthye nga tab/app tjetër";
  }
  if (event.event_type === "window_resized") return `Dritarja u ndryshua në ${width || "?"}% width dhe ${height || "?"}% height`;
  if (event.event_type === "copy_paste" && lines) return `Tekst/kod u paste (${lines} rreshta)`;
  if (event.event_type === "multiple_monitors") return "U detektuan monitorë shtesë";
  if (event.event_type === "fullscreen_exit") return "Pjesëmarrësi doli nga fullscreen";
  if (event.event_type === "copy_paste") return "Copy/paste u përdor";
  if (event.event_type === "camera_disabled") return "Kamera e pjesëmarrësit u ndal";
  if (event.event_type === "screen_share_stopped") return "Screen share u ndal";
  if (event.event_type === "face_not_visible") return "Fytyra nuk u pa mbi 5 sekonda";
  if (event.event_type === "multiple_people") return "U panë më shumë se një person";
  if (event.event_type === "phone_detected") return "U dallua telefon";
  if (event.event_type === "connection_interruption") return "Ndërprerje e shpeshtë lidhjeje";
  return eventLabels[event.event_type] || event.event_type;
}

function hrLiveEventDetails(event: LiveEvent) {
  const duration = event.duration_seconds != null ? `${event.duration_seconds.toFixed(1)}s` : "live/tani";
  const confidence = event.confidence_score != null ? ` · confidence ${Math.round(event.confidence_score * 100)}%` : "";
  const metadata: string[] = [];
  if (event.metadata?.operation) metadata.push(`operation: ${String(event.metadata.operation)}`);
  if (event.metadata?.char_count) metadata.push(`${String(event.metadata.char_count)} karaktere`);
  if (event.metadata?.looks_like_code) metadata.push("duket si kod");
  if (event.metadata?.screen_count) metadata.push(`${String(event.metadata.screen_count)} monitorë`);
  return `${eventLabels[event.event_type] || event.event_type} · ${duration}${confidence}${metadata.length ? ` · ${metadata.join(" · ")}` : ""} · ${dateTime(event.started_at)}`;
}

export function MeetingRoom({ token, role, session, onFinish }: Props) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localScreenRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteScreenRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const nextRemoteVideoTarget = useRef<RemoteTarget>("camera");

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteCameraStream, setRemoteCameraStream] = useState<MediaStream | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [peerPresent, setPeerPresent] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraDeviceId, setCameraDeviceId] = useState("");
  const [micDeviceId, setMicDeviceId] = useState("");
  const [error, setError] = useState("");
  const [lastSignal, setLastSignal] = useState("");
  const [roomAlerts, setRoomAlerts] = useState<Array<{ id: string; title: string; message: string }>>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const localSpeaking = useSpeaking(localStream, micEnabled);
  const remoteSpeaking = useSpeaking(remoteAudioStream, true);
  const mediaBlockedByBrowser = typeof window !== "undefined" && !window.isSecureContext;
  const mediaBlockedMessage = "Kamera, mikrofoni dhe screen share nuk aktivizohen ne HTTP me IP lokale. Monitoring per nderrim faqeje punon prape. Per kamera nga dy pajisje duhet HTTPS/tunnel, ose hapeni ne localhost ne te njejtin PC.";

  const pushRoomAlert = useCallback((alert: { id: string; title: string; message: string }) => {
    setRoomAlerts((current) => [alert, ...current.filter((item) => item.id !== alert.id)].slice(0, 4));
    window.setTimeout(() => {
      setRoomAlerts((current) => current.filter((item) => item.id !== alert.id));
    }, 9000);
  }, []);

  async function attachStream(video: HTMLMediaElement | null, stream: MediaStream | null) {
    if (!video) return;
    video.srcObject = stream;
    if (!stream) return;
    video.muted = video.muted || video === localVideoRef.current || video === localScreenRef.current;
    try {
      await video.play();
    } catch {
      setTimeout(() => void video.play().catch(() => undefined), 250);
    }
  }

  async function refreshDevices() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setDevices([]);
        return;
      }
      const rows = await navigator.mediaDevices.enumerateDevices();
      const usableDevices = rows.filter((item) => item.kind === "videoinput" || item.kind === "audioinput");
      setDevices(usableDevices);
      const preferredCamera = usableDevices.find((item) => item.kind === "videoinput" && item.label && !item.label.toLowerCase().includes("ir"));
      const preferredMic = usableDevices.find((item) => item.kind === "audioinput" && item.label);
      if (!cameraDeviceId && preferredCamera) setCameraDeviceId(preferredCamera.deviceId);
      if (!micDeviceId && preferredMic) setMicDeviceId(preferredMic.deviceId);
    } catch {
      setDevices([]);
    }
  }

  const send = useCallback((payload: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(payload));
  }, []);

  const createAndSendOffer = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer || socketRef.current?.readyState !== WebSocket.OPEN) return;
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send({ type: "offer", description: offer });
  }, [send]);

  const addTracksToPeer = useCallback((peer: RTCPeerConnection, stream: MediaStream, kind: "camera" | "screen") => {
    stream.getTracks().forEach((track) => {
      const exists = peer.getSenders().some((sender) => sender.track === track);
      if (!exists) peer.addTrack(track, stream);
    });
    if (kind === "screen") send({ type: "screen-started" });
  }, [send]);

  const ensurePeer = useCallback(() => {
    if (peerRef.current) return peerRef.current;

    const peer = new RTCPeerConnection(rtcConfig);
    if (localStreamRef.current) addTracksToPeer(peer, localStreamRef.current, "camera");
    if (screenStreamRef.current) addTracksToPeer(peer, screenStreamRef.current, "screen");

    peer.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      if (event.track.kind === "audio") {
        setRemoteAudioStream(stream);
        return;
      }

      if (nextRemoteVideoTarget.current === "screen") {
        nextRemoteVideoTarget.current = "camera";
        setRemoteScreenStream(stream);
        return;
      }

      if (!remoteCameraStream) setRemoteCameraStream(stream);
      else setRemoteScreenStream(stream);
    };

    peer.onicecandidate = (event) => {
      if (event.candidate) send({ type: "ice", candidate: event.candidate });
    };

    peer.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(peer.connectionState)) {
        setRemoteCameraStream(null);
        setRemoteAudioStream(null);
        setRemoteScreenStream(null);
      }
    };

    peerRef.current = peer;
    return peer;
  }, [addTracksToPeer, remoteCameraStream, send]);

  const connectSignaling = useCallback(() => {
    const socket = new WebSocket(`${wsUrl(`/ws/rooms/${token}`)}?role=${role}`);
    socketRef.current = socket;

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      const peer = ensurePeer();

      if (message.type === "screen-started") nextRemoteVideoTarget.current = "screen";
      if (message.type === "screen-stopped") setRemoteScreenStream(null);
      if (message.type === "peers") setPeerPresent(message.roles.some((peerRole: string) => peerRole !== role));
      if (message.type === "peer-joined" && message.role !== role) setPeerPresent(true);
      if (message.type === "integrity-event" && role === "hr") {
        const event = message.event as LiveEvent;
        setLiveEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 20));
        pushRoomAlert({
          id: event.id,
          title: hrLiveEventTitle(event),
          message: hrLiveEventDetails(event),
        });
      }

      if ((message.type === "peers" && role === "hr" && message.roles.length > 0) || (message.type === "peer-joined" && role === "hr")) {
        await createAndSendOffer();
      }

      if (message.type === "offer") {
        await peer.setRemoteDescription(message.description);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        send({ type: "answer", description: answer });
      }

      if (message.type === "answer") await peer.setRemoteDescription(message.description);
      if (message.type === "ice" && message.candidate) await peer.addIceCandidate(message.candidate);
      if (message.type === "peer-left") {
        setPeerPresent(false);
        setRemoteCameraStream(null);
        setRemoteAudioStream(null);
        setRemoteScreenStream(null);
      }
    };
  }, [createAndSendOffer, ensurePeer, pushRoomAlert, role, send, token]);

  async function start() {
    setError("");
    try {
      if (role === "candidate") await api(`/public/sessions/${token}/start`, { method: "POST" }, false);

      setActive(true);
      connectSignaling();
      if (role === "candidate") await roomRef.current?.requestFullscreen().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Monitoring could not start");
    }
  }

  async function startCamera() {
    setError("");
    let camera: MediaStream | null = null;
    try {
      if (mediaBlockedByBrowser || !navigator.mediaDevices?.getUserMedia) {
        setError(mediaBlockedMessage);
        return;
      }
      camera = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : {}),
        },
        audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
      });
      await refreshDevices();

      const selectedVideoTrack = camera.getVideoTracks()[0];
      if (!cameraDeviceId && selectedVideoTrack?.label.toLowerCase().includes("ir")) {
        const rows = await navigator.mediaDevices.enumerateDevices();
        const normalCamera = rows.find((item) => item.kind === "videoinput" && item.label && !item.label.toLowerCase().includes("ir"));
        if (normalCamera) {
          camera.getTracks().forEach((track) => track.stop());
          camera = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              deviceId: { exact: normalCamera.deviceId },
            },
            audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
          });
          setCameraDeviceId(normalCamera.deviceId);
        }
      }

      localStreamRef.current = camera;
      setLocalStream(camera);
      setCameraEnabled(camera.getVideoTracks().some((track) => track.enabled));
      setMicEnabled(camera.getAudioTracks().some((track) => track.enabled));
      await attachStream(localVideoRef.current, camera);
      if (peerRef.current) {
        addTracksToPeer(peerRef.current, camera, "camera");
        await createAndSendOffer();
      }
    } catch (err) {
      camera?.getTracks().forEach((track) => track.stop());
      const message = err instanceof Error ? err.message : "Camera or microphone permission was rejected";
      setError(message.includes("Permission denied") ? "Leja per kamera/mikrofon u refuzua nga browser-i. Kontrollo ikonën e kamerës te adresa e faqes dhe lejo aksesin." : message);
    }
  }

  async function startScreenShare() {
    try {
      if (mediaBlockedByBrowser || !navigator.mediaDevices?.getDisplayMedia) {
        setError(mediaBlockedMessage);
        return;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopScreenShare();
      });

      const peer = ensurePeer();
      addTracksToPeer(peer, stream, "screen");
      await createAndSendOffer();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message.includes("Permission denied") ? "Screen sharing u refuzua nga browser-i. Provo prape dhe zgjidh dritaren/tab-in qe do ta ndash." : "Screen sharing nuk u aktivizua.");
    }
  }

  async function stopScreenShare() {
    const stream = screenStreamRef.current;
    if (!stream) return;
    const peer = peerRef.current;
    stream.getTracks().forEach((track) => {
      peer?.getSenders().forEach((sender) => {
        if (sender.track === track) peer.removeTrack(sender);
      });
      track.stop();
    });
    screenStreamRef.current = null;
    setScreenStream(null);
    send({ type: "screen-stopped" });
    await createAndSendOffer();
  }

  function toggleCamera() {
    if (!localStreamRef.current) {
      void startCamera();
      return;
    }
    const next = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCameraEnabled(next);
  }

  function toggleMic() {
    if (!localStreamRef.current) {
      void startCamera();
      return;
    }
    const next = !micEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicEnabled(next);
  }

  async function finish() {
    if (role === "candidate") await api(`/public/sessions/${token}/finish`, { method: "POST" }, false);
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    peerRef.current?.close();
    socketRef.current?.close();
    setActive(false);
    onFinish?.();
  }

  useEffect(() => {
    void attachStream(localVideoRef.current, localStream);
  }, [localStream]);

  useEffect(() => {
    void attachStream(localScreenRef.current, screenStream);
  }, [screenStream]);

  useEffect(() => {
    void attachStream(remoteVideoRef.current, remoteCameraStream);
  }, [remoteCameraStream]);

  useEffect(() => {
    void attachStream(remoteScreenRef.current, remoteScreenStream);
  }, [remoteScreenStream]);

  useEffect(() => {
    void attachStream(remoteAudioRef.current, remoteAudioStream);
  }, [remoteAudioStream]);

  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
  }, []);

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      peerRef.current?.close();
      socketRef.current?.close();
    };
  }, []);

  return (
    <div ref={roomRef} className="min-h-screen bg-[#0b1520] text-white">
      {roomAlerts.length > 0 && (
        <div className="fixed right-5 top-20 z-50 w-[min(380px,calc(100vw-2.5rem))] space-y-3">
          {roomAlerts.map((alert) => (
            <div key={alert.id} className="rounded-2xl border border-amber-300/50 bg-[#172333] p-4 shadow-2xl">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-amber-300/15 p-2 text-amber-200"><AlertTriangle size={18} /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">{alert.title}</p>
                  <p className="mt-1 text-sm leading-5 text-slate-300">{alert.message}</p>
                </div>
                <button onClick={() => setRoomAlerts((current) => current.filter((item) => item.id !== alert.id))} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Mbyll njoftimin">
                  <X size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3 font-bold">
          <ShieldCheck className="text-teal-300" /> Nemo Call
          <span className="hidden text-sm font-normal text-slate-400 sm:inline">· {session.title}</span>
        </div>
        <div className="flex items-center gap-4">
          {active && role === "candidate" && (
            <InterviewMonitor token={token} videoRef={localVideoRef} active={active} cameraStream={localStream} screenStream={screenStream} onSignal={setLastSignal} />
          )}
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${peerPresent || remoteCameraStream ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-slate-300"}`}>
            {peerPresent || remoteCameraStream ? "Other person connected" : "Waiting for other person"}
          </span>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 p-5 lg:grid-cols-[1fr_320px]">
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
        <section className="grid gap-4 md:grid-cols-2">
          <VideoPanel label={role === "hr" ? "You (Host)" : session.candidate_name} videoRef={localVideoRef} active={!!localStream && cameraEnabled} speaking={localSpeaking} muted />
          <VideoPanel label={role === "hr" ? session.candidate_name : "Host"} videoRef={remoteVideoRef} active={!!remoteCameraStream} present={peerPresent} speaking={remoteSpeaking} />
          {(screenStream || remoteScreenStream) && (
            <>
              <VideoPanel label="Your screen" videoRef={localScreenRef} active={!!screenStream} muted />
              <VideoPanel label={role === "hr" ? "Participant screen" : "Host screen"} videoRef={remoteScreenRef} active={!!remoteScreenStream} />
            </>
          )}
        </section>

        <aside className="space-y-4">
          {!active && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center">
              <Eye className="mx-auto text-teal-300" size={34} />
              <h1 className="mt-4 text-xl font-bold">{role === "hr" ? "Hyr si host" : "Join Nemo Call"}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">Kamera dhe mikrofoni janë opsionale. Nemo Call kap sinjale si tab tjetër, minimize/focus loss, resize dhe copy/paste.</p>
              {mediaBlockedByBrowser && (
                <p className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-left text-xs leading-5 text-amber-100">
                  {mediaBlockedMessage}
                </p>
              )}
              <div className="mt-4 space-y-3 text-left">
                <DeviceSelect label="Kamera" kind="videoinput" devices={devices} value={cameraDeviceId} onChange={setCameraDeviceId} />
                <DeviceSelect label="Mikrofoni" kind="audioinput" devices={devices} value={micDeviceId} onChange={setMicDeviceId} />
              </div>
              <button onClick={start} className="btn-primary mt-5 w-full"><Eye size={18} /> {role === "candidate" ? "Join call" : "Hyr në call"}</button>
              {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
            </section>
          )}

          {active && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="font-semibold">Kontrollet</h2>
              {mediaBlockedByBrowser && (
                <p className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
                  {mediaBlockedMessage}
                </p>
              )}
              <div className="mt-4 grid gap-2">
                <ToggleButton active={!!localStream && cameraEnabled} onClick={toggleCamera} activeIcon={<Camera />} inactiveIcon={<CameraOff />} label={!localStream ? "Aktivizo kameren" : cameraEnabled ? "Kamera on" : "Kamera off"} />
                <ToggleButton active={!!localStream && micEnabled} onClick={toggleMic} activeIcon={<Mic />} inactiveIcon={<MicOff />} label={!localStream ? "Aktivizo mikrofonin" : micEnabled ? "Mikrofoni on" : "Mikrofoni off"} />
                <ToggleButton active={!!screenStream} onClick={screenStream ? stopScreenShare : startScreenShare} activeIcon={<MonitorUp />} inactiveIcon={<MonitorUp />} label={screenStream ? "Ndalo screen sharing" : "Nis screen sharing"} />
              </div>
              {!document.fullscreenElement && (
                <button onClick={() => roomRef.current?.requestFullscreen()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-sm">
                  <Maximize size={16} /> Fullscreen
                </button>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="font-semibold">Status</h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">Kamera/screen share janë opsionale. Sinjalet regjistrohen kur pjesëmarrësi hap tab/app tjetër, minimizon, humb fullscreen, përdor copy/paste, ose humb lidhjen.</p>
            {lastSignal && <p className="mt-3 rounded-lg bg-amber-400/10 p-2 text-xs text-amber-200">Sinjali i fundit u regjistrua per shqyrtim.</p>}
            {error && <p className="mt-3 rounded-lg bg-red-400/10 p-2 text-xs text-red-200">{error}</p>}
          </section>

          {role === "hr" && active && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">Live alerts për host</h2>
                <span className="rounded-full bg-amber-300/10 px-2 py-1 text-xs font-semibold text-amber-200">{liveEvents.length}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">Këtu të del direkt kur pjesëmarrësi hap tab/app tjetër, minimizon/humb focus, del nga fullscreen, përdor copy/paste, resize dritaren, ose ndalet kamera.</p>
              {liveEvents.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-slate-400">
                  Ende nuk ka sinjale live.
                </div>
              ) : (
                <ol className="mt-4 max-h-72 space-y-3 overflow-auto pr-1">
                  {liveEvents.map((event) => (
                    <li key={event.id} className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3">
                      <p className="text-sm font-semibold text-amber-100">{hrLiveEventTitle(event)}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-300">{hrLiveEventDetails(event)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {role === "candidate" && active && session.test && (
            <CandidateTestPanel token={token} test={session.test} />
          )}

          {active && <button onClick={finish} className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold"><PhoneOff size={17} /> Dil nga call</button>}
        </aside>
      </main>
    </div>
  );
}

function VideoPanel({ label, videoRef, active, present = false, speaking = false, muted = false }: { label: string; videoRef: React.RefObject<HTMLVideoElement | null>; active: boolean; present?: boolean; speaking?: boolean; muted?: boolean }) {
  return (
    <div className={`relative flex min-h-[300px] items-center justify-center overflow-hidden rounded-2xl bg-black shadow-2xl transition ${speaking ? "ring-4 ring-emerald-400/80 ring-offset-2 ring-offset-[#0b1520]" : "ring-1 ring-white/5"}`}>
      <video ref={videoRef} autoPlay muted={muted} playsInline controls={false} className={`h-full max-h-[62vh] w-full object-cover ${active ? "block" : "hidden"}`} />
      {!active && <div className="p-6 text-center text-slate-400"><Users className="mx-auto mb-3" />{present ? "Connected · camera off" : "Waiting..."}</div>}
      <div className="absolute bottom-4 left-4 rounded-lg bg-black/60 px-3 py-2 text-xs">{label}</div>
      {speaking && <div className="absolute right-4 top-4 rounded-full bg-emerald-400 px-3 py-1 text-xs font-semibold text-emerald-950">Speaking</div>}
    </div>
  );
}

function useSpeaking(stream: MediaStream | null, enabled: boolean) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || !enabled || stream.getAudioTracks().length === 0) {
      setSpeaking(false);
      return;
    }

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    analyser.fftSize = 512;
    source.connect(analyser);

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const centered = value - 128;
        sum += centered * centered;
      }
      const volume = Math.sqrt(sum / data.length);
      setSpeaking(volume > 9);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [enabled, stream]);

  return speaking;
}

function DeviceSelect({ label, kind, devices, value, onChange }: { label: string; kind: MediaDeviceKind; devices: MediaDeviceInfo[]; value: string; onChange: (value: string) => void }) {
  const rows = devices.filter((device) => device.kind === kind);
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white">
        <option value="">Default</option>
        {rows.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleButton({ active, onClick, activeIcon, inactiveIcon, label }: { active: boolean; onClick?: () => void; activeIcon: React.ReactNode; inactiveIcon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick && active}
      className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-sm transition ${active ? "bg-emerald-400/10 text-emerald-200" : "bg-black/20 text-slate-300 hover:bg-white/10"} disabled:cursor-default`}
    >
      <span className="flex items-center gap-2">{active ? activeIcon : inactiveIcon}{label}</span>
      <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-400" : "bg-slate-600"}`} />
    </button>
  );
}
