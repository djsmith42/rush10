// Plays whole games against bots over HTTP and checks they finish cleanly.
// Builds its own bundle in a temp directory, so it never touches dist/ (which production runs).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// The server logs a rejected bot move; rerun this file as a child to read its log.
if (!process.env.BOT_GAMES_CHILD) {
  const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, BOT_GAMES_CHILD: "1", NODE_ENV: "production", LOG_LEVEL: "error" }, encoding: "utf8" });
  const output = child.stdout + child.stderr;
  process.stdout.write(output);
  assert.equal(child.status, 0, "bot games failed");
  assert.ok(!output.includes("move was rejected"), "a bot move was rejected by the rules");
  console.log("Bot games passed");
  process.exit(0);
}

// Bundle beside the sources so the externals resolve from this package's node_modules.
const dir = mkdtempSync(new URL("../.bot-games-", import.meta.url).pathname);
process.env.DATABASE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "rush10-bots-")), "rush10.db");
process.on("exit", () => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(path.dirname(process.env.DATABASE_PATH), { recursive: true, force: true });
});
await build({
  entryPoints: { app: new URL("../src/app.ts", import.meta.url).pathname, strategy: new URL("../src/lib/bot-strategy.ts", import.meta.url).pathname },
  outdir: dir, bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" },
  external: ["better-sqlite3", "pino", "pino-http", "express", "express-rate-limit"], logLevel: "error",
});

// Bots wait for a deadline before each move; skip ahead instead of sleeping.
let skew = 0;
const realNow = Date.now;
Date.now = () => realNow() + skew;

const { default: app } = await import(pathToFileURL(path.join(dir, "app.mjs")).href);
const { chooseBotMove } = await import(pathToFileURL(path.join(dir, "strategy.mjs")).href);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api/rush10`;

let ip = 0;
async function call(route, { method = "POST", body, token } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    // A fresh client address per request keeps this test under the per-IP rate limits.
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${(++ip >> 8) & 255}.${ip & 255}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body && JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${route}: ${json.error}`);
  return json;
}

const { phases } = await call("/rules", { method: "GET" });
const parts = [
  [{ type: "group", size: 3 }, { type: "group", size: 3 }], [{ type: "group", size: 3 }, { type: "sequence", size: 4 }],
  [{ type: "group", size: 4 }, { type: "sequence", size: 4 }], [{ type: "sequence", size: 7 }], [{ type: "sequence", size: 8 }],
  [{ type: "sequence", size: 9 }], [{ type: "group", size: 4 }, { type: "group", size: 4 }], [{ type: "color", size: 7 }],
  [{ type: "group", size: 5 }, { type: "group", size: 2 }], [{ type: "group", size: 5 }, { type: "group", size: 3 }],
];
assert.equal(phases.length, parts.length);

async function playGame(botCount) {
  const created = await call("/rooms", { body: { playerName: "Tester" } });
  const { roomCode: code, playerToken: token, playerId } = created;
  const levels = ["easy", "medium", "hard"];
  for (let i = 0; i < botCount; i++) await call(`/rooms/${code}/action`, { body: { playerToken: token, action: "add-bot", ...(i % 2 ? { botLevel: "easy" } : {}) } });
  let room = await call(`/rooms/${code}`, { method: "GET", token });
  assert.equal(room.players.filter(player => player.isBot).length, botCount);
  assert.deepEqual(room.players.filter(player => player.isBot).map(player => player.botLevel), Array.from({ length: botCount }, (_, i) => i % 2 ? "easy" : "medium"));
  assert.equal(room.players[0].botLevel, undefined);
  // Removing works too: drop one and add it back.
  const dropped = room.players.find(player => player.isBot);
  room = await call(`/rooms/${code}/action`, { body: { playerToken: token, action: "remove-bot", targetPlayerId: dropped.id } });
  assert.equal(room.players.length, botCount);
  room = await call(`/rooms/${code}/action`, { body: { playerToken: token, action: "add-bot" } });
  // Every level plays in the game.
  for (const [i, bot] of room.players.filter(player => player.isBot).entries()) {
    room = await call(`/rooms/${code}/action`, { body: { playerToken: token, action: "set-bot-level", targetPlayerId: bot.id, botLevel: levels[i % 3] } });
  }
  assert.deepEqual(room.players.filter(player => player.isBot).map(player => player.botLevel), Array.from({ length: botCount }, (_, i) => levels[i % 3]));
  assert.equal(new Set(room.players.map(player => player.avatar)).size, room.players.length);
  room = await call(`/rooms/${code}/start`, { body: { playerToken: token } });

  for (let step = 0; step < 20000; step++) {
    skew += 10_000;
    room = await call(`/rooms/${code}`, { method: "GET", token });
    if (room.status === "finished") return room;
    if (room.status === "round-over") { room = await call(`/rooms/${code}/start`, { body: { playerToken: token } }); continue; }
    if (room.currentPlayerId !== playerId) continue;
    // The human seat plays with the bot strategy too, seeing only what its view shows.
    const self = room.players.find(player => player.id === playerId);
    const move = chooseBotMove({
      level: "medium",
      self: { id: playerId, phase: self.phase, hasLaidPhase: self.hasLaidPhase, hand: room.hand },
      opponents: room.players.filter(player => player.id !== playerId).map(player => ({ ...player, hand: Array(player.handCount) })),
      parts: parts[self.phase - 1], turnState: room.turnState, discardTop: room.discardTop, melds: room.melds, skippedPlayerIds: new Set(),
    });
    await call(`/rooms/${code}/action`, { body: { playerToken: token, ...move } });
  }
  throw new Error(`Game ${code} did not finish`);
}

try {
  for (const bots of [1, 2, 3, 5]) {
    const room = await playGame(bots);
    assert.equal(room.endReason, "level-10");
    const winner = room.players.find(player => player.id === room.winnerId);
    console.log(`${bots + 1} players: ${winner.name} (${winner.botLevel ?? "human seat"}) won after ${room.roundNumber} rounds`);
  }
} finally {
  server.close();
}
