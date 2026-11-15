// Pure, deterministic game engine for "Trash" (a Shithead/Palace variant).
// No I/O here: the server owns a GameState and calls applyAction for every move.

export type Suit = 'S' | 'H' | 'D' | 'C';
export interface Card {
  id: string;
  rank: number; // 2..14 (11=J, 12=Q, 13=K, 14=A)
  suit: Suit;
}

export const HAND_SIZE = 4;
export const DRAW_THRESHOLD = 3; // draw 1 after playing only if hand has <= 3 cards
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8; // 2 decks are used above 5 players

export const RANK_LABEL: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export const isSpecial = (rank: number) => rank === 2 || rank === 8 || rank === 10;

export function cardLabel(c: Card) {
  return `${RANK_LABEL[c.rank]}${SUIT_SYMBOL[c.suit]}`;
}

/**
 * The rank you have to match or beat. 8s are transparent (they count as the card
 * under them). A 2, or an empty pile, means anything goes (null).
 */
export function effectiveRank(pile: Card[]): number | null {
  for (let i = pile.length - 1; i >= 0; i--) {
    const r = pile[i].rank;
    if (r === 8) continue;
    if (r === 2) return null;
    return r;
  }
  return null;
}

/** 2, 8 and 10 go on anything; otherwise equal or higher than the effective rank. */
export function canPlayRank(rank: number, eff: number | null) {
  return isSpecial(rank) || eff === null || rank >= eff;
}

export interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
  faceUp: Card[];
  faceDown: Card[];
  ready: boolean;
}

export type Zone = 'hand' | 'faceUp' | 'faceDown' | 'done';
export function zoneOf(p: { hand: unknown[]; faceUp: unknown[]; faceDown: unknown[] } | { handCount: number; faceUp: unknown[]; faceDownCount: number }): Zone {
  const hand = 'hand' in p ? p.hand.length : p.handCount;
  const down = 'faceDown' in p ? p.faceDown.length : p.faceDownCount;
  if (hand > 0) return 'hand';
  if (p.faceUp.length > 0) return 'faceUp';
  if (down > 0) return 'faceDown';
  return 'done';
}

export type LogKind = 'info' | 'play' | 'special' | 'pickup' | 'end';
export interface LogEntry { id: number; text: string; kind: LogKind }

export interface GameState {
  phase: 'swap' | 'play' | 'over';
  decks: number;
  players: PlayerState[];
  stock: Card[];
  pile: Card[];
  trash: Card[];
  turn: number; // seat index of the player to move
  winner: string | null; // the round ends as soon as one player is out of cards
  log: LogEntry[];
  logSeq: number;
  lastFlip: { playerId: string; card: Card; ok: boolean } | null;
}


export type Action =
  | { type: 'swap'; handId: string; faceUpId: string }
  | { type: 'ready' }
  | { type: 'play'; cardIds: string[] } // exactly one card, from hand or (hand empty) face-up
  | { type: 'playBlind'; index: number } // face-down slot
  | { type: 'pickup' };

export type Rng = () => number;

export function decksFor(players: number) {
  return players > 5 ? 2 : 1;
}

export function createDeck(decks = 1): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const out: Card[] = [];
  for (let d = 0; d < decks; d++)
    for (const s of suits)
      for (let r = 2; r <= 14; r++) out.push({ id: `${d}${RANK_LABEL[r]}${s}`, rank: r, suit: s });
  return out;
}

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface NewGameOptions {
  rng?: Rng;
  startSeat?: number; // default: random
  deck?: Card[]; // pre-ordered deck for tests (dealt from the end)
}

