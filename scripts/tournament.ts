// Engine-level bot games (no network): npm run sim covers networked games.
import { applyAction, newGame, viewFor } from '../shared/game';
import { Difficulty, chooseAction, chooseSwaps, newMemory, observe } from '../shared/bot';

export function playBotGame(levels: Difficulty[], rng: () => number = Math.random, maxMoves = 20000) {
  const g = newGame(levels.map((_, i) => ({ id: 'b' + i, name: `${levels[i]}${i}` })), { rng });
  const mem = levels.map(() => newMemory());
  for (const p of g.players) {
    const lvl = levels[+p.id.slice(1)];
    for (const [h, f] of chooseSwaps(p.hand, p.faceUp, lvl, rng)) applyAction(g, p.id, { type: 'swap', handId: h, faceUpId: f });
    applyAction(g, p.id, { type: 'ready' });
  }
  let moves = 0, illegal = 0;
  while (g.phase === 'play' && moves < maxMoves) {
    const p = g.players[g.turn];
    const i = +p.id.slice(1);
    const a = chooseAction(viewFor(g, p.id, { connected: () => true, hostId: null }), p.id, levels[i], mem[i], rng);
    const r = applyAction(g, p.id, a);
    if (!r.ok) { illegal++; break; }
    g.players.forEach((q, j) => observe(mem[j], viewFor(g, q.id, { connected: () => true, hostId: null })));
    moves++;
  }
  return { g, moves, illegal, done: g.phase === 'over', winner: g.winner ? levels[+g.winner.slice(1)] : null };
}

if (process.argv[1]?.endsWith('tournament.ts')) {
  const N = Number(process.argv[2] ?? 1000);
  const setups: Difficulty[][] = [['hard', 'easy'], ['hard', 'medium'], ['medium', 'easy'], ['hard', 'hard', 'easy', 'easy'], ['easy', 'medium', 'hard', 'medium'], ['easy', 'easy', 'medium', 'medium', 'hard', 'hard']];
  for (const s of setups) {
    let unfinished = 0, illegal = 0, totalMoves = 0, maxM = 0;
    const win: Record<string, number> = {};
    for (let k = 0; k < N; k++) {
      const r = playBotGame(s);
      if (!r.done) unfinished++;
      illegal += r.illegal; totalMoves += r.moves; maxM = Math.max(maxM, r.moves);
      if (r.winner) win[r.winner] = (win[r.winner] ?? 0) + 1;
    }
    console.log(s.join('+'), { games: N, unfinished, illegal, avgMoves: Math.round(totalMoves / N), maxMoves: maxM, win });
  }
}
