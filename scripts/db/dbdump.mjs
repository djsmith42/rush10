#!/usr/bin/env node
// Print the Rush 10 SQLite database in readable form. Local only: it opens the file
// read-only and is never bundled into the API or the published web build.
//
//   ./dbdump                     every table, with one line per game
//   ./dbdump GNBR XWXB           full detail for those games
//   ./dbdump --all               full detail for every game
//   ./dbdump --status=waiting    only games with that status (with the list or --all)
//   ./dbdump --json              every table, every column, unformatted (state parsed)
//   ./dbdump --db=/path/to.db    another database (default: $DATABASE_PATH or production)
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const Database = createRequire(path.join(root, "artifacts/api-server/package.json"))("better-sqlite3");

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => flag(name)?.split("=").slice(1).join("=");
if (flag("help") || args.includes("-h")) {
  console.log(readUsage());
  process.exit(0);
}
const dbPath = value("db") || process.env.DATABASE_PATH || "/var/lib/rush10/rush10.db";
const statusFilter = value("status");
const codes = args.filter((a) => !a.startsWith("-")).map((c) => c.toUpperCase());
if (!existsSync(dbPath)) fail(`No database at ${dbPath}`);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

// ── Styling ─────────────────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const sgr = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = sgr("1"), dim = sgr("2"), under = sgr("4");
const CARD_COLORS = { red: sgr("1;31"), blue: sgr("1;34"), green: sgr("1;32"), yellow: sgr("1;33") };
const STATUS_COLORS = { playing: sgr("32"), waiting: sgr("33"), "round-over": sgr("36"), finished: dim };
const visible = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
const pad = (s, n, right = false) => {
  const gap = " ".repeat(Math.max(0, n - visible(s).length));
  return right ? gap + s : s + gap;
};

function table(headers, rows, rightAligned = []) {
  const widths = headers.map((h, i) => Math.max(visible(h).length, ...rows.map((r) => visible(r[i]).length)));
  const line = (cells) => cells.map((c, i) => pad(c, widths[i], rightAligned.includes(i))).join("  ").trimEnd();
  return [bold(line(headers)), dim(widths.map((w) => "─".repeat(w)).join("  ")), ...rows.map(line)].join("\n");
}

function ago(iso) {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (Number.isNaN(seconds)) return iso;
  const [n, unit] = seconds < 90 ? [seconds, "s"] : seconds < 5400 ? [seconds / 60, "m"] : seconds < 129600 ? [seconds / 3600, "h"] : [seconds / 86400, "d"];
  return `${Math.round(n)}${unit} ago`;
}

const card = (c) => {
  if (!c) return dim("—");
  if (c.type === "wild") return sgr("1;35")("W");
  if (c.type === "skip") return sgr("1;37")("S");
  return (CARD_COLORS[c.color] ?? String)(c.value);
};
const cards = (list) => (list?.length ? list.map(card).join(" ") : dim("(none)"));
const shortToken = (t) => (t ? dim(`${t.slice(0, 8)}…`) : dim("—"));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)}K` : `${n}B`);

// ── Reading ─────────────────────────────────────────────────────────────────
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const rowsOf = (name) => db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all();

function games() {
  return db.prepare("SELECT code, state, updated_at FROM rush10_rooms ORDER BY updated_at DESC").all()
    .map((row) => ({ row, room: parse(row.state) }))
    .filter(({ room }) => !statusFilter || room.status === statusFilter);
}
function parse(state) {
  try { return JSON.parse(state); } catch { return { status: "unreadable" }; }
}

// ── Output ──────────────────────────────────────────────────────────────────
if (flag("json")) {
  const out = Object.fromEntries(tables.map(({ name }) => [name, rowsOf(name).map((row) =>
    "state" in row && typeof row.state === "string" ? { ...row, state: parse(row.state) } : row)]));
  console.log(JSON.stringify(out, null, 2));
} else if (codes.length || flag("all")) {
  const chosen = codes.length
    ? codes.map((code) => {
      const row = db.prepare("SELECT code, state, updated_at FROM rush10_rooms WHERE code = ?").get(code);
      if (!row) { console.error(sgr("31")(`No game ${code}`)); process.exitCode = 1; }
      return row && { row, room: parse(row.state) };
    }).filter(Boolean)
    : games();
  console.log(chosen.map(({ row, room }) => detail(row, room)).join(`\n\n${dim("═".repeat(72))}\n\n`));
} else {
  overview();
}

function overview() {
  console.log(`${bold("Database")}  ${dbPath}  ${dim(`(${tables.length} table${tables.length === 1 ? "" : "s"})`)}\n`);
  for (const { name, sql } of tables) {
    const count = db.prepare(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`).get().n;
    console.log(`${under(bold(name))}  ${dim(`${count} row${count === 1 ? "" : "s"}`)}`);
    console.log(dim(sql.replace(/\n\s*/g, " ").replace(/\(\s+/, "(")));
    console.log();
    if (name === "rush10_rooms") console.log(gameList());
    else console.log(genericTable(rowsOf(name)));
    console.log();
  }
  console.log(dim("Details: ./dbdump <CODE>…   Everything: ./dbdump --all   Raw: ./dbdump --json"));
}

