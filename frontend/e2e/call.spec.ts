import { writeFileSync } from "node:fs";
import { APIRequestContext, Browser, expect, Page, test } from "@playwright/test";

const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL ?? "hr@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "ChangeMe123!";
// The address the built pages call. The host's browser cookie is set for it, so it must be the same host name the page
// uses (the page is on localhost, so is this), not 127.0.0.1.
const API = process.env.E2E_BROWSER_API_URL ?? "http://localhost:8100/api";

// One login for the whole run: the API allows ten logins per account every fifteen minutes (retries and repeats must not use them up).
let hostToken: Promise<string> | undefined;
function loginHost(request: APIRequestContext) {
  hostToken ??= request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD }, headers: { Origin: WEB } }).then(async (login) => {
    expect(login.ok(), "the host account from the CI seed or your dev database").toBeTruthy();
    return (await login.json()).access_token as string;
  });
  return hostToken;
}

// A fake camera and microphone, so two browsers can join a real call on a machine with no hardware, and no permission
// prompt. mDNS candidates are switched off so both sides can reach each other on the loopback address in a container.
const mediaArgs = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns"];
test.use({ launchOptions: { args: mediaArgs } });

// What each browser's WebRTC connection and signaling socket did, with times. Attached to the report when a test fails, so a
// call that never got its picture can be read from the CI run instead of being reproduced.
const recordRtc = () => {
  const log: string[] = [];
  (window as unknown as { __rtcLog: string[] }).__rtcLog = log;
  const note = (text: string) => log.push(`${Math.round(performance.now())} ${text}`);
  const NativePeer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeer {
    constructor(config?: RTCConfiguration) {
      super(config);
      note("peer created");
      for (const name of ["signalingstatechange", "connectionstatechange", "iceconnectionstatechange", "negotiationneeded", "track"]) {
        this.addEventListener(name, () => note(`${name} signaling=${this.signalingState} connection=${this.connectionState} ice=${this.iceConnectionState}`));
      }
    }
  };
  // A camera track that ends by itself (the browser lost the device) looks, on the other side, like a call with no picture.
  const nativeStop = MediaStreamTrack.prototype.stop;
  MediaStreamTrack.prototype.stop = function () {
    note(`stop() on ${this.kind} track, called from ${(new Error().stack ?? "").split("\n").slice(2, 4).join(" <- ").replace(/\s+/g, " ")}`);
    nativeStop.call(this);
  };
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await nativeGetUserMedia(constraints);
    note("getUserMedia ok");
    stream.getTracks().forEach((track) => track.addEventListener("ended", () => note(`${track.kind} track ended by itself`)));
    return stream;
  };
  const nativeClose = RTCPeerConnection.prototype.close;
  RTCPeerConnection.prototype.close = function () {
    note("peer close()");
    nativeClose.call(this);
  };
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener("message", (event) => note(`socket in ${JSON.parse(event.data).type}`));
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      note(`socket out ${JSON.parse(String(data)).type}`);
      super.send(data);
    }
  };
};

type CallEvent = { event_type: string; severity: string; duration_seconds: number | null; metadata: Record<string, unknown> };

