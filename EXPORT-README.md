# Rush 10 source export

Includes the game frontend, API server, shared packages, and existing preview sandbox.
Excludes secrets, database contents, browser player sessions, dependencies, build outputs, and internal workspace files.

## Requirements
A recent Node.js version (22.12+), pnpm, and PostgreSQL.
Install dependencies from this workspace root with `pnpm install --frozen-lockfile`.

## Build
- Shared libraries: `pnpm run typecheck:libs`
- Frontend: `NODE_ENV=production PORT=5173 BASE_PATH=/ pnpm --filter @workspace/rush-10 build`
- API: `pnpm --filter @workspace/api-server build`

## Hosting notes
Configure DATABASE_URL securely for your PostgreSQL database. Initialize a new database schema using `pnpm --filter @workspace/db push`; review proposed schema changes before applying to any existing database.
Run the API with NODE_ENV=production and PORT set using `pnpm --filter @workspace/api-server start`.
Serve the frontend build output with a production web server and proxy /api requests to the API. Configure SPA fallback for /game/:code links. Check vite.config.ts for the configured build output directory.
This is a source export, not a preconfigured standalone deployment.

## Existing games
Database data is NOT included. Migrating existing games requires a separate secure database backup/restore. Player sessions are browser-local and do not automatically transfer to a different domain.
