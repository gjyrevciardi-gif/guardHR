# InterviewGuard MVP

InterviewGuard është një aplikacion HR për regjistrimin e sinjaleve të integritetit gjatë intervistave online. Sinjalet paraqiten për **shqyrtim manual**; sistemi nuk etiketon kandidatin si mashtrues dhe nuk merr vendime punësimi.

## Struktura

```text
cheatHR/
├── frontend/                 # Next.js 15, React, TypeScript, Tailwind
│   ├── app/                  # login, dashboard, session, consent, interview room
│   ├── components/           # shell, badge, MediaPipe/browser monitor
│   └── lib/                  # API client, types, formatters
├── backend/
│   ├── app/api/              # auth, HR sessions, candidate, settings/audit
│   ├── app/models.py         # SQLAlchemy relations
│   ├── app/vision.py         # transient YOLO/OpenCV inference
│   └── tests/                # end-to-end API flow
├── database/schema.sql       # explicit PostgreSQL DDL
├── docker-compose.yml
└── .env.example
```

## Nisja më e shpejtë (Docker)

1. Kopjo `.env.example` në `.env` dhe ndrysho `JWT_SECRET` dhe fjalëkalimin fillestar. Nëse porta PostgreSQL është e zënë, ndrysho `POSTGRES_PORT` (p.sh. `55432`); komunikimi i brendshëm Docker mbetet në portën 5432.
2. Ekzekuto:

```bash
docker compose up --build
```

3. Hap `http://localhost:3100`. API docs janë në `http://localhost:8100/docs`.
4. Email-et lokale të kandidatëve shihen në Mailpit: `http://localhost:8025`.
4. Kredencialet default për zhvillim janë `hr@example.com` / `ChangeMe123!` (ndryshoji në `.env`).

Në nisjen e parë, PostgreSQL ekzekuton [database/schema.sql](database/schema.sql), ndërsa backend-i krijon përdoruesin fillestar. Modeli i vogël `yolo11n.pt` shkarkohet nga Ultralytics kur analiza e parë e frame-it ekzekutohet; cakto `YOLO_MODEL_PATH` në një file lokal në mjedise pa internet.

## Nisja pa Docker

Kërkohet Node.js 20+, Python 3.12+ dhe PostgreSQL 16+.

```bash
# PostgreSQL: krijo DB-në dhe apliko skemën
psql -U postgres -c "CREATE USER interviewguard WITH PASSWORD 'interviewguard_dev';"
psql -U postgres -c "CREATE DATABASE interviewguard OWNER interviewguard;"
psql -U interviewguard -d interviewguard -f database/schema.sql

# Backend
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements-cv.txt
copy .env.example .env                 # Windows; përdor cp në macOS/Linux
python -m app.seed
uvicorn app.main:app --reload --port 8100

# Frontend, në terminal tjetër
cd frontend
copy .env.local.example .env.local
npm install
npm run dev
```

Për backend pa computer vision (p.sh. vetëm testet e API-së), përdor `pip install -r requirements.txt`. Endpoint-i YOLO kërkon `requirements-cv.txt`.

## API kryesore

| Method | Endpoint | Qëllimi |
|---|---|---|
| POST | `/api/auth/login` | JWT login për HR |
| GET | `/api/auth/me` | Profili dhe retention policy |
| GET/POST | `/api/sessions` | Lista / krijimi i sesioneve |
| GET | `/api/sessions/{id}` | Timeline dhe reviews |
| POST | `/api/sessions/{id}/reviews` | Review manual |
| GET | `/api/public/sessions/{token}` | Detaje publike minimale |
| POST | `/api/public/sessions/{token}/consent` | Consent eksplicit |
| POST | `/api/public/sessions/{token}/start` | Nis sesionin |
| POST | `/api/public/sessions/{token}/events` | Regjistron një event neutral |
| POST | `/api/public/sessions/{token}/analyze-frame` | YOLO/OpenCV transient |
| POST | `/api/public/sessions/{token}/finish` | Përfundon sesionin |
| PUT | `/api/settings/retention` | Ndryshon ditët e ruajtjes |
| POST | `/api/settings/retention/purge` | Fshin eventet përtej afatit |
| GET | `/api/audit-logs` | Audit log i HR-it |

## Monitorimi dhe privatësia

- `visibilitychange`, `fullscreenchange`, eventet clipboard, track-et e medias dhe lidhja monitorohen në browser.
- MediaPipe Face Detector punon në browser. Mungesa e fytyrës raportohet vetëm pas 5 sekondash.
- Një frame JPEG i zvogëluar dërgohet çdo 5 sekonda te YOLO/OpenCV vetëm për klasat `person` dhe `cell phone`; bytes nuk ruhen.
- Video/audio nuk regjistrohen në MVP. `integrity_events` pastrohen sipas `retention_days` me endpoint-in purge (në prodhim thirre nga një scheduled job).
- Etiketat e vetme janë: `No events detected`, `Requires review`, `Review completed`, `Insufficient evidence`.
- Nuk ka emotion recognition, lie detection, personality analysis ose refuzim automatik.

## Kontrollet

```bash
cd backend
pytest -q

cd frontend
npm run typecheck
npm run build
```