/** A scheduled call, a signed-in host browser and a candidate browser (two separate contexts), plus how to read the call back. */
async function openCall(browser: Browser, request: APIRequestContext, label: string) {
  const contextOptions = { baseURL: WEB, permissions: ["camera" as const, "microphone" as const] };
  const hostContext = await browser.newContext(contextOptions);
  const candidateContext = await browser.newContext(contextOptions);

  const token = await loginHost(request);
  // The session cookie is the token itself: set it so the host's pages (and the room's socket) are signed in.
  await hostContext.addCookies([{ name: "nemoguard_session", value: token, url: new URL(API).origin }]);
  const headers = { Origin: WEB, Authorization: `Bearer ${token}` };

  const created = await hostContext.request.post(`${API}/sessions`, {
    headers,
    data: {
      title: "Live call smoke",
      candidate_name: "Call Candidate",
      candidate_email: `call-${label}-${Date.now()}@example.com`, // unique per run: one candidate per host and address
      expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      require_screen_share: false,
      verify_candidate_email: false,
    },
  });
  expect(created.status()).toBe(201);
  const call = await created.json();
  // Polled often; maxRetries covers a reused idle keep-alive socket that the API has just closed (ECONNRESET).
  const detail = async () => (await (await hostContext.request.get(`${API}/sessions/${call.id}`, { headers, maxRetries: 3 })).json());

  await hostContext.addInitScript(recordRtc);
  await candidateContext.addInitScript(recordRtc);
  const candidate = await candidateContext.newPage();
  const host = await hostContext.newPage();

  // The candidate: consent, then the lobby, then in.
  const candidateJoins = async () => {
    await candidate.goto(`/join/${call.public_token}`);
    await expect(candidate.getByRole("heading", { name: "Para se të hysh në call" })).toBeVisible();
    await expect(candidate.getByRole("button", { name: "Pranoj dhe vazhdoj" })).toBeDisabled(); // not until they accept
    await candidate.getByRole("checkbox").check();
    await candidate.getByRole("button", { name: "Pranoj dhe vazhdoj" }).click();
    await candidateEnters();
    await expect.poll(async () => (await detail()).status).toBe("in_progress");
  };
  const candidateEnters = async () => {
    await expect(candidate.getByRole("heading", { name: /Gati për të hyrë/ })).toBeVisible();
    await candidate.getByRole("button", { name: "Hyr në call" }).click();
  };
  // The host: straight into the call's room.
  const hostJoins = async () => {
    await host.goto(`/sessions/${call.id}/room`);
    await host.getByRole("button", { name: "Hyr në call" }).click();
  };

  /** Runs a test body; on failure attaches both browsers' WebRTC logs, and always cleans up without hiding the failure. */
  const run = async (body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      for (const [name, page] of [["host", host], ["candidate", candidate]] as const) {
        const log = await page
          .evaluate(() => {
            const videos = [...document.querySelectorAll("video")].map((video) => {
              const tracks = ((video.srcObject as MediaStream | null)?.getTracks() ?? []).map((track) => `${track.kind}:${track.readyState}${track.muted ? ":muted" : ""}`);
              return `video muted=${video.muted} size=${video.videoWidth}x${video.videoHeight} ready=${video.readyState} paused=${video.paused} tracks=[${tracks}]`;
            });
            return [...((window as unknown as { __rtcLog?: string[] }).__rtcLog ?? []), ...videos];
          })
          .catch(() => ["(page not reachable)"]);
        const path = test.info().outputPath(`${name}-webrtc.log`); // a file, so it also stays next to the trace on a plain run
        writeFileSync(path, log.join("\n"));
        await test.info().attach(`${name}-webrtc.log`, { path, contentType: "text/plain" });
      }
      throw error;
    } finally {
      await hostContext.request.delete(`${API}/sessions/${call.id}`, { headers }).catch(() => undefined);
      await hostContext.close().catch(() => undefined);
      await candidateContext.close().catch(() => undefined);
    }
  };

  return { call, host, candidate, detail, candidateJoins, hostJoins, run };
}

/** Real frames from the other side: the remote tile is the one <video> that is not muted. */
const remoteFrames = (page: Page) => page.evaluate(() => [...document.querySelectorAll("video")].some((video) => !video.muted && video.videoWidth > 0));

