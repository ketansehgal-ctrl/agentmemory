# Quantum Accord App Studio

> **Parked here temporarily.** This project is unrelated to agentmemory. It lives on
> this branch only until it gets its own repository. Do not merge it into agentmemory
> `main`; agentmemory's `npm test` would also pick up these tests.
> To move it: copy this folder into a new repository and commit it there.

Clients describe the mobile app they want in plain words. The studio writes a real
React Native (Expo) app with Claude, shows it on their phone within minutes, lets them
ask for changes in a chat, and builds an installable Android app with one tap.

```
Client prompt ──▶ Claude writes the Expo app ──▶ Expo Snack preview (web + QR for Expo Go)
                         ▲                                │
                         └──── "Update my app" chat ◀─────┘
                                                          │
                                   "Build Android app" ──▶ EAS cloud build ──▶ APK download
```

## Status: working prototype

| Part | State |
| --- | --- |
| Web page (prompt, chat, preview, build button) | Done; checked in a browser on desktop and phone sizes |
| API, background jobs, project storage | Done; covered by tests |
| App generation with Claude | Done; covered by tests with a faked Claude. **Not yet run against the live API** |
| Phone preview via Expo Snack | Implemented with `snack-sdk`. **Not yet run live** |
| Android builds via EAS | Implemented (per-app signing key, APK). **Not yet run live** |
| iPhone builds, store publishing, client accounts, billing | Not started; see Roadmap |

The live parts need real keys (Anthropic, Expo), which this prototype was built without.
The first job for whoever deploys it: run one app end to end and fix anything the live
services do differently from their docs.

## Run it

Requirements: Node 20+, and a JDK (for `keytool`) on the machine that runs builds.

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY, and EXPO_TOKEN to enable builds
npm run dev               # http://localhost:3000
```

Production: `npm run build && npm start`. Run it on a server with a persistent disk
(Railway, Render, Fly.io or a VPS), not serverless: builds run the `eas` CLI and keep files.

### Deploy on Railway

The `Dockerfile` (Node 22 plus Java for `keytool`) and `railway.json` (Dockerfile build,
health check on `/api/config`) are ready for Railway.

1. Create a service from this folder: either from GitHub (set the service's Root Directory
   to this folder if it sits inside another repository), or from your computer with the
   Railway CLI: `railway up` inside this folder.
2. Add a volume mounted at **`/data`**. Saved projects, signing keys (`/data/studio`) and build
   workspaces (`/data/work`) live there; without it they vanish on every deploy.
3. Add the variables from the table below: at least `ANTHROPIC_API_KEY` and
   `STUDIO_ACCESS_KEY`, plus `EXPO_TOKEN` to switch on builds. Leave `PORT`, `DATA_DIR` and
   `WORK_DIR` unset; Railway and the Dockerfile set them.
4. Settings → Networking → Generate Domain, then open it and run one test app end to end.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key used to write apps |
| `CLAUDE_MODEL` | Model that writes apps (default `claude-opus-5-5`) |
| `EXPO_TOKEN` | Expo access token; without it the Build button is disabled |
| `EXPO_OWNER` | Expo account or organization that owns the client app projects |
| `APP_ID_PREFIX` | Android package / iOS bundle ID prefix (default `com.quantumaccord.apps`) |
| `STUDIO_ACCESS_KEY` | Optional shared key; the page asks for it once |
| `PORT`, `DATA_DIR`, `WORK_DIR` | Server port, saved projects and keys, build workspaces |

Checks: `npm test` (56 tests), `npm run typecheck`.

## How it works

- **`src/generator.ts`**: one streamed Claude request per app or change. It uses structured
  output (a JSON schema of app name, colour, files and packages), adaptive thinking at high
  effort, and server-side fallback on refusals. The output is validated: only `App.js` and
  `.js` files under `src/`, and only packages from an allowlist. If the app fails
  validation, Claude is asked once to fix it. A new app comes back whole. A change request
  sends the current files, and Claude returns only the files it adds or edits plus a list of
  files to delete; the studio merges that into the app. This keeps changes far cheaper than
  rewriting the whole app. Every request logs a `Claude usage (...)` line with its token
  counts, so real costs can be read from the server logs.
- **`src/prompts.ts`**: the instructions Claude follows: platform limits, the quality bar,
  and no website-in-a-wrapper apps, because app stores reject those.
- **`src/catalog.ts`**: the Expo SDK version and the packages apps may use, pinned to the
  versions Expo SDK 54 ships with. Snack previews currently run up to SDK 54. When Snack
  supports a newer SDK, bump both together.
- **`src/preview.ts`**: saves each version as an Expo Snack. The page embeds Snack's web
  player, and "Open on your phone" leads to Snack's QR code for the Expo Go app.
- **`src/builds.ts`, `src/expoProject.ts`**: write a full Expo project per app, then run
  `npm install`, `eas init` (first build only) and
  `eas build --platform android --profile preview --non-interactive --no-wait --json`.
  The page polls `eas build:view` for the APK link.
- **Signing keys**: each app gets its own Android upload key, created once with `keytool` and
  kept in `DATA_DIR/keystores/`. Google Play only accepts updates signed with the same key,
  so **back this folder up and never delete it**. Move it to a secrets store before real use.
- **`src/server.ts`**: REST API. Generation and builds run in the background, and the page
  polls for progress.

| Endpoint | What it does |
| --- | --- |
| `GET /api/config` | Which features are switched on |
| `POST /api/projects` `{prompt}` | Start a new app (202, then poll) |
| `GET /api/projects/:id` | App, chat, preview and builds |
| `POST /api/projects/:id/changes` `{prompt}` | Ask for a change |
| `POST /api/projects/:id/builds` `{platform:"android"}` | Start an Android build |
| `GET /api/projects/:id/builds/:buildId` | Build status and download link |

## Costs to expect

- **Claude**: at Opus pricing ($4 / $20 per million input / output tokens), a new app is
  roughly $0.80 to $1.20 (about 35,000 output tokens), and a change roughly $0.30 to $0.50,
  since only edited files come back. Read the real numbers from the `Claude usage` log lines
  in the first live runs and adjust plan prices from them.
- **Expo EAS**: the free plan has a small monthly build quota in a slow queue. Paid plans
  are needed once clients build regularly.
- **Store accounts**: paid by each client: Google Play $25 once, Apple $99 per year.

## Roadmap

1. **Live run**: generate, preview and build one real app; fix any gaps with Snack and EAS.
2. **Client accounts and billing**: sign-in, one workspace per client, plans and payment
   (Razorpay or Stripe), usage limits per plan.
3. **Store publishing**: clients connect their own Google Play service account and App Store
   Connect API key. Apple can reject apps that an app-making service submits for its clients
   (rule 4.2.6), so apps must publish under the client's own accounts. Then use `eas submit`.
4. **iPhone builds**: iOS build profile using the client's App Store Connect API key.
5. **Richer apps**: app icon and splash generation, a hosted backend for logins, orders and
   payments (for example Supabase), push notifications.
6. **Production hardening**: a database instead of JSON files, a job queue for generations
   and builds, rate limits, and audit logs.
