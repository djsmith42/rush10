#!/usr/bin/env node
// Install, typecheck, test, build, and publish Rush 10 with every independent step
// running in parallel, shown as a live task board. No dependencies beyond Node.
//
// Every step is keyed on a content hash of its inputs: a step whose inputs (and
// outputs) match its last successful run is skipped. Pass --force to redo all.
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const api = path.join(root, "artifacts/api-server");
const web = path.join(root, "artifacts/rush-10");
const webOut = path.join(web, "dist/public");
const apiOut = path.join(api, "dist");
const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run"); // build and check only; ship nothing

// Resolve a package binary the way pnpm would, without paying for `pnpm exec`.
function bin(dir, name) {
  for (let d = dir; ; d = path.dirname(d)) {
    const p = path.join(d, "node_modules/.bin", name);
    if (existsSync(p)) return p;
    if (d === root) throw new Error(`${name} not found from ${dir}`);
  }
}

// ── Content hashing ──────────────────────────────────────────────────────────
const SKIP = new Set(["node_modules", "dist", ".data", ".tsbuildinfo", "tsconfig.tsbuildinfo"]);
const fileHashes = new Map();
function hashFile(p) {
  if (!fileHashes.has(p)) fileHashes.set(p, createHash("sha1").update(readFileSync(p)).digest("hex"));
  return fileHashes.get(p);
}
function walk(p, out, skip) {
  if (!existsSync(p)) return out.push(`${p}:missing`), out;
  let entries;
  try { entries = readdirSync(p, { withFileTypes: true }); } catch { return out.push(`${path.relative(root, p)}:${hashFile(p)}`), out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (skip && SKIP.has(e.name)) continue;
    const full = path.join(p, e.name);
    if (e.isDirectory()) walk(full, out, skip);
    else if (e.isFile()) out.push(`${path.relative(root, full)}:${hashFile(full)}`);
  }
  return out;
}
// Hash source paths (skipping build artifacts), or build outputs as-is.
const hashPaths = (paths, extra = "", skip = true) => {
  const h = createHash("sha1").update(extra);
  for (const p of paths) h.update(walk(path.resolve(root, p), [], skip).join("\n"));
  return h.digest("hex");
};
const packageJsons = ["package.json", ...["artifacts", "lib"].flatMap((d) => readdirSync(path.join(root, d)).map((p) => `${d}/${p}/package.json`)), "scripts/package.json"];
const shared = ["pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "tsconfig.json", ...packageJsons];

const cacheFile = path.join(root, "node_modules/.cache/rush10-deploy.json");
let cache = {};
try { cache = JSON.parse(readFileSync(cacheFile, "utf8")); } catch {}
function saveCache() {
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
}

const sh = (cmd, args) => new Promise((resolve) => execFile(cmd, args, (err, stdout) => resolve(err ? null : stdout.trim())));

// ── Tasks ────────────────────────────────────────────────────────────────────
// Each task starts once everything in `after` has finished. A task with `inputs`
// is skipped when their hash matches its last success (and `outputs`, if any,
// still match what it produced). `stamp` overrides the key for deploy steps,
// which compare the build output against what was last shipped.
const checks = ["typecheck libs", "typecheck api", "typecheck web", "typecheck scripts", "test web"];
const tasks = [
  { name: "install", inputs: [...packageJsons, "pnpm-lock.yaml", "pnpm-workspace.yaml"], cmd: () => ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"] },
  { name: "typecheck libs", after: ["install"], inputs: ["lib", ...shared], cmd: () => [bin(root, "tsc"), "--build", "--pretty"] },
  { name: "typecheck api", after: ["typecheck libs"], cwd: api, inputs: [api, "lib", ...shared], cmd: () => [bin(api, "tsc"), "-p", "tsconfig.json", "--noEmit", "--pretty"] },
  { name: "typecheck web", after: ["typecheck libs"], cwd: web, inputs: [web, "lib", ...shared], cmd: () => [bin(web, "tsc"), "-p", "tsconfig.json", "--noEmit", "--pretty"] },
  { name: "typecheck scripts", after: ["install"], cwd: path.join(root, "scripts"), inputs: ["scripts", "lib", ...shared], cmd: () => [bin(root, "tsc"), "-p", "tsconfig.json", "--noEmit", "--pretty"] },
  // node --test runs each test file in its own process, spread across every core.
  { name: "test web", after: ["install"], cwd: web, inputs: [web, "lib", ...shared], cmd: () => [bin(web, "tsx"), "--test", ...readdirSync(path.join(web, "src/lib")).filter((f) => f.endsWith(".test.ts")).map((f) => `src/lib/${f}`)] },
  { name: "build api", after: ["install"], cwd: api, inputs: [api, "lib", ...shared], outputs: [apiOut], cmd: () => [process.execPath, "build.mjs"] },
  {
    name: "build web",
    after: ["install"],
    cwd: web,
    env: { NODE_ENV: "production", PORT: "5173", BASE_PATH: "/rush10/" },
    inputs: [web, "lib", ...shared],
    outputs: [webOut],
    cmd: () => [bin(web, "vite"), "build", "--config", "vite.config.ts"],
  },
  {
    name: "publish web",
    after: [...checks, "build web"],
    stamp: () => hashPaths([webOut], "", false),
    cmd: () => ["rsync", "-a", "--delete", `${webOut}/`, "/home/vhosts/thesmithfam.org/rush10/"],
  },
  {
    name: "restart api",
    after: [...checks, "build api"],
    // Restart when the bundle changed, or whenever the service isn't up.
    stamp: async () => hashPaths([apiOut], "", false) + ((await sh("systemctl", ["is-active", "rush10"])) === "active" ? "" : `:down${Date.now()}`),
    cmd: () => ["sudo", "-n", "systemctl", "restart", "rush10"],
    verify: waitForHealthy,
  },
].filter((t) => !dryRun || !t.name.match(/^(publish|restart)/)).map((t) => ({ after: [], cwd: root, env: {}, ...t, state: "waiting", log: "", last: "", start: 0, end: 0 }));

async function waitForHealthy(task) {
  task.last = "waiting for /api/healthz";
  for (const deadline = Date.now() + 15000; Date.now() < deadline; ) {
    try {
      const res = await fetch("http://127.0.0.1:3010/api/healthz", { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  task.log += "API did not answer /api/healthz within 15s. Check: journalctl -u rush10 -n 50\n";
  return false;
}

// ── Rendering ────────────────────────────────────────────────────────────────
const tty = process.stdout.isTTY && !process.env.CI_PLAIN;
const c = (code) => (s) => (tty || process.env.FORCE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const [dim, bold, red, green, yellow, cyan, magenta, blue] = [2, 1, 31, 32, 33, 36, 35, 34].map(c);
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const secs = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const spinner = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const width = Math.max(...tasks.map((t) => t.name.length));
const t0 = Date.now();
const children = new Set();
const log = (task, text) => {
  task.log += text;
  const lines = stripAnsi(text).split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length) task.last = lines.at(-1);
  if (!tty) for (const l of text.split(/\r?\n/).filter((l) => stripAnsi(l).trim())) console.log(`${cyan(task.name.padEnd(width))} ${dim("│")} ${l}`);
};

function exec(task) {
  const [cmd, ...args] = task.cmd();
  const child = spawn(cmd, args, {
    cwd: task.cwd,
    env: { ...process.env, FORCE_COLOR: "1", ...task.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.stdout.on("data", (b) => log(task, b.toString()));
  child.stderr.on("data", (b) => log(task, b.toString()));
  return new Promise((resolve) => {
    child.on("error", (err) => { task.log += String(err); });
    child.on("close", (code) => { children.delete(child); resolve(code === 0); });
  });
}

async function run(task) {
  task.state = "running";
  task.start = Date.now();
  const key = task.stamp ? await task.stamp() : task.inputs && hashPaths(task.inputs, JSON.stringify([task.cmd(), task.env]));
  const prev = cache[task.name];
  const outputsMatch = () => !task.outputs || (prev?.out && prev.out === hashPaths(task.outputs, "", false));
  let ok;
  if (!force && key && prev?.key === key && outputsMatch()) {
    task.state = "cached";
  } else {
    ok = (await exec(task)) && (!task.verify || (await task.verify(task)));
    if (task.state === "running") task.state = ok ? "done" : "failed";
    if (ok && key) {
      cache[task.name] = { key, ...(task.outputs && { out: hashPaths(task.outputs, "", false) }) };
      saveCache();
    }
  }
  task.end = Date.now();
  if (!tty) console.log(`${{ done: green("✔"), cached: blue("⚡"), failed: red("✘") }[task.state] ?? dim("–")} ${task.name} ${dim(task.state === "cached" ? "cached" : secs(task.end - task.start))}`);
}

function row(task, frame) {
  const name = task.name.padEnd(width);
  const took = secs((task.end || Date.now()) - task.start).padStart(6);
  switch (task.state) {
    case "waiting": return `  ${dim("◦")} ${dim(name)}  ${dim("      " + (task.after.length ? "waiting for " + task.after.filter((n) => !["done", "cached"].includes(byName(n).state)).join(", ") : "queued"))}`;
    case "running": return `  ${cyan(spinner[frame % spinner.length])} ${bold(name)}  ${yellow(took)}  ${dim(task.last)}`;
    case "done": return `  ${green("✔")} ${name}  ${green(took)}`;
    case "cached": return `  ${blue("⚡")}${name}  ${blue("cached".padStart(6))}  ${dim("unchanged since last deploy")}`;
    case "failed": return `  ${red("✘")} ${red(name)}  ${red(took)}  ${red(task.last)}`;
    case "cancelled": return `  ${dim("–")} ${dim(name)}  ${dim("     cancelled")}`;
  }
}

function bar(frac, len = 24) {
  const full = Math.floor(frac * len);
  return green("█".repeat(full)) + dim("░".repeat(len - full));
}

// Redraw the whole board in place; long lines are clipped so nothing wraps.
let drawn = 0;
function draw(frame) {
  const cols = process.stdout.columns || 100;
  const clip = (s) => {
    let out = "", visible = 0;
    for (const part of s.split(/(\x1b\[[0-9;?]*[A-Za-z])/)) {
      if (part.startsWith("\x1b[")) { out += part; continue; }
      const room = cols - 1 - visible;
      out += part.slice(0, Math.max(0, room));
      visible += Math.min(part.length, Math.max(0, room));
    }
    return out + "\x1b[0m";
  };
  const finished = tasks.filter((t) => ["done", "cached"].includes(t.state)).length;
  const running = tasks.filter((t) => t.state === "running").length;
  const lines = [
    `${magenta("▲")} ${bold("Rush 10 deploy")}  ${bar(finished / tasks.length)} ${bold(`${finished}/${tasks.length}`)}  ${yellow(secs(Date.now() - t0))}${running ? dim(` · ${running} running`) : ""}`,
    ...tasks.map((t) => row(t, frame)),
  ];
  process.stdout.write((drawn ? `\x1b[${drawn}F` : "") + lines.map((l) => `\x1b[2K${clip(l)}`).join("\n") + "\n");
  drawn = lines.length;
}

function cancelAll() {
  for (const t of tasks) if (t.state === "waiting" || t.state === "running") t.state = "cancelled";
  for (const child of children) child.kill("SIGTERM");
}

process.on("SIGINT", () => { cancelAll(); finish(130); });

let ticker;
function finish(code) {
  clearInterval(ticker);
  if (tty) { draw(0); process.stdout.write("\x1b[?25h"); }
  for (const t of tasks.filter((t) => t.state === "failed")) {
    console.log(`\n${red("━━━")} ${bold(red(t.name))} ${red("output ━━━")}\n${t.log.trimEnd()}`);
  }
  const total = secs(Date.now() - t0);
  const skipped = tasks.filter((t) => t.state === "cached").length;
  if (code === 0) {
    const shipped = ["publish web", "restart api"].filter((n) => byName(n)?.state === "done");
    const what = dryRun ? "Dry run passed" : shipped.length ? `Deployed (${shipped.map((n) => n.split(" ")[1]).join(" + ")})` : "Already up to date";
    console.log(`\n${green("✔")} ${bold(what)} in ${bold(green(total))}${skipped ? dim(` · ${skipped}/${tasks.length} steps cached`) : ""}`);
    console.log(dim("  https://thesmithfam.org/rush10 · logs: journalctl -u rush10 -f"));
  } else {
    console.log(`\n${red("✘")} ${bold(red("Deploy failed"))} after ${bold(total)}${dim(" · nothing was published unless shown ✔ above")}`);
  }
  process.exit(code);
}

const byName = (n) => tasks.find((x) => x.name === n);

if (tty) {
  process.stdout.write("\x1b[?25l");
  let frame = 0;
  ticker = setInterval(() => draw(frame++), 80);
  draw(0);
}

// Scheduler: launch every task whose prerequisites are finished; stop at the first failure.
const ready = (t) => t.after.every((n) => ["done", "cached"].includes(byName(n).state));
const pending = new Map();
await new Promise((resolve) => {
  const pump = () => {
    if (tasks.some((t) => t.state === "failed")) { cancelAll(); return resolve(); }
    for (const t of tasks) {
      if (t.state === "waiting" && ready(t)) {
        pending.set(t, run(t).catch((err) => { t.state = "failed"; t.log += String(err?.stack ?? err); }).then(() => { pending.delete(t); pump(); }));
      }
    }
    if (pending.size === 0) resolve();
  };
  pump();
});
await Promise.all(pending.values());
finish(tasks.every((t) => ["done", "cached"].includes(t.state)) ? 0 : 1);