// The one flow the whole product exists for, with nothing stubbed: the host's room, the candidate's consent and lobby, the
// signaling socket, WebRTC media both ways, a screen share started and stopped mid-call, signals reaching the host live,
// the host's private notes, and a clean ending. Both join orders run, because the two sides negotiate at the same moment
// whichever arrives second (a test like this once caught both sides offering at once and the host's camera being dropped).
for (const first of ["candidate", "host"] as const) {
  test(`a host and a candidate meet in a call, the ${first} first: media both ways, live signals, private notes, clean ending`, async ({ browser, request }) => {
    test.setTimeout(120_000);
    const { call, host, candidate, detail, candidateJoins, hostJoins, run } = await openCall(browser, request, first);

    await run(async () => {
      if (first === "candidate") {
        await candidateJoins();
        await expect(candidate.getByText("Duke pritur Host-i", { exact: true })).toBeVisible();
        await hostJoins();
      } else {
        await hostJoins();
        await expect(host.getByText("Duke pritur Call Candidate", { exact: true })).toBeVisible();
        await candidateJoins();
      }
      await expect(host.getByText("Call Candidate u lidh", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(candidate.getByText("Host-i u lidh", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => remoteFrames(host), { timeout: 30_000, message: "the candidate's camera reaches the host" }).toBe(true);
      await expect.poll(() => remoteFrames(candidate), { timeout: 30_000, message: "the host's camera reaches the candidate" }).toBe(true);

      // Sharing the screen mid-call is a second negotiation on a connection that is already up: the host gets a new tile, and
      // it goes away again when the candidate stops.
      await candidate.getByRole("button", { name: "Ndaj ekranin" }).click();
      await expect(host.getByText("Ekrani i kandidatit", { exact: true })).toBeVisible({ timeout: 20_000 });
      await candidate.getByRole("button", { name: "Ndalo ekranin" }).click();
      await expect(host.getByText("Ekrani i kandidatit", { exact: true })).toBeHidden({ timeout: 20_000 });
      await expect(host.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0); // no error banner on either side
      await expect(candidate.getByRole("alert").filter({ hasText: /\S/ }).filter({ hasNotText: "NemoGuardHR" })).toHaveCount(0);

      // The monitor starts reporting as soon as the candidate is in, and the host's panel says so.
      await expect.poll(async () => (await detail()).monitoring.last_seen_at, { timeout: 20_000 }).not.toBeNull();
      await expect(host.getByRole("tab", { name: /Sinjale/ })).toHaveAttribute("aria-selected", "true");

      // Signals: a paste, and one tab switch (opened, then closed with how long it lasted).
      await candidate.evaluate(() => {
        const data = new DataTransfer();
        data.setData("text/plain", "def secret():\n  return 42");
        document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      });
      // Stored first (the candidate's side did its job), then shown live (the socket carried it to the host's room).
      await expect.poll(async () => (await detail()).events.some((event: CallEvent) => event.event_type === "copy_paste"), { timeout: 15_000 }).toBe(true);
      await expect(host.getByText("Tekst/kod u paste (2 rreshta)")).toBeVisible({ timeout: 15_000 });

      await candidate.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(host.getByText("Pjesëmarrësi hapi tab/app tjetër")).toBeVisible({ timeout: 15_000 });
      await candidate.waitForTimeout(1200);
      await candidate.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      await expect
        .poll(async () => (await detail()).events.find((event: CallEvent) => event.event_type === "tab_hidden")?.duration_seconds, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);
      const stored = await detail();
      const paste = stored.events.find((event: CallEvent) => event.event_type === "copy_paste");
      expect(paste).toMatchObject({ severity: "medium", metadata: { operation: "paste", line_count: 2, content_stored: false } });
      expect(JSON.stringify(stored.events)).not.toContain("def secret"); // the length is kept, never the text
      expect(stored.events.filter((event: CallEvent) => event.event_type === "tab_hidden")).toHaveLength(1); // one switch, one event

      // The host's private notes save themselves and never reach the candidate.
      await host.getByRole("tab", { name: /Shënime/ }).click();
      await host.locator("#host-notes").fill("Kandidati duket i qetë");
      await expect(host.getByText(/U ruajt në/)).toBeVisible({ timeout: 10_000 });
      expect((await detail()).host_notes).toBe("Kandidati duket i qetë");
      const publicView = await host.request.get(`${API}/public/sessions/${call.public_token}`);
      expect(JSON.stringify(await publicView.json())).not.toContain("qetë");

      // The candidate leaves: they get the thank-you page and the host's room notices.
      await candidate.getByRole("button", { name: "Dil nga call-i" }).click();
      await expect(candidate.getByRole("heading", { name: /Faleminderit, Call/ })).toBeVisible();
      await expect(host.getByText("Duke pritur Call Candidate", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect.poll(async () => (await detail()).status).toBe("completed");

      // And the host leaves to the summary.
      await host.getByRole("button", { name: "Dil", exact: true }).click();
      await expect(host.getByRole("heading", { name: "Përmbledhja e call-it" })).toBeVisible();
      const finished = await detail();
      expect(finished.ended_at).not.toBeNull();
      expect(finished.event_count).toBeGreaterThanOrEqual(2);
    });
  });
}
