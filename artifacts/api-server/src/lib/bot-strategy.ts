/** Bot decisions. Pure: it only proposes moves, which the route then plays
 * through the same validation as a human's, so a bot can never break a rule.
 *
 * Skill levels:
 * - easy: ignores the discard pile except for Wilds, sometimes discards at random, never adds Wilds to piles.
 * - medium: keeps whatever brings its level closest, and adds every card it can to piles.
 * - hard: medium, plus it keeps the cards that leave the most ways to finish, and avoids
 *   discarding cards an opponent could add to a laid pile.
 */

type CardColor = "red" | "blue" | "green" | "yellow";
type MeldType = "group" | "sequence" | "color";
export type BotCard = { id: string; type: "number" | "wild" | "skip"; value: number | null; color: CardColor | null };
export type BotPart = { type: MeldType; size: number };
export type BotMeld = { id: string; type: MeldType; declaredValue: number | null; declaredColor: CardColor | null; low: number | null; high: number | null };
export type BotLevel = "easy" | "medium" | "hard";
export type BotPlayer = { id: string; phase: number; hasLaidPhase: boolean; hand: BotCard[] };
export type BotView = {
  level: BotLevel;
  self: BotPlayer;
  opponents: BotPlayer[];
  parts: BotPart[];
  turnState: "draw" | "discard" | "waiting";
  discardTop: BotCard | null;
  melds: BotMeld[];
  skippedPlayerIds: Set<string>;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
};
type MeldInput = { type: MeldType; cardIds: string[]; declaredValue?: number; declaredColor?: CardColor };
export type BotMove =
  | { action: "draw-deck" | "draw-discard" }
  | { action: "lay-phase"; melds: MeldInput[] }
  | { action: "hit"; cardIds: string[]; meldId: string; declaredValue?: number }
  | { action: "discard"; cardIds: string[]; targetPlayerId?: string };

const COLORS: CardColor[] = ["red", "blue", "green", "yellow"];

function points(card: BotCard) {
  return card.type === "wild" ? 25 : card.type === "skip" ? 15 : (card.value ?? 0) >= 10 ? 10 : 5;
}

/** Natural cards one part would use for one target, and how many Wilds it still needs. */
function fill(part: BotPart, pool: BotCard[], target: number | CardColor) {
  let used: BotCard[];
  if (part.type === "group") used = pool.filter(card => card.value === target).slice(0, part.size);
  else if (part.type === "color") used = pool.filter(card => card.color === target).slice(0, part.size);
  else {
    used = [];
    for (let value = target as number; value < (target as number) + part.size; value++) {
      const card = pool.find(candidate => candidate.value === value);
      if (card) used.push(card);
    }
  }
  return { used, need: part.size - used.length };
}

function targets(part: BotPart): Array<number | CardColor> {
  if (part.type === "color") return COLORS;
  const last = part.type === "group" ? 12 : 13 - part.size;
  return Array.from({ length: last }, (_, i) => i + 1);
}

type Plan = { missing: number; wildsUsed: number; parts: Array<{ part: BotPart; target: number | CardColor; used: BotCard[]; need: number }> };

/** Closest way to make the level from `hand`: fewest cards still missing, then fewest Wilds spent. */
export function planLevel(hand: BotCard[], parts: BotPart[]): Plan {
  const wilds = hand.filter(card => card.type === "wild").length;
  let best: Plan | undefined;
  const search = (index: number, pool: BotCard[], chosen: Plan["parts"]) => {
    if (index === parts.length) {
      const need = chosen.reduce((total, entry) => total + entry.need, 0);
      const plan = { missing: Math.max(0, need - wilds), wildsUsed: Math.min(need, wilds), parts: chosen };
      if (!best || plan.missing < best.missing || (plan.missing === best.missing && plan.wildsUsed < best.wildsUsed)) best = plan;
      return;
    }
    const part = parts[index];
    for (const target of targets(part)) {
      const { used, need } = fill(part, pool, target);
      const ids = new Set(used.map(card => card.id));
      search(index + 1, pool.filter(card => !ids.has(card.id)), [...chosen, { part, target, used, need }]);
    }
  };
  search(0, hand.filter(card => card.type === "number"), []);
  return best!;
}

/** How much other cards in hand pull toward keeping `card`, for breaking ties between discards. */
function affinity(card: BotCard, hand: BotCard[], parts: BotPart[]) {
  let score = 0;
  for (const other of hand) {
    if (other === card || other.type !== "number") continue;
    if (parts.some(part => part.type === "group") && other.value === card.value) score += 3;
    if (parts.some(part => part.type === "sequence")) {
      const gap = Math.abs((other.value ?? 0) - (card.value ?? 0));
      if (gap === 1) score += 2;
      else if (gap === 2) score += 1;
    }
    if (parts.some(part => part.type === "color") && other.color === card.color) score += 1;
  }
  return score;
}

/** How many different number cards would bring the level one card closer; more is easier to finish. */
function outs(hand: BotCard[], parts: BotPart[]) {
  const missing = planLevel(hand, parts).missing;
  // Only the dimensions the level cares about can matter, so probe one card per distinct case and weight it.
  const byColor = parts.some(part => part.type === "color");
  const byValue = parts.some(part => part.type !== "color");
  const values = byValue ? Array.from({ length: 12 }, (_, i) => i + 1) : [1];
  const colors = byColor ? COLORS : COLORS.slice(0, 1);
  const weight = (byValue ? 1 : 12) * (byColor ? 1 : COLORS.length);
  let count = 0;
  for (const color of colors) {
    for (const value of values) {
      if (planLevel([...hand, { id: "probe", type: "number", value, color }], parts).missing < missing) count += weight;
    }
  }
  return count;
}

