// Server-side bot players. Bots decide only from the GameView their seat receives
// (own hand, everyone's face-up cards, counts, the public pile) plus their own memory
// of cards they've seen played. They never look at hidden cards.
import {
  Action, Card, GameState, GameView, PlayerState, Rng,
  applyAction, canPlayRank, createDeck, effectiveRank, isSpecial, playableIds, shuffle, zoneOf,
} from './game';

/** Tuning for the Hard bot (rollouts per candidate move). */
export const HARD = { rollouts: 16, margin: 0.15 };
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/**
 * What a Hard bot remembers, built only from public information a person at the table sees:
 * every card that hit the pile, and which known cards each opponent picked up.
 */
export interface BotMemory {
  seen: Set<string>;
  known: Map<string, Map<string, Card>>; // playerId -> cards we watched them pick up
  lastPile: Card[];
  lastTurn: string | null;
  lastTrash: number;
}
export const newMemory = (): BotMemory => ({ seen: new Set(), known: new Map(), lastPile: [], lastTurn: null, lastTrash: 0 });

/** Call after every state change. */
export function observe(mem: BotMemory, view: GameView) {
  const pileIds = new Set(view.pile.map((c) => c.id));
  const continued = mem.lastPile.every((c) => pileIds.has(c.id));
  if (!continued && view.trashCount === mem.lastTrash && mem.lastTurn) {
    // The pile vanished without going to the trash: the previous mover picked it up.
    const k = mem.known.get(mem.lastTurn) ?? new Map<string, Card>();
    for (const c of mem.lastPile) k.set(c.id, c);
    if (view.lastFlip && !view.lastFlip.ok && view.lastFlip.playerId === mem.lastTurn) k.set(view.lastFlip.card.id, view.lastFlip.card);
    mem.known.set(mem.lastTurn, k);
  }
  for (const c of view.pile) {
    mem.seen.add(c.id);
    for (const k of mem.known.values()) k.delete(c.id);
  }
  for (const p of view.players) for (const c of p.faceUp) mem.seen.add(c.id);
  if (view.lastFlip) mem.seen.add(view.lastFlip.card.id);
  mem.lastPile = view.pile;
  mem.lastTurn = view.turn;
  mem.lastTrash = view.trashCount;
}

// Higher = more valuable to keep face-up (played late) — specials and high cards.
function keepValue(c: Card, d: Difficulty) {
  if (c.rank === 10) return 30;
  if (c.rank === 2) return 29;
  if (c.rank === 8) return d === 'hard' ? 20 : 14.5; // 8 is a wildcard-ish "match", great late
  return c.rank;
}

/** Swaps to perform in the swap phase, as [handId, faceUpId] pairs. */
export function chooseSwaps(hand: Card[], faceUp: Card[], d: Difficulty, rng: Rng = Math.random): [string, string][] {
  if (d === 'easy') {
    if (rng() < 0.5 || !hand.length || !faceUp.length) return [];
    return [[hand[Math.floor(rng() * hand.length)].id, faceUp[Math.floor(rng() * faceUp.length)].id]];
  }
  // Put the best 3 of hand+faceUp face-up. Hard also avoids stacking 3 of one special.
  const all = [...hand, ...faceUp].sort((a, b) => keepValue(b, d) - keepValue(a, d));
  let best = all.slice(0, faceUp.length);
  if (d === 'hard') {
    const counts = new Map<number, number>();
    best = [];
    for (const c of all) {
      if (best.length === faceUp.length) break;
      const k = counts.get(c.rank) ?? 0;
      if (isSpecial(c.rank) && k >= 1) continue; // spread specials: one face-up of each kind
      counts.set(c.rank, k + 1);
      best.push(c);
    }
    for (const c of all) if (best.length < faceUp.length && !best.includes(c)) best.push(c);
  }
  const wantUp = new Set(best.map((c) => c.id));
  const handOut = hand.filter((c) => wantUp.has(c.id)); // hand cards that should go up
  const upOut = faceUp.filter((c) => !wantUp.has(c.id)); // face-up cards that should go to hand
  return handOut.map((h, i) => [h.id, upOut[i].id] as [string, string]);
}

const lowestFirst = (a: Card, b: Card) => a.rank - b.rank;

