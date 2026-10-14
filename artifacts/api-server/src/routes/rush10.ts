import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { changeStoredRoom, createStoredRoom, readStoredRoom } from "../lib/room-store";
import {
  ActInRush10GameBody,
  CreateRush10RoomBody,
  CreateRush10TestRoomBody,
  JoinRush10RoomBody,
  StartRush10GameBody,
} from "@workspace/api-zod";

type CardColor = "red" | "blue" | "green" | "yellow";
type CardType = "number" | "wild" | "skip";
type MeldType = "group" | "sequence" | "color";
type RoomStatus = "waiting" | "playing" | "round-over" | "finished";
type EndReason = "level-10" | "player-left";
type GameCard = {
  id: string;
  type: CardType;
  value: number | null;
  color: CardColor | null;
};
type GamePlayer = {
  avatar?: "fox" | "cat" | "bear" | "rabbit" | "owl" | "panda" | "frog" | "penguin";
  id: string;
  token: string;
  name: string;
  phase: number;
  score: number;
  hand: GameCard[];
  isHost: boolean;
  hasLaidPhase: boolean;
};
const AVATARS = ["fox", "cat", "bear", "rabbit", "owl", "panda", "frog", "penguin"] as const;
function randomAvailableAvatar(players: GamePlayer[], selfId?: string) {
  const taken = new Set(players.filter(player => player.id !== selfId).map(player => player.avatar ?? "fox"));
  const available = AVATARS.filter(avatar => !taken.has(avatar));
  return available[Math.floor(Math.random() * available.length)]!;
}
type GameMeld = {
  id: string;
  ownerId: string;
  type: MeldType;
  cardIds: string[];
  cards: GameCard[];
  declaredValue: number | null;
  declaredColor: CardColor | null;
  low: number | null;
  high: number | null;
};
type GameRoom = {
  events?: GameEvent[];
  code: string;
  status: RoomStatus;
  players: GamePlayer[];
  hostPlayerId: string;
  currentPlayerId: string | null;
  turnState: "draw" | "discard" | "waiting";
  roundNumber: number;
  drawPile: GameCard[];
  discardPile: GameCard[];
  melds: GameMeld[];
  skippedPlayerIds: Set<string>;
  message: string;
  winnerId: string | null;
  /** Absent on rooms saved before games could end early; see `endOf`. */
  endReason?: EndReason | null;
  endedByPlayerId?: string | null;
  dealerIndex: number;
};
type PhasePart = { type: MeldType; size: number };
type GameEvent = {
  id: string;
  playerId: string;
  targetPlayerId?: string;
  kind: "draw-deck" | "draw-discard" | "discard" | "lay-phase" | "hit" | "deal";
  createdAt: number;
  card: GameCard | null;
};

function recordEvent(room: GameRoom, playerId: string, kind: GameEvent["kind"], card: GameCard | null = null, targetPlayerId?: string) {
  room.events = [...(room.events ?? []), { id: randomUUID(), playerId, kind, createdAt: Date.now(), card, ...(targetPlayerId ? { targetPlayerId } : {}) }].slice(-40);
}

