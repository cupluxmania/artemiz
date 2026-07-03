# Gerbang Inbox

A unified inbox for WhatsApp and Telegram — one dashboard, two channels, real messages, backed
by a real Postgres database.

## What this is

A working Node.js app: a real backend that connects to your Telegram bot and your WhatsApp
account, stores conversations in Postgres, and serves a live web dashboard — all deployable
to a real server.

- **Telegram** connects through the official Bot API — no approval needed, just a token.
- **WhatsApp** connects by scanning a QR code (like linking WhatsApp Web) using the
  `whatsapp-web.js` library. This is an **unofficial** method that automates your personal
  WhatsApp Web session — it is not Meta's approved Business API. Fine for personal/small-scale
  use; Meta can restrict accounts that push high volume through it. For a real business at
  scale, migrate to the official
  [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api) later —
  `routes.js` is written so `whatsapp.js` can be swapped out without touching anything else.
- **Storage** is Postgres, via `server/schema.sql` + `server/db.js`.

## Run it locally (with Docker — easiest)

1. Install [Docker](https://docs.docker.com/get-docker/)
2. Create a Telegram bot: message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token
3. Create `.env` from `.env.example`, add your `TELEGRAM_BOT_TOKEN`, and set `SESSION_SECRET`
   to a random string (e.g. `openssl rand -hex 32`) — leave `DATABASE_URL` blank, compose sets it
4. ```bash
   docker compose up --build
   ```
5. In another terminal, create a login for yourself (and one per teammate who needs access):
   ```bash
   docker compose exec app npm run create-user -- alice "a-strong-password" "Alice"
   ```
6. Open **http://localhost:3000**, log in, then scan the WhatsApp QR code with your phone
   (WhatsApp → Linked Devices → Link a Device)
7. Message your Telegram bot or your linked WhatsApp number — it shows up live, and replies
   from the dashboard actually send, tagged with whichever agent sent them.

Postgres data and the WhatsApp session both persist in Docker volumes between restarts.

## Run it locally (without Docker)

1. Install [Node.js](https://nodejs.org) v18+ and Postgres
2. `npm install`
3. Create a database: `createdb gerbang`
4. `cp .env.example .env`, set `DATABASE_URL=postgres://<user>:<pass>@localhost:5432/gerbang`,
   your `TELEGRAM_BOT_TOKEN`, and a random `SESSION_SECRET`
5. `npm start` once so the schema (including the `users` table) gets created, then in another
   terminal: `npm run create-user -- alice "a-strong-password" "Alice"`
6. Open **http://localhost:3000** and log in

## Deploy it online (Railway — recommended)

Railway supports long-running Node processes (required — WhatsApp needs a persistent
connection, not a serverless function) and a one-click Postgres add-on.

1. Push this project to a GitHub repo
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo**, pick this repo
   (Railway will detect the `Dockerfile` automatically)
3. **Add a database**: in the same project, click **+ New → Database → PostgreSQL**
4. Railway auto-injects `DATABASE_URL` into your app service — nothing to copy manually
5. In your app service's **Variables** tab, add `TELEGRAM_BOT_TOKEN` and a random
   `SESSION_SECRET` (e.g. `openssl rand -hex 32`)
6. **Add a volume** (Settings → Volumes) mounted at `/app/.wwebjs_auth` — without this, the
   WhatsApp login is lost and asks for a new QR scan on every redeploy
7. Deploy. Then, from the **Shell** tab on your app service (or `railway run`), create a login
   for each agent: `npm run create-user -- alice "a-strong-password" "Alice"`
8. Open the generated `*.up.railway.app` URL, log in, and scan the WhatsApp QR code from your
   phone
9. Your dashboard is now live at that URL, 24/7, with per-agent logins, and Telegram and
   WhatsApp both wired to a real Postgres database

Render.com and Fly.io work the same way (Dockerfile + Postgres add-on + persistent
disk/volume) if you'd rather use one of those.

## Security

This template includes:

- **Per-agent dashboard logins.** Every route (UI, API, and the Socket.io connection) requires
  a logged-in session. Accounts aren't self-serve — an admin creates one per teammate with
  `npm run create-user -- <username> <password> ["Display Name"]`, passwords are hashed with
  bcrypt, and sessions are stored server-side in Postgres (`connect-pg-simple`) and signed with
  `SESSION_SECRET`. Outgoing messages are tagged with whichever agent sent them. **Set
  `SESSION_SECRET` and create at least one user before deploying anywhere public** — the server
  logs a warning on startup if either is missing.
- **Login rate limiting.** Capped at 20 attempts per 15 minutes per IP, to slow down password
  guessing.
- **XSS protection.** Contact names, handles, and message text all come from strangers on
  WhatsApp/Telegram and are HTML-escaped before being rendered.
- **Rate limiting.** Outgoing messages are capped at 20/minute per IP, to avoid runaway loops
  getting your number flagged or banned.
- **Security headers** via `helmet`, and a 100kb request body limit.
- **Parameterized SQL** everywhere (no string-built queries), so it isn't SQL-injectable.

Things to still be deliberate about:

- **`.wwebjs_auth` is equivalent to your WhatsApp password.** It's excluded from git
  (`.gitignore`) and from Docker images (`.dockerignore`) — never commit it or share it. If you
  ever suspect it's been exposed, unlink the device from WhatsApp (Linked Devices) immediately.
- **Rotate `TELEGRAM_BOT_TOKEN` and `SESSION_SECRET`** if they're ever exposed (e.g. pasted
  into a public chat or committed by accident) — regenerate the bot token via @BotFather;
  rotating `SESSION_SECRET` also signs everyone out. If an individual agent's password is
  compromised, just re-run `npm run create-user -- <username> <new-password>` to reset it.
- **HTTPS**: Railway/Render/Fly all terminate TLS for you automatically on their generated
  domains — don't put this behind plain HTTP on the public internet.
- **WhatsApp ban risk** is a business risk, not a security bug: `whatsapp-web.js` automates a
  personal session outside Meta's official Business API, so high volume or spammy use can get
  the number restricted. Keep volume modest, or migrate to the official Cloud API for scale.
- All agents currently see and can reply to every conversation — there's no per-agent
  assignment, roles, or permissions yet (any logged-in agent can do anything). That's a natural
  next step if you need it.


- Only text messages are handled in this template. Images/documents/voice notes arrive but are
  currently ignored — extend `whatsapp.js` / `telegram.js` to handle `msg.hasMedia` /
  `msg.photo` etc. if you need them.
- Group chats are skipped by default in `whatsapp.js`.
- To disable a channel (e.g. you only want Telegram for now), set `ENABLE_WHATSAPP=false`.
- `server/schema.sql` runs automatically on startup (`CREATE TABLE IF NOT EXISTS`), so a fresh
  database provisions itself — no manual migration step.

## Project structure

```
gerbang-inbox/
  server/
    index.js         — app entry point, starts Express + Socket.io, runs schema on boot
    db.js             — Postgres data layer (conversations, messages, users)
    schema.sql        — table definitions
    whatsapp.js       — WhatsApp connection (whatsapp-web.js)
    telegram.js       — Telegram connection (Bot API)
    routes.js         — REST API used by the dashboard
    auth.js           — session middleware, login verification, password hashing
    auth-routes.js     — /api/auth/login, /logout, /me
    create-user.js     — CLI: npm run create-user -- <username> <password>
  public/
    index.html, app.js, styles.css  — the dashboard UI
    login.html, login.js            — the login screen
  Dockerfile          — includes Chromium deps for whatsapp-web.js
  docker-compose.yml  — app + Postgres for local dev
  railway.json        — Railway deploy config
```
