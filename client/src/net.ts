import { io, Socket } from 'socket.io-client';

export const socket: Socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });

export function getToken() {
  let t = localStorage.getItem('trash-token');
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('trash-token', t);
  }
  return t;
}
export const getName = () => localStorage.getItem('trash-name') ?? '';
export const setName = (n: string) => localStorage.setItem('trash-name', n);

export type Reply = { ok: boolean; error?: string; [k: string]: unknown };
export function emit(event: string, payload: unknown = {}): Promise<Reply> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'No answer from the server — check your connection.' }), 8000);
    socket.emit(event, payload, (r: Reply) => { clearTimeout(timer); resolve(r); });
  });
}