const COLORS: CardColor[] = ["red", "blue", "green", "yellow"];
const PHASES: Array<{ number: number; title: string; description: string; parts: PhasePart[] }> = [
  { number: 1, title: "Two Groups of 3", description: "Two Groups of 3", parts: [{ type: "group", size: 3 }, { type: "group", size: 3 }] },
  { number: 2, title: "Group of 3 + Sequence of 4", description: "One Group of 3 and one Sequence of 4", parts: [{ type: "group", size: 3 }, { type: "sequence", size: 4 }] },
  { number: 3, title: "Group of 4 + Sequence of 4", description: "One Group of 4 and one Sequence of 4", parts: [{ type: "group", size: 4 }, { type: "sequence", size: 4 }] },
  { number: 4, title: "Sequence of 7", description: "One Sequence of 7", parts: [{ type: "sequence", size: 7 }] },
  { number: 5, title: "Sequence of 8", description: "One Sequence of 8", parts: [{ type: "sequence", size: 8 }] },
  { number: 6, title: "Sequence of 9", description: "One Sequence of 9", parts: [{ type: "sequence", size: 9 }] },
  { number: 7, title: "Two Groups of 4", description: "Two Groups of 4", parts: [{ type: "group", size: 4 }, { type: "group", size: 4 }] },
  { number: 8, title: "One Color: 7 cards", description: "7 cards of one color", parts: [{ type: "color", size: 7 }] },
  { number: 9, title: "Group of 5 + Group of 2", description: "One Group of 5 and one Group of 2", parts: [{ type: "group", size: 5 }, { type: "group", size: 2 }] },
  { number: 10, title: "Group of 5 + Group of 3", description: "One Group of 5 and one Group of 3", parts: [{ type: "group", size: 5 }, { type: "group", size: 3 }] },
];
const TURN_RULES = [
  "On your turn, draw one card from the draw pile or the top of the discard pile.",
  "After drawing, you may lay down your current level, add cards to any laid-down pile, then discard one card to end your turn unless the round has ended.",
  "A Group is cards with the same number. A Sequence is consecutive numbers. Wild cards can stand in for a number or color.",
  "A Skip card is discarded to make a chosen opponent miss their next turn. Nobody may draw a Skip from the discard pile. Skip cards cannot be used in a Group, Sequence, or color level.",
  "You can lay down only your current level, and only once per round. After laying it down, you can add matching cards to any player's laid-down piles.",
  "The round ends immediately when every player has laid their current level, or when a player empties their hand. Players who laid their level advance; everyone scores the cards left in hand.",
  "The first player to complete Level 10 wins. If more than one player completes it in that round, the lowest score wins.",
];
const SCORING = [
  "Number cards 1–9: 5 points each",
  "Number cards 10–12: 10 points each",
  "Skip cards: 15 points each",
  "Wild cards: 25 points each",
];
// Letters only avoid digit/letter look-alikes; omit I, L, O and Q too.
const codeAlphabet = "ABCDEFGHJKMNPRSTUVWXYZ";

class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function makeRoomCode() {
  return Array.from({ length: 4 }, () => codeAlphabet[Math.floor(Math.random() * codeAlphabet.length)]).join("");
}

function makeDeck(): GameCard[] {
  const deck: GameCard[] = [];
  for (const color of COLORS) {
    for (let value = 1; value <= 12; value += 1) {
      for (let copy = 0; copy < 2; copy += 1) {
        deck.push({ id: randomUUID(), type: "number", value, color });
      }
    }
  }
  for (let copy = 0; copy < 8; copy += 1) {
    deck.push({ id: randomUUID(), type: "wild", value: null, color: null });
  }
  for (let copy = 0; copy < 4; copy += 1) {
    deck.push({ id: randomUUID(), type: "skip", value: null, color: null });
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function requireRoom(room: GameRoom | undefined) {
  if (!room) throw new GameError("That room could not be found.", 404);
  return room;
}

function getPlayer(room: GameRoom, token: unknown) {
  if (typeof token !== "string" || !token) throw new GameError("Your player session is missing.", 403);
  const player = room.players.find((candidate) => candidate.token === token);
  if (!player) throw new GameError("That player session is not valid for this room.", 403);
  return player;
}

function shuffleDiscardIntoDraw(room: GameRoom) {
  if (room.discardPile.length <= 1) throw new GameError("There are no more cards to draw.");
  const top = room.discardPile.pop()!;
  const reshuffle = room.discardPile;
  for (let index = reshuffle.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [reshuffle[index], reshuffle[swapIndex]] = [reshuffle[swapIndex], reshuffle[index]];
  }
  room.drawPile = reshuffle;
  room.discardPile = [top];
}

function drawOne(room: GameRoom) {
  if (room.drawPile.length === 0) shuffleDiscardIntoDraw(room);
  const card = room.drawPile.pop();
  if (!card) throw new GameError("The draw pile is empty.");
  return card;
}

function dealRound(room: GameRoom, firstPlayerId: string) {
  room.drawPile = makeDeck();
  room.discardPile = [];
  room.melds = [];
  room.skippedPlayerIds.clear();
  room.winnerId = null;
  for (const player of room.players) {
    player.hand = Array.from({ length: 10 }, () => drawOne(room));
    player.hasLaidPhase = false;
  }
  room.discardPile.push(drawOne(room));
  room.status = "playing";
  room.currentPlayerId = firstPlayerId;
  room.turnState = "draw";
  // No banner: the bouncing draw-pile arrows already show who goes first.
  room.message = "";
}

function toView(room: GameRoom, player: GamePlayer) {
  const top = room.discardPile[room.discardPile.length - 1] ?? null;
  return {
    roomCode: room.code,
    events: room.events ?? [],
    status: room.status,
    players: room.players.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      avatar: candidate.avatar ?? "fox",
      phase: candidate.phase,
      score: candidate.score,
      handCount: candidate.hand.length,
      isHost: candidate.isHost,
      hasLaidPhase: candidate.hasLaidPhase,
    })),
    hostPlayerId: room.hostPlayerId,
    currentPlayerId: room.currentPlayerId,
    turnState: room.turnState,
    currentPhase: player.phase,
    drawPileCount: room.drawPile.length,
    discardTop: top,
    hand: player.hand,
    melds: room.melds,
    roundNumber: room.roundNumber,
    message: room.message,
    winnerId: room.winnerId,
    ...endOf(room),
  };
}