export function newGame(players: { id: string; name: string }[], opts: NewGameOptions = {}): GameState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS)
    throw new Error(`Need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  const rng = opts.rng ?? Math.random;
  const decks = decksFor(players.length);
  const stock = opts.deck ? [...opts.deck] : shuffle(createDeck(decks), rng);
  const ps: PlayerState[] = players.map((p) => ({ id: p.id, name: p.name, hand: [], faceUp: [], faceDown: [], ready: false }));
  const deal = (n: number, key: 'faceDown' | 'faceUp' | 'hand') => {
    for (let i = 0; i < n; i++) for (const p of ps) p[key].push(stock.pop()!);
  };
  deal(3, 'faceDown');
  deal(3, 'faceUp');
  deal(HAND_SIZE, 'hand');
  const g: GameState = {
    phase: 'swap', decks, players: ps, stock, pile: [], trash: [],
    turn: opts.startSeat ?? Math.floor(rng() * ps.length),
    winner: null, log: [], logSeq: 0, lastFlip: null,
  };
  log(g, 'Cards dealt. Swap hand cards with your face-up cards, then press Ready.', 'info');
  return g;
}

function log(g: GameState, text: string, kind: LogKind) {
  g.log.push({ id: ++g.logSeq, text, kind });
  if (g.log.length > 200) g.log.splice(0, g.log.length - 200);
}


/** Pass the turn clockwise. */
function advance(g: GameState) {
  const n = g.players.length;
  g.turn = (g.turn + 1) % n;
}

/** First player with no cards left wins and the round ends right away. */
function checkFinished(g: GameState, p: PlayerState): boolean {
  if (p.hand.length || p.faceUp.length || p.faceDown.length) return false;
  g.phase = 'over';
  g.winner = p.id;
  log(g, `${p.name} is out of cards and wins the round! 🏆`, 'end');
  return true;
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function pickUpPile(g: GameState, p: PlayerState) {
  const n = g.pile.length;
  p.hand.push(...g.pile);
  g.pile = [];
  return n;
}

function drawAfterPlay(g: GameState, p: PlayerState) {
  if (g.stock.length > 0 && p.hand.length <= DRAW_THRESHOLD) p.hand.push(g.stock.pop()!);
}

/** Put a legal card on the pile and resolve its effect. */
function resolvePlay(g: GameState, p: PlayerState, card: Card, verb: string) {
  g.pile.push(card);
  drawAfterPlay(g, p);
  const label = cardLabel(card);
  if (card.rank === 10) {
    log(g, `${p.name} ${verb} ${label} — Trash! 🗑️ The pile is gone.`, 'special');
    g.trash.push(...g.pile);
    g.pile = [];
  } else if (card.rank === 2) {
    log(g, `${p.name} ${verb} ${label} — reset, anything goes.`, 'special');
  } else if (card.rank === 8) {
    const eff = effectiveRank(g.pile);
    log(g, `${p.name} ${verb} ${label} — counts as ${eff === null ? 'anything' : RANK_LABEL[eff]}`, 'special');
  } else {
    log(g, `${p.name} ${verb} ${label}`, 'play');
  }
  checkFinished(g, p);
  if (g.phase === 'over') return;
  advance(g); // after a 10 the next player starts the new pile
}

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };

export function applyAction(g: GameState, playerId: string, a: Action): Result {
  const p = g.players.find((x) => x.id === playerId);
  if (!p) return fail('You are not in this game');

  if (a.type === 'swap') {
    if (g.phase !== 'swap') return fail('Swapping is only allowed before the game starts');
    if (p.ready) return fail('You are already ready');
    const hi = p.hand.findIndex((c) => c.id === a.handId);
    const fi = p.faceUp.findIndex((c) => c.id === a.faceUpId);
    if (hi < 0 || fi < 0) return fail('Pick one hand card and one face-up card');
    [p.hand[hi], p.faceUp[fi]] = [p.faceUp[fi], p.hand[hi]];
    return OK;
  }

  if (a.type === 'ready') {
    if (g.phase !== 'swap') return fail('The game already started');
    if (p.ready) return OK;
    p.ready = true;
    log(g, `${p.name} is ready`, 'info');
    if (g.players.every((x) => x.ready)) {
      g.phase = 'play';
      log(g, `Game on! ${g.players[g.turn].name} starts.`, 'info');
    }
    return OK;
  }

  if (g.phase !== 'play') return fail('The game is not in progress');
  if (g.players[g.turn].id !== p.id) return fail("It's not your turn");
  const zone = zoneOf(p);
  const eff = effectiveRank(g.pile);

  if (a.type === 'pickup') {
    if (g.pile.length === 0) return fail('The pile is empty — play any card');
    const n = pickUpPile(g, p);
    log(g, `${p.name} picked up the pile (${n} card${n === 1 ? '' : 's'})`, 'pickup');
    g.lastFlip = null;
    advance(g);
    return OK;
  }

  if (a.type === 'play') {
    if (!Array.isArray(a.cardIds) || a.cardIds.length !== 1) return fail('Play exactly one card per turn');
    if (zone !== 'hand' && zone !== 'faceUp') return fail('Play one of your face-down cards');
    const source = zone === 'hand' ? p.hand : p.faceUp;
    const idx = source.findIndex((c) => c.id === a.cardIds[0]);
    if (idx < 0) return fail(zone === 'hand' ? 'That card is not in your hand' : 'Play from your face-up cards (your hand is empty)');
    const card = source[idx];
    g.lastFlip = null;
    if (canPlayRank(card.rank, eff)) {
      source.splice(idx, 1);
      resolvePlay(g, p, card, zone === 'hand' ? 'played' : 'played face-up');
      return OK;
    }
    if (zone === 'faceUp' && !p.faceUp.some((c) => canPlayRank(c.rank, eff))) {
      // Forced: no face-up card can beat the pile -> play it, then take the pile (including it).
      source.splice(idx, 1);
      g.pile.push(card);
      const n = pickUpPile(g, p);
      log(g, `${p.name} couldn't beat the pile with face-up cards: played ${cardLabel(card)} and picked up ${n} cards`, 'pickup');
      advance(g);
      return OK;
    }
    return fail(`${cardLabel(card)} can't beat ${eff === null ? 'that' : RANK_LABEL[eff]}`);
  }

  if (a.type === 'playBlind') {
    if (zone !== 'faceDown') return fail(zone === 'done' ? 'You are already out' : 'You still have cards to play before your face-down cards');
    if (!Number.isInteger(a.index) || a.index < 0 || a.index >= p.faceDown.length) return fail('Pick one of your face-down cards');
    const [card] = p.faceDown.splice(a.index, 1);
    const ok = canPlayRank(card.rank, eff);
    g.lastFlip = { playerId: p.id, card, ok };
    if (ok) {
      resolvePlay(g, p, card, 'flipped');
    } else {
      g.pile.push(card);
      const n = pickUpPile(g, p);
      log(g, `${p.name} flipped ${cardLabel(card)} — can't beat ${RANK_LABEL[eff!]}, picks up ${n} cards`, 'pickup');
      advance(g);
    }
    return OK;
  }

  return fail('Unknown action');
}

