import { test as base, expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { API_URL, DATABASE_PATH } from './env';
import { analyzeMotion, startMotion, stopMotion, type MotionReport } from './motion';

const run = promisify(execFile);

// ---------- Cards ----------
// Shorthand: R5 = red 5, B12 = blue 12, G = green, Y = yellow, W = Wild, S = Skip.
type Color = 'red' | 'blue' | 'green' | 'yellow';
const COLOR: Record<string, Color> = { R: 'red', B: 'blue', G: 'green', Y: 'yellow' };
export type Card = { id: string; type: 'number' | 'wild' | 'skip'; value: number | null; color: Color | null };

/** Card ids are `<spec>_<n>`, numbered across hands (in seat order), then the discard pile, laid piles and
 *  draw pile, so the first red 5 is `card-in-hand-R5_1`. Default filler cards are `<spec>_f<n>`. */
export function makeCards(specs: string[], counter: Map<string, number>, tag = ''): Card[] {
  return specs.map(spec => {
    const n = (counter.get(tag + spec) ?? 0) + 1;
    counter.set(tag + spec, n);
    const id = `${spec}_${tag}${n}`;
    if (spec === 'W') return { id, type: 'wild', value: null, color: null };
    if (spec === 'S') return { id, type: 'skip', value: null, color: null };
    const color = COLOR[spec[0]];
    const value = Number(spec.slice(1));
    if (!color || !(value >= 1 && value <= 12)) throw new Error(`Bad card spec ${spec}`);
    return { id, type: 'number', value, color };
  });
}

const FILLER = Array.from({ length: 30 }, (_, i) => `${'RBGY'[i % 4]}${(i * 5) % 12 + 1}`);

// ---------- Seeding ----------
export type SeatSpec = {
  name: string; phase?: number; score?: number; hand?: string[]; hasLaidPhase?: boolean;
  isBot?: boolean; botLevel?: 'easy' | 'medium' | 'hard'; avatar?: string;
};
export type MeldSpec = {
  id?: string; owner: number; type: 'group' | 'sequence' | 'color'; cards: string[];
  declaredValue?: number; declaredColor?: Color; low?: number; high?: number;
};
export type SeedSpec = {
  players: SeatSpec[];
  status?: 'waiting' | 'playing' | 'round-over' | 'finished';
  current?: number; turnState?: 'draw' | 'discard' | 'waiting';
  /** Bottom to top. */
  discard?: string[];
  /** Bottom to top; the last card is drawn first. Defaults to filler. */
  draw?: string[];
  melds?: MeldSpec[]; roundNumber?: number; skipped?: number[];
};
export type Seat = { id: string; token: string; name: string };
export type Seeded = { code: string; seats: Seat[] };

const AVATARS = ['fox', 'cat', 'bear', 'rabbit', 'owl', 'panda', 'frog', 'penguin'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPRSTUVWXYZ';

let db: Database.Database | undefined;
function database() {
  if (!db) {
    db = new Database(DATABASE_PATH);
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

export function buildRoom(code: string, spec: SeedSpec) {
  const counter = new Map<string, number>();
  const status = spec.status ?? 'playing';
  const players = spec.players.map((seat, index) => ({
    id: randomUUID(), token: randomUUID(), name: seat.name, avatar: seat.avatar ?? AVATARS[index],
    phase: seat.phase ?? 1, score: seat.score ?? 0, hand: makeCards(seat.hand ?? [], counter),
    isHost: index === 0, hasLaidPhase: seat.hasLaidPhase ?? false,
    ...(seat.isBot ? { isBot: true, botLevel: seat.botLevel ?? 'medium' } : {}),
  }));
  const discardPile = status === 'waiting' ? [] : makeCards(spec.discard ?? ['G6'], counter);
  const melds = (spec.melds ?? []).map(meld => {
    const cards = makeCards(meld.cards, counter);
    const numbers = cards.filter(card => card.type === 'number');
    const values = numbers.map(card => card.value!);
    return {
      id: meld.id ?? randomUUID(), ownerId: players[meld.owner].id, type: meld.type,
      cardIds: cards.map(card => card.id), cards,
      declaredValue: meld.type === 'group' ? meld.declaredValue ?? values[0] : null,
      declaredColor: meld.type === 'color' ? meld.declaredColor ?? numbers[0].color : null,
      low: meld.type === 'sequence' ? meld.low ?? Math.min(...values) : null,
      high: meld.type === 'sequence' ? meld.high ?? Math.max(...values) : null,
    };
  });
  const playing = status === 'playing';
  return {
    code, status, events: [], players, hostPlayerId: players[0].id,
    currentPlayerId: playing ? players[spec.current ?? 0].id : null,
    turnState: playing ? spec.turnState ?? 'draw' : 'waiting',
    roundNumber: spec.roundNumber ?? 1,
    drawPile: status === 'waiting' ? [] : spec.draw ? makeCards(spec.draw, counter) : makeCards(FILLER, counter, 'f'),
    discardPile,
    melds, skippedPlayerIds: (spec.skipped ?? []).map(index => players[index].id),
    message: '', winnerId: null, endReason: null, endedByPlayerId: null, dealerIndex: 0, botDueAt: null,
  };
}

/** Write a room straight into the suite's private database; the API reads it fresh on every request. */
export function seed(spec: SeedSpec): Seeded {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    const room = buildRoom(code, spec);
    const inserted = database().prepare('INSERT INTO rush10_rooms (code, state) VALUES (?, ?) ON CONFLICT (code) DO NOTHING').run(code, JSON.stringify(room));
    if (inserted.changes === 1) return { code, seats: room.players.map(({ id, token, name }) => ({ id, token, name })) };
  }
  throw new Error('Could not allocate a room code');
}

/** A well-formed code with no game behind it. */
export function unusedCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    if (!stored(code)) return code;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Stored = any;
export function stored(code: string): Stored {
  const row = database().prepare('SELECT state FROM rush10_rooms WHERE code = ?').get(code) as { state: string } | undefined;
  return row ? JSON.parse(row.state) : undefined;
}
/** Change a saved room under the same write lock the API uses. */
export function rig(code: string, change: (room: Stored) => void) {
  const conn = database();
  conn.transaction(() => {
    const room = stored(code);
    change(room);
    conn.prepare('UPDATE rush10_rooms SET state = ? WHERE code = ?').run(JSON.stringify(room), code);
  }).immediate();
}

// ---------- API ----------
let ipCounter = 0;
/** A distinct client address per caller keeps the suite under the API's per-IP rate limits. */
export function freshIp() {
  ipCounter += 1;
  return `10.${process.pid % 250}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}
export async function api(route: string, { method = 'POST', body, token }: { method?: string; body?: unknown; token?: string } = {}) {
  const response = await fetch(`${API_URL}/api/rush10${route}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, ok: response.ok, json };
}
export const act = (code: string, seat: Seat, action: string, extra: Record<string, unknown> = {}) =>
  api(`/rooms/${code}/action`, { body: { playerToken: seat.token, action, ...extra } });
export const view = async (code: string, seat: Seat) => (await api(`/rooms/${code}`, { method: 'GET', token: seat.token })).json;

// ---------- Browser ----------
export type OpenOptions = { animate?: boolean; viewport?: { width: number; height: number }; path?: string; waitFor?: 'table' | 'lobby' | 'none' };

export class Harness {
  private contexts: BrowserContext[] = [];
  private shot = 0;
  pageErrors: string[] = [];
  constructor(private browser: Browser, private info: TestInfo) {}

  /** A fresh browser (its own storage and client address), optionally seated as `seat` in `code`. */
  async open(seat?: { code: string; seat: Seat }, options: OpenOptions = {}): Promise<Page> {
    const context = await this.browser.newContext({
      viewport: options.viewport ?? { width: 1100, height: 760 },
      reducedMotion: options.animate ? 'no-preference' : 'reduce',
      extraHTTPHeaders: { 'x-forwarded-for': freshIp() },
    });
    this.contexts.push(context);
    await context.addInitScript(({ session, animate }) => {
      // Static page transitions keep non-animation tests fast; animation tests keep them.
      if (!animate) sessionStorage.setItem('rush10-static-background', '1');
      if (session && !sessionStorage.getItem('e2e-seated')) {
        sessionStorage.setItem('e2e-seated', '1');
        localStorage.setItem('rush10-player-session', JSON.stringify(session));
      }
    }, { session: seat ? { roomCode: seat.code, playerToken: seat.seat.token, playerId: seat.seat.id } : null, animate: !!options.animate });
    const page = await context.newPage();
    page.on('pageerror', error => this.pageErrors.push(String(error)));
    const target = options.path ?? (seat ? `/game/${seat.code}` : '/');
    await page.goto(target);
    const waitFor = options.waitFor ?? (seat ? 'table' : 'none');
    if (waitFor === 'table') await expect(page.getByTestId('game-table')).toBeVisible();
    if (waitFor === 'lobby') await expect(page.getByText('Invite players to join')).toBeVisible();
    return page;
  }

  /** Attach a screenshot to the album. */
  async snap(page: Page, label: string) {
    const body = await page.screenshot({ type: 'jpeg', quality: 72, animations: 'allow' });
    this.shot += 1;
    await this.info.attach(`${String(this.shot).padStart(2, '0')} ${label}`, { body, contentType: 'image/jpeg' });
  }

  /** Attach text (e.g. an API exchange) to the album. */
  async note(label: string, value: unknown) {
    await this.info.attach(label, { body: typeof value === 'string' ? value : JSON.stringify(value, null, 2), contentType: 'text/plain' });
  }

  /** Record `page` while `action` runs (plus a short tail) and attach an animated GIF.
   *  Unless `motion` is false, every frame is also checked for teleports, pop-ins, shadow snaps, duplicates and jank. */
  async gif(page: Page, label: string, action: () => Promise<void>, { tailMs = 400, width = 600, motion = true } = {}): Promise<MotionReport | undefined> {
    if (motion) await startMotion(page);
    const cdp = await page.context().newCDPSession(page);
    const frames: Array<{ data: string; t: number }> = [];
    cdp.on('Page.screencastFrame', frame => {
      frames.push({ data: frame.data, t: frame.metadata.timestamp ?? Date.now() / 1000 });
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 720, maxHeight: 500, everyNthFrame: 2 });
    try {
      await action();
      await page.waitForTimeout(tailMs);
    } finally {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
    }
    const trace = motion ? await stopMotion(page) : undefined;
    if (trace && process.env.E2E_MOTION_TRACE) writeFileSync(path.join(tmpdir(), `motion-${label.replace(/\W+/g, '-')}.json`), JSON.stringify(trace));
    const report = trace ? analyzeMotion(trace) : undefined;
    if (report) await this.checkMotion(label, report);
    if (frames.length === 0) return report;
    const dir = mkdtempSync(path.join(tmpdir(), 'rush10-gif-'));
    try {
      const end = Date.now() / 1000;
      const lines: string[] = [];
      frames.forEach((frame, index) => {
        const file = path.join(dir, `f${String(index).padStart(5, '0')}.jpg`);
        writeFileSync(file, Buffer.from(frame.data, 'base64'));
        const next = frames[index + 1]?.t ?? Math.max(frame.t + 0.05, end);
        lines.push(`file '${file}'`, `duration ${Math.max(0.01, next - frame.t).toFixed(3)}`);
      });
      lines.push(`file '${path.join(dir, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`);
      writeFileSync(path.join(dir, 'list.txt'), lines.join('\n'));
      const out = path.join(dir, 'out.gif');
      await run('ffmpeg', ['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
        '-vf', `fps=15,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
        '-loop', '0', out]);
      this.shot += 1;
      await this.info.attach(`${String(this.shot).padStart(2, '0')} ${label}`, { body: readFileSync(out), contentType: 'image/gif' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return report;
  }

  /** Attach a motion summary and fail (softly, so the GIF is kept) on anything that didn't move smoothly. */
  async checkMotion(label: string, report: MotionReport) {
    const lines = [
      `${report.frames} frames over ${report.seconds}s · p95 frame ${report.p95FrameMs}ms · longest ${report.maxFrameMs}ms · ${report.longFrames} frames over 50ms · longest script block ${report.maxBlockingMs}ms`,
      ...(['teleports', 'popIns', 'vanishes', 'shadowPops', 'duplicates', 'stalls'] as const).flatMap(kind => report[kind].map(issue => `${kind} @${issue.at}ms: ${issue.what}`)),
    ];
    await this.note(`Motion: ${label}`, lines.join('\n'));
    expect.soft(report.teleports, `${label}: cards that teleported instead of moving`).toEqual([]);
    expect.soft(report.popIns, `${label}: cards that appeared out of nowhere`).toEqual([]);
    expect.soft(report.vanishes, `${label}: cards that vanished on the spot`).toEqual([]);
    expect.soft(report.shadowPops, `${label}: shadows that snapped on`).toEqual([]);
    expect.soft(report.duplicates, `${label}: cards shown twice`).toEqual([]);
    expect.soft(report.stalls, `${label}: frames that hitched while cards were moving`).toEqual([]);
  }

  async close() {
    await Promise.all(this.contexts.map(context => context.close().catch(() => {})));
  }
}

export const test = base.extend<{ h: Harness }>({
  h: async ({ browser }, use, testInfo) => {
    const h = new Harness(browser, testInfo);
    await use(h);
    if (h.pageErrors.length) await h.note('Page errors', h.pageErrors.join('\n'));
    await h.close();
    expect.soft(h.pageErrors, 'uncaught page errors').toEqual([]);
  },
});
export { expect };

// ---------- Page helpers ----------
export const hand = (page: Page, id: string) => page.getByTestId(`card-in-hand-${id}`);
export const turnStatus = (page: Page) => page.getByTestId('text-turn-status');

/** Toggle cards by keyboard (Enter on a hand card toggles it), which avoids the fan's overlapping hit areas. */
export async function pick(page: Page, ...ids: string[]) {
  for (const id of ids) {
    const card = hand(page, id);
    const before = await card.getAttribute('aria-pressed');
    await card.press('Enter');
    await expect(card).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  }
}

/** The visible order of the hand, as card ids. */
export async function handOrder(page: Page) {
  return page.locator('[data-testid^="card-in-hand-"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')!.replace('card-in-hand-', '')));
}

/** A point inside `locator` where it is the topmost element (hand cards overlap their neighbours). */
export async function grabPoint(locator: ReturnType<Page['locator']>) {
  const point = await locator.evaluate((el: Element) => {
    const r = el.getBoundingClientRect();
    for (const fy of [0.45, 0.3, 0.6, 0.15, 0.8]) {
      for (let fx = 0.06; fx < 0.95; fx += 0.08) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error('No exposed point on the element');
  return point;
}

/** Drag with real pointer moves from a hand card to a target element. */
export async function dragTo(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>, { release = true } = {}) {
  const a = await grabPoint(from);
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y - 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  if (release) await page.mouse.up();
}