/** Rooms finished before `endReason` existed could only have ended at Level 10. */
function endOf(room: GameRoom): { endReason: EndReason | null; endedByPlayerId: string | null } {
  if (room.status !== "finished") return { endReason: null, endedByPlayerId: null };
  if (room.endReason) return { endReason: room.endReason, endedByPlayerId: room.endedByPlayerId ?? null };
  return { endReason: room.winnerId ? "level-10" : null, endedByPlayerId: room.winnerId };
}

/** The poll token travels in `Authorization: Bearer`, keeping it out of URLs and access logs.
 * The `?playerToken=` fallback only serves tabs still running the previous build; remove it once they have reloaded. */
function requestToken(req: { get(name: string): string | undefined; query: Record<string, unknown> }) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "");
  return match ? match[1].trim() : req.query.playerToken;
}

function assertCurrentTurn(room: GameRoom, player: GamePlayer) {
  if (room.status !== "playing") throw new GameError("The game is not in progress.");
  if (room.currentPlayerId !== player.id) throw new GameError("Wait for your turn.");
}

function removeCardsFromHand(player: GamePlayer, cardIds: string[]) {
  const uniqueIds = new Set(cardIds);
  if (uniqueIds.size !== cardIds.length) throw new GameError("A card can only be used once.");
  const cards = cardIds.map((id) => player.hand.find((card) => card.id === id));
  if (cards.some((card) => !card)) throw new GameError("Choose cards from your hand.");
  const selected = cards as GameCard[];
  player.hand = player.hand.filter((card) => !uniqueIds.has(card.id));
  return selected;
}

function validateGroup(cards: GameCard[], requestedValue: number | null) {
  if (cards.length === 0 || cards.some((card) => card.type === "skip")) throw new GameError("A Group needs number cards or Wild cards.");
  const naturalValues = cards.filter((card) => card.type === "number").map((card) => card.value);
  const value = requestedValue ?? naturalValues[0] ?? null;
  if (value === null || value < 1 || value > 12 || naturalValues.some((natural) => natural !== value)) {
    throw new GameError("Every card in a Group must have the same number. Wild cards can fill in.");
  }
  return value;
}

function validateSequence(cards: GameCard[], size: number) {
  if (cards.length !== size || cards.some((card) => card.type === "skip")) throw new GameError(`A Sequence needs ${size} number or Wild cards.`);
  const naturalValues = cards.filter((card) => card.type === "number").map((card) => card.value as number);
  if (new Set(naturalValues).size !== naturalValues.length) throw new GameError("A Sequence cannot repeat a number.");
  const wildCount = cards.filter((card) => card.type === "wild").length;
  for (let low = 1; low + size - 1 <= 12; low += 1) {
    const high = low + size - 1;
    if (naturalValues.some((value) => value < low || value > high)) continue;
    const gaps = size - naturalValues.length;
    if (gaps <= wildCount) return { low, high };
  }
  throw new GameError("Those cards do not make a consecutive Sequence. Wild cards can fill missing numbers.");
}

function validateColor(cards: GameCard[], size: number, requestedColor: string | null) {
  if (cards.length !== size || cards.some((card) => card.type === "skip")) throw new GameError(`A color level needs ${size} number or Wild cards.`);
  const colors = new Set(cards.filter((card) => card.type === "number").map((card) => card.color));
  const color = requestedColor as CardColor | null ?? (colors.size === 1 ? [...colors][0] : null);
  if (!color || !COLORS.includes(color) || colors.size > 1 || (colors.size === 1 && !colors.has(color))) {
    throw new GameError("Choose one color for the level. Wild cards can match it.");
  }
  return color;
}

