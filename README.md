# NemoGuardHR MVP

NemoGuardHR është një aplikacion HR për regjistrimin e sinjaleve të integritetit gjatë intervistave online. Sinjalet paraqiten për **shqyrtim manual**; sistemi nuk etiketon kandidatin si mashtrues dhe nuk merr vendime punësimi.

## Struktura

```text
cheatHR/
├── frontend/                 # Next.js 15, React, TypeScript, Tailwind
│   ├── app/                  # login, dashboard, session, consent, interview room, tests/forms
│   ├── components/           # shell, badge, MediaPipe/browser monitor, meeting room
│   └── lib/                  # API client (cookie session), tipet, mesazhet e gabimeve (sq)
├── backend/
│   ├── app/api/              # auth, sessions, public (kandidati), tests, settings, signaling (WebSocket)
│   ├── app/models.py         # SQLAlchemy relations + CHECK constraints
│   ├── app/enums.py          # statuset dhe llojet e lejuara
│   ├── app/retention.py      # pastrimi sipas retention dhe fshirja e plotë e call/test
│   ├── app/ratelimit.py      # limitim kërkesash (në memorie, 1 worker)
│   ├── app/vision.py         # transient YOLO/OpenCV inference
│   ├── alembic/              # migrimet e PostgreSQL (e vetmja burim i skemës)
│   └── tests/                # pytest: API, auth, WebSocket, retention, migrime
├── deploy/nginx.conf         # reverse proxy HTTPS për prodhim
├── docker-compose.yml        # zhvillim
├── docker-compose.prod.yml   # overlay për prodhim (vetëm Nginx publik)
├── docs/deployment.md        # prodhimi, TURN, scheduling, kufizimet
├── docs/staging.md           # staging me TLS, TURN dhe zbulim telefoni: hapat, kontrollet, çfarë nuk është verifikuar
├── docs/signals.md           # rëndësia e sinjaleve, rregulli i rishikimit, mbulimi
├── docs/accessibility.md     # WCAG 2.2 AA: rregullat, si u verifikua, kufijtë
├── docs/candidate-checks.md  # testi i pajisjes dhe kodi me email para hyrjes
├── docs/product-design.md    # drejtimi i dizajnit, sistemi i tokenëve, çfarë u ndërtua dhe çfarë mbetet
└── .env.example
```

## Nisja më e shpejtë (Docker)

1. Kopjo `.env.example` në `.env` dhe ndrysho `JWT_SECRET` dhe fjalëkalimin fillestar. Nëse porta PostgreSQL është e zënë, ndrysho `POSTGRES_PORT` (p.sh. `55432`); komunikimi i brendshëm Docker mbetet në portën 5432.
2. Ekzekuto:

```bash
docker compose up --build
```

3. Hap `http://localhost:3100`. API docs janë në `http://localhost:8100/docs`.
4. Email-et lokale të kandidatëve shihen në Mailpit: `http://localhost:8025`. Nëse `.env` ka SMTP real (p.sh. Gmail), ftesat dërgohen vërtet; për zhvillim lokal lëre `SMTP_HOST=mailpit`.
5. Kredencialet e zhvillimit janë `hr@example.com` / `ChangeMe123!` (ndryshoji në `.env`). Në zhvillim regjistrimi publik është i hapur; në prodhim është i mbyllur dhe llogaritë i krijon administratori (`POST /api/auth/users`).

Në nisje backend-i ekzekuton `alembic upgrade head`, krijon përdoruesin fillestar dhe starton me **një worker**. Imazhi përfshin YOLO/OpenCV (`INSTALL_CV=true`, default) që zbulimi i telefonit dhe i personit shtesë të funksionojë; vendos `INSTALL_CV=false` për imazh më të vogël pa këtë zbulim (`/api/health` kthen `"vision": false` dhe backend-i logon një paralajmërim). Modeli `yolo11n.pt` shkarkohet nga Ultralytics kur analiza e parë e frame-it ekzekutohet; cakto `YOLO_MODEL_PATH` në një file lokal në mjedise pa internet.

