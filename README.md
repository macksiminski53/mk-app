# MK

A lightweight, real-time chat app in your browser: register/login, add friends by username, accept/decline friend requests, upload a profile picture, and chat 1:1 in real time.

## Stack

- **Backend**: Node.js, Express, Socket.io, SQLite-compatible database via `@libsql/client` (works with a local file for dev, or a hosted [Turso](https://turso.tech) database in production so data survives redeploys), JWT auth, Multer for avatar uploads.
- **Frontend**: React + Vite, socket.io-client, dark red themed CSS.

## Project layout

```
mk/
  server/   # Express + Socket.io API
  client/   # React frontend
  docker-compose.yml
```

## Running locally (no Docker)

**Backend**

```
cd server
npm install
npm run dev        # or: npm start
```

Runs on http://localhost:4000 by default. Config via environment variables:

- `PORT` (default 4000)
- `JWT_SECRET` (set this to a long random string in production)
- `CLIENT_ORIGIN` (the frontend's URL, for CORS — defaults to `*`)
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — if set, the server connects to a hosted Turso database (persists across deploys). If left unset, it falls back to a local SQLite file at `server/data.sqlite` (fine for local dev, but resets on every redeploy on a host with no persistent disk — see the Turso setup section below).

Uploaded profile pictures are stored in `server/uploads/` and served at `/uploads/<filename>`.

**Frontend**

```
cd client
npm install
npm run dev
```

Runs on http://localhost:5173. Set `VITE_API_URL` in `client/.env` to point at your backend (defaults to `http://localhost:4000`).

Open two browser windows (or one normal + one incognito) to test chatting between two accounts.

## Running with Docker Compose

```
docker compose up --build
```

Builds and runs both services — backend on http://localhost:4000 (SQLite + uploads persisted in Docker volumes), frontend on http://localhost:5173. Edit `docker-compose.yml` to change `JWT_SECRET` before using this anywhere but your own machine.

## Deploying live on the internet (so you can send a friend a link)

The app is two independent pieces — deploy the backend as a **web service** and the frontend as a **static site**. Render and Railway are the easiest options for something this size.

### Setting up Turso (persistent database — do this first)

Render's free tier has no persistent disk, so a local SQLite file resets to empty on every redeploy. Turso is a free, hosted, SQLite-compatible database that fixes this — the app already talks to it via `@libsql/client`, you just need to create a database and give the server its URL/token.

1. Install the Turso CLI and sign up (free tier, no credit card required): see [docs.turso.tech/quickstart](https://docs.turso.tech/quickstart) — sign up with GitHub or email.
2. Create a database:
   ```
   turso db create mk-app
   ```
3. Get the connection URL:
   ```
   turso db show mk-app --url
   ```
   This prints something like `libsql://mk-app-yourname.turso.io` — this is your `TURSO_DATABASE_URL`.
4. Create an auth token:
   ```
   turso db tokens create mk-app
   ```
   This is your `TURSO_AUTH_TOKEN`.
5. On Render, open the backend web service → **Environment** → add both `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` → save (this triggers a redeploy). From then on, friends/messages/status/avatars survive every redeploy.

You can also do all of the above from [turso.tech](https://turso.tech)'s web dashboard instead of the CLI if you'd rather click through a UI.

### Render

1. Push this project to a GitHub repo.
2. **Backend** — New "Web Service":
   - Root directory: `server`
   - Build command: `npm install`
   - Start command: `node index.js`
   - Environment variables: `JWT_SECRET` (random string), `CLIENT_ORIGIN` (fill in once you know the frontend URL), `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (from the Turso setup above).
3. **Frontend** — New "Static Site":
   - Root directory: `client`
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Environment variable: `VITE_API_URL` = your backend's Render URL.
4. Go back to the backend service, set `CLIENT_ORIGIN` to the frontend's URL, and redeploy.
5. Send your friend the frontend's URL — that's the link that "just works" for them.

Note: uploaded avatars/attachments in `server/uploads/` still live on local disk, so they'll still reset on redeploy unless you also add a Render persistent disk mounted there. Friends, messages, and status text (the things that broke most often) are now safe once Turso is wired up.

### Railway

Same shape — one service from `server/` (with the same `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` env vars), one static/service from `client/` (build with `npm run build`, serve `dist/`).

### A note on the database layer

All database access lives in `server/db.js` via a small `db.prepare(sql).run/get/all(...)` wrapper around `@libsql/client`. Locally (no `TURSO_DATABASE_URL` set) it just points at a local SQLite file; in production it points at your hosted Turso database. If you ever outgrow SQLite/Turso entirely, this is the one file you'd swap out.

## Features

- Register / log in (JWT-based sessions)
- Add friends by username, accept/decline incoming requests
- Real-time 1:1 messaging with typing indicators and online/offline presence
- Changeable profile picture (click your avatar in the bottom-left)
- Update Log and Friend Request panels in the top bar
- Remove a friend from the chat settings menu
