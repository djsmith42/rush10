/**
 * Pure recognition of a level's required melds from an unordered card selection.
 * Mirrors the server validators in api-server/src/routes/rush10.ts
 * (validateGroup / validateSequence / validateColor / validatePhaseInput).
 */
export type RCard = { id: string; type: 'number' | 'wild' | 'skip'; value: number | null; color: string | null };
export type MeldType = 'group' | 'sequence' | 'color';
export type PhasePart = { type: MeldType; size: number };
export type MeldRequest = { type: MeldType; cardIds: string[]; declaredValue: number | null; declaredColor: string | null };

export const MAX_RECOGNITION_CARDS = 11;
const COLORS = ['red', 'blue', 'green', 'yellow'];

export const PHASE_PARTS: Record<number, PhasePart[]> = {
  1: [{ type: 'group', size: 3 }, { type: 'group', size: 3 }],
  2: [{ type: 'group', size: 3 }, { type: 'sequence', size: 4 }],
  3: [{ type: 'group', size: 4 }, { type: 'sequence', size: 4 }],
  4: [{ type: 'sequence', size: 7 }],
  5: [{ type: 'sequence', size: 8 }],
  6: [{ type: 'sequence', size: 9 }],
  7: [{ type: 'group', size: 4 }, { type: 'group', size: 4 }],
  8: [{ type: 'color', size: 7 }],
  9: [{ type: 'group', size: 5 }, { type: 'group', size: 2 }],
  10: [{ type: 'group', size: 5 }, { type: 'group', size: 3 }],
};

export type RecognizedPart = PhasePart & { cards: RCard[]; complete: boolean; low?: number; high?: number; value?: number; color?: string };
export type Recognition = {
  status: 'empty' | 'none' | 'partial' | 'extra' | 'ready';
  parts: RecognizedPart[];
  unused: RCard[];
  melds: MeldRequest[];
  message: string;
};

/** Can these cards still become (part of) a valid meld of this requirement? Monotone under subsets. */
export function partialValid(part: PhasePart, cards: RCard[]): boolean {
  if (cards.length > part.size || cards.some(c => c.type === 'skip')) return false;
  const naturals = cards.filter(c => c.type === 'number');
  if (part.type === 'group') return new Set(naturals.map(c => c.value)).size <= 1;
  if (part.type === 'color') return new Set(naturals.map(c => c.color)).size <= 1;
  return sequenceWindow(naturals.map(c => c.value as number), part.size, part.size - naturals.length) !== null;
}

/** Server rule: first (lowest) window [low, low+size-1] in 1..12 holding all distinct naturals. */
export function sequenceWindow(values: number[], size: number, wilds: number) {
  if (new Set(values).size !== values.length) return null;
  for (let low = 1; low + size - 1 <= 12; low += 1) {
    const high = low + size - 1;
    if (values.some(v => v < low || v > high)) continue;
    if (size - values.length <= wilds) return { low, high };
  }
  return null;
}

function describe(part: PhasePart, article = true) {
  if (part.type === 'color') return `${part.size} cards of one color`;
  return `${article ? 'a ' : ''}${part.type === 'group' ? 'Group' : 'Sequence'} of ${part.size}`;
}
function joinList(items: string[]) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function finish(part: PhasePart, cards: RCard[]): RecognizedPart {
  const complete = cards.length === part.size && partialValid(part, cards);
  const naturals = cards.filter(c => c.type === 'number');
  const out: RecognizedPart = { ...part, cards, complete };
  if (part.type === 'group') out.value = naturals[0]?.value ?? undefined;
  if (part.type === 'color') out.color = naturals[0]?.color ?? undefined;
  if (part.type === 'sequence' && complete) {
    const w = sequenceWindow(naturals.map(c => c.value as number), part.size, cards.length - naturals.length)!;
    out.low = w.low; out.high = w.high;
  }
  return out;
}

