# Valet

Mobile command centre for **Bags** (Bagheera), butler to Shadrick Vidmar. This repository is the app. It is not a second Bags agent.

Open the site, sign in, and talk to Bags in text. The conversation is stored on the server. The phone UI is a dark, installable PWA.

## What works in this build

- The app serves and the production build completes (`npm run build`).
- Owner sign-in with `VALET_OWNER_PASSWORD`, plus a one-time pairing code for a second device.
- Text chat with Bags over the existing live socket. History is reloaded after a new sign-in.
- Personality is **Cynical** by default, or Precise / Warm. That changes tone only.
- With no model key, a local butler replies. It can recall earlier lines in the chat. It cannot send mail, call agents, or finish tasks, and it says so.
- With `VALET_LLM_API_KEY`, replies come from an OpenAI-compatible chat API. If that call fails, Valet reports the failure and does not invent a successful answer.
- Meetings and status checks stay on this server. A status check reports that Paperclip and PMS are not linked. Approval flags are checked on the server.
- Voice-orb states (idle, listening, processing, speaking, muted, error) follow the existing browser speech controls. Triple-tap the orb to change the accent. Mute silences speech. This was not tested on a phone microphone.

## What this build does not do

- It was not deployed. There is no production URL from this work.
- It was not installed or tested on an Android device.
- `vidmarholdings` was not readable with the available GitHub credentials (the API returned 404), so Aaron, Nehemiah, Solomon, Paperclip, and PMS were not wired. Placeholder names in the Agents tab stay disconnected.
- `Bags-Mark-LIII` is a separate desktop assistant. It was not copied in, and its wake word and voice are not used.
- No TPPL or other client data. No smart-home controls. No incoming call from a real agent bus — the Calls tab can still simulate one in the browser.

## Run

Node.js 22 or newer.

```sh
npm install
cp .env.example .env
# set VALET_OWNER_PASSWORD to 10 or more characters
npm test
npm run build
npm start
```

Then open `http://127.0.0.1:8787`. The password is checked on the server. The browser stores the session token in `localStorage` so a refresh keeps the chat; lock the device from the connection panel to erase server data and the token.

A second device can be paired without the password. The code is single-use and lasts 5 minutes:

```sh
npm run pair-code
```

Or, while signed in, `POST /api/pair-codes` with the bearer token.

`npm start` serves this directory. After `npm run build`, the same server can serve the snapshot:

```sh
VALET_STATIC_ROOT=dist VALET_OWNER_PASSWORD='…' node server/index.js
```

`dist/` also contains the server files. On another machine, copy `dist/`, run `npm install` inside it, set the env vars, and `npm start`. The build does not deploy anything.

## Environment

| Variable | Purpose |
| --- | --- |
| `VALET_OWNER_PASSWORD` | Owner password, 10+ characters. Required for sign-in. |
| `VALET_DATA_DIR` | SQLite database and uploads. Default `./data`. |
| `VALET_HOST` | Bind address. Default `0.0.0.0`. |
| `VALET_PORT` | Default `8787`. |
| `VALET_SESSION_HOURS` | Session lifetime. Default 12, maximum 336. |
| `VALET_LLM_API_KEY` | Optional. Empty means the local butler. |
| `VALET_LLM_BASE_URL` | OpenAI-compatible base URL. Default `https://api.openai.com/v1`. |
| `VALET_LLM_MODEL` | Default `gpt-4o-mini`. |
| `VALET_STATIC_ROOT` | Folder that contains `index.html`. |
| `VALET_TLS_KEY`, `VALET_TLS_CERT` | Optional PEM files. If both are set, the server speaks HTTPS. |

Do not put the password or the model key in the static site. They are read only by the Node process.

## Deploy

Not done in this workspace. A production host needs:

1. Node 22, this repo, `npm install`, and a persistent `VALET_DATA_DIR`.
2. `VALET_OWNER_PASSWORD` set in the process environment, not in the client.
3. HTTPS. Android will not install a PWA, and the microphone will not start, on plain HTTP except for `localhost`. Either terminate TLS at Caddy or nginx and proxy to `127.0.0.1:8787`, or set `VALET_TLS_KEY` and `VALET_TLS_CERT`.
4. Serve the app at the site root. The client calls `./health` and `./api/…` relative to the page. A reverse proxy that mounts only `/valet/` while the API stays at `/` will miss the server. Proxy the whole origin.
5. Restart the process and confirm `GET /health` returns `"protocol": 1` and `"auth": "password"`.

GitHub Pages can still show the static files. That copy has no owner auth and no server history; it uses the in-browser demo and keeps chat in the browser only.

## Install on Android

These steps were not run on a device.

1. Deploy with HTTPS as above, and confirm the padlock in Chrome.
2. Open the site in Chrome.
3. Tap the Chrome menu (three dots). Choose **Install app** or **Add to Home screen**.
4. Confirm. A Bags icon is added.
5. Open it from the home screen. It should open without the browser address bar (`display: standalone`).
6. Tap **Sign in** and enter the owner password. Send a message. Leave the app and come back; the same history should load.
7. Updates are fetched network-first. If a stale page appears, pull to refresh once while online.

The manifest and service worker are `manifest.webmanifest` and `sw.js`. Icons are 192 and 512.

## Layout of the code

- `index.html`, `app.css`, `app.js` — the existing phone UI, extended with sign-in, history, and the orb.
- `agents.js` — Bags's id is `bagheera_butler.agent`. Other rows are placeholders.
- `mock.js` — demo replies when no server is reachable.
- `orb-state.js` — display state for the voice orb.
- `server/` — auth, SQLite history, live chat, meetings, and status checks.
- `test/p1.test.js` — the checks that were actually run with `npm test`.

## Security notes

- Passwords are checked with scrypt. Session tokens are random and only their SHA-256 is stored.
- Sign-in and pairing are rate-limited per address.
- Meeting creation requires `context_approved: true` on the server. Task creation requires `confirmed: true`. Unsupported task actions are rejected.
- Uploads require a session and `X-Upload-Consent: yes`. They are stored and not analysed.
- Lock device deletes sessions, messages, meetings, tasks, and events.
- The session token in `localStorage` is readable by any script on this origin. Keep the host limited to Valet.
