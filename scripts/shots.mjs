// Headless Chromium screenshots + horizontal-overflow checks at phone and desktop sizes.
// Needs a running server (BOT_DELAY_MS=150 npm start) and a Chrome/Chromium (CHROME=/path).
import { chromium } from 'playwright-core';
import { io } from 'socket.io-client';
import fs from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:3000';
const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const OUT = 'shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sizes = [
  { name: 'iphone13', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: 'android-small', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];

function friend(code, name) {
  // A second human (socket client) who readies up and plays lowest legal card / picks up.
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const token = 'friend-' + Math.random().toString(36).slice(2);
  let me = '', busy = false;
  s.on('state', async (v) => {
    const g = v.game;
    if (!g || busy) return;
    busy = true;
    const p = g.players.find((x) => x.id === me);
    if (g.phase === 'swap' && p && !p.ready) { await sleep(400); s.emit('game:action', { type: 'ready' }, () => {}); }
    if (g.phase === 'play' && g.turn === me) {
      await sleep(250);
      const src = g.hand.length ? g.hand : p.faceUp;
      const tries = [...src].sort((a, b) => a.rank - b.rank).map((c) => ({ type: 'play', cardIds: [c.id] }));
      tries.push({ type: 'pickup' }, { type: 'playBlind', index: 0 });
      for (const t of tries) { const r = await new Promise((res) => s.emit('game:action', t, res)); if (r.ok) break; }
    }
    busy = false;
  });
  return new Promise((res) => s.on('connect', () => s.emit('room:join', { code, name, token }, (r) => { me = r.playerId; res(s); })));
}

const overflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
const report = [];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// PWA icons from the SVG
{
  const page = await browser.newPage();
  for (const px of [192, 512]) {
    await page.setViewportSize({ width: px, height: px });
    await page.goto(`${URL}/icon.svg`);
    await page.screenshot({ path: `client/public/icon-${px}.png`, omitBackground: true });
  }
  await page.close();
}

for (const sz of sizes) {
  const ctx = await browser.newContext({ viewport: sz.viewport, isMobile: sz.isMobile, hasTouch: sz.hasTouch, deviceScaleFactor: sz.deviceScaleFactor });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.push(`${sz.name} pageerror: ${e.message}`));
  await page.goto(URL);
  await page.fill('input[autocomplete=nickname]', 'Ates');
  await page.click('text=Create a room');
  await page.waitForSelector('.lobby');
  const code = (await page.textContent('.code')).trim();
  const f = await friend(code, 'Can');
  await page.click('.seg button:has-text("Hard")');
  await page.click('text=+ Add bot');
  await page.click('.seg button:has-text("Easy")');
  await page.click('text=+ Add bot');
  await page.waitForFunction(() => document.querySelectorAll('.seats li').length === 4);
  await page.waitForTimeout(150);
  const shot = async (label) => {
    const o = await overflow(page);
    report.push(`${sz.name} ${label}: scrollWidth ${o.sw} / viewport ${o.w} -> ${o.sw <= o.w ? 'no horizontal overflow' : 'OVERFLOW'}`);
    await page.screenshot({ path: `${OUT}/${sz.name}-${label}.png` });
  };
  await shot('1-lobby');
  await page.click('text=Start game');
  await page.waitForSelector('.table');
  await page.locator('.hand .card').first().click();
  await page.waitForTimeout(150);
  await shot('2-swap');
  await page.click("text=I'm ready");
  // Play a handful of turns through the real UI.
  let myMoves = 0;
  const t0 = Date.now();
  while (myMoves < 6 && Date.now() - t0 < 60000) {
    await page.waitForSelector('.table.my-turn, .results', { timeout: 30000 });
    if (await page.$('.results')) break;
    const playable = page.locator('.hand .card.playable, .my-table .card.playable');
    if (await playable.count()) {
      await playable.first().click();
      if (myMoves === 5) { await page.waitForTimeout(150); await shot('3-midgame'); }
      await page.click('.actions .play');
    } else {
      if (myMoves === 5) await shot('3-midgame');
      await page.click('.actions .pickup');
    }
    myMoves++;
    await page.waitForFunction(() => !document.querySelector('.table.my-turn') || document.querySelector('.results'), null, { timeout: 15000 }).catch(() => {});
  }
  if (sz.isMobile) {
    await page.waitForSelector('.table.my-turn', { timeout: 30000 }).catch(() => {});
    await page.click('[aria-label="Event log"]');
    await page.waitForTimeout(100);
    await shot('4-log');
    await page.click('[aria-label="Event log"]');
  }
  await page.click('[aria-label="Rules"]');
  await page.waitForTimeout(100);
  await shot('5-rules');
  f.close();
  await ctx.close();
}
await browser.close();
console.log(report.join('\n'));
if (report.some((l) => /OVERFLOW|pageerror/.test(l))) process.exit(1);