/** Pick an action for the bot whose turn it is. Always returns a legal action. */
export function chooseAction(view: GameView, myId: string, d: Difficulty, mem: BotMemory = newMemory(), rng: Rng = Math.random): Action {
  const me = view.players.find((p) => p.id === myId)!;
  const zone = zoneOf(me);
  if (zone === 'faceDown') return { type: 'playBlind', index: Math.floor(rng() * me.faceDownCount) };

  const src = zone === 'hand' ? view.hand : me.faceUp;
  const okIds = new Set(playableIds(zone, view.hand, me.faceUp, view.pile));
  const legal = src.filter((c) => okIds.has(c.id));
  const play = (c: Card): Action => ({ type: 'play', cardIds: [c.id] });

  if (legal.length === 0) {
    if (zone === 'faceUp') return play([...src].sort(lowestFirst)[0]); // forced play + pickup
    return { type: 'pickup' };
  }

  if (d === 'easy') {
    // Sometimes grabs a small pile even though it could play.
    if (view.pile.length > 0 && view.pile.length <= 2 && rng() < 0.08) return { type: 'pickup' };
    // Half the time any legal card (wastes specials and high cards), otherwise the lowest one.
    if (rng() < 0.5) return play(legal[Math.floor(rng() * legal.length)]);
    return play([...legal].sort(lowestFirst)[0]);
  }

  const normals = legal.filter((c) => !isSpecial(c.rank)).sort(lowestFirst);
  const specials = legal.filter((c) => isSpecial(c.rank));
  const byRank = (r: number) => specials.find((c) => c.rank === r);

  if (d === 'medium') {
    if (normals.length) return play(rng() < 0.1 ? normals[Math.floor(rng() * normals.length)] : normals[0]);
    return play(byRank(8) ?? byRank(2) ?? byRank(10)!);
  }

  // ---- hard: Monte Carlo look-ahead ----
  // Start from Medium's choice, then deal the cards we can't see at random (consistent with
  // everything we've watched), play each alternative forward with a fast sensible policy, and
  // switch only if an alternative clearly gets us out of cards first more often.
  observe(mem, view);
  const base = normals.length ? normals[0] : (byRank(8) ?? byRank(2) ?? byRank(10)!);
  const candidates: Card[] = [base];
  const seenRank = new Set<number>([base.rank]);
  for (const c of [...legal].sort(lowestFirst)) if (!seenRank.has(c.rank)) { seenRank.add(c.rank); candidates.push(c); }
  if (candidates.length === 1) return play(base);
  const ROLLOUTS = HARD.rollouts;
  let best = base, bestScore = -Infinity, baseScore = 0;
  for (const cand of candidates) {
    let total = 0;
    for (let k = 0; k < ROLLOUTS; k++) {
      const g = determinize(view, myId, mem, rng);
      applyAction(g, myId, play(cand));
      total += rollout(g, myId, rng);
    }
    if (cand === base) baseScore = total;
    if (total > bestScore) { bestScore = total; best = cand; }
  }
  return play(bestScore >= baseScore + HARD.margin * ROLLOUTS ? best : base);
}

/** A full GameState consistent with what this seat knows; hidden cards are dealt at random. */
export function determinize(view: GameView, myId: string, mem: BotMemory, rng: Rng): GameState {
  const deck = createDeck(view.decks);
  const located = new Set<string>();
  const take = (c: Card) => { located.add(c.id); return { ...c }; };
  const hand = view.hand.map(take);
  const faceUps = view.players.map((p) => p.faceUp.map(take));
  const pile = view.pile.map(take);
  const knownHeld = new Map<string, Card[]>();
  for (const p of view.players) {
    if (p.id === myId) continue;
    const k = [...(mem.known.get(p.id)?.values() ?? [])].filter((c) => !located.has(c.id)).slice(0, p.handCount);
    knownHeld.set(p.id, k.map(take));
  }
  const fresh = shuffle(deck.filter((c) => !located.has(c.id) && !mem.seen.has(c.id)), rng);
  const stale = shuffle(deck.filter((c) => !located.has(c.id) && mem.seen.has(c.id)), rng); // most likely trashed
  const draw = () => fresh.pop() ?? stale.pop()!;
  const players: PlayerState[] = view.players.map((p, i) => {
    const isMe = p.id === myId;
    const h = isMe ? hand : [...knownHeld.get(p.id)!];
    while (h.length < p.handCount) h.push(draw());
    const fd: Card[] = [];
    for (let j = 0; j < p.faceDownCount; j++) fd.push(draw());
    return { id: p.id, name: p.name, hand: h, faceUp: faceUps[i], faceDown: fd, ready: true };
  });
  const stock: Card[] = [];
  for (let j = 0; j < view.stockCount; j++) stock.push(draw());
  return {
    phase: 'play', decks: view.decks, players, stock, pile, trash: [...fresh, ...stale],
    turn: Math.max(0, view.players.findIndex((p) => p.id === view.turn)),
    winner: null, log: [], logSeq: 0, lastFlip: null,
  };
}

/** Fast "medium" policy straight on the state; returns this seat's score in [0, 1]. */
function rollout(g: GameState, myId: string, rng: Rng, maxMoves = 400): number {
  let moves = 0;
  while (g.phase === 'play' && moves++ < maxMoves) {
    const p = g.players[g.turn];
    const zone = zoneOf(p);
    if (zone === 'faceDown') { applyAction(g, p.id, { type: 'playBlind', index: Math.floor(rng() * p.faceDown.length) }); continue; }
    const src = zone === 'hand' ? p.hand : p.faceUp;
    const eff = effectiveRank(g.pile);
    let pick: Card | undefined, alt: Card | undefined;
    for (const c of src) {
      if (!canPlayRank(c.rank, eff)) continue;
      if (!isSpecial(c.rank)) { if (!pick || c.rank < pick.rank) pick = c; }
      else if (!alt || specialOrder(c.rank) < specialOrder(alt.rank)) alt = c;
    }
    const c = pick ?? alt;
    if (c) applyAction(g, p.id, { type: 'play', cardIds: [c.id] });
    else if (zone === 'faceUp') applyAction(g, p.id, { type: 'play', cardIds: [src[0].id] });
    else applyAction(g, p.id, { type: 'pickup' });
  }
  // The first player out of cards wins; that's all that counts.
  if (g.phase === 'over') return g.winner === myId ? 1 : 0;
  // Rollout cut short: fewer cards than the others is better.
  const cards = (q: PlayerState) => q.hand.length + q.faceUp.length + q.faceDown.length;
  const me = g.players.find((q) => q.id === myId)!;
  const others = g.players.filter((q) => q.id !== myId);
  const worse = others.filter((q) => cards(q) > cards(me)).length;
  return 0.5 * (worse / Math.max(1, others.length));
}
const specialOrder = (r: number) => (r === 8 ? 0 : r === 2 ? 1 : 2);