Për prodhim shih [docs/deployment.md](docs/deployment.md).

## Nisja pa Docker

Kërkohet Node.js 20+, Python 3.12+ dhe PostgreSQL 16+ (13+ funksionon).

```bash
# PostgreSQL: krijo DB-në (skema krijohet nga Alembic)
psql -U postgres -c "CREATE USER interviewguard WITH PASSWORD 'interviewguard_dev';"
psql -U postgres -c "CREATE DATABASE interviewguard OWNER interviewguard;"

# Backend
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt        # shto -r requirements-cv.txt për zbulimin me YOLO
copy .env.example .env                     # Windows; përdor cp në macOS/Linux
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload --port 8100

# Frontend, në terminal tjetër
cd frontend
copy .env.local.example .env.local
npm install
npm run dev
```

Pa `DATABASE_URL` backend-i përdor një file SQLite lokal (vetëm për zhvillim/teste; migrimet janë vetëm për PostgreSQL).

### Përditësim nga një version i vjetër

Skema nuk krijohet më nga `database/schema.sql` por nga Alembic. Një databazë ekzistuese përditësohet me `alembic upgrade head` (Docker e bën automatikisht). Migrimi `0002` e ndan çdo kandidat të ndarë mes disa përdoruesve HR në një rekord për përdorues. Sesionet ekzistuese hyjnë me cookie; tokeni i vjetër në `localStorage` fshihet automatikisht.

## API kryesore

| Method | Endpoint | Qëllimi |
|---|---|---|
| POST | `/api/auth/login` | Login HR; vendos cookie `HttpOnly` (kthen edhe `access_token` për klientë API). Me verifikim në dy hapa përgjigjja është `401 mfa_required` derisa dërgohet edhe `code` |
| POST | `/api/auth/logout` | Fshin cookie-n e sesionit |
| POST | `/api/auth/logout-everywhere` | Ç'vlefëson çdo sesion të përdoruesit (kjo pajisje dhe të tjerat) |
| POST | `/api/auth/password` | Ndryshon fjalëkalimin (kërkon fjalëkalimin aktual); pajisjet e tjera dalin, kjo merr sesion të ri |
| POST | `/api/auth/password-reset/request` | Dërgon link rivendosjeje me email; përgjigjja është gjithmonë e njëjtë (nuk zbulon cilat email ekzistojnë) |
| POST | `/api/auth/password-reset/confirm` | Vendos fjalëkalim të ri me linkun (një herë, 60 minuta); të gjitha pajisjet dalin |
| POST | `/api/auth/mfa/setup` · `/enable` · `/disable` | Verifikimi në dy hapa (TOTP): çelës, aktivizim me kod (kthen 8 kodet e rikuperimit një herë), çaktivizim me fjalëkalim dhe kod |
| POST | `/api/auth/register` | Regjistrim HR (i mbyllur në prodhim) |
| POST | `/api/auth/users` | Krijim përdoruesi nga admin |
| GET | `/api/auth/me` | Profili dhe retention policy |
| GET/POST | `/api/sessions` | Lista (`limit`, `offset`) / krijimi i sesioneve; ftesa dërgohet në sfond |
| GET/DELETE | `/api/sessions/{id}` | Timeline dhe reviews / fshirje e plotë |
| POST | `/api/sessions/{id}/reviews` | Review manual |
| PUT | `/api/sessions/{id}/notes` | Ruan shënimet private të host-it (vetëm pronari; shfaqen vetëm te detaji i call-it, kurrë te kandidati) |
| GET/POST | `/api/tests` | Teste/formularë (listë me `limit`, `offset`); `POST /api/tests/generate-from-file` nga PDF/DOCX/TXT/MD |
| GET/PUT/DELETE | `/api/tests/{id}` | Detaje, editim, fshirje |
| GET | `/api/public/sessions/{token}` | Detaje publike minimale (pa link publik të testit) |
| POST | `/api/public/sessions/{token}/consent` | Consent eksplicit (idempotent) |
| POST | `/api/public/sessions/{token}/start` | Nis sesionin |
| POST | `/api/public/sessions/{token}/events` | Regjistron një event neutral (me rëndësi: info/low/medium/high) |
| PATCH | `/api/public/sessions/{token}/events/{id}` | Mbyll një event të hapur (kthimi në faqe): kohëzgjatja dhe rëndësia |
| POST | `/api/public/sessions/{token}/heartbeat` | Monitori raporton çdo 10 s; prej tij llogaritet mbulimi |
| POST | `/api/public/sessions/{token}/analyze-frame` | YOLO/OpenCV transient |
| POST | `/api/public/sessions/{token}/test-submission` | Dorëzon testin e call-it |
| POST | `/api/public/sessions/{token}/finish` | Përfundon sesionin |
| GET | `/api/public/tests/{token}` | Test/formular publik (një test jep vetëm titullin dhe numrin e pyetjeve, jo pyetjet) |
| POST | `/api/public/tests/{token}/start` | Fillimi i një testi publik: emri dhe emaili, kthen pyetjet dhe një `attempt` |
| POST | `/api/public/tests/{token}/submissions` | Dorëzim publik (një për email; testi kërkon `attempt` nga `/start`) |
| GET | `/api/rtc-config` | Serverat ICE (STUN/TURN) për WebRTC; me `TURN_URLS`+`TURN_SECRET` shton një kredencial TURN 8-orëshe |
| WS | `/api/ws/rooms/{token}?role=hr\|candidate` | Signaling; roli verifikohet në server |
| PUT | `/api/settings/retention` | Ndryshon ditët e ruajtjes |
| POST | `/api/settings/retention/purge` | Pastron të dhënat përtej afatit |
| GET | `/api/audit-logs` | Audit log i HR-it (`limit`, `offset`) |

