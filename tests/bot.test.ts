import { describe, expect, it } from 'vitest';
import { applyAction, newGame, viewFor } from '../shared/game';
import { Difficulty, chooseAction, chooseSwaps, newMemory } from '../shared/bot';
import { playBotGame } from '../scripts/tournament';
import { HARD } from '../shared/bot';
import { cs, player, rng, state } from './helpers';

const v = (g: any, id: string) => viewFor(g, id, { connected: () => true, hostId: null });

describe('bots', () => {
  it('every difficulty only produces legal moves and finishes games', () => {
    HARD.rollouts = 4; // keep the test fast
    const setups: Difficulty[][] = [['easy', 'medium', 'hard'], ['hard', 'hard'], ['easy', 'easy', 'easy', 'medium', 'medium', 'hard']];
    let seed = 1;
    for (const s of setups)
      for (let k = 0; k < 6; k++) {
        const r = playBotGame(s, rng(seed++));
        expect(r.illegal).toBe(0);
        expect(r.done).toBe(true);
      }
    HARD.rollouts = 16;
  });

  it('pick up when nothing is playable from hand', () => {
    for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
      const g = state([player('a', { hand: cs('3', '4') }), player('b', { hand: cs('3') })], { pile: cs('K') });
      expect(chooseAction(v(g, 'a'), 'a', d, newMemory(), rng(1))).toEqual({ type: 'pickup' });
    }
  });

  it('forced face-up play when no face-up card can beat the pile', () => {
    const g = state([player('a', { faceUp: cs('3', '4') }), player('b', { hand: cs('3') })], { pile: cs('K') });
    const a = chooseAction(v(g, 'a'), 'a', 'medium');
    expect(a.type).toBe('play');
    expect(applyAction(g, 'a', a).ok).toBe(true);
    expect(g.players[0].hand).toHaveLength(2);
  });

  it('blind play picks a valid face-down slot', () => {
    const g = state([player('a', { faceDown: cs('3', '4') }), player('b', { hand: cs('3') })]);
    const a = chooseAction(v(g, 'a'), 'a', 'hard');
    expect(a.type).toBe('playBlind');
    expect(applyAction(g, 'a', a).ok).toBe(true);
  });

  it('medium plays its lowest normal card and saves specials', () => {
    const g = state([player('a', { hand: cs('10', '2', 'K', '5', '9') }), player('b', { hand: cs('3') })], { pile: cs('4') });
    const a = chooseAction(v(g, 'a'), 'a', 'medium', newMemory(), () => 0.99) as any;
    expect(g.players[0].hand.find((c) => c.id === a.cardIds[0])!.rank).toBe(5);
  });

  it('medium/hard swap puts specials and high cards face-up', () => {
    const hand = cs('10', '2', '3', '4'), up = cs('5', '6', 'A');
    for (const d of ['medium', 'hard'] as Difficulty[]) {
      const swaps = chooseSwaps(hand, up, d);
      const upIds = new Set(up.map((c) => c.id));
      for (const [h, f] of swaps) { upIds.delete(f); upIds.add(h); }
      const ranks = [...hand, ...up].filter((c) => upIds.has(c.id)).map((c) => c.rank).sort((x, y) => x - y);
      expect(ranks).toContain(10);
      expect(ranks).toContain(2);
      expect(ranks).toContain(14);
    }
  });

  it('bot decisions never depend on hidden cards (same view -> same choice)', () => {
    const g1 = newGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { rng: rng(9), startSeat: 0 });
    g1.players.forEach((p) => applyAction(g1, p.id, { type: 'ready' }));
    const g2 = structuredClone(g1);
    // Shuffle everything 'a' can't see in g2.
    const hidden = [...g2.players[1].hand, ...g2.players[1].faceDown, ...g2.players[0].faceDown, ...g2.stock].reverse();
    let i = 0;
    for (const arr of [g2.players[1].hand, g2.players[1].faceDown, g2.players[0].faceDown, g2.stock]) for (let j = 0; j < arr.length; j++) arr[j] = hidden[i++];
    for (const d of ['easy', 'medium'] as Difficulty[])
      expect(chooseAction(v(g1, 'a'), 'a', d, newMemory(), rng(5))).toEqual(chooseAction(v(g2, 'a'), 'a', d, newMemory(), rng(5)));
    HARD.rollouts = 3;
    expect(chooseAction(v(g1, 'a'), 'a', 'hard', newMemory(), rng(5))).toEqual(chooseAction(v(g2, 'a'), 'a', 'hard', newMemory(), rng(5)));
    HARD.rollouts = 16;
  });
});
