import { describe, expect, it } from 'vitest';
import { applyAction, canPlayRank, createDeck, effectiveRank, newGame, viewFor, zoneOf } from '../shared/game';
import { c, cs, player, rng, state } from './helpers';

const play = (g: any, id: string, card: { id: string }) => applyAction(g, id, { type: 'play', cardIds: [card.id] });

describe('setup', () => {
  it('deals 3 face-down, 3 face-up, 4 in hand; rest is stock', () => {
    const g = newGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], { rng: rng(1) });
    for (const p of g.players) {
      expect(p.faceDown).toHaveLength(3);
      expect(p.faceUp).toHaveLength(3);
      expect(p.hand).toHaveLength(4);
    }
    expect(g.stock).toHaveLength(52 - 30);
    expect(g.phase).toBe('swap');
  });
  it('uses two decks above 5 players and allows up to 8', () => {
    const ps = Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    expect(newGame(ps).stock.length).toBe(104 - 60);
    expect(createDeck(2).length).toBe(104);
    expect(new Set(createDeck(2).map((x) => x.id)).size).toBe(104);
    expect(() => newGame([{ id: 'a', name: 'A' }])).toThrow();
  });
  it('swap phase: swap hand <-> face-up, then start when all ready', () => {
    const g = newGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { rng: rng(2), startSeat: 1 });
    const a = g.players[0];
    const h = a.hand[0], f = a.faceUp[2];
    expect(applyAction(g, 'a', { type: 'swap', handId: h.id, faceUpId: f.id }).ok).toBe(true);
    expect(a.hand).toContain(f);
    expect(a.faceUp).toContain(h);
    expect(applyAction(g, 'a', { type: 'play', cardIds: [a.hand[0].id] }).ok).toBe(false); // not started
    applyAction(g, 'a', { type: 'ready' });
    expect(applyAction(g, 'a', { type: 'swap', handId: a.hand[0].id, faceUpId: a.faceUp[0].id }).ok).toBe(false);
    expect(g.phase).toBe('swap');
    applyAction(g, 'b', { type: 'ready' });
    expect(g.phase).toBe('play');
    expect(g.turn).toBe(1);
  });
});

describe('ranking', () => {
  it('normal order 3..7,9,J,Q,K,A; equal or higher beats', () => {
    expect(canPlayRank(9, 9)).toBe(true);
    expect(canPlayRank(7, 9)).toBe(false);
    expect(canPlayRank(14, 13)).toBe(true);
    expect(canPlayRank(13, 14)).toBe(false);
    expect(canPlayRank(3, null)).toBe(true);
  });
  it('2, 8 and 10 can go on anything, even an Ace', () => {
    for (const r of [2, 8, 10]) expect(canPlayRank(r, 14)).toBe(true);
  });
  it('rejects a lower card and leaves state unchanged', () => {
    const lo = c('5');
    const g = state([player('a', { hand: [lo, c('6')] }), player('b', { hand: cs('3') })], { pile: cs('9') });
    const r = play(g, 'a', lo);
    expect(r.ok).toBe(false);
    expect(g.pile).toHaveLength(1);
    expect(g.turn).toBe(0);
  });
});

describe('one card per turn', () => {
  it('rejects multiple cards even of the same rank', () => {
    const [x, y] = cs('9', '9H');
    const g = state([player('a', { hand: [x, y, c('3')] }), player('b', { hand: cs('3') })]);
    expect(applyAction(g, 'a', { type: 'play', cardIds: [x.id, y.id] }).ok).toBe(false);
    expect(applyAction(g, 'a', { type: 'play', cardIds: [] }).ok).toBe(false);
    expect(play(g, 'a', x).ok).toBe(true);
    expect(g.turn).toBe(1);
  });
  it('rejects moves out of turn', () => {
    const k = c('K');
    const g = state([player('a', { hand: cs('3') }), player('b', { hand: [k] })]);
    expect(play(g, 'b', k).ok).toBe(false);
  });
});

describe('2: reset', () => {
  it('2 on a 9 lets the next player play a 3', () => {
    const two = c('2'), three = c('3');
    const g = state([player('a', { hand: [two, c('4')] }), player('b', { hand: [three, c('5')] })], { pile: cs('9') });
    expect(play(g, 'a', two).ok).toBe(true);
    expect(effectiveRank(g.pile)).toBeNull();
    expect(play(g, 'b', three).ok).toBe(true);
    expect(effectiveRank(g.pile)).toBe(3);
  });
});

