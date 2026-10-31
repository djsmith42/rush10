// Runs the real API for the e2e suite on its own port and a throwaway database.
// Bundles beside the API sources (so externals resolve from its node_modules) and never touches dist/,
// which production runs.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const apiDir = path.join(root, "artifacts/api-server");
const { build } = createRequire(path.join(apiDir, "package.json"))("esbuild");

const databasePath = process.env.DATABASE_PATH;
if (!databasePath) throw new Error("DATABASE_PATH is required");
rmSync(path.dirname(databasePath), { recursive: true, force: true });
mkdirSync(path.dirname(databasePath), { recursive: true });

const dir = mkdtempSync(path.join(apiDir, ".e2e-build-"));
const cleanup = () => rmSync(dir, { recursive: true, force: true });
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));

await build({
  entryPoints: { app: path.join(apiDir, "src/app.ts") },
  outdir: dir, bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" },
  external: ["better-sqlite3", "pino", "pino-http", "express", "express-rate-limit"], logLevel: "error",
});
const { default: app } = await import(pathToFileURL(path.join(dir, "app.mjs")).href);
const port = Number(process.env.PORT);
app.listen(port, "127.0.0.1", () => console.log(`e2e API listening on ${port}`));
