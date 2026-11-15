import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server, Socket } from 'socket.io';
import { Room, RoomStore } from './rooms';
import type { Action } from '../shared/game';
import type { Difficulty } from '../shared/bot';

const PORT = Number(process.env.PORT) || 3000;
const BOT_DELAY_MS = process.env.BOT_DELAY_MS; // e.g. "0" for fast automated tests

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = [path.join(here, 'client'), path.join(here, '..', 'dist', 'client'), path.resolve('dist/client')].find((d) =>
  fs.existsSync(path.join(d, 'index.html')),
);

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => { res.json({ ok: true, rooms: store.rooms.size }); });
if (staticDir) {
  app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
} else {
  app.get('/', (_req, res) => { res.send('Client not built yet. Run "npm run build" (or use "npm run dev").'); });
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, pingInterval: 10000, pingTimeout: 8000 });

const socketsByPlayer = new Map<string, Set<Socket>>(); // playerId -> sockets
const broadcast = (room: Room) => {
  for (const s of room.seats) for (const sock of socketsByPlayer.get(s.id) ?? []) sock.emit('state', room.viewFor(s.id));
};
const store = new RoomStore(broadcast, BOT_DELAY_MS !== undefined ? () => Number(BOT_DELAY_MS) : undefined);
setInterval(() => store.sweep(), 10 * 60 * 1000).unref();

type Ack = (r: unknown) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

io.on('connection', (socket) => {
  let room: Room | null = null;
  let playerId: string | null = null;

  const detach = () => {
    if (room && playerId) {
      const set = socketsByPlayer.get(playerId);
      set?.delete(socket);
      if (!set || set.size === 0) {
        socketsByPlayer.delete(playerId);
        room.disconnect(playerId);
      }
    }
  };

  socket.on('room:create', (_p, ack) => {
    const r = store.create();
    safeAck(ack)({ ok: true, code: r.code });
  });

  socket.on('room:join', (p: { code: string; name: string; token: string }, ack) => {
    const reply = safeAck(ack);
    const r = store.get(p?.code);
    if (!r) return reply({ ok: false, error: 'Room not found. Check the code or create a new room.' });
    if (typeof p.token !== 'string' || p.token.length < 8) return reply({ ok: false, error: 'Bad token' });
    detach();
    const res = r.join(p.token, p.name ?? '');
    if (!res.ok) return reply(res);
    room = r;
    playerId = res.playerId;
    if (!socketsByPlayer.has(playerId)) socketsByPlayer.set(playerId, new Set());
    socketsByPlayer.get(playerId)!.add(socket);
    reply({ ok: true, playerId });
    socket.emit('state', r.viewFor(playerId));
  });

  const withRoom = (fn: (r: Room, id: string, p: any) => { ok: boolean; error?: string }) => (p: any, ack: unknown) => {
    const reply = safeAck(ack);
    if (!room || !playerId) return reply({ ok: false, error: 'Join a room first' });
    try {
      reply(fn(room, playerId, p ?? {}));
    } catch (e) {
      console.error(e);
      reply({ ok: false, error: 'Server error' });
    }
  };

  socket.on('room:leave', withRoom((r, id) => {
    const res = r.leave(id);
    socketsByPlayer.get(id)?.delete(socket);
    room = null; playerId = null;
    return res;
  }));
  socket.on('room:addBot', withRoom((r, id, p) => r.addBot(id, p.difficulty as Difficulty)));
  socket.on('room:removeBot', withRoom((r, id, p) => r.removeBot(id, p.botId)));
  socket.on('room:botLevel', withRoom((r, id, p) => r.setBotDifficulty(id, p.botId, p.difficulty)));
  socket.on('room:replaceWithBot', withRoom((r, id, p) => r.replaceWithBot(id, p.playerId, p.difficulty)));
  socket.on('game:start', withRoom((r, id) => r.start(id)));
  socket.on('game:lobby', withRoom((r, id) => r.toLobby(id)));
  socket.on('game:action', withRoom((r, id, p) => r.act(id, p as Action)));
  socket.on('disconnect', detach);
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
  console.log(`🗑️  Trash is running on http://localhost:${PORT}`);
  for (const ip of lan) console.log(`   Friends on the same Wi-Fi: http://${ip}:${PORT}`);
  if (!staticDir) console.log('   (client not built: run "npm run build")');
});
