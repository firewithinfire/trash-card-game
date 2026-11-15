// Networked end-to-end simulation against a running server (default http://localhost:3000).
// Start the server with BOT_DELAY_MS=0 for speed:  BOT_DELAY_MS=0 npm start  then  npm run sim
import { io, Socket } from 'socket.io-client';
import { randomBytes } from 'node:crypto';
import type { RoomView } from '../server/rooms';
import { effectiveRank, canPlayRank, isSpecial, zoneOf } from '../shared/game';

const URL = process.env.URL ?? 'http://localhost:3000';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  sock: Socket;
  view: RoomView | null = null;
  id = '';
  token = randomBytes(8).toString('hex');
  busy = false;
  errors: string[] = [];
  moves = 0;
  constructor(public name: string) { this.sock = this.connect(); }
  connect() {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.on('state', (v: RoomView) => { this.view = v; });
    this.sock = s;
    return s;
  }
  emit(ev: string, p: unknown = {}): Promise<any> {
    return new Promise((res) => this.sock.emit(ev, p, res));
  }
  async join(code: string) {
    const r = await this.emit('room:join', { code, name: this.name, token: this.token });
    if (!r.ok) throw new Error(`${this.name} join failed: ${r.error}`);
    this.id = r.playerId;
  }
  /** One legal-ish move if it's our turn (lowest card mostly, sometimes random, rarely a voluntary pickup). */
  async tick() {
    const g = this.view?.game;
    if (!g || this.busy) return;
    if (g.phase === 'swap') {
      const me = g.players.find((p) => p.id === this.id)!;
      if (!me.ready) { this.busy = true; await this.check(this.emit('game:action', { type: 'ready' })); this.busy = false; }
      return;
    }
    if (g.phase !== 'play' || g.turn !== this.id) return;
    const me = g.players.find((p) => p.id === this.id)!;
    const zone = zoneOf(me);
    let action: any;
    if (zone === 'faceDown') action = { type: 'playBlind', index: Math.floor(Math.random() * me.faceDownCount) };
    else {
      const src = zone === 'hand' ? g.hand : me.faceUp;
      const eff = effectiveRank(g.pile);
      const ok = src.filter((c) => canPlayRank(c.rank, eff)).sort((a, b) => (isSpecial(a.rank) ? 99 : a.rank) - (isSpecial(b.rank) ? 99 : b.rank));
      if (!ok.length) action = zone === 'faceUp' ? { type: 'play', cardIds: [src[0].id] } : { type: 'pickup' };
      else if (g.pileCount > 0 && g.pileCount <= 2 && Math.random() < 0.03) action = { type: 'pickup' };
      else action = { type: 'play', cardIds: [(Math.random() < 0.15 ? ok[Math.floor(Math.random() * ok.length)] : ok[0]).id] };
    }
    this.busy = true;
    const before = this.view;
    await this.check(this.emit('game:action', action), action);
    // wait until the state moved on so we don't act twice on a stale view
    for (let i = 0; i < 200 && this.view === before; i++) await sleep(2);
    this.moves++;
    this.busy = false;
  }
  async check(p: Promise<any>, action?: unknown) {
    const r = await p;
    if (!r.ok) this.errors.push(`${r.error} ${JSON.stringify(action)}`);
  }
}

async function runGame(clients: Client[], host: Client, label: string, maxMs = 120000) {
  const t0 = Date.now();
  let r = await host.emit('game:start');
  if (!r.ok) throw new Error('start failed: ' + r.error);
  await sleep(50);
  while (Date.now() - t0 < maxMs) {
    await Promise.all(clients.map((c) => c.tick()));
    const g = host.view?.game;
    if (g?.phase === 'over') {
      const names = (id: string) => g.players.find((p) => p.id === id)!.name;
      return { label, ok: true, ms: Date.now() - t0, winner: g.winner ? names(g.winner) : null, left: g.players.filter((p) => p.id !== g.winner).map((p) => `${p.name}:${p.handCount + p.faceUp.length + p.faceDownCount}`).join(' '), logLines: g.log.length };
    }
    await sleep(1);
  }
  return { label, ok: false, ms: Date.now() - t0, winner: null, left: '', logLines: 0 };
}

async function main() {
  const results: any[] = [];
  const errors: string[] = [];

  // A) 3 humans, 3 rounds in the same room (Play again)
  {
    const cs = ['Ates', 'Can', 'Deniz'].map((n) => new Client(n));
    await sleep(200);
    const { code } = await cs[0].emit('room:create');
    for (const c of cs) await c.join(code);
    for (let k = 1; k <= 5; k++) results.push(await runGame(cs, cs[0], `3 humans, round ${k}`));
    cs.forEach((c) => { errors.push(...c.errors.map((e) => `${c.name}: ${e}`)); c.sock.close(); });
  }

  // B) 1 human + Easy, Medium, Hard bots, 3 rounds
  {
    const h = new Client('Ates');
    await sleep(100);
    const { code } = await h.emit('room:create');
    await h.join(code);
    for (const d of ['easy', 'medium', 'hard']) { const r = await h.emit('room:addBot', { difficulty: d }); if (!r.ok) throw new Error(r.error); }
    for (let k = 1; k <= 5; k++) results.push(await runGame([h], h, `1 human + E/M/H bots, round ${k}`));
    errors.push(...h.errors.map((e) => `bots-room: ${e}`));
    h.sock.close();
  }

  // C) 2 humans + 2 bots; one human drops mid-game and reconnects with the same token
  {
    const a = new Client('Ates'), b = new Client('Can');
    await sleep(100);
    const { code } = await a.emit('room:create');
    await a.join(code); await b.join(code);
    await a.emit('room:addBot', { difficulty: 'hard' });
    await a.emit('room:addBot', { difficulty: 'easy' });
    await a.emit('game:start');
    for (let i = 0; i < 60; i++) { await Promise.all([a.tick(), b.tick()]); await sleep(2); }
    const handBefore = JSON.stringify(b.view!.game!.hand.map((c) => c.id).sort());
    b.sock.close();
    await sleep(100);
    const offline = a.view!.seats.find((s) => s.id === b.id)!.connected === false;
    b.connect(); b.view = null;
    await new Promise<void>((res) => b.sock.on('connect', () => res()));
    await b.join(code);
    await sleep(100);
    const sameSeat = b.view!.you === b.id;
    const handAfter = JSON.stringify(b.view!.game!.hand.map((c) => c.id).sort());
    // b can't move while offline (the game waits on its turn), so its hand must be identical.
    const handSame = handBefore === handAfter;
    results.push({ label: 'reconnect: seat shown offline while away', ok: offline });
    results.push({ label: 'reconnect: same seat + cards after rejoin', ok: sameSeat && handSame });
    // finish the game
    const t0 = Date.now();
    while (a.view!.game!.phase !== 'over' && Date.now() - t0 < 120000) { await Promise.all([a.tick(), b.tick()]); await sleep(1); }
    results.push({ label: '2 humans + 2 bots with reconnect, finished', ok: a.view!.game!.phase === 'over' });
    errors.push(...a.errors, ...b.errors);
    a.sock.close(); b.sock.close();
  }

  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.ms !== undefined ? `  (${r.ms} ms)` : ''}${r.winner ? `  winner: ${r.winner}  cards left: ${r.left}` : ''}`);
  console.log(`server rejected moves: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.log('  ', e));
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed || errors.length ? 'SIMULATION FAILED' : 'SIMULATION OK');
  process.exit(failed || errors.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
