import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, GameView, PublicPlayer, RANK_LABEL, playableIds, zoneOf } from '../../shared/game';
import type { Difficulty } from '../../shared/bot';
import type { RoomView } from '../../server/rooms';
import { CardView } from './Card';
import { RulesPanel } from './Rules';
import { emit, getName, getToken, setName, socket } from './net';

const roomFromPath = () => location.pathname.match(/^\/room\/([A-Za-z0-9]{3,8})/)?.[1]?.toUpperCase() ?? null;

export function App() {
  const [code, setCode] = useState<string | null>(roomFromPath());
  useEffect(() => {
    const onPop = () => setCode(roomFromPath());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const go = (c: string | null) => {
    history.pushState(null, '', c ? `/room/${c}` : '/');
    setCode(c);
  };
  return code ? <RoomScreen code={code} onExit={() => go(null)} /> : <Home onRoom={go} />;
}

// ---------------------------------------------------------------- home

function Home({ onRoom }: { onRoom: (code: string) => void }) {
  const [name, setN] = useState(getName());
  const [join, setJoin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rules, setRules] = useState(false);
  const create = async () => {
    if (!name.trim()) return setErr('Pick a nickname first');
    setName(name.trim());
    setBusy(true);
    const r = await emit('room:create');
    setBusy(false);
    if (r.ok) onRoom(r.code as string);
    else setErr(r.error ?? 'Could not create a room');
  };
  const doJoin = () => {
    const c = join.trim().toUpperCase();
    if (!name.trim()) return setErr('Pick a nickname first');
    if (c.length < 3) return setErr('Enter the room code');
    setName(name.trim());
    onRoom(c);
  };
  return (
    <div className="home">
      <div className="logo">
        <CardView card={{ id: 'l1', rank: 10, suit: 'H' }} size="lg" className="tilt-l" />
        <CardView size="lg" className="tilt-r" />
      </div>
      <h1>Trash</h1>
      <p className="tag">The card game where 10s take out the trash.</p>
      <label className="field">
        <span>Your nickname</span>
        <input value={name} maxLength={16} onChange={(e) => setN(e.target.value)} placeholder="e.g. Ates" autoComplete="nickname" />
      </label>
      <button className="btn primary wide" disabled={busy} onClick={create}>Create a room</button>
      <div className="or">or join friends</div>
      <div className="row">
        <input className="code-input" value={join} maxLength={8} onChange={(e) => setJoin(e.target.value.toUpperCase())} placeholder="CODE" autoCapitalize="characters" onKeyDown={(e) => e.key === 'Enter' && doJoin()} />
        <button className="btn" onClick={doJoin}>Join</button>
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn link" onClick={() => setRules(true)}>How to play</button>
      {rules && <RulesPanel onClose={() => setRules(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- room

function RoomScreen({ code, onExit }: { code: string; onExit: () => void }) {
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState('');
  const [needName, setNeedName] = useState(!getName());
  const [connected, setConnected] = useState(socket.connected);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number>();

  const showToast = useCallback((t: string) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  const join = useCallback(async () => {
    if (!getName()) return;
    const r = await emit('room:join', { code, name: getName(), token: getToken() });
    if (!r.ok) setError(r.error ?? 'Could not join');
    else setError('');
  }, [code]);

  useEffect(() => {
    const onState = (v: RoomView) => setView(v);
    const onConnect = () => { setConnected(true); join(); };
    const onDisconnect = () => setConnected(false);
    socket.on('state', onState);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) join();
    // Phones suspend sockets while asleep: reconnect + rejoin when the page is visible again.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!socket.connected) socket.connect();
      else join();
    };
    document.addEventListener('visibilitychange', onVisible);
    addEventListener('pageshow', onVisible);
    addEventListener('online', onVisible);
    return () => {
      socket.off('state', onState);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      document.removeEventListener('visibilitychange', onVisible);
      removeEventListener('pageshow', onVisible);
      removeEventListener('online', onVisible);
    };
  }, [join]);

  if (needName)
    return <NameGate code={code} onDone={() => { setNeedName(false); join(); }} />;

  if (error && !view)
    return (
      <div className="home">
        <h1>Room {code}</h1>
        <p className="error">{error}</p>
        <button className="btn primary wide" onClick={join}>Try again</button>
        <button className="btn wide" onClick={onExit}>Back</button>
      </div>
    );

  if (!view) return <div className="home"><p className="tag">Connecting to room {code}…</p></div>;

  const leave = async () => {
    await emit('room:leave');
    onExit();
  };

  return (
    <>
      {!connected && <div className="offline-banner">Reconnecting…</div>}
      {view.game ? <Table room={view} toast={showToast} /> : <Lobby room={view} toast={showToast} onLeave={leave} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function NameGate({ code, onDone }: { code: string; onDone: () => void }) {
  const [name, setN] = useState('');
  return (
    <div className="home">
      <h1>Join room {code}</h1>
      <label className="field">
        <span>Your nickname</span>
        <input autoFocus value={name} maxLength={16} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && (setName(name.trim()), onDone())} />
      </label>
      <button className="btn primary wide" disabled={!name.trim()} onClick={() => { setName(name.trim()); onDone(); }}>Take a seat</button>
    </div>
  );
}

// small hook: run an emit with a busy flag so buttons can't double-fire
function useAction(toast: (t: string) => void) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (event: string, payload?: unknown) => {
    setBusy(true);
    const r = await emit(event, payload);
    setBusy(false);
    if (!r.ok && r.error) toast(r.error);
    return r;
  }, [toast]);
  return { busy, run };
}

const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];
const levelLabel = (d: Difficulty) => d[0].toUpperCase() + d.slice(1);

function Lobby({ room, toast, onLeave }: { room: RoomView; toast: (t: string) => void; onLeave: () => void }) {
  const { busy, run } = useAction(toast);
  const [level, setLevel] = useState<Difficulty>('medium');
  const [rules, setRules] = useState(false);
  const isHost = room.you === room.hostId;
  const link = `${location.origin}/room/${room.code}`;
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Play Trash with me', text: `Join my Trash room ${room.code}`, url: link }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(link); toast('Link copied!'); } catch { toast(link); }
  };
  return (
    <div className="lobby">
      <header className="bar">
        <button className="btn ghost" onClick={onLeave} aria-label="Leave room">←</button>
        <div className="title">Room <b className="code">{room.code}</b></div>
        <button className="btn ghost" onClick={() => setRules(true)} aria-label="Rules">?</button>
      </header>
      <section className="share">
        <p>Send this link to your friends:</p>
        <div className="link-box">{link}</div>
        <button className="btn wide" onClick={share}>📤 Share / copy link</button>
      </section>
      <section>
        <h3>Players ({room.seats.length}/{room.maxPlayers})</h3>
        <ul className="seats">
          {room.seats.map((s) => (
            <li key={s.id} className={s.id === room.you ? 'me' : ''}>
              <span className="avatar">{s.bot ? '🤖' : s.name[0]?.toUpperCase()}</span>
              <span className="name">{s.name}{s.id === room.you && ' (you)'}</span>
              {s.isHost && <span className="badge host">host</span>}
              {s.bot && <span className={`badge lvl ${s.bot}`}>{levelLabel(s.bot)}</span>}
              {!s.bot && !s.connected && <span className="badge off">offline</span>}
              {isHost && s.bot && (
                <span className="seat-tools">
                  <select value={s.bot} aria-label="Bot level" onChange={(e) => run('room:botLevel', { botId: s.id, difficulty: e.target.value })}>
                    {LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
                  </select>
                  <button className="btn small danger" disabled={busy} onClick={() => run('room:removeBot', { botId: s.id })} aria-label={`Remove ${s.name}`}>✕</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {isHost && room.seats.length < room.maxPlayers && (
          <div className="add-bot">
            <div className="seg" role="radiogroup" aria-label="Bot difficulty">
              {LEVELS.map((l) => (
                <button key={l} role="radio" aria-checked={level === l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{levelLabel(l)}</button>
              ))}
            </div>
            <button className="btn" disabled={busy} onClick={() => run('room:addBot', { difficulty: level })}>+ Add bot</button>
          </div>
        )}
      </section>
      <div className="bottom-bar">
        {isHost ? (
          <button className="btn primary wide big" disabled={busy || room.seats.length < 2} onClick={() => run('game:start')}>
            {room.seats.length < 2 ? 'Add a friend or a bot to start' : `Start game (${room.seats.length} players)`}
          </button>
        ) : (
          <p className="hint center">Waiting for {room.seats.find((s) => s.isHost)?.name ?? 'the host'} to start…</p>
        )}
      </div>
      {rules && <RulesPanel onClose={() => setRules(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- table

function beatLabel(eff: number | null, pileCount: number) {
  if (pileCount === 0) return 'Empty — play anything';
  if (eff === null) return 'Anything';
  return `Beat: ${RANK_LABEL[eff]}`;
}

function Table({ room, toast }: { room: RoomView; toast: (t: string) => void }) {
  const g = room.game as GameView;
  const { busy, run } = useAction(toast);
  const [sel, setSel] = useState<{ zone: 'hand' | 'faceUp' | 'faceDown'; id: string } | null>(null);
  const [swapHand, setSwapHand] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [rules, setRules] = useState(false);
  const me = g.players.find((p) => p.id === room.you);
  const myIdx = g.players.findIndex((p) => p.id === room.you);
  // Opponents in turn order starting after me (clockwise).
  const opponents = useMemo(() => {
    const n = g.players.length;
    return Array.from({ length: n - 1 }, (_, k) => g.players[(myIdx + 1 + k + n) % n]).filter((p) => p.id !== room.you);
  }, [g.players, myIdx, room.you]);
  const myTurn = g.phase === 'play' && g.turn === room.you;
  const zone = me ? zoneOf(me) : 'done';
  const playable = useMemo(() => new Set(me && myTurn ? playableIds(zone, g.hand, me.faceUp, g.pile) : []), [me, myTurn, zone, g.hand, g.pile]);
  const forcedFaceUp = myTurn && zone === 'faceUp' && playable.size === 0;
  const isHost = room.you === room.hostId;

  useEffect(() => { setSel(null); }, [g.turn, g.hand.length, g.phase]);
  useEffect(() => {
    if (myTurn) { navigator.vibrate?.(60); document.title = '🟢 Your turn — Trash'; } else document.title = 'Trash 🗑️ card game';
  }, [myTurn]);

  const tapHand = (c: Card) => {
    if (g.phase === 'swap') {
      if (me?.ready) return;
      setSwapHand(swapHand === c.id ? null : c.id);
      return;
    }
    if (!myTurn || zone !== 'hand') return;
    setSel(sel?.id === c.id ? null : { zone: 'hand', id: c.id });
  };
  const tapFaceUp = async (c: Card) => {
    if (g.phase === 'swap') {
      if (me?.ready) return;
      if (!swapHand) return toast('Tap a hand card first, then the face-up card to swap with');
      await run('game:action', { type: 'swap', handId: swapHand, faceUpId: c.id });
      setSwapHand(null);
      return;
    }
    if (!myTurn || zone !== 'faceUp') return;
    setSel(sel?.id === c.id ? null : { zone: 'faceUp', id: c.id });
  };
  const tapFaceDown = (i: number) => {
    if (!myTurn || zone !== 'faceDown') return;
    setSel(sel?.id === String(i) ? null : { zone: 'faceDown', id: String(i) });
  };
  const playSelected = async () => {
    if (!sel) return;
    const action = sel.zone === 'faceDown' ? { type: 'playBlind', index: Number(sel.id) } : { type: 'play', cardIds: [sel.id] };
    const r = await run('game:action', action);
    if (r.ok) setSel(null);
  };
  const pickup = () => run('game:action', { type: 'pickup' });

  const turnPlayer = g.players.find((p) => p.id === g.turn);
  const nameOf = (id: string | null) => g.players.find((p) => p.id === id)?.name ?? '?';
  const flip = g.lastFlip;

  let status: string;
  if (g.phase === 'swap') status = me?.ready ? 'Waiting for everyone to be ready…' : 'Swap: tap a hand card, then a face-up card. Then press Ready.';
  else if (g.phase === 'over') status = 'Round over!';
  else if (!myTurn) status = `${turnPlayer?.name}'s turn${room.seats.find((s) => s.id === g.turn)?.bot ? ' 🤖' : ''}`;
  else if (zone === 'faceDown') status = 'Your turn: tap a face-down card, then Flip';
  else if (forcedFaceUp) status = "No face-up card can beat it: play one and you'll pick up the pile";
  else if (playable.size === 0) status = 'No playable card — pick up the pile';
  else status = 'Your turn: tap a card, then Play';

  return (
    <div className={`table ${myTurn ? 'my-turn' : ''}`}>
      <header className="bar">
        <div className="title">Room <b className="code">{room.code}</b></div>
        <div className="bar-tools">
          <button className="btn ghost" onClick={() => setShowLog(!showLog)} aria-expanded={showLog} aria-label="Event log">📜</button>
          <button className="btn ghost" onClick={() => setRules(true)} aria-label="Rules">?</button>
        </div>
      </header>

      <div className="layout">
        <div className="main-col">
          <section className="opponents" aria-label="Opponents">
            {opponents.map((p) => (
              <Opponent key={p.id} p={p} turn={g.turn === p.id} bot={room.seats.find((s) => s.id === p.id)?.bot ?? null}
                canReplace={isHost && !p.connected && g.phase !== 'over'} onReplace={() => run('room:replaceWithBot', { playerId: p.id, difficulty: 'medium' })} />
            ))}
          </section>

          <section className="center" aria-label="Table center">
            <div className="stack-col">
              <div className="mini-stack">{g.stockCount > 0 ? <CardView size="sm" /> : <div className="slot sm" />}</div>
              <span className="count">Stock {g.stockCount}</span>
            </div>
            <div className="pile-col">
              <div className="pile">
                {g.pile.length === 0 && <div className="slot lg">Empty</div>}
                {g.pile.slice(-4).map((c, i, arr) => (
                  <CardView key={c.id} card={c} size="lg" className={`pile-card p${arr.length - 1 - i}`} />
                ))}
              </div>
              <div className={`beat ${g.effectiveRank === null ? 'any' : ''}`}>{beatLabel(g.effectiveRank, g.pileCount)}</div>
              <span className="count">{g.pileCount} in pile</span>
            </div>
            <div className="stack-col">
              <div className="mini-stack trash-icon">🗑️</div>
              <span className="count">Trash {g.trashCount}</span>
            </div>
          </section>

          {flip && g.phase === 'play' && (
            <div className={`flip-note ${flip.ok ? 'ok' : 'bad'}`}>{nameOf(flip.playerId)} flipped {RANK_LABEL[flip.card.rank]} {flip.ok ? '✓' : '✗ picked up'}</div>
          )}
          <div className={`status ${myTurn ? 'go' : ''}`} aria-live="polite">{status}</div>

          {me && (
            <section className="mine" aria-label="Your cards">
              <div className="my-table">
                {[0, 1, 2].map((i) => {
                  const up = me.faceUp[i];
                  const hasDown = i < me.faceDownCount;
                  const downSelectable = myTurn && zone === 'faceDown' && hasDown;
                  return (
                    <div className="stack" key={i}>
                      {hasDown ? (
                        <CardView size="md" className="down" selected={sel?.zone === 'faceDown' && sel.id === String(i)} playable={downSelectable}
                          onClick={downSelectable ? () => tapFaceDown(i) : undefined} label={`Face-down card ${i + 1}`} />
                      ) : <div className="slot md" />}
                      {up && (
                        <CardView card={up} size="md" className="up"
                          selected={sel?.id === up.id}
                          playable={(g.phase === 'swap' && !me.ready) || (myTurn && zone === 'faceUp' && (playable.has(up.id) || forcedFaceUp))}
                          dim={myTurn && zone === 'faceUp' && !playable.has(up.id) && !forcedFaceUp}
                          onClick={g.phase === 'swap' || (myTurn && zone === 'faceUp') ? () => tapFaceUp(up) : undefined} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className={`hand ${g.hand.length > 6 ? 'crowded' : ''} ${g.hand.length > 12 ? 'packed' : ''}`} aria-label={`Your hand, ${g.hand.length} cards`}>
                {g.hand.length === 0 && <span className="hint">{zone === 'done' ? "You're out! 🎉" : 'Hand empty'}</span>}
                {[...g.hand].sort((a, b) => a.rank - b.rank).map((c) => (
                  <CardView key={c.id} card={c} size="md"
                    selected={sel?.id === c.id || swapHand === c.id}
                    playable={myTurn && zone === 'hand' && playable.has(c.id)}
                    dim={myTurn && zone === 'hand' && !playable.has(c.id)}
                    onClick={() => tapHand(c)} />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className={`log ${showLog ? 'open' : ''}`} aria-label="Event log">
          <h3>What happened</h3>
          <ol>
            {[...g.log].reverse().map((e) => <li key={e.id} className={e.kind}>{e.text}</li>)}
          </ol>
        </aside>
      </div>

      <div className="bottom-bar actions">
        {g.phase === 'swap' && me && (
          <button className="btn primary wide big" disabled={busy || me.ready} onClick={() => run('game:action', { type: 'ready' })}>
            {me.ready ? `Ready ✓ (${g.players.filter((p) => p.ready).length}/${g.players.length})` : "I'm ready"}
          </button>
        )}
        {g.phase === 'play' && (
          <>
            <button className="btn big pickup" disabled={!myTurn || busy || g.pileCount === 0} onClick={pickup}>Pick up ({g.pileCount})</button>
            <button className="btn primary big play" disabled={!myTurn || busy || !sel} onClick={playSelected}>
              {sel?.zone === 'faceDown' ? 'Flip it!' : sel ? 'Play' : 'Play'}
            </button>
          </>
        )}
      </div>

      {g.phase === 'over' && <Results room={room} run={run} busy={busy} />}
      {rules && <RulesPanel onClose={() => setRules(false)} />}
    </div>
  );
}

function Opponent({ p, turn, bot, canReplace, onReplace }: { p: PublicPlayer; turn: boolean; bot: Difficulty | null; canReplace: boolean; onReplace: () => void }) {
  return (
    <div className={`opp ${turn ? 'turn' : ''}`}>
      <div className="opp-head">
        <span className="opp-name">{bot ? '🤖 ' : ''}{p.name}</span>
        {bot && <span className={`badge lvl ${bot}`}>{levelLabel(bot)[0]}</span>}
        {!p.connected && !bot && <span className="badge off">off</span>}
      </div>
      <>
          <div className="opp-cards">
            {[0, 1, 2].map((i) => (
              <div className="opp-stack" key={i}>
                {i < p.faceDownCount ? <CardView size="xs" /> : <div className="slot xs" />}
                {p.faceUp[i] && <CardView card={p.faceUp[i]} size="xs" className="up" />}
              </div>
            ))}
          </div>
          <div className="opp-meta"><span title="cards in hand">✋ {p.handCount}</span></div>
      </>
      {canReplace && <button className="btn small" onClick={onReplace}>Replace with bot</button>}
    </div>
  );
}

function Results({ room, run, busy }: { room: RoomView; run: (e: string, p?: unknown) => Promise<unknown>; busy: boolean }) {
  const g = room.game!;
  const isHost = room.you === room.hostId;
  const winner = g.players.find((p) => p.id === g.winner);
  const left = (p: PublicPlayer) => p.handCount + p.faceUp.length + p.faceDownCount;
  const others = g.players.filter((p) => p.id !== g.winner).sort((a, b) => left(a) - left(b));
  return (
    <div className="modal-backdrop">
      <div className="modal results" role="dialog" aria-label="Results">
        <h2>{g.winner === room.you ? 'You win! 🏆' : `${winner?.name ?? '?'} wins! 🏆`}</h2>
        <p className="hint">First one out of cards takes the round.</p>
        <h3 className="left-title">Cards left</h3>
        <ol className="podium">
          {others.map((p) => (
            <li key={p.id}>
              <span className="who">{p.name}{p.id === room.you && ' (you)'}</span>
              <span className="left">{left(p)} card{left(p) === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ol>
        {isHost ? (
          <>
            <button className="btn primary wide big" disabled={busy} onClick={() => run('game:start')}>Play again</button>
            <button className="btn wide" disabled={busy} onClick={() => run('game:lobby')}>Back to lobby (change players/bots)</button>
          </>
        ) : (
          <p className="hint center">Waiting for the host to start the next round…</p>
        )}
      </div>
    </div>
  );
}