/** Ids of the cards this player may legally play right now (from their active zone). */
export function playableIds(zone: Zone, hand: Card[], faceUp: Card[], pile: Card[]): string[] {
  const eff = effectiveRank(pile);
  const src = zone === 'hand' ? hand : zone === 'faceUp' ? faceUp : [];
  return src.filter((c) => canPlayRank(c.rank, eff)).map((c) => c.id);
}

// ---------- client view (hidden information stays on the server) ----------

export interface PublicPlayer {
  id: string;
  name: string;
  handCount: number;
  faceUp: Card[];
  faceDownCount: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface GameView {
  phase: 'swap' | 'play' | 'over';
  players: PublicPlayer[];
  hand: Card[];
  pile: Card[]; // whole central pile, bottom first (public: everyone saw these played)
  pileCount: number;
  effectiveRank: number | null;
  stockCount: number;
  trashCount: number;
  turn: string | null;
  winner: string | null;
  log: LogEntry[];
  lastFlip: GameState['lastFlip'];
  decks: number;
}

export function viewFor(
  g: GameState,
  viewerId: string,
  meta: { connected: (id: string) => boolean; hostId: string | null },
): GameView {
  const me = g.players.find((p) => p.id === viewerId);
  return {
    phase: g.phase,
    players: g.players.map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      faceUp: p.faceUp.map((c) => ({ ...c })),
      faceDownCount: p.faceDown.length,
      ready: p.ready,
      connected: meta.connected(p.id),
      isHost: p.id === meta.hostId,
    })),
    hand: me ? me.hand.map((c) => ({ ...c })) : [],
    pile: g.pile.map((c) => ({ ...c })),
    pileCount: g.pile.length,
    effectiveRank: effectiveRank(g.pile),
    stockCount: g.stock.length,
    trashCount: g.trash.length,
    turn: g.phase === 'play' ? g.players[g.turn].id : null,
    winner: g.winner,
    log: g.log.slice(-40),
    lastFlip: g.lastFlip,
    decks: g.decks,
  };
}
