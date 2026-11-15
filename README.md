# Trash 🗑️ — online multiplayer card game

A phone-first web app for **Trash**, a Shithead/Palace-style card game. Create a room, send your
friends the link, fill empty seats with bots (Easy / Medium / Hard), and play. One small Node
server runs everything: the rooms, the rules, the bots and the web page.

- Rooms with a 4-letter code and a share link (`/room/K7QX`)
- 2–8 players (6+ players use two decks); any mix of friends and bots, or solo against bots
- The server referees every move; each phone only ever receives its own hand
- Refresh, lose signal or lock your phone: you rejoin the same seat with your cards
- If a friend drops out for good, the host can hand their seat to a bot
- Works in phone browsers (portrait) and on desktop; "Add to Home Screen" installs it like an app

## Rules

- **Deal:** each player gets 3 face-down cards, 3 face-up cards on top of them, and 4 in hand. The rest is the stock.
- **Swap:** before the start, swap any hand cards with your face-up cards, then press **Ready**. The game starts when everyone is ready. A random player goes first; play goes clockwise.
- **One card per turn** onto the central pile. It must be **equal or higher** than the last card.
  Order, low to high: 3 4 5 6 7 9 J Q K **A**.
- **2** can go on anything and resets the pile: anything can follow it.
- **8** can go on anything and counts as the card under it (an 8 on a 9 means "beat 9"). On an empty pile or a 2, anything can follow. It does not skip anyone.
- **10 — Trash!** can go on anything. The whole pile, including the 10, goes to the trash and is out for the round. The **next player** starts a new pile with any card.
- **Drawing:** after you play, draw 1 card from the stock (while it lasts) if your hand has 3 or fewer cards. So after a pickup you don't draw until you're back down to 3.
- **Picking up:** if you can't play, or don't want to, take the whole pile into your hand. That ends your turn.
- **Face-up cards:** once your hand is empty (and the stock is gone), play from your face-up cards. If none of them can beat the pile, you must play one anyway and pick up the pile including it, then carry on from your hand.
- **Face-down cards:** once your hand and face-ups are gone, tap a face-down card to flip it. If it beats the pile it stays. If it's lower, you pick up the whole pile plus that flipped card into your hand (just like with face-up cards) and play from your hand again.
- **Winning:** the **first player to get rid of all their cards** (hand, face-up and face-down) wins, and the round ends right there, even if their last card was a 10. The end screen shows the winner and how many cards everyone else had left; the host can press **Play again**.

### Bots

The host adds bots in the lobby and picks a level for each (shown as a badge). Bots run on the
server, do their swap automatically and move after about a second. They only use what a real
player in that seat could see: their own hand, everyone's face-up cards, card counts and the
cards played to the pile.

| Level | How it plays |
|---|---|
| **Easy** | Often plays a random legal card (wasting specials), sometimes picks up a small pile when it didn't have to. |
| **Medium** | Plays its lowest normal card, saves 2 / 8 / 10 until it has nothing else, keeps high cards and specials face-up. |
| **Hard** | Medium's habits plus card tracking (what was played, trashed and picked up by whom) and look-ahead: for each possible move it deals the unseen cards at random many times, plays the game forward, and picks the move most likely to get it out of cards first. |

## Run it on your computer

Needs [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run build
npm start
```

Open http://localhost:3000. The server prints a second address such as
`http://192.168.1.23:3000`: friends on the **same Wi-Fi** open that on their phones.

(`PORT=4000 npm start` changes the port. `npm run dev` runs a hot-reloading dev setup at http://localhost:5173.)

## Play online with friends (quick, from your computer)

Keep `npm start` running and open a temporary public link in a second terminal:

```bash
npx cloudflared tunnel --url http://localhost:3000
```

It prints an `https://something.trycloudflare.com` address. Send that to your friends; it works
until you close the terminal. (No account needed. [ngrok](https://ngrok.com) works the same way:
`ngrok http 3000`.) Your computer must stay awake while you play.

## Permanent free hosting

### Render.com (easiest)

1. Put this folder in a GitHub repository (it can be private).
2. Sign in at [render.com](https://render.com) with GitHub, click **New → Web Service**, and pick the repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Click **Create Web Service**. After a couple of minutes you get `https://your-app.onrender.com`. Share that link.

On the free plan the server sleeps after ~15 minutes without visitors; the first visit then takes
about 30–60 seconds to wake it. Rooms live in memory, so a restart or redeploy ends running games.

### Fly.io or Railway (Docker)

A `Dockerfile` is included.

- **Fly.io:** install `flyctl`, then run `fly launch` in this folder (accept the Dockerfile, internal port 3000), then `fly deploy`.
- **Railway:** **New Project → Deploy from GitHub repo**. It detects the Dockerfile. Then add a public domain under **Settings → Networking**.
- **Any Docker host:** `docker build -t trash . && docker run -p 3000:3000 trash`

Keep it to **one instance**: rooms are held in that server's memory.

## Development

```bash
npm test              # unit tests (rules engine, bots, rooms)
npm run typecheck
BOT_DELAY_MS=0 npm start &  npm run sim      # networked multi-client games to completion
npx tsx scripts/tournament.ts 500           # bot-vs-bot statistics
BOT_DELAY_MS=150 npm start & npm run shots   # phone/desktop screenshots into shots/
```

Layout:

- `shared/game.ts`: pure rules engine (state, moves, validation, per-player views)
- `shared/bot.ts`: bot strategies
- `server/rooms.ts`: rooms, seats, reconnection and the bot scheduler
- `server/index.ts`: Express + Socket.IO server that also serves the built client
- `client/`: React (Vite) app with CSS-drawn cards