export function toMeldRequest(part: RecognizedPart): MeldRequest {
  const allWild = part.cards.every(c => c.type === 'wild');
  return {
    type: part.type,
    cardIds: part.cards.map(c => c.id),
    // The server needs an explicit value/color only when no natural card fixes it.
    declaredValue: part.type === 'group' ? (part.value ?? (allWild ? 12 : null)) : null,
    declaredColor: part.type === 'color' ? (part.color ?? (allWild ? COLORS[0] : null)) : null,
  };
}

/**
 * Exhaustively assigns each selected card to one required part or to "unused",
 * then picks the best allocation: all parts complete with nothing unused (ready),
 * then most complete parts, most cards placed, fewest unused.
 */
export function recognizeSelection(selection: RCard[], parts: PhasePart[]): Recognition {
  const cards = selection.slice(0, MAX_RECOGNITION_CARDS);
  const empty: Recognition = { status: 'empty', parts: [], unused: [], melds: [], message: '' };
  if (!cards.length || !parts.length) return empty;

  const buckets: RCard[][] = parts.map(() => []);
  const unused: RCard[] = [];
  let best: { score: number[]; buckets: RCard[][]; unused: RCard[] } | null = null;
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };

  const walk = (i: number) => {
    if (i === cards.length) {
      const complete = buckets.filter((b, k) => b.length === parts[k].size).length;
      const placed = cards.length - unused.length;
      const ready = complete === parts.length && unused.length === 0 && cards.length === selection.length ? 1 : 0;
      const focus = buckets.reduce((sum, b) => sum + b.length * b.length, 0);
      const score = [ready, complete, placed, -unused.length, focus];
      if (!best || better(score, best.score)) best = { score, buckets: buckets.map(b => [...b]), unused: [...unused] };
      return;
    }
    const card = cards[i];
    for (let k = 0; k < parts.length; k += 1) {
      // Identical requirements are interchangeable; only try the first empty one.
      if (buckets[k].length === 0 && parts.slice(0, k).some((p, j) => buckets[j].length === 0 && p.type === parts[k].type && p.size === parts[k].size)) continue;
      buckets[k].push(card);
      if (partialValid(parts[k], buckets[k])) walk(i + 1);
      buckets[k].pop();
    }
    unused.push(card);
    walk(i + 1);
    unused.pop();
  };
  walk(0);

  const chosen = best as unknown as { score: number[]; buckets: RCard[][]; unused: RCard[] };
  const recognized = parts.map((p, k) => finish(p, chosen.buckets[k]));
  const extraUnused = [...chosen.unused, ...selection.slice(MAX_RECOGNITION_CARDS)];
  const done = recognized.filter(p => p.complete);
  const allDone = done.length === parts.length;
  const doneText = joinList(done.map(p => describe(p)));

  if (allDone && extraUnused.length === 0) {
    return { status: 'ready', parts: recognized, unused: [], melds: recognized.map(toMeldRequest), message: `You have ${doneText}! You are ready to lay down.` };
  }
  if (allDone) {
    const n = extraUnused.length;
    return { status: 'extra', parts: recognized, unused: extraUnused, melds: [],
      message: `You have ${doneText}, plus ${n} extra card${n === 1 ? '' : 's'}. Deselect ${n === 1 ? 'it' : 'them'} to lay down.` };
  }
  const building = recognized.filter(p => !p.complete && p.cards.length >= 2);
  const bits: string[] = [];
  if (done.length) bits.push(`You have ${doneText}!`);
  if (building.length) bits.push(`${done.length ? 'Still building' : 'Building'} ${joinList(building.map(p => `${describe(p)} (${p.cards.length} of ${p.size})`))}.`);
  if (extraUnused.length && (done.length || building.length)) bits.push(`${extraUnused.length} selected card${extraUnused.length === 1 ? " doesn't" : "s don't"} fit.`);
  if (!bits.length) {
    if (cards.length < 2) return { ...empty, unused: extraUnused };
    return { status: 'none', parts: recognized, unused: extraUnused, melds: [], message: `No ${joinList(parts.map(p => describe(p, false)))} in these cards yet.` };
  }
  return { status: 'partial', parts: recognized, unused: extraUnused, melds: [], message: bits.join(' ') };
}
