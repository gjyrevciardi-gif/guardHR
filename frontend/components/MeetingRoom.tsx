"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Camera, CameraOff, EyeOff, Maximize, Mic, MicOff, MonitorUp, PanelRightClose, PanelRightOpen, PhoneOff, ShieldCheck, Users, X } from "lucide-react";
import { HostRail } from "@/components/HostRail";
import { InterviewMonitor } from "@/components/InterviewMonitor";
import { Lobby } from "@/components/Lobby";
import { CandidateTestPanel } from "@/components/TestPanel";
import { Wordmark } from "@/components/Wordmark";
import { api, wsUrl } from "@/lib/api";
import { clock, dateTime, eventLabels, parseApiDate } from "@/lib/format";
import { monitorHealth } from "@/lib/monitor";
import { EventType, InterviewSession, RoomSession } from "@/lib/types";

type Role = "candidate" | "hr";
type RemoteTarget = "camera" | "screen";
type LiveEvent = {
  id: string;
  event_type: EventType;
  started_at: string;
  duration_seconds: number | null;
  confidence_score: number | null;
  severity?: "info" | "low" | "medium" | "high";
  metadata: Record<string, unknown>;
};

interface Props {
  token: string;
  role: Role;
  session: RoomSession;
  onFinish?: () => void;
  /** Host only: the call's id (for the review rail) and where "back" leads. */
  sessionId?: string;
  backHref?: string;
}

type TileId = "remoteCamera" | "remoteScreen" | "localCamera" | "localScreen";

// Used only if /rtc-config cannot be reached; the server-provided list (STUN/TURN) normally replaces it.
const fallbackRtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const signalingCloseMessages: Record<number, string> = {
  4401: "Sesioni i host-it ka skaduar. Kyçu përsëri.",
  4403: "Lidhja u refuzua nga serveri.",
  4404: "Linku i call-it nuk është i vlefshëm.",
  4409: "Call-i ka përfunduar ose u hap në një dritare tjetër.",
  4429: "Shumë përpjekje lidhjeje. Prit pak dhe provo përsëri.",
};

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