describe('8: rank transparent, no skip', () => {
  it('8 counts as the card under it', () => {
    const eight = c('8'), seven = c('7'), nine = c('9H');
    const g = state([player('a', { hand: [eight, c('4')] }), player('b', { hand: [seven, nine, c('5')] }), player('c', { hand: cs('3') })], { pile: cs('9') });
    expect(play(g, 'a', eight).ok).toBe(true);
    expect(effectiveRank(g.pile)).toBe(9);
    expect(g.turn).toBe(1); // next player, nobody skipped
    expect(play(g, 'b', seven).ok).toBe(false);
    expect(play(g, 'b', nine).ok).toBe(true);
    expect(g.turn).toBe(2);
  });
  it('8 on an empty pile or on a 2 means anything goes; 8 on 8 looks through both', () => {
    expect(effectiveRank(cs('8'))).toBeNull();
    expect(effectiveRank(cs('K', '2', '8'))).toBeNull();
    expect(effectiveRank(cs('Q', '8', '8H'))).toBe(12);
  });
  it('8 can be played on an Ace', () => {
    const eight = c('8');
    const g = state([player('a', { hand: [eight, c('3')] }), player('b', { hand: cs('3') })], { pile: cs('A') });
    expect(play(g, 'a', eight).ok).toBe(true);
    expect(effectiveRank(g.pile)).toBe(14);
  });
  it('8 never skips with 2 players either', () => {
    const eight = c('8');
    const g = state([player('a', { hand: [eight, c('3')] }), player('b', { hand: cs('3') })]);
    play(g, 'a', eight);
    expect(g.turn).toBe(1);
  });
});

describe('10: trash', () => {
  it('moves pile including the 10 to trash; NEXT player starts the new pile with anything', () => {
    const ten = c('10'), three = c('3');
    const g = state([player('a', { hand: [ten, c('4')] }), player('b', { hand: [three, c('6')] })], { pile: cs('9', 'K', 'A') });
    expect(play(g, 'a', ten).ok).toBe(true);
    expect(g.pile).toHaveLength(0);
    expect(g.trash).toHaveLength(4);
    expect(g.trash).toContain(ten);
    expect(g.turn).toBe(1);
    expect(play(g, 'b', three).ok).toBe(true);
  });
  it('the next player cannot pick up an empty pile', () => {
    const ten = c('10');
    const g = state([player('a', { hand: [ten, c('4')] }), player('b', { hand: cs('3') })], { pile: cs('9') });
    play(g, 'a', ten);
    expect(applyAction(g, 'b', { type: 'pickup' }).ok).toBe(false);
  });
});

describe('drawing', () => {
  it('draws 1 after playing while stock has cards and hand <= 3', () => {
    const x = c('5');
    const g = state([player('a', { hand: [x, ...cs('6', '7', '9')] }), player('b', { hand: cs('3') })], { stock: cs('J', 'Q') });
    play(g, 'a', x);
    expect(g.players[0].hand).toHaveLength(4);
    expect(g.stock).toHaveLength(1);
  });
  it('after a pickup: no draw until the hand is back down to 3', () => {
    const g = state([player('a', { hand: cs('3', '4', '5', '6') }), player('b', { hand: cs('3', '4') })], { pile: cs('K', 'A'), stock: cs('J', 'Q', 'K') });
    applyAction(g, 'a', { type: 'pickup' });
    const a = g.players[0];
    expect(a.hand).toHaveLength(6);
    expect(g.turn).toBe(1);
    g.turn = 0;
    play(g, 'a', a.hand.find((x) => x.rank === 3)!); // 5 left
    expect(a.hand).toHaveLength(5);
    g.turn = 0;
    play(g, 'a', a.hand.find((x) => x.rank === 4)!); // 4 left
    expect(a.hand).toHaveLength(4);
    expect(g.stock).toHaveLength(3);
    g.turn = 0;
    play(g, 'a', a.hand.find((x) => x.rank === 5)!); // 3 left -> draw 1
    expect(a.hand).toHaveLength(4);
    expect(g.stock).toHaveLength(2);
  });
  it('does not draw from an empty stock', () => {
    const x = c('5');
    const g = state([player('a', { hand: [x], faceUp: cs('9') }), player('b', { hand: cs('3') })]);
    play(g, 'a', x);
    expect(g.players[0].hand).toHaveLength(0);
  });
  it('picking up the pile ends the turn', () => {
    const g = state([player('a', { hand: cs('3') }), player('b', { hand: cs('3') })], { pile: cs('K') });
    expect(applyAction(g, 'a', { type: 'pickup' }).ok).toBe(true);
    expect(g.pile).toHaveLength(0);
    expect(g.turn).toBe(1);
  });
  it('you may pick up voluntarily even if you could play', () => {
    const g = state([player('a', { hand: cs('A') }), player('b', { hand: cs('3') })], { pile: cs('4') });
    expect(applyAction(g, 'a', { type: 'pickup' }).ok).toBe(true);
    expect(g.players[0].hand).toHaveLength(2);
  });
});

