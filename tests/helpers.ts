import { Card, GameState, PlayerState, Suit } from '../shared/game';

let n = 0;
const R: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14 };
/** c('9') -> a 9 of spades with a unique id; c('10H'), c('AS') etc. */
export function c(spec: string): Card {
  const m = spec.match(/^(10|[2-9JQKA])([SHDC])?$/)!;
  const rank = R[m[1]] ?? Number(m[1]);
  const suit = (m[2] ?? 'S') as Suit;
  return { id: `t${m[1]}${suit}${++n}`, rank, suit };
}
export const cs = (...specs: string[]) => specs.map(c);

export function player(id: string, p: Partial<PlayerState> = {}): PlayerState {
  return { id, name: id.toUpperCase(), hand: [], faceUp: [], faceDown: [], ready: true, ...p };
}

export function state(players: PlayerState[], g: Partial<GameState> = {}): GameState {
  return { phase: 'play', decks: 1, players, stock: [], pile: [], trash: [], turn: 0, winner: null, log: [], logSeq: 0, lastFlip: null, ...g };
}

/** Seeded PRNG (mulberry32) for reproducible random games. */
export function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