/** One card from `hand` onto a laid pile, or undefined if nothing fits. Number cards go before Wilds. */
function findHit(hand: BotCard[], melds: BotMeld[], useWilds = true): Extract<BotMove, { action: "hit" }> | undefined {
  const ordered = [...hand.filter(card => card.type === "number"), ...(useWilds ? hand.filter(card => card.type === "wild") : [])];
  for (const card of ordered) {
    for (const meld of melds) {
      if (meld.type === "group" && (card.type === "wild" || card.value === meld.declaredValue)) return { action: "hit", cardIds: [card.id], meldId: meld.id };
      if (meld.type === "color" && (card.type === "wild" || card.color === meld.declaredColor)) return { action: "hit", cardIds: [card.id], meldId: meld.id };
      if (meld.type === "sequence" && meld.low !== null && meld.high !== null) {
        const ends = [meld.high + 1, meld.low - 1].filter(value => value >= 1 && value <= 12);
        const value = card.type === "wild" ? ends[0] : ends.find(end => end === card.value);
        if (value !== undefined) return { action: "hit", cardIds: [card.id], meldId: meld.id, declaredValue: value };
      }
    }
  }
  return undefined;
}

function chooseDraw(view: BotView): BotMove {
  const top = view.discardTop;
  if (!top || top.type === "skip") return { action: "draw-deck" };
  if (top.type === "wild") return { action: "draw-discard" };
  if (view.level === "easy") return { action: "draw-deck" };
  if (view.self.hasLaidPhase) return findHit([top], view.melds) ? { action: "draw-discard" } : { action: "draw-deck" };
  if (view.level === "hard") {
    // Take it only if, after the discard it would cause, the hand is closer or has more ways to finish.
    const withTop = [...view.self.hand, top];
    const discard = chooseDiscard({ ...view, self: { ...view.self, hand: withTop } });
    if (discard.action !== "discard" || discard.cardIds[0] === top.id) return { action: "draw-deck" };
    const kept = withTop.filter(card => card.id !== discard.cardIds[0]);
    const score = (hand: BotCard[]) => planLevel(hand, view.parts).missing * 100 - outs(hand, view.parts);
    return score(kept) < score(view.self.hand) ? { action: "draw-discard" } : { action: "draw-deck" };
  }
  const now = planLevel(view.self.hand, view.parts).missing;
  const after = planLevel([...view.self.hand, top], view.parts).missing;
  return after < now ? { action: "draw-discard" } : { action: "draw-deck" };
}

function chooseDiscard(view: BotView): BotMove {
  const hand = view.self.hand;
  const random = view.random ?? Math.random;
  const skip = hand.find(card => card.type === "skip");
  if (skip) {
    if (view.level === "easy") return { action: "discard", cardIds: [skip.id], targetPlayerId: view.opponents[Math.floor(random() * view.opponents.length)]?.id };
    // Hold back whoever is closest to winning: furthest level, then fewest cards.
    const target = view.opponents
      .filter(player => !view.skippedPlayerIds.has(player.id))
      .sort((a, b) => b.phase - a.phase || Number(b.hasLaidPhase) - Number(a.hasLaidPhase) || a.hand.length - b.hand.length)[0]
      ?? view.opponents[0];
    return { action: "discard", cardIds: [skip.id], targetPlayerId: target?.id };
  }
  const candidates = hand.some(card => card.type !== "wild") ? hand.filter(card => card.type !== "wild") : hand;
  if (view.level === "easy" && random() < 0.25) return { action: "discard", cardIds: [candidates[Math.floor(random() * candidates.length)].id] };
  const hard = view.level === "hard";
  // Hard bots won't hand an opponent who has laid their level a card for a pile.
  const opponentsCanHit = hard && view.opponents.some(player => player.hasLaidPhase);
  const feeds = (card: BotCard) => (opponentsCanHit && findHit([card], view.melds) ? 1 : 0);
  // Sort keys, smallest discarded first.
  const rank = (card: BotCard) => {
    if (view.self.hasLaidPhase) return [0, feeds(card), 0, -points(card)];
    const rest = hand.filter(other => other !== card);
    return [planLevel(rest, view.parts).missing, feeds(card), hard ? -outs(rest, view.parts) : 0, affinity(card, hand, view.parts), -points(card)];
  };
  const ranked = candidates.map(card => ({ card, key: rank(card) }));
  ranked.sort((a, b) => a.key.reduce((order, value, i) => order || value - b.key[i], 0));
  return { action: "discard", cardIds: [ranked[0].card.id] };
}

/** Turn a complete plan into the lay-phase request, spending Wilds on whichever parts are short. */
function layMove(plan: Plan, hand: BotCard[]): BotMove {
  const wilds = hand.filter(card => card.type === "wild");
  const melds = plan.parts.map(({ part, target, used, need }) => {
    const cardIds = [...used, ...wilds.splice(0, need)].map(card => card.id);
    return part.type === "color"
      ? { type: part.type, cardIds, declaredColor: target as CardColor }
      : part.type === "group" ? { type: part.type, cardIds, declaredValue: target as number } : { type: part.type, cardIds };
  });
  return { action: "lay-phase", melds };
}

/** The bot's next single move. Call repeatedly until it discards (or the round ends). */
export function chooseBotMove(view: BotView): BotMove {
  if (view.turnState === "draw") return chooseDraw(view);
  if (!view.self.hasLaidPhase) {
    const plan = planLevel(view.self.hand, view.parts);
    if (plan.missing === 0) return layMove(plan, view.self.hand);
  } else {
    const hit = findHit(view.self.hand, view.melds, view.level !== "easy");
    if (hit) return hit;
  }
  return chooseDiscard(view);
}
