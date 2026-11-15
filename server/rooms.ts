// Room + seat management, independent of sockets so it can be unit tested.
import { randomBytes } from 'node:crypto';
import { Action, GameState, GameView, MAX_PLAYERS, MIN_PLAYERS, applyAction, newGame, viewFor } from '../shared/game';
import { BotMemory, Difficulty, DIFFICULTIES, chooseAction, chooseSwaps, newMemory, observe } from '../shared/bot';

export interface Seat {
  id: string;
  token: string | null; // null for bots
  name: string;
  bot: Difficulty | null;
  connected: boolean;
  memory: BotMemory;
}

export interface RoomView {
  code: string;
  you: string | null;
  hostId: string | null;
  seats: { id: string; name: string; bot: Difficulty | null; connected: boolean; isHost: boolean }[];
  maxPlayers: number;
  game: GameView | null;
  round: number;
}

const BOT_NAMES = ['Robo Rita', 'Card Shark', 'Botley', 'Deckard', 'Ace-9000', 'Pixel Pete', 'Trashbot', 'Lady Luck'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export class Room {
  seats: Seat[] = [];
  hostId: string | null = null;
  game: GameState | null = null;
  round = 0;
  lastActivity = Date.now();
  private botTimer: NodeJS.Timeout | null = null;

  constructor(
    public code: string,
    private onChange: (room: Room) => void,
    public botDelay: () => number = () => 800 + Math.random() * 700,
  ) {}

  private changed() {
    this.lastActivity = Date.now();
    const g = this.game;
    if (g && g.phase === 'play')
      for (const s of this.seats) if (s.bot) observe(s.memory, viewFor(g, s.id, { connected: () => true, hostId: null }));
    this.onChange(this);
    this.scheduleBots();
  }

  get inProgress() {
    return !!this.game && this.game.phase !== 'over';
  }

  join(token: string, rawName: string): Ok<{ playerId: string }> {
    const existing = this.seats.find((s) => s.token === token);
    if (existing) {
      existing.connected = true;
      if (rawName.trim() && !this.inProgress) existing.name = cleanName(rawName);
      if (!this.hostId) this.hostId = existing.id;
      this.changed();
      return { ok: true, playerId: existing.id };
    }
    if (this.inProgress) return { ok: false, error: 'A game is in progress in this room. Wait for it to finish.' };
    if (this.seats.length >= MAX_PLAYERS) return { ok: false, error: 'This room is full.' };
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'Pick a nickname.' };
    const seat: Seat = { id: 'p' + randomBytes(4).toString('hex'), token, name: this.uniqueName(name), bot: null, connected: true, memory: newMemory() };
    this.seats.push(seat);
    if (!this.hostId || !this.seats.find((s) => s.id === this.hostId && !s.bot)) this.hostId = seat.id;
    this.changed();
    return { ok: true, playerId: seat.id };
  }

  private uniqueName(name: string) {
    let n = name, i = 2;
    while (this.seats.some((s) => s.name.toLowerCase() === n.toLowerCase())) n = `${name} ${i++}`;
    return n;
  }

  disconnect(playerId: string) {
    const s = this.seats.find((x) => x.id === playerId);
    if (!s || s.bot) return;
    s.connected = false;
    // The seat is kept so a refresh / phone wake-up rejoins it; it's only removed on an explicit leave.
    if (this.hostId === playerId) {
      const other = this.seats.find((x) => !x.bot && x.connected);
      if (other) this.hostId = other.id;
    }
    this.changed();
  }

  leave(playerId: string): Ok {
    const s = this.seats.find((x) => x.id === playerId);
    if (!s) return { ok: true };
    if (this.inProgress) {
      this.disconnect(playerId);
      return { ok: true };
    }
    this.seats = this.seats.filter((x) => x.id !== playerId);
    if (this.hostId === playerId) this.hostId = this.seats.find((x) => !x.bot)?.id ?? null;
    this.changed();
    return { ok: true };
  }

  private requireHost(playerId: string): string | null {
    return playerId === this.hostId ? null : 'Only the host can do that.';
  }

  addBot(playerId: string, difficulty: Difficulty): Ok {
    const err = this.requireHost(playerId);
    if (err) return { ok: false, error: err };
    if (this.inProgress) return { ok: false, error: 'Wait for the round to finish.' };
    if (!DIFFICULTIES.includes(difficulty)) return { ok: false, error: 'Unknown difficulty' };
    if (this.seats.length >= MAX_PLAYERS) return { ok: false, error: 'The room is full.' };
    const free = BOT_NAMES.filter((n) => !this.seats.some((s) => s.name.startsWith(n)));
    const seat: Seat = { id: 'b' + randomBytes(4).toString('hex'), token: null, name: this.uniqueName(free[0] ?? 'Bot'), bot: difficulty, connected: true, memory: newMemory() };
    this.seats.push(seat);
    this.changed();
    return { ok: true };
  }

  setBotDifficulty(playerId: string, botId: string, difficulty: Difficulty): Ok {
    const err = this.requireHost(playerId);
    if (err) return { ok: false, error: err };
    const s = this.seats.find((x) => x.id === botId && x.bot);
    if (!s || !DIFFICULTIES.includes(difficulty)) return { ok: false, error: 'No such bot' };
    s.bot = difficulty;
    this.changed();
    return { ok: true };
  }

  removeBot(playerId: string, botId: string): Ok {
    const err = this.requireHost(playerId);
    if (err) return { ok: false, error: err };
    if (this.inProgress) return { ok: false, error: 'Wait for the round to finish.' };
    const before = this.seats.length;
    this.seats = this.seats.filter((x) => !(x.id === botId && x.bot));
    if (this.seats.length === before) return { ok: false, error: 'No such bot' };
    this.changed();
    return { ok: true };
  }

  /** Host replaces a disconnected human with a bot (keeps their cards and seat). */
  replaceWithBot(playerId: string, targetId: string, difficulty: Difficulty = 'medium'): Ok {
    const err = this.requireHost(playerId);
    if (err) return { ok: false, error: err };
    const s = this.seats.find((x) => x.id === targetId);
    if (!s || s.bot) return { ok: false, error: 'No such player' };
    if (s.connected) return { ok: false, error: 'You can only replace a player who is offline.' };
    s.bot = difficulty;
    s.token = null;
    s.connected = true;
    s.memory = newMemory();
    const gp = this.game?.players.find((p) => p.id === s.id);
    s.name = this.uniqueName(`${s.name.replace(/ \(bot\)$/, '')} (bot)`);
    if (gp) gp.name = s.name;
    this.changed();
    return { ok: true };
  }

  start(playerId: string, opts: { rng?: () => number } = {}): Ok {
    const err = this.requireHost(playerId);
    if (err) return { ok: false, error: err };
    if (this.inProgress) return { ok: false, error: 'A round is already running.' };
    if (this.seats.length < MIN_PLAYERS) return { ok: false, error: `Need at least ${MIN_PLAYERS} players (add a bot!).` };
    this.round++;
    for (const s of this.seats) s.memory = newMemory();
    this.game = newGame(this.seats.map((s) => ({ id: s.id, name: s.name })), { rng: opts.rng });
    this.changed();
    return { ok: true };
  }

  /** Back to the lobby (host only), e.g. to change seats/bots. */
  toLobby(playerId: string): Ok {
    const err = this.requireHost(playerId);
    if (err) return { ok: false, error: err };
    this.game = null;
    this.changed();
    return { ok: true };
  }

  act(playerId: string, action: Action): Ok {
    if (!this.game) return { ok: false, error: 'No game running' };
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat || seat.bot) return { ok: false, error: 'Not your seat' };
    const r = applyAction(this.game, playerId, action);
    if (r.ok) this.changed();
    return r;
  }

  viewFor(playerId: string | null): RoomView {
    const connected = (id: string) => this.seats.find((s) => s.id === id)?.connected ?? false;
    return {
      code: this.code,
      you: playerId,
      hostId: this.hostId,
      seats: this.seats.map((s) => ({ id: s.id, name: s.name, bot: s.bot, connected: s.connected, isHost: s.id === this.hostId })),
      maxPlayers: MAX_PLAYERS,
      game: this.game ? viewFor(this.game, playerId ?? '', { connected, hostId: this.hostId }) : null,
      round: this.round,
    };
  }

  get humansConnected() {
    return this.seats.some((s) => !s.bot && s.connected);
  }

  // ---------- bots ----------

  /** Runs one pending bot step synchronously. Returns true if a bot acted. */
  stepBots(): boolean {
    const g = this.game;
    if (!g || g.phase === 'over') return false;
    if (g.phase === 'swap') {
      const bot = this.seats.find((s) => s.bot && !g.players.find((p) => p.id === s.id)!.ready);
      if (!bot) return false;
      const gp = g.players.find((p) => p.id === bot.id)!;
      for (const [h, f] of chooseSwaps(gp.hand, gp.faceUp, bot.bot!)) applyAction(g, bot.id, { type: 'swap', handId: h, faceUpId: f });
      applyAction(g, bot.id, { type: 'ready' });
      return true;
    }
    const cur = g.players[g.turn];
    const seat = this.seats.find((s) => s.id === cur.id);
    if (!seat?.bot) return false;
    const view = viewFor(g, seat.id, { connected: () => true, hostId: this.hostId });
    const action = chooseAction(view, seat.id, seat.bot, seat.memory);
    const r = applyAction(g, seat.id, action);
    if (!r.ok) {
      // Should never happen; fall back to the safest legal move so the game can't stall.
      console.error(`[bot ${seat.name}] illegal action`, action, r.error);
      if (applyAction(g, seat.id, { type: 'pickup' }).ok === false) return false;
    }
    return true;
  }

  private scheduleBots() {
    if (this.botTimer) return;
    const g = this.game;
    if (!g || g.phase === 'over') return;
    const needsBot =
      g.phase === 'swap'
        ? this.seats.some((s) => s.bot && !g.players.find((p) => p.id === s.id)?.ready)
        : !!this.seats.find((s) => s.id === g.players[g.turn].id)?.bot;
    if (!needsBot) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.stepBots()) this.changed();
    }, g.phase === 'swap' ? 400 : this.botDelay());
  }

  dispose() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }
}

export function cleanName(name: string) {
  return String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
}

export class RoomStore {
  rooms = new Map<string, Room>();
  constructor(private onChange: (room: Room) => void, private botDelay?: () => number) {}

  create(): Room {
    let code = '';
    do {
      code = Array.from(randomBytes(4), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, this.onChange, this.botDelay);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string) {
    return this.rooms.get(String(code ?? '').toUpperCase());
  }

  /** Drop rooms nobody human has been connected to for `idleMs`. */
  sweep(idleMs = 1000 * 60 * 60 * 6) {
    const now = Date.now();
    for (const [code, r] of this.rooms)
      if (!r.humansConnected && now - r.lastActivity > idleMs) {
        r.dispose();
        this.rooms.delete(code);
      }
  }
}