export function MeetingRoom({ token, role, session, onFinish, sessionId, backHref }: Props) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localScreenRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteScreenRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const rtcConfigRef = useRef<RTCConfiguration>(fallbackRtcConfig);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const nextRemoteVideoTarget = useRef<RemoteTarget>("camera");
  // Offer collisions ("glare"): both sides may start negotiating at once. The host is impolite (ignores a colliding offer),
  // the candidate is polite (drops its own offer and answers the host's), so exactly one negotiation wins. See onmessage.
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteCameraStream, setRemoteCameraStream] = useState<MediaStream | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [peerPresent, setPeerPresent] = useState(false);
  const [verified, setVerified] = useState(!session.verification_required);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraDeviceId, setCameraDeviceId] = useState("");
  const [micDeviceId, setMicDeviceId] = useState("");
  const [error, setError] = useState("");
  const [lastSignal, setLastSignal] = useState("");
  const [roomAlerts, setRoomAlerts] = useState<Array<{ id: string; title: string; message: string }>>([]);
  const [hostData, setHostData] = useState<InterviewSession | null>(null);
  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  const [focusChoice, setFocusChoice] = useState<TileId | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const localSpeaking = useSpeaking(localStream, micEnabled);
  const remoteSpeaking = useSpeaking(remoteAudioStream, true);
  const mediaBlockedByBrowser = typeof window !== "undefined" && !window.isSecureContext;
  const cameraLostMessage = "Kamera ose mikrofoni u ndal: ose e mori një aplikacion tjetër, ose u shkëput. Mbyll aplikacionet që e përdorin (Teams, Zoom) dhe rifresko faqen.";
  const mediaBlockedMessage ="Kamera, mikrofoni dhe screen share nuk aktivizohen ne HTTP me IP lokale. Monitoring per nderrim faqeje punon prape. Per kamera nga dy pajisje duhet HTTPS/tunnel, ose hapeni ne localhost ne te njejtin PC.";

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

  // Sends an offer. Not while an offer from the other side is being answered (setLocalDescription() would then produce an
  // answer): that exchange finishes on its own and the browser raises negotiationneeded again if more has to be offered.
  // From have-local-offer it offers again on purpose: an earlier offer sent to an empty room was lost.
  const createAndSendOffer = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer || socketRef.current?.readyState !== WebSocket.OPEN || peer.signalingState === "have-remote-offer") return;
    // The host makes the first offer, always: it offers as soon as the two meet. A candidate offer at the same moment collides
    // with it, and after the rollback Chrome can end up with a connection that never gathers a single ICE candidate.
    if (role === "candidate" && !peer.remoteDescription) return;
    try {
      makingOffer.current = true;
      await peer.setLocalDescription(); // the browser picks the right kind (an offer here)
      if (peer.localDescription) send({ type: peer.localDescription.type, description: peer.localDescription });
    } finally {
      makingOffer.current = false;
    }
  }, [role, send]);

  const addTracksToPeer = useCallback((peer: RTCPeerConnection, stream: MediaStream, kind: "camera" | "screen") => {
    stream.getTracks().forEach((track) => {
      const exists = peer.getSenders().some((sender) => sender.track === track);
      if (!exists) peer.addTrack(track, stream);
    });
    if (kind === "screen") send({ type: "screen-started" });
  }, [send]);

  const ensurePeer = useCallback(() => {
    if (peerRef.current) return peerRef.current;

    const peer = new RTCPeerConnection(rtcConfigRef.current);
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

    // Adding or removing a track (camera, screen) is what asks for a new negotiation; nothing else offers on its own.
    peer.onnegotiationneeded = () => void createAndSendOffer().catch(() => undefined);

    peer.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(peer.connectionState)) {
        setRemoteCameraStream(null);
        setRemoteAudioStream(null);
        setRemoteScreenStream(null);
      }
    };

    peerRef.current = peer;
    return peer;
  }, [addTracksToPeer, createAndSendOffer, remoteCameraStream, send]);

  // The other side is a new browser page every time it (re)joins, with its own ICE and DTLS identity: the old connection can
  // never be renegotiated with it, so drop it and let the next message build a fresh one.
  const dropPeer = useCallback(() => {
    const peer = peerRef.current;
    if (!peer) return;
    peer.onnegotiationneeded = peer.onicecandidate = peer.ontrack = peer.onconnectionstatechange = null;
    peer.close();
    peerRef.current = null;
    makingOffer.current = false;
    ignoreOffer.current = false;
    nextRemoteVideoTarget.current = "camera";
    setRemoteCameraStream(null);
    setRemoteAudioStream(null);
    setRemoteScreenStream(null);
  }, []);

  const connectSignaling = useCallback(() => {
    const socket = new WebSocket(`${wsUrl(`/ws/rooms/${token}`)}?role=${role}`);
    socketRef.current = socket;

    socket.onclose = (event) => {
      const reason = signalingCloseMessages[event.code];
      if (reason) setError(reason);
    };

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "peer-joined" || message.type === "peer-left") dropPeer();
      const peer = ensurePeer();

      if (message.type === "screen-started") nextRemoteVideoTarget.current = "screen";
      if (message.type === "screen-stopped") setRemoteScreenStream(null);
      if (message.type === "peers") setPeerPresent(message.roles.some((peerRole: string) => peerRole !== role));
      if (message.type === "peer-joined" && message.role !== role) setPeerPresent(true);
      if (message.type === "integrity-event" && role === "hr") {
        const event = message.event as LiveEvent;
        if (event.severity !== "info") {
          pushRoomAlert({
            id: event.id,
            title: hrLiveEventTitle(event),
            message: hrLiveEventDetails(event),
          });
        }
      }
      if (message.type === "integrity-event-closed" && role === "hr") {
        const event = message.event as LiveEvent;
        pushRoomAlert({ id: `${event.id}-closed`, title: "Pjesëmarrësi u kthye në faqe", message: `Mungoi ${Math.round(event.duration_seconds ?? 0)} sekonda` });
      }

      if ((message.type === "peers" && role === "hr" && message.roles.length > 0) || (message.type === "peer-joined" && role === "hr")) {
        await createAndSendOffer();
      }

      if (message.type === "offer" || message.type === "answer") {
        const description = message.description as RTCSessionDescriptionInit;
        const collision = description.type === "offer" && (makingOffer.current || peer.signalingState !== "stable");
        ignoreOffer.current = role === "hr" && collision; // the host wins a collision; the candidate rolls back and answers
        if (!ignoreOffer.current) {
          try {
            await peer.setRemoteDescription(description);
            if (description.type === "offer") {
              await peer.setLocalDescription();
              if (peer.localDescription) send({ type: "answer", description: peer.localDescription });
            }
          } catch {
            // A stale answer or a superseded offer: the exchange that is still open (or the next negotiationneeded) settles it.
          }
        }
      }

      if (message.type === "ice" && message.candidate) {
        try {
          await peer.addIceCandidate(message.candidate);
        } catch (err) {
          if (!ignoreOffer.current) throw err; // candidates for an offer we ignored are expected to fail
        }
      }
      if (message.type === "peer-left") {
        setPeerPresent(false);
        setRemoteCameraStream(null);
        setRemoteAudioStream(null);
        setRemoteScreenStream(null);
      }
    };
  }, [createAndSendOffer, dropPeer, ensurePeer, pushRoomAlert, role, send, token]);

  async function start() {
    setError("");
    try {
      if (role === "candidate") await api(`/public/sessions/${token}/start`, { method: "POST" }, false);

      rtcConfigRef.current = await api<RTCConfiguration>("/rtc-config", {}, false).catch(() => fallbackRtcConfig);
      setActive(true);
      setJoinedAt(new Date().toISOString());
      connectSignaling();
      void startCamera();
      if (role === "candidate") await roomRef.current?.requestFullscreen().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Monitorimi nuk mund të nisej");
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
      // A device another app took or that was unplugged ends its track by itself (stop() from here does not fire this), and a
      // track can even arrive already ended. Without a word the candidate just sits in a call nobody can see.
      camera.getTracks().forEach((track) => {
        if (track.readyState === "ended") setError(cameraLostMessage);
        else track.addEventListener("ended", () => setError(cameraLostMessage));
      });
      setLocalStream(camera);
      setCameraEnabled(camera.getVideoTracks().some((track) => track.enabled));
      setMicEnabled(camera.getAudioTracks().some((track) => track.enabled));
      await attachStream(localVideoRef.current, camera);
      if (peerRef.current) addTracksToPeer(peerRef.current, camera, "camera"); // negotiationneeded sends the offer
    } catch (err) {
      camera?.getTracks().forEach((track) => track.stop());
      const message = err instanceof Error ? err.message : "Leja për kamerën ose mikrofonin u refuzua";
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
      addTracksToPeer(peer, stream, "screen"); // negotiationneeded sends the offer
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
    send({ type: "screen-stopped" }); // removeTrack above raised negotiationneeded
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
  }, [localStream, active]);

  useEffect(() => {
    void attachStream(localScreenRef.current, screenStream);
  }, [screenStream, active]);

  useEffect(() => {
    void attachStream(remoteVideoRef.current, remoteCameraStream);
  }, [remoteCameraStream, active]);

  useEffect(() => {
    void attachStream(remoteScreenRef.current, remoteScreenStream);
  }, [remoteScreenStream, active]);

  useEffect(() => {
    void attachStream(remoteAudioRef.current, remoteAudioStream);
  }, [remoteAudioStream, active]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshDevices only calls state setters; subscribe once
  }, []);

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      peerRef.current?.close();
      socketRef.current?.close();
    };
  }, []);

  const hostView = role === "hr";
  const startedAt = hostData?.started_at ?? joinedAt;
  const elapsed = startedAt ? Math.max(0, (now - parseApiDate(startedAt).getTime()) / 1000) : 0;
  const health = hostData ? monitorHealth(hostData.monitoring, hostData.status, now) : null;
  const connected = peerPresent || !!remoteCameraStream;
  const otherName = hostView ? session.candidate_name : "Host-i";
  const showRail = !hostView || !focusMode;

  const tiles: Record<TileId, { label: string; videoRef: React.RefObject<HTMLVideoElement | null>; hasVideo: boolean; offText: string; speaking: boolean; muted: boolean; screen: boolean; visible: boolean }> = {
    remoteCamera: { label: otherName, videoRef: remoteVideoRef, hasVideo: !!remoteCameraStream, offText: connected ? "Kamera e fikur" : `Duke pritur ${otherName}…`, speaking: remoteSpeaking, muted: false, screen: false, visible: true },
    remoteScreen: { label: hostView ? "Ekrani i kandidatit" : "Ekrani i host-it", videoRef: remoteScreenRef, hasVideo: !!remoteScreenStream, offText: "", speaking: false, muted: false, screen: true, visible: !!remoteScreenStream },
    localCamera: { label: "Ti", videoRef: localVideoRef, hasVideo: !!localStream && cameraEnabled, offText: localStream ? "Kamera e fikur" : "Kamera nuk është hapur", speaking: localSpeaking, muted: true, screen: false, visible: true },
    localScreen: { label: "Ekrani yt", videoRef: localScreenRef, hasVideo: !!screenStream, offText: "", speaking: false, muted: true, screen: true, visible: !!screenStream },
  };
  const order: TileId[] = ["remoteCamera", "remoteScreen", "localCamera", "localScreen"];
  const autoFocus: TileId = remoteScreenStream ? "remoteScreen" : "remoteCamera";
  const focused: TileId = focusChoice && tiles[focusChoice].visible ? focusChoice : autoFocus;
  const thumbs = order.filter((id) => tiles[id].visible && id !== focused);

  const controls = (
    <div className="flex flex-wrap items-center justify-center gap-2 pt-3" role="toolbar" aria-label="Kontrollet e call-it">
      <ControlButton on={!!localStream && micEnabled} pressed={!!localStream && micEnabled} onClick={toggleMic} icon={micEnabled && localStream ? <Mic size={18} /> : <MicOff size={18} />} label={!localStream ? "Hap mikrofonin" : micEnabled ? "Mikrofoni" : "Mikrofoni i fikur"} />
      <ControlButton on={!!localStream && cameraEnabled} pressed={!!localStream && cameraEnabled} onClick={toggleCamera} icon={cameraEnabled && localStream ? <Camera size={18} /> : <CameraOff size={18} />} label={!localStream ? "Hap kamerën" : cameraEnabled ? "Kamera" : "Kamera e fikur"} />
      <ControlButton on={!!screenStream} highlight pressed={!!screenStream} onClick={screenStream ? stopScreenShare : startScreenShare} icon={<MonitorUp size={18} />} label={screenStream ? "Ndalo ekranin" : "Ndaj ekranin"} />
      <ControlButton on={false} onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void roomRef.current?.requestFullscreen())} icon={<Maximize size={18} />} label="Ekran i plotë" />
      {hostView && (
        <ControlButton on={focusMode} highlight pressed={focusMode} onClick={() => setFocusMode((value) => !value)} icon={focusMode ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />} label={focusMode ? "Shfaq panelin" : "Pamje e pastër"} />
      )}
      <button type="button" onClick={finish} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#b91c1c] px-4 text-sm font-semibold text-[#ffffff] transition hover:bg-[#a31818]">
        <PhoneOff size={18} aria-hidden="true" /> <span>{hostView ? "Dil" : "Dil nga call-i"}</span>
      </button>
    </div>
  );

  return (
    <div ref={roomRef} className={active ? "bg-stage" : "bg-canvas"}>
      {!active ? (
        <Lobby
          token={token}
          role={role}
          session={session}
          verified={verified}
          onVerified={() => setVerified(true)}
          devices={devices}
          cameraDeviceId={cameraDeviceId}
          micDeviceId={micDeviceId}
          onCamera={setCameraDeviceId}
          onMic={setMicDeviceId}
          onPermissionGranted={() => void refreshDevices()}
          onJoin={start}
          error={error}
          mediaBlocked={mediaBlockedByBrowser}
          mediaBlockedMessage={mediaBlockedMessage}
          backHref={backHref}
        />
      ) : (
        <div className="dark-ui flex min-h-dvh flex-col bg-stage text-stage-ink lg:h-dvh lg:overflow-hidden">
          <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
          {/* Always mounted: a live region is only announced if it exists before its content changes. */}
          <div role="status" aria-live="polite" className="pointer-events-none fixed left-1/2 top-16 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 space-y-2">
            {roomAlerts.map((alert) => (
              <div key={alert.id} className="pointer-events-auto rounded-xl border border-amber-300/40 bg-stage-raised p-3.5 shadow-2xl">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-amber-300/15 p-1.5 text-amber-200"><AlertTriangle size={16} aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-stage-ink">{alert.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-stage-muted">{alert.message}</p>
                    <p className="mt-1 text-[11px] text-stage-muted">Sinjal për shqyrtim, jo verdikt.</p>
                  </div>
                  <button onClick={() => setRoomAlerts((current) => current.filter((item) => item.id !== alert.id))} className="-mr-1.5 -mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-stage-muted hover:bg-white/10 hover:text-stage-ink" aria-label="Mbyll njoftimin">
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stage-line px-4 py-2.5">
            {backHref && (
              <Link href={backHref} className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-xl text-stage-muted hover:bg-white/10 hover:text-stage-ink" aria-label="Kthehu te call-i"><ArrowLeft size={18} aria-hidden="true" /></Link>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{session.title}</h1>
              <p className="truncate text-xs text-stage-muted">{hostView ? `me ${session.candidate_name}` : <Wordmark tone="light" />}</p>
            </div>
            <time className="rounded-lg bg-white/5 px-2.5 py-1 font-mono text-sm tabular-nums" aria-label="Kohëzgjatja e call-it">{clock(elapsed)}</time>
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${connected ? "bg-stage-accent/15 text-stage-accent" : "bg-white/10 text-stage-muted"}`}>
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-stage-accent" : "bg-stage-muted"}`} aria-hidden="true" />
              {connected ? `${otherName} u lidh` : `Duke pritur ${otherName}`}
            </span>
            {hostView && health && (
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${health.state === "active" ? "bg-stage-accent/15 text-stage-accent" : health.state === "silent" ? "bg-amber-300/15 text-amber-200" : "bg-white/10 text-stage-muted"}`}>
                {health.state === "silent" ? <AlertTriangle size={12} aria-hidden="true" /> : health.state === "active" ? <ShieldCheck size={12} aria-hidden="true" /> : <EyeOff size={12} aria-hidden="true" />}
                {health.label}
              </span>
            )}
            {!hostView && (
              <span className="ml-auto">
                <InterviewMonitor token={token} videoRef={localVideoRef} active={active} cameraStream={localStream} screenStream={screenStream} onSignal={setLastSignal} />
              </span>
            )}
          </header>

          <div className={`grid min-h-0 flex-1 grid-cols-1 ${showRail ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
            <main id="main" className="flex min-h-0 flex-col p-3 sm:p-4">
              {(error || mediaBlockedByBrowser) && (
                <p role="alert" className="mb-3 rounded-xl border border-amber-300/40 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">{error || mediaBlockedMessage}</p>
              )}
              <div className="relative aspect-video min-h-[240px] w-full flex-1 overflow-hidden rounded-2xl border border-stage-line bg-black [--th:4.5rem] sm:[--th:6.19rem] lg:aspect-auto">
                {order.map((id) => {
                  const tile = tiles[id];
                  const thumbIndex = thumbs.indexOf(id);
                  return (
                    <Tile
                      key={id}
                      label={tile.label}
                      videoRef={tile.videoRef}
                      hasVideo={tile.hasVideo}
                      offText={tile.offText}
                      speaking={tile.speaking}
                      muted={tile.muted}
                      screen={tile.screen}
                      mirror={id === "localCamera"}
                      visible={tile.visible}
                      thumb={id !== focused}
                      thumbIndex={Math.max(0, thumbIndex)}
                      onFocus={() => setFocusChoice(id)}
                    />
                  );
                })}
                {hostView && focusMode && (
                  <span className="absolute left-3 top-3 z-20 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-stage-ink">
                    {health?.label ?? "Monitori"} · pamje e pastër
                  </span>
                )}
              </div>
              {controls}
            </main>

            {hostView ? (
              <aside aria-label="Paneli i shqyrtimit" className={`${focusMode ? "hidden" : "flex"} max-h-[70vh] min-h-0 flex-col border-t border-stage-line bg-stage-rail lg:max-h-none lg:border-l lg:border-t-0`}>
                {sessionId && (
                  <HostRail
                    sessionId={sessionId}
                    now={now}
                    live={{ peerPresent: connected, remoteCamera: !!remoteCameraStream, remoteScreen: !!remoteScreenStream }}
                    onSession={setHostData}
                  />
                )}
              </aside>
            ) : (
              <aside aria-label="Informacion për call-in" className="flex min-h-0 flex-col gap-4 overflow-y-auto border-t border-stage-line bg-stage-rail p-4 lg:border-l lg:border-t-0">
                <section className="rounded-xl border border-stage-line bg-stage-raised p-4">
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-stage-accent" aria-hidden="true" /> Çfarë regjistrohet</h2>
                  <p className="mt-2 text-xs leading-5 text-stage-muted">Browser-i raporton sinjale si dalja nga faqja, humbja e fokusit, copy/paste ose ndërprerja e lidhjes. Video dhe zëri nuk regjistrohen. Sinjalet i shqyrton një njeri; asnjë vendim nuk merret automatikisht.</p>
                  {lastSignal && <p role="status" className="mt-3 rounded-lg bg-amber-300/10 p-2 text-xs leading-5 text-amber-100">Një sinjal u regjistrua për shqyrtim. Mund të vazhdosh normalisht.</p>}
                </section>
                {session.test && <CandidateTestPanel token={token} test={session.test} />}
              </aside>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, videoRef, hasVideo, offText, speaking, muted, screen, mirror, visible, thumb, thumbIndex, onFocus }: {
  label: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hasVideo: boolean;
  offText: string;
  speaking: boolean;
  muted: boolean;
  screen: boolean;
  mirror: boolean;
  visible: boolean;
  thumb: boolean;
  thumbIndex: number;
  onFocus: () => void;
}) {
  // The <video> stays mounted (hidden) so its stream survives a layout change; only the wrapper's classes move.
  const placement = !visible ? "hidden" : thumb ? "absolute right-3 z-10 aspect-video w-32 sm:w-44" : "absolute inset-0";
  const style = thumb ? ({ top: "calc(0.75rem + var(--i) * (var(--th) + 0.5rem))", ["--i" as string]: thumbIndex } as React.CSSProperties) : undefined;
  return (
    <div className={placement} style={style}>
      <div className={`relative h-full w-full overflow-hidden bg-black ${thumb ? "rounded-xl border border-stage-line shadow-lg" : ""} ${speaking ? "ring-2 ring-inset ring-stage-accent" : ""}`}>
        <video ref={videoRef} autoPlay muted={muted} playsInline controls={false} className={`h-full w-full ${screen ? "object-contain" : "object-cover"} ${mirror ? "[transform:scaleX(-1)]" : ""} ${hasVideo ? "block" : "hidden"}`} />
        {!hasVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stage-raised p-3 text-center text-stage-muted">
            <Users size={thumb ? 18 : 30} aria-hidden="true" />
            {!thumb && <p className="text-sm">{offText}</p>}
          </div>
        )}
        <span className="absolute bottom-2 left-2 max-w-[85%] truncate rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium text-[#eaf3e7]">{label}{speaking ? " · flet" : ""}</span>
        {thumb && <button type="button" onClick={onFocus} className="absolute inset-0 z-10 rounded-xl" aria-label={`Zgjero: ${label}`} />}
      </div>
    </div>
  );
}

function ControlButton({ on, pressed, highlight = false, onClick, icon, label }: { on: boolean; pressed?: boolean; highlight?: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  const style = highlight && on ? "bg-stage-accent text-[#0b1713]" : on ? "bg-white/10 text-stage-ink hover:bg-white/15" : "bg-white/5 text-stage-muted hover:bg-white/10 hover:text-stage-ink";
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition ${style}`}>
      <span aria-hidden="true">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </button>
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

