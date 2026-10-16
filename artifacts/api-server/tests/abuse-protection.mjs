// Run after `pnpm --filter @workspace/api-server build`.
// Starts the production server on a throwaway database and checks every abuse limit.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const Database = createRequire(import.meta.url)("better-sqlite3");
const dir = mkdtempSync(path.join(tmpdir(), "rush10-abuse-"));
const databasePath = path.join(dir, "rush10.db");

async function freePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

/** Start a production server on a fresh database seeded with `rows` of [code, status, ageDays]. */
async function withServer(rows, run) {
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  const seed = new Database(databasePath);
  seed.exec("CREATE TABLE rush10_rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))");
  const insert = seed.prepare("INSERT INTO rush10_rooms VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))");
  for (const [code, status, ageDays] of rows) insert.run(code, JSON.stringify({ code, status }), `-${ageDays} days`);
  seed.close();

  const port = await freePort();
  const child = spawn(process.execPath, ["dist/index.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production", DATABASE_PATH: databasePath },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}/api/rush10`;
  try {
    for (let attempt = 0; ; attempt++) {
      if (child.exitCode !== null) throw new Error("Test API exited before becoming ready.");
      try { if ((await fetch(`${base}/rules`)).ok) break; } catch {}
      if (attempt > 100) throw new Error("Test API did not start.");
      await delay(100);
    }
    await run(base);
  } finally {
    child.kill("SIGKILL");
    await once(child, "exit").catch(() => {});
  }
}

// Each fake client sits behind Apache, which reports it in X-Forwarded-For.
const send = (base, route, { ip = "203.0.113.1", method = "POST", body } = {}) => fetch(`${base}${route}`, {
  method,
  headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
  body: method === "GET" ? undefined : (typeof body === "string" ? body : JSON.stringify(body ?? {})),
});
const create = (base, ip) => send(base, "/rooms", { ip, body: { playerName: "Host" } });

try {
  await withServer([
    ["OLDW", "waiting", 2], ["OLDF", "finished", 2], ["IDLE", "playing", 2], ["GONE", "playing", 8], ["NEWW", "waiting", 0],
  ], async base => {
    const remaining = new Database(databasePath, { readonly: true });
    const codes = remaining.prepare("SELECT code FROM rush10_rooms ORDER BY code").all().map(row => row.code);
    remaining.close();
    assert.deepEqual(codes, ["IDLE", "NEWW"], "stale lobbies, finished games, and week-old games are swept at startup");

    assert.equal((await send(base, "/test-rooms", { body: { scenario: "play", playerCount: 2 } })).status, 404, "test games are off in production");

    for (let i = 0; i < 10; i++) assert.equal((await create(base, "203.0.113.1")).status, 201);
    const limited = await create(base, "203.0.113.1");
    assert.equal(limited.status, 429, "an 11th game in an hour is refused");
    assert.match((await limited.json()).error, /Too many new games/);
    assert.equal((await create(base, "203.0.113.2")).status, 201, "another IP is unaffected");

    for (let i = 0; i < 60; i++) assert.equal((await send(base, "/rooms/ZZZZ/joinable", { ip: "203.0.113.3", method: "GET" })).status, 404);
    assert.equal((await send(base, "/rooms/ZZZZ/joinable", { ip: "203.0.113.3", method: "GET" })).status, 429, "code guessing is throttled");
    assert.equal((await send(base, "/rooms/ZZZZ/join", { ip: "203.0.113.3", body: { playerName: "Guesser" } })).status, 429, "join shares the lookup budget");

    const huge = JSON.stringify({ playerName: "x".repeat(10_000) });
    assert.equal((await send(base, "/rooms", { ip: "203.0.113.4", body: huge })).status, 413, "oversized bodies are rejected");

    // 600 requests a minute covers six players polling from one home network.
    const polls = await Promise.all(Array.from({ length: 600 }, () => send(base, "/rules", { ip: "203.0.113.5", method: "GET" })));
    assert.ok(polls.every(response => response.status === 200));
    assert.equal((await send(base, "/rules", { ip: "203.0.113.5", method: "GET" })).status, 429, "request floods are throttled");
  });

  await withServer(Array.from({ length: 200 }, (_, i) => [`W${String(i).padStart(3, "0")}`, "waiting", 0]), async base => {
    const full = await create(base, "203.0.113.6");
    assert.equal(full.status, 503, "new games are refused while 200 wait for players");
    assert.match((await full.json()).error, /server is full/);
  });
  console.log("abuse protection: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