function validatePhaseInput(player: GamePlayer, input: NonNullable<ReturnType<typeof ActInRush10GameBody.parse>["melds"]>) {
  const phase = PHASES[player.phase - 1];
  if (!phase || !input || input.length !== phase.parts.length) throw new GameError("Choose the required Groups and Sequences for your level.");
  const allIds = input.flatMap((meld) => meld.cardIds);
  if (allIds.length !== new Set(allIds).size) throw new GameError("Each card can only be used once in your level.");
  const selected = new Map(player.hand.map((card) => [card.id, card]));
  const remaining = [...phase.parts];
  const melds = input.map((request) => {
    const match = remaining.findIndex(part => part.type === request.type && part.size === request.cardIds.length);
    if (match < 0) {
      throw new GameError(`Level ${player.phase} requires ${phase.description}.`);
    }
    const [requirement] = remaining.splice(match, 1);
    const cards = request.cardIds.map((id) => selected.get(id));
    if (cards.some((card) => !card)) throw new GameError("Choose cards from your hand.");
    const chosen = cards as GameCard[];
    let declaredValue: number | null = null;
    let declaredColor: CardColor | null = null;
    let low: number | null = null;
    let high: number | null = null;
    if (request.type === "group") {
      declaredValue = validateGroup(chosen, request.declaredValue ?? null);
    } else if (request.type === "sequence") {
      ({ low, high } = validateSequence(chosen, requirement.size));
    } else {
      declaredColor = validateColor(chosen, requirement.size, request.declaredColor ?? null);
    }
    return {
      id: randomUUID(),
      ownerId: player.id,
      type: request.type,
      cardIds: request.cardIds,
      cards: chosen,
      declaredValue,
      declaredColor,
      low,
      high,
    };
  });
  const removed = removeCardsFromHand(player, allIds);
  void removed;
  return melds;
}

function advanceTurn(room: GameRoom) {
  const currentIndex = room.players.findIndex((player) => player.id === room.currentPlayerId);
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidate = room.players[(currentIndex + offset) % room.players.length];
    if (room.skippedPlayerIds.has(candidate.id)) {
      room.skippedPlayerIds.delete(candidate.id);
      continue;
    }
    room.currentPlayerId = candidate.id;
    room.turnState = "draw";
    room.message = `${candidate.name}'s turn. Draw a card.`;
    return;
  }
  const fallback = room.players[(currentIndex + 1) % room.players.length];
  room.currentPlayerId = fallback.id;
  room.turnState = "draw";
  room.message = `${fallback.name}'s turn. Draw a card.`;
}

/** Shared invariant for every move and recovery of older saved games. */
function completeRoundIfNeeded(room: GameRoom) {
  if (room.status !== "playing") return;
  const emptyHand = room.players.find(player => player.hand.length === 0);
  const allCompleted = room.players.length > 0 && room.players.every(player => player.hasLaidPhase);
  if (emptyHand || allCompleted) {
    finishRound(room, emptyHand ?? room.players.find(player => player.id === room.currentPlayerId) ?? room.players[0], allCompleted);
  }
}

function scoreHand(hand: GameCard[]) {
  return hand.reduce((total, card) => total + (card.type === "wild" ? 25 : card.type === "skip" ? 15 : (card.value ?? 0) >= 10 ? 10 : 5), 0);
}

function finishRound(room: GameRoom, finisher: GamePlayer, allCompleted = false) {
  if (room.status !== "playing") return;
  const finalists = room.players.filter((player) => player.phase === 10 && player.hasLaidPhase);
  for (const player of room.players) {
    if (player.hasLaidPhase && player.phase < 10) player.phase += 1;
    player.score += scoreHand(player.hand);
  }
  room.turnState = "waiting";
  room.currentPlayerId = null;
  room.skippedPlayerIds.clear();
  if (finalists.length > 0) {
    finalists.sort((a, b) => a.score - b.score);
    room.winnerId = finalists[0].id;
    room.status = "finished";
    room.endReason = "level-10";
    room.endedByPlayerId = finalists[0].id;
    room.message = `${finalists[0].name} wins Rush 10${finalists.length > 1 ? " with the lowest score" : ""}!`;
  } else {
    room.status = "round-over";
    room.message = `${allCompleted ? "Everyone completed their level. The round is over." : `${finisher.name} went out.`} Scores are updated; the host can deal the next round.`;
  }
}