describe('face-up cards', () => {
  it('cannot play face-up while the hand has cards', () => {
    const up = c('K');
    const g = state([player('a', { hand: cs('5'), faceUp: [up] }), player('b', { hand: cs('3') })]);
    expect(play(g, 'a', up).ok).toBe(false);
  });
  it('plays from face-up when the hand is empty', () => {
    const up = c('K');
    const g = state([player('a', { faceUp: [up, c('3')], faceDown: cs('4') }), player('b', { hand: cs('3') })], { pile: cs('Q') });
    expect(zoneOf(g.players[0])).toBe('faceUp');
    expect(play(g, 'a', up).ok).toBe(true);
    expect(g.players[0].faceUp).toHaveLength(1);
  });
  it('forced: no face-up card beats the pile -> play one and pick up the pile including it', () => {
    const [u1, u2] = cs('4', '5');
    const g = state([player('a', { faceUp: [u1, u2], faceDown: cs('6') }), player('b', { hand: cs('3') })], { pile: cs('9', 'K') });
    expect(play(g, 'a', u1).ok).toBe(true);
    const a = g.players[0];
    expect(a.hand.map((x) => x.id)).toContain(u1.id);
    expect(a.hand).toHaveLength(3);
    expect(a.faceUp).toEqual([u2]);
    expect(g.pile).toHaveLength(0);
    expect(g.turn).toBe(1);
    expect(zoneOf(a)).toBe('hand'); // back to playing from hand
  });
  it('cannot dump a losing face-up card while another face-up card can play', () => {
    const [lo, hi] = cs('4', 'A');
    const g = state([player('a', { faceUp: [lo, hi] }), player('b', { hand: cs('3') })], { pile: cs('K') });
    expect(play(g, 'a', lo).ok).toBe(false);
    expect(play(g, 'a', hi).ok).toBe(true);
  });
});

describe('face-down (blind) cards', () => {
  it('only once hand and face-up are empty', () => {
    const g = state([player('a', { faceUp: cs('4'), faceDown: cs('5') }), player('b', { hand: cs('3') })]);
    expect(applyAction(g, 'a', { type: 'playBlind', index: 0 }).ok).toBe(false);
  });
  it('valid flip stays on the pile', () => {
    const g = state([player('a', { faceDown: cs('K', '3') }), player('b', { hand: cs('3') })], { pile: cs('9') });
    expect(applyAction(g, 'a', { type: 'playBlind', index: 0 }).ok).toBe(true);
    expect(g.pile.at(-1)!.rank).toBe(13);
    expect(g.lastFlip!.ok).toBe(true);
    expect(g.turn).toBe(1);
  });
  it('flip lower than the pile: pile + the flipped card go into the hand, turn passes, then play from hand again', () => {
    const pile = cs('9', 'J');
    const [low, other] = cs('4', 'K');
    const g = state([player('a', { faceDown: [low, other] }), player('b', { hand: cs('3', '5') })], { pile: [...pile] });
    expect(applyAction(g, 'a', { type: 'playBlind', index: 0 }).ok).toBe(true);
    const a = g.players[0];
    expect(a.hand.map((x) => x.id).sort()).toEqual([pile[0].id, pile[1].id, low.id].sort()); // exactly pile + flipped card
    expect(a.faceDown).toEqual([other]);
    expect(g.pile).toHaveLength(0);
    expect(g.trash).toHaveLength(0);
    expect(g.lastFlip).toMatchObject({ playerId: 'a', ok: false });
    expect(g.turn).toBe(1); // turn passes
    expect(zoneOf(a)).toBe('hand'); // back to playing from the hand
    applyAction(g, 'b', { type: 'play', cardIds: [g.players[1].hand[0].id] }); // b plays 3
    expect(applyAction(g, 'a', { type: 'playBlind', index: 0 }).ok).toBe(false); // can't flip while holding cards
    expect(applyAction(g, 'a', { type: 'play', cardIds: [low.id] }).ok).toBe(true);
  });
  it('bad index rejected', () => {
    const g = state([player('a', { faceDown: cs('4') }), player('b', { hand: cs('3') })]);
    expect(applyAction(g, 'a', { type: 'playBlind', index: 3 }).ok).toBe(false);
  });
});