function gameList() {
  const list = games();
  if (!list.length) return dim(statusFilter ? `(no ${statusFilter} games)` : "(empty)");
  const counts = {};
  for (const { room } of list) counts[room.status] = (counts[room.status] ?? 0) + 1;
  const rows = list.map(({ row, room }) => [
    bold(row.code),
    (STATUS_COLORS[room.status] ?? String)(room.status),
    String(room.roundNumber ?? ""),
    String(room.players?.length ?? 0),
    ago(row.updated_at),
    kb(row.state.length),
    (room.players ?? []).map((p) => `${p.id === room.currentPlayerId ? sgr("4")(p.name) : p.name}${dim(` L${p.phase}·${p.score}`)}`).join(", "),
  ]);
  const summary = Object.entries(counts).map(([s, n]) => `${(STATUS_COLORS[s] ?? String)(s)} ${n}`).join(dim(" · "));
  return `${table(["code", "status", "rnd", "plyrs", "updated", "size", "players (level·score, current underlined)"], rows, [2, 3, 5])}\n\n${summary}`;
}

function genericTable(rows) {
  if (!rows.length) return dim("(empty)");
  const headers = Object.keys(rows[0]);
  const cell = (v) => {
    const s = v === null ? dim("NULL") : typeof v === "object" ? "<blob>" : String(v);
    return visible(s).length > 60 ? `${s.slice(0, 57)}…` : s;
  };
  return table(headers, rows.map((r) => headers.map((h) => cell(r[h]))));
}

function detail(row, room) {
  const byId = new Map((room.players ?? []).map((p) => [p.id, p]));
  const who = (id) => (id ? byId.get(id)?.name ?? dim(id.slice(0, 8)) : dim("—"));
  const out = [];
  out.push(`${bold(`Game ${row.code}`)}  ${(STATUS_COLORS[room.status] ?? String)(room.status)}  ${dim(`round ${room.roundNumber} · updated ${ago(row.updated_at)} (${row.updated_at}) · ${kb(row.state.length)}`)}`);
  if (room.message) out.push(dim(`“${room.message}”`));
  out.push("");
  const turn = room.currentPlayerId ? `${who(room.currentPlayerId)} to ${room.turnState}` : room.turnState;
  out.push(`${bold("Turn")}     ${turn}`);
  out.push(`${bold("Host")}     ${who(room.hostPlayerId)}    ${bold("Dealer")} ${who(room.players?.[room.dealerIndex % (room.players?.length || 1)]?.id)}`);
  if (room.skippedPlayerIds?.length) out.push(`${bold("Skipped")}  ${room.skippedPlayerIds.map(who).join(", ")}`);
  if (room.winnerId || room.endReason) out.push(`${bold("Ended")}    ${room.endReason ?? ""}${room.winnerId ? `, winner ${who(room.winnerId)}` : ""}${room.endedByPlayerId ? `, by ${who(room.endedByPlayerId)}` : ""}`);
  out.push("");

  out.push(table(
    ["player", "avatar", "level", "score", "laid", "hand", "token"],
    (room.players ?? []).map((p) => [
      `${p.id === room.currentPlayerId ? "▶ " : "  "}${bold(p.name)}${p.isHost ? dim(" (host)") : ""}`,
      p.avatar ?? dim("—"),
      String(p.phase),
      String(p.score),
      p.hasLaidPhase ? sgr("32")("yes") : dim("no"),
      `${dim(`${p.hand?.length ?? 0}:`)} ${cards(sortHand(p.hand))}`,
      shortToken(p.token),
    ]),
    [2, 3],
  ));
  out.push("");

  const discard = room.discardPile ?? [];
  out.push(`${bold("Draw pile")}     ${plural(room.drawPile?.length ?? 0, "card")}${room.drawPile?.length ? dim(`, next ${visible(card(room.drawPile.at(-1)))}`) : ""}`);
  out.push(`${bold("Discard pile")}  ${plural(discard.length, "card")}${discard.length ? `, top ${card(discard.at(-1))}  ${dim(`(${visible(cards(discard.slice(-8).reverse()))}${discard.length > 8 ? " …" : ""})`)}` : ""}`);

  if (room.melds?.length) {
    out.push("", bold("Laid down"));
    for (const m of room.melds) {
      const label = m.type === "group" ? `group of ${m.declaredValue ?? "?"}`
        : m.type === "sequence" ? `sequence ${m.low ?? "?"}–${m.high ?? "?"}`
        : `${m.declaredColor ?? "?"} color`;
      out.push(`  ${pad(who(m.ownerId), 10)} ${pad(label, 16)} ${cards(m.cards)}`);
    }
  }

  if (room.events?.length) {
    out.push("", bold(`Recent events ${dim(`(last ${Math.min(10, room.events.length)} of ${room.events.length})`)}`));
    for (const e of room.events.slice(-10)) {
      const when = new Date(e.createdAt).toISOString().replace("T", " ").slice(0, 19);
      out.push(`  ${dim(when)}  ${pad(who(e.playerId), 10)} ${pad(e.kind, 12)} ${e.card ? card(e.card) : ""}${e.targetPlayerId ? ` → ${who(e.targetPlayerId)}` : ""}`);
    }
  }
  return out.join("\n");
}

function sortHand(hand = []) {
  const rank = (c) => (c.type === "wild" ? 100 : c.type === "skip" ? 200 : c.value);
  return [...hand].sort((a, b) => rank(a) - rank(b) || String(a.color).localeCompare(String(b.color)));
}

// The usage text is the comment block at the top of this file.
function readUsage() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  return lines.slice(0, lines.findIndex((line) => !line.startsWith("//"))).map((line) => line.replace(/^\/\/ ?/, "")).join("\n");
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