function handleError(res: Parameters<Parameters<IRouter["get"]>[1]>[1], error: unknown) {
  const status = error instanceof GameError ? error.status : 400;
  const message = error instanceof Error ? error.message : "The game action could not be completed.";
  res.status(status).json({ error: message });
}

/** Leaving ends the game for everyone; the round in progress is not scored. */
function endGameByLeaving(room: GameRoom, player: GamePlayer) {
  room.status = "finished";
  room.turnState = "waiting";
  room.currentPlayerId = null;
  room.skippedPlayerIds.clear();
  room.winnerId = null;
  room.endReason = "player-left";
  room.endedByPlayerId = player.id;
  room.message = `${player.name} left the game.`;
}

const TEST_NAMES = ["Ava", "Ben", "Cleo", "Dev", "Eli", "Fay"];
const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/** Take one card matching `want` out of the draw pile, falling back to a Wild. */
function takeFromDrawPile(room: GameRoom, want: (card: GameCard) => boolean) {
  const candidates = room.drawPile.filter(want);
  const card = candidates.length ? candidates[randomInt(0, candidates.length - 1)] : room.drawPile.find(c => c.type === "wild");
  if (!card) return undefined;
  room.drawPile = room.drawPile.filter(c => c !== card);
  return card;
}

/** Build a legal laid-down level for `player` from the draw pile; undefined if the cards ran out. */
function seedLaidLevel(room: GameRoom, player: GamePlayer): GameMeld[] | undefined {
  const melds: GameMeld[] = [];
  const usedValues = new Set<number>();
  for (const part of PHASES[player.phase - 1].parts) {
    let cards: Array<GameCard | undefined>;
    let declaredValue: number | null = null;
    let declaredColor: CardColor | null = null;
    let low: number | null = null;
    let high: number | null = null;
    if (part.type === "group") {
      // Two groups in one level read better with different numbers.
      let value = randomInt(1, 12);
      while (usedValues.has(value)) value = randomInt(1, 12);
      usedValues.add(value);
      declaredValue = value;
      cards = Array.from({ length: part.size }, () => takeFromDrawPile(room, c => c.type === "number" && c.value === value));
    } else if (part.type === "sequence") {
      low = randomInt(1, 13 - part.size);
      high = low + part.size - 1;
      cards = Array.from({ length: part.size }, (_, i) => takeFromDrawPile(room, c => c.type === "number" && c.value === low! + i));
    } else {
      const color = COLORS[randomInt(0, COLORS.length - 1)];
      declaredColor = color;
      cards = Array.from({ length: part.size }, () => takeFromDrawPile(room, c => c.type === "number" && c.color === color));
    }
    if (cards.some(card => !card)) return undefined;
    const chosen = cards as GameCard[];
    melds.push({ id: randomUUID(), ownerId: player.id, type: part.type, cardIds: chosen.map(c => c.id), cards: chosen, declaredValue, declaredColor, low, high });
  }
  return melds;
}

/** Lay some players' levels mid-round. At least one player stays unlaid, or the round would end. */
function seedLaidLevels(room: GameRoom) {
  const order = [...room.players].sort(() => Math.random() - 0.5);
  const layCount = randomInt(1, room.players.length - 1);
  for (const player of order.slice(0, layCount)) {
    const melds = seedLaidLevel(room, player);
    if (!melds) continue;
    room.melds.push(...melds);
    player.hasLaidPhase = true;
    // Laying shrinks the hand, but never to zero: an empty hand ends the round.
    const used = melds.reduce((total, meld) => total + meld.cards.length, 0);
    const keep = Math.max(1, player.hand.length - used);
    room.drawPile.unshift(...player.hand.slice(keep));
    player.hand = player.hand.slice(0, keep);
  }
}

