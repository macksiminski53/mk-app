# MK

A lightweight, real-time chat app in your browser: register/login, add friends by username, accept/decline friend requests, upload a profile picture, and chat 1:1 in real time.

## Stack

- **Backend**: Node.js, Express, Socket.io, SQLite (via Node's built-in `node:sqlite`, requires Node 22+), JWT auth, Multer for avatar uploads.
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
- `DB_PATH` (where the SQLite file lives — defaults to `server/data.sqlite`)
- `STRIPE_PAYMENT_LINK` (simplest option for MK ULTRA's $1 purchase — a Stripe Payment Link URL from the Dashboard under Payment Links. No secret API key needed for this path; the buyer's account id is appended automatically as `client_reference_id` when they're sent to it.)
- `STRIPE_SECRET_KEY` (alternate option — creates a Checkout Session per-purchase via the API instead of a static Payment Link. From the Stripe Dashboard under Developers > API keys.)
- `STRIPE_WEBHOOK_SECRET` (needed either way — from the webhook endpoint you create in Stripe pointing at `<your-server-url>/api/billing/webhook`, so Stripe's "payment completed" event is verified before granting MK ULTRA. Without it, unsigned events are still accepted for local testing, but this must be set before going live.)

If you're using a Payment Link, set its "after payment" redirect (in the Stripe Dashboard, under the link's settings) to `<your-client-url>/?ultra=success` so the app knows to refresh and show the new MK ULTRA badge/perks.

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

### Render

1. Push this project to a GitHub repo.
2. **Backend** — New "Web Service":
   - Root directory: `server`
   - Build command: `npm install`
   - Start command: `node index.js`
   - Environment variables: `JWT_SECRET` (random string), `CLIENT_ORIGIN` (fill in once you know the frontend URL).
   - Add a **persistent disk** mounted at `/app/data` (and ideally another at `/app/uploads` for profile pictures), set `DB_PATH=/app/data/data.sqlite` — without a persistent disk, the SQLite file and uploaded avatars reset on every deploy/restart on the free tier.
3. **Frontend** — New "Static Site":
   - Root directory: `client`
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Environment variable: `VITE_API_URL` = your backend's Render URL.
4. Go back to the backend service, set `CLIENT_ORIGIN` to the frontend's URL, and redeploy.
5. Send your friend the frontend's URL — that's the link that "just works" for them.

### Railway

Same shape — one service from `server/` with a volume for `/app/data` and `/app/uploads`, one static/service from `client/` (build with `npm run build`, serve `dist/`). Railway's volumes make persistence simpler than Render's free tier.

### A note on SQLite in production

SQLite works well for a small app but only if the file persists on disk and only one server instance writes to it. If you outgrow that, swap `server/db.js` for a hosted Postgres database — the rest of the app doesn't need to change much since all queries live in `db.js` and the route files.

## Features

- Register / log in (JWT-based sessions)
- Add friends by username, accept/decline incoming requests
- Real-time 1:1 messaging with typing indicators and online/offline presence
- Changeable profile picture (click your avatar in the bottom-left)
- Update Log and Friend Request panels in the top bar
- Remove a friend from the chat settings menu
