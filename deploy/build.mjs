#!/usr/bin/env node
// Install, typecheck, and build Rush 10 with every independent step running in
// parallel, shown as a live task board. No dependencies beyond Node itself.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = path.join(root, "artifacts/api-server");
const web = path.join(root, "artifacts/rush-10");

// Resolve a package binary the way pnpm would, without paying for `pnpm exec`.
function bin(dir, name) {
  for (let d = dir; ; d = path.dirname(d)) {
    const p = path.join(d, "node_modules/.bin", name);
    if (existsSync(p)) return p;
    if (d === root) throw new Error(`${name} not found from ${dir}`);
  }
}

// Each task starts as soon as everything in `after` has succeeded.
const tasks = [
  { name: "install", cmd: () => ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"] },
  { name: "typecheck libs", after: ["install"], cmd: () => [bin(root, "tsc"), "--build", "--pretty"] },
  { name: "typecheck api", after: ["typecheck libs"], cwd: api, cmd: () => [bin(api, "tsc"), "-p", "tsconfig.json", "--noEmit", "--pretty"] },
  { name: "typecheck web", after: ["typecheck libs"], cwd: web, cmd: () => [bin(web, "tsc"), "-p", "tsconfig.json", "--noEmit", "--pretty"] },
  { name: "typecheck scripts", after: ["install"], cwd: path.join(root, "scripts"), cmd: () => [bin(root, "tsc"), "-p", "tsconfig.json", "--noEmit", "--pretty"] },
  { name: "build api", after: ["install"], cwd: api, cmd: () => [process.execPath, "build.mjs"] },
  {
    name: "build web",
    after: ["install"],
    cwd: web,
    env: { NODE_ENV: "production", PORT: "5173", BASE_PATH: "/rush10/" },
    cmd: () => [bin(web, "vite"), "build", "--config", "vite.config.ts"],
  },
].map((t) => ({ after: [], cwd: root, env: {}, ...t, state: "waiting", log: "", last: "", start: 0, end: 0 }));

const tty = process.stdout.isTTY && !process.env.CI_PLAIN;
const c = (code) => (s) => (tty || process.env.FORCE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const [dim, bold, red, green, yellow, cyan, magenta] = [2, 1, 31, 32, 33, 36, 35].map(c);
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const spinner = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const width = Math.max(...tasks.map((t) => t.name.length));
const t0 = Date.now();
const children = new Set();

function run(task) {
  task.state = "running";
  task.start = Date.now();
  const [cmd, ...args] = task.cmd();
  const child = spawn(cmd, args, {
    cwd: task.cwd,
    env: { ...process.env, FORCE_COLOR: "1", ...task.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const onData = (buf) => {
    const text = buf.toString();
    task.log += text;
    const lines = stripAnsi(text).split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length) task.last = lines.at(-1);
    if (!tty) for (const l of text.split(/\r?\n/).filter((l) => stripAnsi(l).trim())) console.log(`${cyan(task.name.padEnd(width))} ${dim("│")} ${l}`);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return new Promise((resolve) => {
    child.on("error", (err) => { task.log += String(err); });
    child.on("close", (code) => {
      children.delete(child);
      task.end = Date.now();
      if (task.state === "running") task.state = code === 0 ? "done" : "failed";
      if (!tty) console.log(`${task.state === "done" ? green("✔") : red("✘")} ${task.name} ${dim(secs(task.end - task.start))}`);
      resolve();
    });
  });
}

function row(task, frame) {
  const name = task.name.padEnd(width);
  const now = task.end || Date.now();
  switch (task.state) {
    case "waiting": return `  ${dim("◦")} ${dim(name)}  ${dim("waiting for " + task.after.join(", "))}`;
    case "running": return `  ${cyan(spinner[frame % spinner.length])} ${bold(name)}  ${yellow(secs(now - task.start).padStart(5))}  ${dim(task.last)}`;
    case "done": return `  ${green("✔")} ${name}  ${green(secs(now - task.start).padStart(5))}`;
    case "failed": return `  ${red("✘")} ${red(name)}  ${red(secs(now - task.start).padStart(5))}  ${red(task.last)}`;
    case "cancelled": return `  ${dim("–")} ${dim(name)}  ${dim("cancelled")}`;
  }
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
  const running = tasks.filter((t) => t.state === "running").length;
  const lines = [
    `${magenta("▲")} ${bold("Rush 10 deploy")}  ${dim(`${secs(Date.now() - t0)} · ${running} running`)}`,
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
  if (code === 0) console.log(`\n${green("✔")} ${bold("Built")} in ${green(secs(Date.now() - t0))}`);
  process.exit(code);
}

if (tty) {
  process.stdout.write("\x1b[?25l");
  let frame = 0;
  ticker = setInterval(() => draw(frame++), 80);
  draw(0);
}

// Scheduler: launch every task whose prerequisites are done; stop at the first failure.
const pending = new Map();
await new Promise((resolve) => {
  const pump = () => {
    if (tasks.some((t) => t.state === "failed")) { cancelAll(); return resolve(); }
    for (const t of tasks) {
      if (t.state === "waiting" && t.after.every((n) => tasks.find((x) => x.name === n).state === "done")) {
        pending.set(t, run(t).then(() => { pending.delete(t); pump(); }));
      }
    }
    if (pending.size === 0) resolve();
  };
  pump();
});
await Promise.all(pending.values());
finish(tasks.every((t) => t.state === "done") ? 0 : 1);