## Monitorimi dhe privatësia

- `visibilitychange`, `fullscreenchange`, eventet clipboard, track-et e medias dhe lidhja monitorohen në browser.
- MediaPipe Face Detector punon në browser. Mungesa e fytyrës raportohet vetëm pas 5 sekondash.
- Një frame JPEG i zvogëluar dërgohet çdo 5 sekonda te YOLO/OpenCV vetëm për klasat `person` dhe `cell phone`; bytes nuk ruhen.
- Video/audio nuk regjistrohen në MVP.
- **Retention:** në nisje të API-t dhe çdo ditë (`RETENTION_PURGE_INTERVAL_HOURS`) dhe me kërkesë (`/settings/retention/purge`) fshihen `integrity_events`, përgjigjet e testeve, `consent_ip` dhe IP-të në audit log për call-et e përfunduara përtej afatit. Call-et që mbeten `in_progress` më shumë se `ABANDONED_SESSION_HOURS` (12 orë) mbyllen si të braktisura dhe ndjekin të njëjtin afat; linket e skaduara që s'u përdorën kurrë humbin vetëm IP-në e pranimit. Sesioni, review-t, shënimet private të host-it dhe emri i kandidatit mbeten derisa HR të fshijë call-in (`DELETE /api/sessions/{id}`), që heq gjithçka, përfshirë kandidatin nëse nuk ka call tjetër. Mund ta ekzekutosh edhe nga cron: `python -m app.retention`.
- IP-ja e kandidatit (consent, audit) merret nga lidhja TCP. `X-Forwarded-For` besohet vetëm kur `TRUST_PROXY_HEADERS=true` (Nginx i përfshirë e mbishkruan).
- Staging me certifikatë reale, TURN të vetin dhe zbulim telefoni (hapat, kontrollet dhe çfarë mbetet pa verifikuar): [docs/staging.md](docs/staging.md).
- Rëndësia e sinjaleve, rregulli i rishikimit dhe mbulimi i monitorimit: [docs/signals.md](docs/signals.md).
- Qasshmëria (WCAG 2.2 AA), konventat e UI dhe kufijtë e njohur: [docs/accessibility.md](docs/accessibility.md).
- Testi i pajisjes dhe verifikimi i email-it para hyrjes (çfarë provon dhe çfarë jo): [docs/candidate-checks.md](docs/candidate-checks.md).
- Rivendosja e fjalëkalimit, dalja nga të gjitha pajisjet dhe verifikimi në dy hapa (çfarë bëjnë dhe kufijtë e tyre): [docs/account-security.md](docs/account-security.md).
- Etiketat e vetme (vlerat e ruajtura dhe të API-t) janë: `No events detected`, `Requires review`, `Review completed`, `Insufficient evidence`. UI i shfaq shqip: "Pa sinjale", "Kërkon shqyrtim", "Shqyrtuar", "Prova të pamjaftueshme" (`reviewStatusLabels` në `frontend/lib/format.ts`).
- Nuk ka emotion recognition, lie detection, personality analysis ose refuzim automatik.