/** A fresh room for the test pages: random levels and scores, every seat owned by the caller. */
function seedTestRoom(code: string, scenario: "play" | "level-10" | "player-left", playerCount: number) {
  const avatars = [...AVATARS].sort(() => Math.random() - 0.5);
  const players: GamePlayer[] = TEST_NAMES.slice(0, playerCount).map((name, index) => ({
    id: randomUUID(), token: randomUUID(), name, avatar: avatars[index],
    phase: randomInt(1, 9), score: 0, hand: [], isHost: index === 0, hasLaidPhase: false,
  }));
  const winner = scenario === "level-10" ? players[randomInt(0, playerCount - 1)] : undefined;
  if (winner) winner.phase = 10;
  else if (Math.random() < 0.3) players[randomInt(0, playerCount - 1)].phase = 10;
  const roundNumber = Math.max(...players.map(player => player.phase)) + randomInt(0, 4);
  for (const player of players) player.score = 5 * randomInt(roundNumber * 2, roundNumber * 10);
  const room: GameRoom = {
    code, status: "waiting", players, hostPlayerId: players[0].id, currentPlayerId: null, turnState: "waiting",
    roundNumber, drawPile: [], discardPile: [], melds: [], skippedPlayerIds: new Set(), message: "",
    winnerId: null, dealerIndex: randomInt(0, playerCount - 1),
  };
  dealRound(room, players[room.dealerIndex].id);
  recordEvent(room, players[0].id, "deal");
  if (!winner) seedLaidLevels(room);
  if (winner) {
    // The winner went out on Level 10; everyone else is caught holding part of their hand.
    winner.hasLaidPhase = true;
    winner.hand = [];
    for (const player of players) if (player !== winner) player.hand = player.hand.slice(0, randomInt(1, 8));
    finishRound(room, winner);
  } else if (scenario === "player-left") {
    endGameByLeaving(room, players[randomInt(1, playerCount - 1)]);
  }
  return room;
}

const router: IRouter = Router();

router.get("/rush10/rules", (_req, res) => {
  res.json({
    phases: PHASES.map(({ number, title, description }) => ({ number, title, description })),
    turnRules: TURN_RULES,
    scoring: SCORING,
  });
});