describe('winning: first player out of cards ends the round', () => {
  it('playing the last hand card (no face-up/face-down left) wins immediately', () => {
    const g = state([player('a', { hand: cs('5') }), player('b', { hand: cs('3') }), player('c', { hand: cs('Q', 'K') })]);
    play(g, 'a', g.players[0].hand[0]);
    expect(g.phase).toBe('over');
    expect(g.winner).toBe('a');
    expect(applyAction(g, 'b', { type: 'pickup' }).ok).toBe(false);
    expect(applyAction(g, 'b', { type: 'play', cardIds: [g.players[1].hand[0].id] }).ok).toBe(false);
  });
  it('a valid last face-down flip wins', () => {
    const g = state([player('a', { faceDown: cs('K') }), player('b', { hand: cs('3', '4') })], { pile: cs('9') });
    applyAction(g, 'a', { type: 'playBlind', index: 0 });
    expect(g.phase).toBe('over');
    expect(g.winner).toBe('a');
  });
  it('a 10 as the last card wins (pile still trashed)', () => {
    const ten = c('10');
    const g = state([player('a', { hand: [ten] }), player('b', { hand: cs('3') }), player('c', { hand: cs('4') })], { pile: cs('K') });
    play(g, 'a', ten);
    expect(g.phase).toBe('over');
    expect(g.winner).toBe('a');
    expect(g.trash).toHaveLength(2);
  });
  it('an invalid last face-down flip does not win (picks up instead)', () => {
    const g = state([player('a', { faceDown: cs('4') }), player('b', { hand: cs('3') })], { pile: cs('9') });
    applyAction(g, 'a', { type: 'playBlind', index: 0 });
    expect(g.phase).toBe('play');
    expect(g.winner).toBeNull();
    expect(g.players[0].hand).toHaveLength(2);
  });
  it('empty hand with cards still on the table is not a win', () => {
    const g = state([player('a', { hand: cs('5'), faceDown: cs('3') }), player('b', { hand: cs('3') })]);
    play(g, 'a', g.players[0].hand[0]);
    expect(g.phase).toBe('play');
    expect(g.turn).toBe(1);
  });
});

describe('hidden information', () => {
  it('view contains only own hand, counts for others, no face-down cards', () => {
    const g = newGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { rng: rng(3) });
    const v = viewFor(g, 'a', { connected: () => true, hostId: 'a' });
    expect(v.hand.map((x) => x.id)).toEqual(g.players[0].hand.map((x) => x.id));
    const json = JSON.stringify(v);
    for (const x of g.players[1].hand) expect(json).not.toContain(`"${x.id}"`);
    for (const p of g.players) for (const x of p.faceDown) expect(json).not.toContain(`"${x.id}"`);
    for (const x of g.stock) expect(json).not.toContain(`"${x.id}"`);
    expect(v.players[1].handCount).toBe(4);
    expect(v.players[1].faceDownCount).toBe(3);
  });
});

describe('random full games (engine fuzz)', () => {
  // Note: with one card per turn and no burns, two purely random players can bounce the pile
  // forever, so random games are capped; games where players play their lowest legal card must finish.
  it('100 games with random/lowest-card players: every move legal, cards conserved, sensible games finish', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = rng(seed);
      const n = 2 + (seed % 7);
      const g = newGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), { rng: r });
      const total = g.decks * 52;
      g.players.forEach((p) => applyAction(g, p.id, { type: 'ready' }));
      let moves = 0;
      while (g.phase === 'play' && moves < (seed % 2 ? 50000 : 3000)) {
        const p = g.players[g.turn];
        const zone = zoneOf(p);
        let res;
        if (zone === 'faceDown') res = applyAction(g, p.id, { type: 'playBlind', index: Math.floor(r() * p.faceDown.length) });
        else {
          const src = zone === 'hand' ? p.hand : p.faceUp;
          const eff = effectiveRank(g.pile);
          const ok = src.filter((x) => canPlayRank(x.rank, eff)).sort((x, y) => (x.rank % 8 === 2 || x.rank === 8 ? 99 : x.rank) - (y.rank % 8 === 2 || y.rank === 8 ? 99 : y.rank));
          const randomish = seed % 2 === 0;
          if (ok.length && !(randomish && g.pile.length && r() < 0.05)) res = applyAction(g, p.id, { type: 'play', cardIds: [(randomish || r() < 0.1 ? ok[Math.floor(r() * ok.length)] : ok[0]).id] });
          else if (zone === 'faceUp' && !ok.length) res = applyAction(g, p.id, { type: 'play', cardIds: [src[0].id] });
          else res = applyAction(g, p.id, { type: 'pickup' });
        }
        expect(res.ok, JSON.stringify(res)).toBe(true);
        const count = g.stock.length + g.pile.length + g.trash.length + g.players.reduce((s, q) => s + q.hand.length + q.faceUp.length + q.faceDown.length, 0);
        expect(count).toBe(total);
        moves++;
      }
      if (seed % 2 === 1 || g.phase === 'over') {
        expect(g.phase).toBe('over');
        const w = g.players.find((q) => q.id === g.winner)!;
        expect(w.hand.length + w.faceUp.length + w.faceDown.length).toBe(0);
      }
    }
  });
});