## Siguria në pika

- Sesioni HR është cookie `HttpOnly`, `SameSite=Lax` (`Secure` mbi HTTPS); kërkesat që ndryshojnë të dhëna me cookie kërkojnë `Origin` të lejuar.
- Login: kufizim për IP dhe për llogari; përpjekjet e dështuara regjistrohen në audit log.
- Llogaria: rivendosje fjalëkalimi me link një-përdorimësh, "Dil nga të gjitha pajisjet" dhe verifikim në dy hapa (TOTP) për çdo përdorues; në prodhim administratorët duhet ta aktivizojnë para se të përdorin funksionet e administratorit (`REQUIRE_ADMIN_MFA`). Detaje dhe kufij: [docs/account-security.md](docs/account-security.md).
- Rooms e thirrjes: roli `hr` kërkon cookie të vlefshme të pronarit të sesionit; kandidati hyn vetëm pasi ka dhënë consent dhe ka nisur; klientët mund të përcjellin vetëm mesazhe WebRTC (`offer`, `answer`, `ice`, `screen-*`).
- Në `APP_ENV=production` backend-i refuzon të niset me `JWT_SECRET` të dobët/placeholder, fjalëkalim admin default ose `PUBLIC_APP_URL` pa HTTPS.
- Kufijtë dhe ceilings të njohura (një worker, limitet në memorie) janë në [docs/deployment.md](docs/deployment.md).

## Kontrollet

```bash
cd backend
pip install -r requirements-dev.txt
ruff check .
pytest -q                                   # SQLite
# PostgreSQL (skema ndërtohet me Alembic dhe ekzekutohen edhe testet e migrimit):
docker run -d --name pg-test -e POSTGRES_USER=ng -e POSTGRES_PASSWORD=test -e POSTGRES_DB=ngtest -p 55433:5432 postgres:16-alpine
TEST_DATABASE_URL=postgresql+psycopg://ng:test@localhost:55433/ngtest pytest -q

cd frontend
npm run lint
npm run typecheck
npm run build

# Një test smoke me Playwright (kandidati bën një provim, hosti sheh pikët dhe sinjalet). Duhen ndezur API-ja në :8100
# dhe frontend-i në :3100 (p.sh. `node .next/standalone/server.js` me PORT=3100 pas `npm run build`).
npx playwright install chromium             # ose vendos PW_CHANNEL=chrome për Chrome-in që ke
npm run e2e                                 # E2E_EMAIL / E2E_PASSWORD nëse admini nuk është hr@example.com
```

CI (`.github/workflows/ci.yml`) ekzekuton të njëjtat kontrolle, përfshirë PostgreSQL. Dy workflow të tjerë: `e2e.yml` ndez API-n dhe frontend-in dhe ekzekuton testin smoke; `security.yml` ekzekuton `pip-audit` dhe `npm audit` për çdo PR dhe çdo të hënë (një dobësi e re te një varësi e pandryshuar del kështu pa PR). Dependabot (`.github/dependabot.yml`) hap PR javore për varësitë, imazhet Docker dhe actions.
