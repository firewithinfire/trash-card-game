import { describe, expect, it } from 'vitest';
import { Room } from '../server/rooms';

const mk = () => new Room('ABCD', () => {}, () => 0);

describe('rooms', () => {
  it('join, host, rejoin with the same token keeps the seat', () => {
    const r = mk();
    const a = r.join('tokenA123', 'Ates');
    const b = r.join('tokenB123', 'Can');
    expect(a.ok && b.ok).toBe(true);
    expect(r.hostId).toBe((a as any).playerId);
    const again = r.join('tokenA123', 'Ates');
    expect((again as any).playerId).toBe((a as any).playerId);
    expect(r.seats).toHaveLength(2);
  });
  it('host adds/removes bots with a difficulty; others cannot', () => {
    const r = mk();
    const a: any = r.join('tokenA123', 'Ates');
    const b: any = r.join('tokenB123', 'Can');
    expect(r.addBot(b.playerId, 'easy').ok).toBe(false);
    expect(r.addBot(a.playerId, 'hard').ok).toBe(true);
    const bot = r.seats.find((s) => s.bot)!;
    expect(bot.bot).toBe('hard');
    expect(r.setBotDifficulty(a.playerId, bot.id, 'easy').ok).toBe(true);
    expect(r.removeBot(a.playerId, bot.id).ok).toBe(true);
    expect(r.seats).toHaveLength(2);
  });
  it('solo human vs bots plays to the end via bot steps; humans act through act()', () => {
    const r = mk();
    const a: any = r.join('tokenA123', 'Ates');
    r.addBot(a.playerId, 'easy');
    r.addBot(a.playerId, 'medium');
    expect(r.start(a.playerId).ok).toBe(true);
    while (r.stepBots()); // bots ready up
    expect(r.game!.phase).toBe('swap');
    expect(r.act(a.playerId, { type: 'ready' }).ok).toBe(true);
    expect(r.game!.phase).toBe('play');
    let guard = 0;
    while (r.game!.phase === 'play' && guard++ < 20000) {
      if (r.stepBots()) continue;
      // human: play the first legal card else pick up (or forced/blind)
      const view = r.viewFor(a.playerId).game!;
      const me = view.players.find((p) => p.id === a.playerId)!;
      const tries = [
        ...view.hand.map((c) => ({ type: 'play', cardIds: [c.id] })),
        ...me.faceUp.map((c) => ({ type: 'play', cardIds: [c.id] })),
        { type: 'pickup' },
        { type: 'playBlind', index: 0 },
      ];
      expect(tries.some((t) => r.act(a.playerId, t as any).ok)).toBe(true);
    }
    expect(r.game!.phase).toBe('over');
    r.dispose();
  });
  it('rejects new joiners mid-game and lets the host replace an offline player with a bot', () => {
    const r = mk();
    const a: any = r.join('tokenA123', 'Ates');
    const b: any = r.join('tokenB123', 'Can');
    r.start(a.playerId);
    expect(r.join('tokenC123', 'Late').ok).toBe(false);
    expect(r.replaceWithBot(a.playerId, b.playerId).ok).toBe(false); // still online
    r.disconnect(b.playerId);
    expect(r.replaceWithBot(a.playerId, b.playerId, 'hard').ok).toBe(true);
    expect(r.seats.find((s) => s.id === b.playerId)!.bot).toBe('hard');
    r.dispose();
  });
  it('views never leak other hands', () => {
    const r = mk();
    const a: any = r.join('tokenA123', 'Ates');
    r.addBot(a.playerId, 'easy');
    r.start(a.playerId);
    const json = JSON.stringify(r.viewFor(a.playerId));
    for (const c of r.game!.players[1].hand) expect(json).not.toContain(`"${c.id}"`);
    expect(json).not.toContain('token');
    r.dispose();
  });
});
