# Penrose Studio

Penrose Studio turns a topic or a book into a complete course: curriculum, narrated lecture videos, slides, quizzes and downloads, published to YouTube or Google Drive.

It runs as two processes that share one PostgreSQL database:

- **Web app** (`npm run dev` / `npm start`): the studio, sign in, workspaces and the platform admin console.
- **Worker** (`npm run worker`): runs AI generation, rendering and video encoding in the background.

## Configuration at a glance

Settings live in one of two places:

| Where | What | Change takes effect |
|---|---|---|
| `.env` (server file) | What the app needs before it can read the database: database address, auth secret, encryption key, portal owner, plus sign in with Google, branding and plans | After a restart |
| **Portal → Settings** (`/portal/settings`) | Email, publishing apps, media storage, rendering, worker, rate limiting and sign up | Within about 5 seconds, no restart |

Portal settings are stored in the database. API keys and passwords saved there are encrypted with `AI_KEYS_ENCRYPTION_KEY` and never shown again in full.

## 1. Requirements

- Node.js 24
- PostgreSQL 16 or newer
- For video and visuals: Google Chrome or Microsoft Edge installed, or run `npx playwright install chromium`. FFmpeg ships with the app.

## 2. Install

```bash
npm install          # also generates the Prisma client
cp .env.example .env
```

## 3. Fill in `.env`

Only these are required to start:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your PostgreSQL connection URL, e.g. `postgresql://user:password@localhost:5432/penrose?schema=public`. Use a database of its own for Penrose. |
| `BETTER_AUTH_SECRET` | Run `openssl rand -base64 32` and paste the result |
| `BETTER_AUTH_URL` | The public address of the app, e.g. `http://localhost:3000` |
| `AI_KEYS_ENCRYPTION_KEY` | Run `openssl rand -base64 32` again (a different value). Keep it safe: changing it later makes every saved AI key and portal secret unreadable. |
| `NEXT_PUBLIC_APP_URL` | Same address as `BETTER_AUTH_URL` |

To manage settings from the browser, turn on the platform admin console:

| Variable | Value |
|---|---|
| `PORTAL_ENABLED` | `true` |
| `PORTAL_INITIAL_OWNER_EMAIL` | The email you will sign up with. That account becomes the platform admin. |
| `PORTAL_PATH_PREFIX` | Optional, defaults to `/portal` |

Optional `.env` settings that still need a restart:

- **Sign in with Google:** `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Branding:** `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_DESCRIPTION`, `NEXT_PUBLIC_APP_DOMAIN`
- **Subscriptions:** `NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED`, the Stripe keys and the plan names, prices and trial days

## 4. Create the database tables

```bash
npx prisma migrate deploy
```

Run this again after every update that adds a migration.

## 5. Start the app

In two terminals:

```bash
npm run dev          # web app on http://localhost:3000
npm run worker:dev   # background worker (restarts on code changes)
```

The web app shows a setup checklist instead of the studio until every required `.env` value is set.

## 6. First sign in

1. Open the app and sign up with the email you set in `PORTAL_INITIAL_OWNER_EMAIL`.
2. Open `/portal` (or your `PORTAL_PATH_PREFIX`). Your platform admin account is created automatically.
3. Go to **Settings** in the portal sidebar and fill in the sections below.
4. In the studio, go to **Settings → AI providers** to add your AI provider keys for your workspace.

## 7. Portal settings

Each section saves on its own. A **From server file** badge means the value currently comes from `.env`. Saving the section stores it in the database, after which you can remove that line from `.env`. A secret that only exists in `.env` must be typed in once to move it.

| Section | Settings | Notes |
|---|---|---|
| **Email** | Resend API key, sender address | Without a key, emails are skipped. The sender must be on a domain verified in Resend. |
| **Publishing apps** | Google client ID and secret, Vimeo client ID and secret, Canvas developer keys | Register `<app address>/api/publishing/callback` as the redirect address in each app. Turn on the YouTube Data, Classroom and Drive APIs for the Google client. Google falls back to the sign in client when left blank. |
| **Media storage** | This server or S3 compatible bucket, local folder, bucket, region, endpoint, path style, access keys | Works with AWS S3, Cloudflare R2 (region `auto`), MinIO (turn on path style) and others. Files already saved stay where they were written. |
| **Rendering** | FFmpeg path, browser path, videos at once | Leave paths blank to use the bundled FFmpeg and an installed browser. A new browser path applies the next time the browser starts. |
| **Background worker** | Tasks at once, check for work interval | Applies on the worker's next loop. |
| **Security** | Upstash Redis URL and token, allow private AI addresses | Without Upstash, requests are not rate limited. Allow private addresses for a local model server such as Ollama in production. |
| **Sign up** | Open sign up | Turn off to make the platform invitation only. |

## Production

### Docker

`docker-compose.yml` applies migrations against PostgreSQL on the host, then starts the web app and the worker. Containers reach that database at `host.docker.internal`.

1. Create `.env.production` with the `.env` values from step 3, using your public address. `DATABASE_URL` in that file is overridden by Compose so it points at the host database.
2. Set `POSTGRES_PASSWORD`, `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_APP_DOMAIN` in your shell or a `.env` file next to `docker-compose.yml`. Optional: `POSTGRES_USER` (default `studio`), `POSTGRES_DB` (default `studio`), `POSTGRES_HOST` (default `host.docker.internal`), `POSTGRES_PORT` (default `5432`). The `NEXT_PUBLIC_` values are baked into the build.
3. Run:

```bash
docker compose up -d --build
```

4. Sign in and complete the portal settings as in steps 6 and 7.

### Without Docker

```bash
npx prisma migrate deploy
npm run build
npm start            # web app
npm run worker       # worker, as a separate long running process
```

Run at least one worker next to the web app. Several workers can run at once.

## Desktop app

The `desktop/` folder builds a standalone app with its own embedded database and local storage, so no `.env` setup is needed there.

```bash
cd desktop
npm install
npm run dev          # run the desktop app
npm run build        # build an installer
```

Migrations are applied automatically when the desktop app starts.

## Troubleshooting

- **The setup checklist keeps showing:** a required `.env` value is missing or empty. Restart after editing `.env`.
- **`/portal` returns not found:** `PORTAL_ENABLED` is not `true`, or you are signed in with a different email than `PORTAL_INITIAL_OWNER_EMAIL`.
- **A saved secret stopped working:** `AI_KEYS_ENCRYPTION_KEY` was changed. Restore the old key, or enter the secret again in portal settings.
- **Portal settings have no effect and the log says "could not load saved settings":** the database tables are missing. Run `npx prisma migrate deploy`.
- **Videos or visuals fail to render:** install Chrome or Edge, or set the browser path under Portal → Settings → Rendering.

## License

Proprietary. See [LICENSE](LICENSE).