router.post("/rush10/rooms", async (req, res) => {
  try {
    const input = CreateRush10RoomBody.parse(req.body);
    const name = input.playerName.trim();
    if (!name) throw new GameError("Enter a player name.");
    const code = makeRoomCode();
    const host: GamePlayer = { id: randomUUID(), token: randomUUID(), name, phase: 1, score: 0, hand: [], isHost: true, hasLaidPhase: false };
    host.avatar = randomAvailableAvatar([]);
    const room: GameRoom = {
      code,
      status: "waiting",
      players: [host],
      hostPlayerId: host.id,
      currentPlayerId: null,
      turnState: "waiting",
      roundNumber: 1,
      drawPile: [],
      discardPile: [],
      melds: [],
      skippedPlayerIds: new Set(),
      message: "Waiting for players to join.",
      winnerId: null,
      dealerIndex: 0,
    };
    let saved = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await createStoredRoom(room)) { saved = true; break; }
      room.code = makeRoomCode();
    }
    if (!saved) throw new GameError("Could not allocate a room code. Please try again.", 503);
    res.status(201).json({ roomCode: room.code, playerToken: host.token, playerId: host.id, room: toView(room, host) });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/rush10/test-rooms", async (req, res) => {
  try {
    const input = CreateRush10TestRoomBody.parse(req.body);
    let room: GameRoom | undefined;
    for (let attempt = 0; attempt < 100 && !room; attempt += 1) {
      const candidate = seedTestRoom(makeRoomCode(), input.scenario, input.playerCount);
      if (await createStoredRoom(candidate)) room = candidate;
    }
    if (!room) throw new GameError("Could not allocate a room code. Please try again.", 503);
    res.status(201).json({
      roomCode: room.code,
      sessions: room.players.map(player => ({ playerId: player.id, playerToken: player.token, name: player.name })),
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/rush10/rooms/:code/join", async (req, res) => {
  try {
    const response = await changeStoredRoom(req.params.code.toUpperCase(), (stored: GameRoom | undefined) => {
    const room = requireRoom(stored);
    const input = JoinRush10RoomBody.parse(req.body);
    const name = input.playerName.trim();
    if (!name) throw new GameError("Enter a player name.");
    if (room.status !== "waiting") throw new GameError("This game has already started. Rejoin with your saved player session.");
    if (room.players.length >= 6) throw new GameError("This room already has six players.");
    const player: GamePlayer = { id: randomUUID(), token: randomUUID(), name, phase: 1, score: 0, hand: [], isHost: false, hasLaidPhase: false };
    player.avatar = randomAvailableAvatar(room.players);
    room.players.push(player);
    room.message = `${name} joined the room.`;
    return { roomCode: room.code, playerToken: player.token, playerId: player.id, room: toView(room, player) };
    });
    res.json(response);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/rush10/rooms/:code", async (req, res) => {
  try {
    const room = requireRoom(await readStoredRoom<GameRoom>(req.params.code.toUpperCase()));
    const token = requestToken(req);
    const player = getPlayer(room, token);
    if (room.status === "playing" && room.players.length > 0 &&
        (room.players.some(player => player.hand.length === 0) || room.players.every(player => player.hasLaidPhase))) {
      // Re-read under the same lock as moves; concurrent polls must not score twice.
      const recovered = await changeStoredRoom(req.params.code.toUpperCase(), (stored: GameRoom | undefined) => {
        const latest = requireRoom(stored);
        const viewer = getPlayer(latest, token);
        completeRoundIfNeeded(latest);
        return toView(latest, viewer);
      });
      res.json(recovered);
      return;
    }
    res.json(toView(room, player));
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/rush10/rooms/:code/start", async (req, res) => {
  try {
    const response = await changeStoredRoom(req.params.code.toUpperCase(), (stored: GameRoom | undefined) => {
    const room = requireRoom(stored);
    const input = StartRush10GameBody.parse(req.body);
    const player = getPlayer(room, input.playerToken);
    if (player.id !== room.hostPlayerId) throw new GameError("Only the host can start the game.", 403);
    if (room.status === "finished") throw new GameError("This game has finished. Create a new room.");
    if (room.status === "waiting" && room.players.length < 2) throw new GameError("At least two players are needed to start.");
    if (room.status === "playing") throw new GameError("The game is already in progress.");
    if (room.status === "round-over" && room.currentPlayerId === null) {
      room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
      room.roundNumber += 1;
    }
    dealRound(room, room.players[room.dealerIndex % room.players.length].id);
    recordEvent(room, player.id, "deal");
    return toView(room, player);
    });
    res.json(response);
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/rush10/rooms/:code/action", async (req, res) => {
  try {
    const response = await changeStoredRoom(req.params.code.toUpperCase(), (stored: GameRoom | undefined) => {
    const room = requireRoom(stored);
    const input = ActInRush10GameBody.parse(req.body);
    const player = getPlayer(room, input.playerToken);
    if (input.action === "set-avatar") {
      if (room.status !== "waiting") throw new GameError("Choose your avatar before the game starts.");
      const avatar = input.avatar ?? randomAvailableAvatar(room.players, player.id);
      if (room.players.some(other => other.id !== player.id && (other.avatar ?? "fox") === avatar)) {
        throw new GameError("That avatar is already taken. Choose another.");
      }
      player.avatar = avatar;
      return toView(room, player);
    }
    if (input.action === "leave") {
      if (room.status === "waiting") throw new GameError("The game has not started yet.");
      if (room.status !== "finished") endGameByLeaving(room, player);
      return toView(room, player);
    }
    assertCurrentTurn(room, player);
    const cardIds = input.cardIds ?? [];
    if (input.action === "draw-deck" || input.action === "draw-discard") {
      if (room.turnState !== "draw") throw new GameError("Draw one card before playing.");
      if (input.action === "draw-deck") {
        player.hand.push(drawOne(room));
      } else {
        const top = room.discardPile.at(-1);
        if (top?.type === "skip") {
          throw new GameError("You can't draw a Skip from the discard pile");
        }
        const card = room.discardPile.pop();
        if (!card) throw new GameError("There is no discard card to pick up.");
        player.hand.push(card);
      }
      room.turnState = "discard";
      room.message = ""; // Drawing is shown by the card-flight animation, not a banner.
      // Never include a privately drawn card in the public animation log.
      recordEvent(room, player.id, input.action);
    } else if (input.action === "lay-phase") {
      if (room.turnState !== "discard") throw new GameError("Draw a card before laying your level.");
      if (player.hasLaidPhase) throw new GameError("You have already laid your level this round.");
      const newMelds = validatePhaseInput(player, input.melds ?? []);
      room.melds.push(...newMelds);
      player.hasLaidPhase = true;
      room.message = `${player.name} laid Level ${player.phase}.`;
      recordEvent(room, player.id, "lay-phase");
    } else if (input.action === "hit") {
      if (room.turnState !== "discard") throw new GameError("Draw a card before adding cards to a pile.");
      if (!player.hasLaidPhase) throw new GameError("Lay down your own level before adding cards to a pile.");
      if (!cardIds.length || !input.meldId) throw new GameError("Choose cards and one laid-down pile.");
      const meld = room.melds.find((candidate) => candidate.id === input.meldId);
      if (!meld) throw new GameError("That pile is no longer in the game.");
      if (new Set(cardIds).size !== cardIds.length) throw new GameError("A card can only be used once.");
      const selected = cardIds.map(id => {
        const card = player.hand.find(card => card.id === id);
        if (!card) throw new GameError("Choose cards from your hand.");
        return card;
      });
      if (selected.some(card => card.type === "skip")) throw new GameError("Skip cards cannot be added to a pile.");
      let low = meld.low;
      let high = meld.high;
      if (meld.type === "group") {
        if (selected.some(card => card.type === "number" && card.value !== meld.declaredValue)) throw new GameError("All selected cards must match the Group.");
      } else if (meld.type === "sequence") {
        if (selected.length === 1) {
          const value = input.declaredValue;
          if (!value || (value !== low! - 1 && value !== high! + 1) || (selected[0].type === "number" && selected[0].value !== value) || value < 1 || value > 12) {
            throw new GameError("A Sequence can only be extended by its next consecutive number (1–12).");
          }
          if (value === low! - 1) low = value;
          else high = value;
        } else {
          const numbers = selected.filter(card => card.type === "number").map(card => card.value!);
          const size = high! - low! + 1 + selected.length;
          let bounds: { low: number; high: number } | undefined;
          if (new Set(numbers).size === numbers.length && !numbers.some(n => n >= low! && n <= high!)) {
            for (let start = Math.max(1, low! - selected.length); start <= low!; start++) {
              const end = start + size - 1;
              if (end >= high! && end <= 12 && numbers.every(n => n >= start && n <= end)) {
                bounds = { low: start, high: end };
                break;
              }
            }
          }
          if (!bounds) throw new GameError("All selected cards must extend the Sequence without gaps (1–12).");
          low = bounds.low;
          high = bounds.high;
        }
      } else if (selected.some(card => card.type === "number" && card.color !== meld.declaredColor)) {
        throw new GameError("All selected cards must match the color level.");
      }
      // Commit only after validating every card, never a partial selection.
      meld.low = low;
      meld.high = high;
      player.hand = player.hand.filter((card) => !cardIds.includes(card.id));
      meld.cardIds.push(...cardIds);
      meld.cards.push(...selected);
      for (const card of selected) recordEvent(room, player.id, "hit", card);
      room.message = `${player.name} added ${selected.length === 1 ? "a card" : `${selected.length} cards`} to ${room.players.find((candidate) => candidate.id === meld.ownerId)?.name ?? "a player"}'s pile.`;
    } else if (input.action === "discard") {
      if (room.turnState !== "discard") throw new GameError("Draw a card before discarding.");
      if (cardIds.length !== 1) throw new GameError("Discard one card to end your turn.");
      const selected = player.hand.find((card) => card.id === cardIds[0]);
      if (!selected) throw new GameError("Choose a card from your hand.");
      let skippedPlayer: GamePlayer | undefined;
      if (selected.type === "skip") {
        const targetId = input.targetPlayerId || (room.players.length === 2 ? room.players.find(candidate => candidate.id !== player.id)?.id : undefined);
        skippedPlayer = room.players.find(candidate => candidate.id === targetId && candidate.id !== player.id);
        if (!skippedPlayer) {
          throw new GameError("Choose another player to skip.");
        }
        room.skippedPlayerIds.add(skippedPlayer.id);
      }
      player.hand = player.hand.filter((card) => card.id !== selected.id);
      room.discardPile.push(selected);
      recordEvent(room, player.id, "discard", selected, skippedPlayer?.id);
      if (player.hand.length === 0) {
        finishRound(room, player);
      } else {
        advanceTurn(room);
        if (skippedPlayer && room.currentPlayerId === player.id) {
          room.message = `${player.name}'s turn again because they skipped ${skippedPlayer.name}.`;
        }
      }
    }
    completeRoundIfNeeded(room);
    return toView(room, player);
    });
    res.json(response);
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
