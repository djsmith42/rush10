# Rush 10 source export

Includes the game frontend, API server, shared packages, and existing preview sandbox.
Excludes secrets, database contents, browser player sessions, dependencies, build outputs, and internal workspace files.

## Requirements
A recent Node.js version (22.12+) and pnpm. Storage is a SQLite file (via better-sqlite3).
Install dependencies from this workspace root with `pnpm install --frozen-lockfile`.

## Build
- Shared libraries: `pnpm run typecheck:libs`
- Frontend: `NODE_ENV=production PORT=5173 BASE_PATH=/ pnpm --filter @workspace/rush-10 build`
- API: `pnpm --filter @workspace/api-server build`

## Hosting notes
Set DATABASE_PATH to the SQLite file location (outside any web-served directory); the API creates the file and table on startup. Run the API with NODE_ENV=production, PORT and DATABASE_PATH set (optionally HOST=127.0.0.1 behind a proxy) using `pnpm --filter @workspace/api-server start`.
The thesmithfam.org/rush10 deployment (systemd unit, Apache snippet, deploy logic) is in `scripts/deploy/`; redeploy with `./deploy`.
Serve the frontend build output with a production web server and proxy /api requests to the API. Configure SPA fallback for /game/:code links. Check vite.config.ts for the configured build output directory.
This is a source export, not a preconfigured standalone deployment.

## Existing games
Database data is NOT included. Migrating existing games requires a separate secure database backup/restore. Player sessions are browser-local and do not automatically transfer to a different domain.
