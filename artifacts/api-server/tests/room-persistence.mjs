// Run after `pnpm --filter @workspace/api-server build`.
// Uses the development database and creates one test game.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}/api/rush10`;
let child;
async function start() {
  child = spawn(process.execPath, ["dist/index.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Test API exited before becoming ready.");
    try { if ((await fetch(`${base}/rules`)).ok) return; } catch {}
    await delay(100);
  }
  throw new Error("Test API did not start.");
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL"); // Abrupt shutdown proves no shutdown hook is needed.
  await exited;
}
async function post(path, body, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal(response.status, expected);
  return response.json();
}
async function view(session) {
  const response = await fetch(`${base}/rooms/${session.roomCode}`, { headers: { Authorization: `Bearer ${session.playerToken}` } });
  assert.equal(response.status, 200);
  return response.json();
}
try {
  await start();
  const host = await post("/rooms", { playerName: "Storage host" }, 201);
  const guest = await post(`/rooms/${host.roomCode}/join`, { playerName: "Storage guest" });
  const avatarView = await post(`/rooms/${host.roomCode}/action`, {
    playerToken: guest.playerToken, action: "set-avatar", avatar: "owl",
  });
  assert.equal(avatarView.players.find(player => player.id === guest.playerId).avatar, "owl");
  assert.equal((await view(host)).players.find(player => player.id === guest.playerId).avatar, "owl",
    "Avatar choice must be visible to the other player");
  await post(`/rooms/${host.roomCode}/action`, {
    playerToken: guest.playerToken, action: "set-avatar", avatar: "invalid",
  }, 400);
  const lobby = await view(host);
  const roomUrl = `${base}/rooms/${host.roomCode}`;
  assert.equal((await fetch(roomUrl)).status, 403, "Polling without a token must be refused");
  assert.equal((await fetch(roomUrl, { headers: { Authorization: "Bearer not-a-player" } })).status, 403, "Unknown tokens must be refused");
  const legacy = await fetch(`${roomUrl}?playerToken=${host.playerToken}`);
  assert.deepEqual(await legacy.json(), lobby, "Tabs on the previous build may still poll with ?playerToken= during the transition");
  await stop();
  await start();
  assert.deepEqual(await view(host), lobby, "Lobby and saved player session must survive restart");

  await post(`/rooms/${host.roomCode}/start`, { playerToken: host.playerToken });
  const started = await view(host);
  await post(`/rooms/${host.roomCode}/action`, {
    playerToken: guest.playerToken, action: "set-avatar", avatar: "cat",
  }, 400);
  const current = started.currentPlayerId === host.playerId ? host : guest;
  const actionPath = `/rooms/${host.roomCode}/action`;
  const draw = { playerToken: current.playerToken, action: "draw-deck" };
  const responses = await Promise.all([fetch(`${base}${actionPath}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draw),
  }), fetch(`${base}${actionPath}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draw),
  })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400], "Only one simultaneous draw may commit");
  const before = await view(current);
  assert.equal(before.hand.length, 11);
  const drawEvents = before.events.filter(event => event.kind === "draw-deck");
  assert.equal(drawEvents.length, 1, "Concurrent draws must create only one event");
  assert.equal(drawEvents[0].card, null, "Draw animations must not expose private card faces");
  assert.equal(drawEvents[0].playerId, current.playerId);
  assert.ok(before.players.every(player => !("hand" in player) && !("token" in player)));
  await post(actionPath, { playerToken: current.playerToken, action: "discard", cardIds: ["missing-card"] }, 400);
  assert.deepEqual(await view(current), before, "Rejected action must not change state");
  const views = await Promise.all([view(host), view(guest)]);
  await stop();
  await start();
  assert.deepEqual(await Promise.all([view(host), view(guest)]), views, "Both private hands and full public state must survive abrupt restart");
  const card = before.hand.find(card => card.type !== "skip");
  const discarded = await post(actionPath, { playerToken: current.playerToken, action: "discard", cardIds: [card.id] });
  assert.equal(discarded.hand.length, 10);
  assert.equal(discarded.discardTop.id, card.id);
  assert.equal(discarded.events.at(-1).card.id, card.id, "Discard event exposes only the public discarded card");
  assert.notEqual(discarded.currentPlayerId, current.playerId);
  const other = current.playerId === host.playerId ? guest : host;
  const drawn = await post(actionPath, { playerToken: other.playerToken, action: "draw-discard" });
  assert.ok(drawn.hand.some(item => item.id === card.id), "Play must continue normally after restart");
  assert.equal(drawn.events.at(-1).kind, "draw-discard");
  assert.equal(drawn.events.at(-1).card, null);
  let skipPlayed = false;
  for (let turn = 0; turn < 110; turn++) {
    const state = await view(host);
    const actor = state.currentPlayerId === host.playerId ? host : guest;
    const opponent = actor.playerId === host.playerId ? guest : host;
    const handView = state.turnState === "draw"
      ? await post(actionPath, { playerToken: actor.playerToken, action: "draw-deck" })
      : await view(actor);
    const skip = handView.hand.find(card => card.type === "skip");
    if (skip) {
      await post(actionPath, { playerToken: actor.playerToken, action: "discard", cardIds: [skip.id], targetPlayerId: actor.playerId }, 400);
      assert.deepEqual(await view(actor), handView, "Self-skip rejection must not change state");
      const skipped = await post(actionPath, { playerToken: actor.playerToken, action: "discard", cardIds: [skip.id] });
      assert.equal(skipped.currentPlayerId, actor.playerId, "Two-player Skip must return the turn to its sender");
      assert.equal(skipped.turnState, "draw");
      assert.equal(skipped.discardTop.id, skip.id);
      assert.equal(skipped.hand.length, handView.hand.length - 1);
      const opponentName = skipped.players.find(player => player.id === opponent.playerId).name;
      assert.ok(skipped.message.includes(`skipped ${opponentName}`), "Skip feedback must name the opponent");
      await post(actionPath, { playerToken: opponent.playerToken, action: "draw-deck" }, 400);
      const nextDraw = await post(actionPath, { playerToken: actor.playerToken, action: "draw-deck" });
      const normalCard = nextDraw.hand.find(card => card.type !== "skip");
      const nextTurn = await post(actionPath, { playerToken: actor.playerToken, action: "discard", cardIds: [normalCard.id] });
      assert.equal(nextTurn.currentPlayerId, opponent.playerId, "Skip must only skip one turn");
      skipPlayed = true;
      break;
    }
    await post(actionPath, { playerToken: actor.playerToken, action: "discard", cardIds: [handView.hand[0].id] });
  }
  assert.ok(skipPlayed, "Test must exercise a real two-player Skip");
  console.log("PASS: automatic two-player Skip, named feedback, self-target rejection, repeat turn and single-use skip");
  console.log("PASS: avatars, event privacy, lobby, sessions, hands, turns, concurrent draws, rollback, abrupt restart, continued play");
} finally {
  await stop();
}
