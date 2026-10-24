# Valet

Mobile command centre for **Bags** (Bagheera), butler to Shadrick Vidmar. This repository is the app. It is not a second Bags agent.

Open the site, sign in, and talk to Bags in text or by voice. The conversation is stored on the server. The phone UI is a dark, installable PWA.

## What works in this build

- The app serves and the production build completes (`npm run build`).
- Owner sign-in with `VALET_OWNER_PASSWORD`, plus a one-time pairing code for a second device.
- Text chat with Bags over the existing live socket. History lists earlier chats and can open one. A new chat does not erase the older ones. The current chat is reloaded after a new sign-in.
- Personality is **Cynical** by default, or Precise / Warm. That changes tone only.
- With no model key, a local butler replies. It can recall earlier lines in the chat. It cannot send mail, call agents, or finish tasks, and it says so.
- With `VALET_LLM_API_KEY`, replies come from an OpenAI-compatible chat API. If that call fails, Valet reports the failure and does not invent a successful answer.
- Activities leads with Open meeting and Run status check. Meeting approval is still checked on the server. A status check reports that Paperclip and PMS are not linked.
- Live (centre button) starts and stops a browser voice session with Bags. The glass orb shows IDLE, LISTENING, PROCESSING, SPEAKING, MUTED, or ERROR from that lifecycle. Triple-tap the orb to change the accent. The composer stays usable while Live is on; a typed line joins the same transcript. The top bar is the BAGS mark, a light or dark toggle, and Profile. Profile holds sign-in, pairing, lock, personality, mute, and the model name reported by health. Chrome on this machine reached LISTENING, PROCESSING, MUTED, and ERROR with the real speech recognizer. SPEAKING is wired for when the browser has a speech voice; this Chrome had none, so replies stayed on screen. No phone microphone, phone speaker, or Android device was used.

## What this build does not do

- It was not deployed. There is no production URL from this work.
- It was not installed or tested on an Android device.
- `vidmarholdings` was not readable with the available GitHub credentials (the API returned 404), so Aaron, Nehemiah, Solomon, Paperclip, and PMS are not connected. The Agents tab lists Bags only.
- `Bags-Mark-LIII` is a separate desktop assistant. It was not copied in, and its wake word and voice are not used.
- No TPPL or other client data. No smart-home controls. No incoming call from a real agent bus. The Calls tab can ring Bags locally in the browser.

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

Then open `http://127.0.0.1:8787`. The password is checked on the server. The browser stores the session token in `localStorage` so a refresh keeps the chat; lock the device from Profile to erase server data and the token.

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

Not deployed. There is no production URL. A host, a DNS name, and `VALET_OWNER_PASSWORD` are still required. The files below are the path for a Hostinger-style VPS once those exist.

Serve the app at the site root. The phone calls `./health` and `./api/…` relative to the page, and the live socket is `wss` on that same origin. Proxy the whole site to `127.0.0.1:8787`, including WebSocket upgrade. Do not mount the app under a subpath.

### systemd (Node 22 already installed)

From the repository root, as root:

```sh
VALET_OWNER_PASSWORD='choose-10-or-more-characters' ./deploy/install.sh
```

Optional, when Caddy is already installed and DNS points at this machine:

```sh
VALET_OWNER_PASSWORD='choose-10-or-more-characters' VALET_DOMAIN='the domain that points here' ./deploy/install.sh
```

The script checks Node 22, installs dependencies, writes `/etc/valet.env` (mode 600), creates `/var/lib/valet`, installs `deploy/valet.service`, and starts `valet`. It does not print the password. Confirm with:

```sh
curl -fsS http://127.0.0.1:8787/health
systemctl status valet
```

`GET /health` should include `"protocol": 1` and `"auth": "password"`.

If Caddy is absent, the script still starts Valet on localhost and leaves HTTPS to you. `deploy/Caddyfile` and `deploy/nginx-valet.conf` are the proxy snippets. Either one must forward `Upgrade` and `Connection` so the live socket works. Put your certificate paths in the nginx file. Caddy obtains a certificate when the domain resolves to this host and ports 80 and 443 are open.

Direct TLS without a proxy is also possible: set `VALET_TLS_KEY` and `VALET_TLS_CERT` in `/etc/valet.env` and set `VALET_PORT=443`. The proxy path is the one to use on a typical VPS.

### Docker

```sh
docker build -t valet .
# .env on the server, not in git. Same keys as .env.example.
# VALET_HOST=0.0.0.0 is set in the image. Publish only on localhost and proxy HTTPS in front.
docker compose up -d --build
curl -fsS http://127.0.0.1:8787/health
```

The compose file stores SQLite in the `valet-data` volume, mounted at `/var/lib/valet`.

GitHub Pages can still show the static files. That copy has no owner auth and no server history; chat stays in the browser only.

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
- `agents.js` — Bags's id is `bagheera_butler.agent`.
- `mock.js` — replies on this device when no server is reachable.
- `voice-session.js` — voice lifecycle. The orb reads it.
- `orb-state.js` — priority of the orb labels.
- `server/` — auth, SQLite history, live chat, meetings, and status checks.
- `test/p1.test.js` — the checks that were actually run with `npm test`.

## Security notes

- Passwords are checked with scrypt. Session tokens are random and only their SHA-256 is stored.
- Sign-in and pairing are rate-limited per address.
- Meeting creation requires `context_approved: true` on the server. Task creation requires `confirmed: true`. Unsupported task actions are rejected.
- Uploads require a session and `X-Upload-Consent: yes`. They are stored and not analysed.
- Lock device deletes sessions, messages, meetings, tasks, and events.
- The session token in `localStorage` is readable by any script on this origin. Keep the host limited to Valet.
