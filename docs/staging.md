# Staging

A staging host is a rehearsal of production on a real server: HTTPS with a real certificate, your own TURN relay, and the image with phone / extra-person detection (`INSTALL_CV=true`). Run one real call through it before any candidate does. Everything here builds on [deployment.md](deployment.md).

## What you need

- A Linux server with a public IPv4 address, Docker with Compose >= 2.24, and a DNS name pointing at it (`hr-staging.example.com` below).
- These ports open in the server's firewall and in the cloud provider's security group:

  | Port | Used by |
  |---|---|
  | 80/tcp, 443/tcp | the proxy (80 only redirects, and answers the certificate challenge) |
  | 3478/tcp and 3478/udp | TURN / STUN |
  | 5349/tcp | TURN over TLS (`turns:`) |
  | 49160-49200/udp | media relayed by TURN (`min-port`/`max-port` in `deploy/turnserver.conf`; each relayed participant uses one port, so about 40 at a time, and `total-quota` must be widened together with the range) |

- An SMTP relay: invitations, the candidate's email code and password reset go through it.

## Setup

1. **Clone** the repository on the server and create `.env` there (never commit it). On top of the values in the [production checklist](deployment.md#production-checklist):

   ```env
   PUBLIC_APP_URL=https://hr-staging.example.com
   INSTALL_CV=true                      # the default; phone / extra-person detection
   TURN_URLS=turn:hr-staging.example.com:3478?transport=udp,turn:hr-staging.example.com:3478?transport=tcp,turns:hr-staging.example.com:5349?transport=tcp
   TURN_SECRET=<python -c "import secrets; print(secrets.token_hex(32))">
   ICE_SERVERS=[{"urls":"stun:hr-staging.example.com:3478"}]
   ```

   `TURN_SECRET` is read by both the backend and the relay. The backend turns it into a credential that lasts 8 hours and hands it out from `/api/rtc-config`, so the secret itself is never published. `ICE_SERVERS` points STUN at your own relay as well; without it candidates still send their IP address to Google's STUN server (the default). Change either value and you must restart the backend and the relay.

2. **Certificate.** Port 80 must be reachable from the internet and the DNS name must already resolve to this server:

   ```bash
   ./deploy/renew-certs.sh hr-staging.example.com you@example.com
   ```

   It gets a Let's Encrypt certificate, installs it in `deploy/certs/` and starts the proxy. Run the same command from cron every day (`17 3 * * * cd /srv/nemoguard && ./deploy/renew-certs.sh hr-staging.example.com you@example.com >> deploy/renew.log 2>&1`): it does nothing until the certificate has under 30 days left, then stops the proxy for a few seconds, renews, copies and restarts the proxy and the relay. Let's Encrypt has rate limits; if you are only testing the script use its staging endpoint by adding `--test-cert` to the `certonly` line first (browsers will not trust that certificate).

3. **Start everything**, including the relay:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile turn up -d --build
   ```

   The first build downloads PyTorch (CPU) and, new in this release, the `yolo11n.pt` weights, so the first candidate frame no longer waits for a download. Expect several minutes and a large image.

4. **Smoke checks:**

   ```bash
   ./deploy/check-staging.sh https://hr-staging.example.com
   ```

   It checks the HTTP to HTTPS redirect, the certificate, `/api/health` (including `"vision": true`), that `/api/rtc-config` carries a TURN entry with a temporary credential, and that the TURN ports answer. It prints the frame counters too; they are all zero until a call has run.

5. **Prove the relay works.** The script cannot tell whether media actually flows through TURN.
   - Fetch a credential: `curl -s https://hr-staging.example.com/api/rtc-config`.
   - Open the WebRTC "Trickle ICE" sample (`webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`), remove the default servers, add one entry per URL from `TURN_URLS` with the `username` and `credential` from the response, and press *Gather candidates*. At least one candidate of type `relay` must appear for each URL. (Use only the temporary credential from the response, never `TURN_SECRET`.)
   - Then make a real call with one person on mobile data and the other on another network. In Chrome, `chrome://webrtc-internals` on either side shows the selected candidate pair; `relay` there means TURN carried the call.

6. **Rehearse a real call** with a test candidate: join, share the screen, hold up a phone and bring a second person into view, finish. Then read `/api/health`:

   ```bash
   curl -s https://hr-staging.example.com/api/health
   ```

   `frames.analyzed` should have grown. Judge the host by `frames.inference_ms_avg` / `inference_ms_max` and by how many frames were `dropped` (see *Known limits* in deployment.md). If drops are common with the number of simultaneous candidates you expect, the server is too small.

## What was and was not verified

Verified here, on a development machine: the backend credential derivation and configuration rules (tests), the compose files (`docker compose config`, also in CI), the shell scripts' control flow against a stubbed `docker` (nothing to do while the certificate is valid, renew when it is not, bring the proxy back even when the certificate request fails) and the TURN secret guard.

**Not verified: anything that needs a real server.** No real Let's Encrypt issuance, no real coturn (`deploy/turnserver.conf` was written from coturn's documentation), no relayed media, no real YOLO timing and no image build with the weights step (Docker was not available). Treat the first run on staging as the test: if coturn refuses to start, `docker compose --profile turn logs turn` says which line of `deploy/turnserver.conf` it dislikes.

## Known limits

- **TURN over TLS is on 5349, not 443.** Networks that only allow outbound 443 cannot reach the relay. Serving it on 443 needs its own IP address or an SNI-routing `stream` block in Nginx; neither is set up.
- **The relay reads the private key as an unprivileged user**, so `renew-certs.sh` makes `deploy/certs/privkey.pem` readable by every local account. Use a server dedicated to this app, or give the relay a separate certificate.
- **Credentials are public by design.** Anyone who can open `/api/rtc-config` (it is rate-limited, not authenticated, because candidates have no account) can obtain a relay credential for 8 hours. The relay caps itself (40 allocations in total, about 3 MB/s each) and refuses to relay into private networks, so abuse cannot exhaust the server, but it can fill the relay and block your own candidates. Watch the server's traffic and the relay's log.
- **If the server's own address is private** (AWS, GCP and Azure map a public IP onto a private one), uncomment `external-ip` and `allowed-peer-ip` in `deploy/turnserver.conf`, otherwise calls where both people are relayed fail.
- **One server, no failover.** The proxy, the app, the database and the relay share a host; renewing the certificate interrupts the proxy for a few seconds.
- The frame counters reset on every restart.
