'use strict';
/*
 * HappyTown v2 — game server
 *
 * - Players answer at their own pace (asynchronous). The host display is updated in real time.
 * - Three timed phases (3 / 5 / 6 minutes by default), an 8-second rules screen before each,
 *   then a 1-minute finale.
 * - Race conditions: every action that changes the game (answers, bombs, shields, timeouts,
 *   joins, kicks) goes through ONE first-in-first-out queue per room and is applied while the
 *   room is locked (see enqueue()). Two bombs that arrive in the same millisecond are applied
 *   one after the other, each reading the floors left by the previous one, so no update is lost.
 */
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const DEFAULT_QUESTIONS = require('./questions');

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 60;
const TICK_MS = 100;
const PUB_MS = 250; // how often the shared town state is pushed to screens
const SET_SIZE = 3;

const DEFAULT_SETTINGS = {
  p1Sec: 120, p2Sec: 300, p3Sec: 360, finaleSec: 60, introSec: 8,
  p1QSec: 15, setQSec: 20, wrongSec: 3, throwSec: 5, chooseSec: 5,
  p1Cap: 18, p2Cap: 9, p3Cap: 10, shuffle: true, mix: true
};
const SETTING_LIMITS = {
  p1Sec: [10, 1800], p2Sec: [10, 1800], p3Sec: [10, 1800], finaleSec: [5, 600], introSec: [0, 120],
  p1QSec: [5, 120], setQSec: [5, 120], wrongSec: [0, 15], throwSec: [2, 30], chooseSec: [2, 30],
  p1Cap: [1, 500], p2Cap: [1, 200], p3Cap: [1, 200]
};
// Default rules (floors and damage). Each room has its own copy (room.rules) that the host can
// change in the admin panel (💣 Damage), even during a game. Keep in sync with HT.RULES in common.js.
const DEFAULT_RULES = {
  p1: { floor: 1 },
  p2: { floor: 1, dmg: 2, step: 2, maxStacks: 3 }, // bomb damage 2 → 4 → 6
  // Phase 3: Mega 5. Holding it, the next perfect set adds one Mini Bomb (1) that grows +2 per
  // further perfect set (1 → 3 → 5). A shield blocks up to 5 floors of ONE bomb, then disappears.
  p3: { floor: 3, mega: 5, mini: 1, miniStep: 2, maxMiniStacks: 3, shieldHp: 5, secPerMini: 2 }
};
const RULE_LIMITS = {
  p1: { floor: [0, 20] },
  p2: { floor: [0, 20], dmg: [1, 50], step: [0, 20], maxStacks: [1, 5] },
  p3: { floor: [0, 20], mega: [1, 50], mini: [1, 50], miniStep: [0, 20], maxMiniStacks: [1, 5], shieldHp: [1, 50], secPerMini: [0, 10] }
};
function sanitizeRules(r, base) {
  const out = {};
  for (const ph of Object.keys(DEFAULT_RULES)) {
    out[ph] = {};
    for (const k of Object.keys(DEFAULT_RULES[ph])) {
      const [lo, hi] = RULE_LIMITS[ph][k];
      const raw = r && r[ph] ? r[ph][k] : undefined;
      const v = Number(raw);
      const fallback = base && base[ph] && base[ph][k] !== undefined ? base[ph][k] : DEFAULT_RULES[ph][k];
      out[ph][k] = raw !== undefined && raw !== null && raw !== '' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
    }
  }
  return out;
}
const stepsText = (base, step, n) => Array.from({ length: n }, (_, i) => base + step * i).join('→');
// Keep in sync with public/js/common.js
const AVATARS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵',
  '🐔', '🐧', '🐦', '🦄', '🐙', '🐢', '🦋', '🐝', '🐳', '🦉', '🐲', '🦖', '🐬', '🦀', '🐞'];
const COLORS = ['#ef476f', '#f78c40', '#ffc43d', '#06d6a0', '#1b9aaa', '#4d7cfe', '#8f5bff', '#ff70a6',
  '#3fb950', '#e85d75', '#00b4d8', '#f4a261', '#9b5de5', '#2ec4b6', '#e76f51', '#7cb518',
  '#fb5607', '#3a86ff', '#c77dff', '#ff006e', '#38b000', '#0096c7', '#ffb703', '#d62828'];
const BOT_NAMES = ['Bot Ada', 'Bot Bao', 'Bot Chi', 'Bot Duc', 'Bot Emi', 'Bot Fin', 'Bot Gia', 'Bot Hai',
  'Bot Ivy', 'Bot Jun', 'Bot Kai', 'Bot Lan', 'Bot Mai', 'Bot Nam', 'Bot Oli', 'Bot Phu'];

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000, maxHttpBufferSize: 2e6 });

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/api/default-questions', (req, res) => res.json(DEFAULT_QUESTIONS));
app.get('/api/info', (req, res) => res.json({ lanAddresses: lanAddresses(), port: PORT }));
app.get('/api/qr', async (req, res) => {
  try {
    const data = String(req.query.data || '').slice(0, 400);
    const svg = await QRCode.toString(data || 'HappyTown', { type: 'svg', margin: 1, color: { dark: '#16233a', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch (e) {
    res.status(400).send('bad qr');
  }
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const now = () => Date.now();
const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const cleanText = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const normSid = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 24);
// R = the room's rules
const bombDmg = (R, stacks) => R.p2.dmg + R.p2.step * (stacks - 1);
const miniDmg = (R, stacks) => (stacks ? R.p3.mini + R.p3.miniStep * (stacks - 1) : 0);
const arsenalBombs = (R, a) => [{ kind: 'mega', dmg: R.p3.mega }, ...(a.miniStacks ? [{ kind: 'mini', dmg: miniDmg(R, a.miniStacks) }] : [])];
const arsenalDmg = (R, a) => R.p3.mega + miniDmg(R, a.miniStacks);
const arsenalCount = (a) => (a.miniStacks ? 2 : 1);
const isTwoOption = (q) => q.options.length === 2;

function sanitizeSettings(s, base) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof DEFAULT_SETTINGS[k] === 'boolean') { out[k] = s && s[k] !== undefined ? !!s[k] : base[k] !== undefined ? base[k] : DEFAULT_SETTINGS[k]; continue; }
    const [lo, hi] = SETTING_LIMITS[k];
    const v = Number(s && s[k]);
    out[k] = s && s[k] !== undefined && s[k] !== null && s[k] !== '' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : base[k];
  }
  return out;
}

function sanitizeQuestion(item) {
  if (!item || typeof item !== 'object') return null;
  const q = cleanText(item.q, 400);
  const options = Array.isArray(item.options) ? item.options.map((o) => cleanText(o, 200)).filter(Boolean).slice(0, 4) : [];
  const answer = Number(item.answer);
  if (!q || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
  return { q, options, answer, explain: cleanText(item.explain, 500), level: /^e/i.test(String(item.level || '')) ? 'easy' : 'hard' };
}

function sanitizeBank(bank) {
  if (!Array.isArray(bank)) return null;
  const out = bank.slice(0, 800).map(sanitizeQuestion).filter(Boolean);
  return out.length >= 3 ? out : null;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
const rooms = new Map();

function newCode() {
  for (let i = 0; i < 1000; i++) {
    const c = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(c)) return c;
  }
  return String(10000 + Math.floor(Math.random() * 90000));
}

function setBank(room, list) {
  room.bank = list.map((q, i) => ({ id: i + 1, ...q, rev: 0 }));
  room.qById = new Map(room.bank.map((q) => [q.id, q]));
  room.nextQid = room.bank.length + 1;
  for (const p of room.players.values()) { p.decks = { easy: [], hard: [] }; p.waiting = []; }
}

function createRoom(settings, bank, rules) {
  const custom = sanitizeBank(bank);
  const room = {
    code: newCode(),
    hostToken: rid(16),
    settings: sanitizeSettings(settings, DEFAULT_SETTINGS),
    rules: sanitizeRules(rules, DEFAULT_RULES),
    customBank: !!custom,
    bank: [], qById: new Map(), nextQid: 1,
    players: new Map(), bySid: new Map(),
    stage: 'lobby', // lobby | intro | play | finale | ended
    phase: 0,
    deadline: 0,
    gameStartV: 0,
    paused: false, pausedAt: 0, pausedTotal: 0, lastTickV: 0,
    queue: [], locked: false, seq: 0, keySeq: 0,
    log: [], events: [], evSeq: 0,
    qstats: {}, final: null,
    nextPlot: 1, botCount: 0,
    lastActivity: now(),
    ticker: null, pubTimer: null, dirty: new Set()
  };
  setBank(room, custom || DEFAULT_QUESTIONS);
  rooms.set(room.code, room);
  room.ticker = setInterval(() => tick(room), TICK_MS);
  return room;
}

// Virtual game clock: it stops while the game is paused, so every countdown freezes with it.
const vnow = (room) => (room.paused ? room.pausedAt : now()) - room.pausedTotal;
const gameClock = (room) => (room.gameStartV ? Math.max(0, vnow(room) - room.gameStartV) : 0);
const phaseSec = (room, phase) => [0, room.settings.p1Sec, room.settings.p2Sec, room.settings.p3Sec][phase];
const capFor = (room) => (room.phase === 1 ? room.settings.p1Cap : room.phase === 2 ? room.settings.p2Cap : room.settings.p3Cap);

// ---------------------------------------------------------------------------
// The action queue (one per room). This is the "pessimistic lock" from the design document:
// only the action at the head of the queue may change the room; everything else waits its turn.
// ---------------------------------------------------------------------------
function enqueue(room, action, cb) {
  room.queue.push({ ...action, cb });
  if (room.locked) return; // the action currently holding the lock will drain the queue
  room.locked = true;
  try {
    while (room.queue.length) {
      const a = room.queue.shift();
      a.seq = ++room.seq;
      room.current = a;
      let res;
      try {
        res = apply(room, a);
      } catch (e) {
        console.error('action failed', a.type, e);
        res = { ok: false, error: 'server_error' };
      }
      if (typeof a.cb === 'function') a.cb(res || { ok: true });
    }
  } finally {
    room.current = null;
    room.locked = false;
  }
  room.lastActivity = now();
  flush(room);
}

const fail = (error) => ({ ok: false, error });

function apply(room, a) {
  const p = a.pid ? room.players.get(a.pid) : null;
  switch (a.type) {
    case 'join': return doJoin(room, a);
    case 'answer': {
      if (!p || room.stage !== 'play' || room.paused) return fail('not_now');
      if (p.mode !== 'question' || a.key !== p.key) return fail('stale');
      const choice = Number(a.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice >= p.q.order.length) return fail('bad_choice');
      return { ok: true, ...handleAnswer(room, p, choice) };
    }
    case 'throw': {
      if (!p || room.paused) return fail('not_now');
      const err = doThrow(room, p, a.targetId);
      return err ? fail(err) : { ok: true };
    }
    case 'hold': {
      if (!p || room.paused) return fail('not_now');
      const err = doHold(room, p);
      return err ? fail(err) : { ok: true };
    }
    case 'choose': {
      if (!p || room.paused) return fail('not_now');
      const err = doChoose(room, p, a.item, false);
      return err ? fail(err) : { ok: true };
    }
    case 'timeout': {
      if (!p || p.key !== a.key || room.stage !== 'play') return null;
      if (p.mode === 'question') handleAnswer(room, p, null);
      else if (p.mode === 'feedback') continueFlow(room, p);
      else if (p.mode === 'choose') doChoose(room, p, 'shield', true);
      else if (p.mode === 'target') windowTimeout(room, p);
      return null;
    }
    case 'bot': {
      if (!p || !p.isBot || p.key !== a.key || room.stage !== 'play') return null;
      botAct(room, p);
      return null;
    }
    case 'stageEnd': {
      if (a.stage !== room.stage || a.phase !== room.phase) return null;
      advanceStage(room);
      return null;
    }
    case 'start': {
      if (room.stage !== 'lobby' && room.stage !== 'ended') return fail('in_game');
      if (!room.players.size) return fail('no_players');
      startGame(room);
      return { ok: true };
    }
    case 'skip': {
      if (room.paused) resume(room);
      if (['intro', 'play', 'finale'].includes(room.stage)) advanceStage(room);
      return { ok: true };
    }
    case 'pause': {
      if (room.paused) resume(room); else pause(room);
      return { ok: true, paused: room.paused };
    }
    case 'endGame': {
      if (room.paused) resume(room);
      if (room.stage === 'intro' || room.stage === 'play') { stopPlayers(room, 'gameEnd'); goFinale(room); }
      else if (room.stage === 'finale') goEnded(room);
      return { ok: true };
    }
    case 'lobby': {
      backToLobby(room);
      return { ok: true };
    }
    case 'addBots': {
      const n = Math.max(1, Math.min(30, Number(a.n) || 1));
      for (let i = 0; i < n && room.players.size < MAX_PLAYERS; i++) {
        const name = BOT_NAMES[room.botCount % BOT_NAMES.length] + (room.botCount >= BOT_NAMES.length ? ` ${Math.floor(room.botCount / BOT_NAMES.length) + 1}` : '');
        room.botCount += 1;
        addPlayer(room, { name, isBot: true });
      }
      return { ok: true };
    }
    case 'kick': {
      const t = room.players.get(a.targetId);
      if (!t) return fail('no_player');
      detachSocket(room, t, a.silent ? null : 'kicked');
      room.players.delete(t.id);
      if (t.sid) room.bySid.delete(t.sid);
      log(room, a.silent ? `👋 ${t.name} left the lobby` : `🚪 Host removed ${t.name}`, 'admin');
      return { ok: true };
    }
    case 'reset': {
      const t = room.players.get(a.targetId);
      if (!t) return fail('no_player');
      detachSocket(room, t, 'replaced');
      log(room, `🔌 Host reset ${t.name}'s connection — they can rejoin with their Student ID`, 'admin');
      return { ok: true };
    }
    case 'editQuestion': return editQuestion(room, a);
    case 'rules': {
      room.rules = a.rules ? sanitizeRules(a.rules, room.rules) : sanitizeRules(null, DEFAULT_RULES);
      for (const p of room.players.values()) {
        // bombs being held stay within the new maximums and follow the new damage
        if (p.bomb) p.bomb.stacks = Math.min(p.bomb.stacks, room.rules.p2.maxStacks);
        if (p.arsenal) p.arsenal.miniStacks = Math.min(p.arsenal.miniStacks, room.rules.p3.maxMiniStacks);
        dirty(room, p);
      }
      const R = room.rules;
      log(room, `💣 Rules changed: P1 +${R.p1.floor} floor · P2 +${R.p2.floor} floor, bomb ${stepsText(R.p2.dmg, R.p2.step, R.p2.maxStacks)} · ` +
        `P3 +${R.p3.floor} floors, Mega ${R.p3.mega}, Mini ${stepsText(R.p3.mini, R.p3.miniStep, R.p3.maxMiniStacks)}, Shield ${R.p3.shieldHp}`, 'admin');
      return { ok: true, rules: room.rules };
    }
    default: return fail('unknown');
  }
}

// ---------------------------------------------------------------------------
// Clock tick: phase timers, personal timers (question time, throw window…) and bots.
// The tick only *queues* actions; the queue applies them.
// ---------------------------------------------------------------------------
const GRACE = { question: 500, target: 400, choose: 400, feedback: 0 };

function tick(room) {
  if (room.paused || room.stage === 'lobby' || room.stage === 'ended') { room.lastTickV = 0; return; }
  const t = vnow(room);
  const dt = room.lastTickV ? t - room.lastTickV : 0;
  room.lastTickV = t;
  if (room.stage === 'play') {
    // An offline player's own clock waits for them (the phase clock does not).
    for (const p of room.players.values()) if (!p.isBot && !p.connected && p.deadline) p.deadline += dt;
  }
  const actions = [];
  if (room.deadline && t >= room.deadline) {
    actions.push({ type: 'stageEnd', stage: room.stage, phase: room.phase });
  } else if (room.stage === 'play') {
    for (const p of room.players.values()) {
      if (p.deadline && t >= p.deadline + (GRACE[p.mode] || 0)) actions.push({ type: 'timeout', pid: p.id, key: p.key });
      else if (p.isBot && p.botAt && t >= p.botAt) { p.botAt = 0; actions.push({ type: 'bot', pid: p.id, key: p.key }); }
    }
  }
  for (const a of actions) enqueue(room, a);
}

function pause(room) {
  if (room.paused || !['intro', 'play', 'finale'].includes(room.stage)) return;
  room.paused = true;
  room.pausedAt = now();
  log(room, '⏸ Game paused', 'admin');
  pubSoon(room, true);
}
function resume(room) {
  if (!room.paused) return;
  room.pausedTotal += now() - room.pausedAt;
  room.paused = false;
  room.lastTickV = 0;
  log(room, '▶ Game resumed', 'admin');
  for (const p of room.players.values()) dirty(room, p);
  pubSoon(room, true);
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
function freshStats() {
  return { answered: 0, correct: 0, built: 0, destroyed: 0, absorbed: 0, thrown: 0, hits: 0, missed: new Map() };
}

function uniqueName(room, name) {
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 999; i++) {
    const n = `${name.slice(0, 13)} ${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return `${name.slice(0, 10)} ${rid(2)}`;
}

function leastUsed(list, used) {
  let best = list[0];
  let bestN = Infinity;
  for (const x of shuffle([...list])) { const n = used.get(x) || 0; if (n < bestN) { best = x; bestN = n; } }
  return best;
}
function pickColor(room) {
  const used = new Map();
  for (const p of room.players.values()) used.set(p.color, (used.get(p.color) || 0) + 1);
  return leastUsed(COLORS, used);
}
function pickAvatar(room, wanted) {
  if (AVATARS.includes(wanted)) return wanted;
  const used = new Map();
  for (const p of room.players.values()) used.set(p.avatar, (used.get(p.avatar) || 0) + 1);
  return leastUsed(AVATARS, used);
}

function blankPlay(p) {
  Object.assign(p, {
    mode: 'idle', deadline: 0, botAt: 0, q: null, fb: null, set: [], p1Count: 0, setsDone: 0, last: null, window: null
  });
}
function resetPlayer(p) {
  blankPlay(p);
  Object.assign(p, { floors: 0, stats: freshStats(), served: 0, decks: { easy: [], hard: [] }, waiting: [], bomb: null, arsenal: null, shield: null, hits: [] });
}

function addPlayer(room, { name, sid, avatar, isBot }) {
  const p = {
    id: rid(6), token: rid(16), sid: sid || null,
    name: uniqueName(room, name), avatar: pickAvatar(room, avatar), color: pickColor(room), plot: room.nextPlot++,
    socketId: null, connected: !!isBot, isBot: !!isBot, skill: isBot ? rand(0.55, 0.9) : 0,
    key: 0, joinedAt: now()
  };
  resetPlayer(p);
  room.players.set(p.id, p);
  if (p.sid) room.bySid.set(p.sid, p.id);
  if (room.stage === 'play') startPlayerPhase(room, p);
  dirty(room, p);
  return p;
}

function doJoin(room, a) {
  const socket = a.socket;
  const sid = normSid(a.sid);
  if (!sid) return fail('Please enter your Student ID.');
  const existingId = room.bySid.get(sid);
  if (existingId) {
    const p = room.players.get(existingId);
    if (p && !p.isBot) {
      const live = p.socketId && io.sockets.sockets.get(p.socketId);
      if (live && live.id !== socket.id) {
        return fail('This Student ID is already playing on another device. If that phone has a problem, ask the host to reset it.');
      }
      attachSocket(room, p, socket);
      log(room, `🔁 ${p.name} rejoined with Student ID ${sid} (${p.floors} floors restored)`, 'join');
      pushEvent(room, { type: 'rejoin', id: p.id, name: p.name, floors: p.floors });
      return { ok: true, token: p.token, id: p.id, name: p.name, restored: true, floors: p.floors };
    }
  }
  if (room.stage === 'finale' || room.stage === 'ended') return fail('This game has ended. Wait for the host to start a new one.');
  if (room.players.size >= MAX_PLAYERS) return fail('This town is full.');
  const name = cleanText(a.name, 16).replace(/[<>]/g, '');
  if (!name) return fail('Please enter your name.');
  const p = addPlayer(room, { name, sid, avatar: a.avatar });
  attachSocket(room, p, socket);
  log(room, `👋 ${p.name} joined${room.stage === 'play' ? ` during Phase ${room.phase}` : ''}`, 'join');
  return { ok: true, token: p.token, id: p.id, name: p.name, restored: false };
}

function attachSocket(room, p, socket) {
  if (p.socketId && p.socketId !== socket.id) {
    const old = io.sockets.sockets.get(p.socketId);
    if (old) { old.leave(room.code + ':all'); old.data.playerId = null; }
  }
  p.socketId = socket.id;
  p.connected = true;
  socket.data.roomCode = room.code;
  socket.data.playerId = p.id;
  socket.join(room.code + ':all');
  dirty(room, p);
}

function detachSocket(room, p, reason) {
  if (p.socketId) {
    const s = io.sockets.sockets.get(p.socketId);
    if (s) {
      if (reason) s.emit(reason);
      s.leave(room.code + ':all');
      s.data.playerId = null;
    }
  }
  p.socketId = null;
  if (!p.isBot) p.connected = false;
}

// ---------------------------------------------------------------------------
// Personal flow: question → (feedback) → … → set result → (choose) → (throw window) → next
// ---------------------------------------------------------------------------
function botDelay(room, mode) {
  if (mode === 'question') {
    const limit = (room.phase === 1 ? room.settings.p1QSec : room.settings.setQSec) * 1000 * 0.85;
    return Math.min(limit, room.phase === 1 ? rand(2500, 8000) : rand(3500, 11000));
  }
  if (mode === 'choose') return rand(800, 2500);
  if (mode === 'target') return rand(700, 2200);
  return 0;
}

function setMode(room, p, mode, ms = 0) {
  p.mode = mode;
  p.key = ++room.keySeq;
  p.deadline = ms ? vnow(room) + ms : 0;
  const bd = p.isBot ? botDelay(room, mode) : 0;
  p.botAt = bd ? vnow(room) + bd : 0;
  dirty(room, p);
}

function fromDeck(room, p, level, exclude, waitingIds) {
  for (let pass = 0; pass < 2; pass++) {
    const deck = p.decks[level] || (p.decks[level] = []);
    while (deck.length) {
      const qid = deck.pop();
      if (room.qById.has(qid) && !exclude.has(qid) && !waitingIds.has(qid)) return qid;
    }
    const pool = room.bank.filter((q) => level === 'all' || q.level === level).map((q) => q.id);
    if (!pool.length) return null;
    p.decks[level] = shuffle(pool);
  }
  return null;
}

// Spaced repetition: a missed question waits in p.waiting and comes back 2–4 questions later,
// in a random upcoming slot, until it is answered correctly.
function drawQuestion(room, p, exclude) {
  p.served += 1;
  const reviewsInSet = room.phase === 1 ? 0 : p.set.filter((s) => s.repeat).length;
  const due = p.waiting.filter((w) => w.dueAt <= p.served && !exclude.has(w.qid) && room.qById.has(w.qid));
  if (due.length && reviewsInSet < 2) return { qid: due[Math.floor(Math.random() * due.length)].qid, repeat: true };
  const waitingIds = new Set(p.waiting.map((w) => w.qid));
  // "mix" (default): every phase draws from one shuffled deck of the whole bank.
  // Otherwise Phase 1 uses the easy questions and Phases 2–3 the hard ones.
  const want = room.settings.mix ? 'all' : room.phase === 1 ? 'easy' : 'hard';
  let qid = fromDeck(room, p, want, exclude, waitingIds);
  if (qid == null && want !== 'all') qid = fromDeck(room, p, want === 'easy' ? 'hard' : 'easy', exclude, waitingIds);
  if (qid != null) return { qid, repeat: false };
  const fallback = due[0] || p.waiting.find((w) => !exclude.has(w.qid) && room.qById.has(w.qid));
  return fallback ? { qid: fallback.qid, repeat: true } : null;
}

function makeOrder(room, q) {
  const order = [...Array(q.options.length).keys()];
  return room.settings.shuffle && !isTwoOption(q) ? shuffle(order) : order;
}

function serveQuestion(room, p) {
  const exclude = new Set(p.set.map((s) => s.qid));
  const pick = drawQuestion(room, p, exclude);
  if (!pick) { p.q = null; setMode(room, p, 'capped'); return; }
  const q = room.qById.get(pick.qid);
  p.q = { qid: pick.qid, order: makeOrder(room, q), repeat: pick.repeat };
  setMode(room, p, 'question', (room.phase === 1 ? room.settings.p1QSec : room.settings.setQSec) * 1000);
}

function registerAnswer(room, p, choice) {
  const q = room.qById.get(p.q.qid);
  const timeout = choice === null;
  const correct = !timeout && !!q && p.q.order[choice] === q.answer;
  p.stats.answered += 1;
  const qs = room.qstats[p.q.qid] || (room.qstats[p.q.qid] = { asked: 0, wrong: 0 });
  if (!timeout) qs.asked += 1;
  if (correct) {
    p.stats.correct += 1;
    p.waiting = p.waiting.filter((w) => w.qid !== p.q.qid);
    const m = p.stats.missed.get(p.q.qid);
    if (m) m.fixed = true;
  } else {
    if (!timeout) qs.wrong += 1;
    const dueAt = p.served + randInt(3, 5);
    const w = p.waiting.find((x) => x.qid === p.q.qid);
    if (w) w.dueAt = dueAt; else p.waiting.push({ qid: p.q.qid, dueAt });
    const m = p.stats.missed.get(p.q.qid) || { times: 0, fixed: false, timeouts: 0 };
    m.times += 1;
    m.fixed = false;
    if (timeout) m.timeouts += 1;
    p.stats.missed.set(p.q.qid, m);
  }
  return { correct, correctChoice: q ? p.q.order.indexOf(q.answer) : -1, timeout };
}

function handleAnswer(room, p, choice) {
  const info = registerAnswer(room, p, choice);
  if (room.phase === 1) {
    p.p1Count += 1;
    if (info.correct) { p.floors += room.rules.p1.floor; p.stats.built += room.rules.p1.floor; }
  } else {
    p.set.push({ qid: p.q.qid, correct: info.correct, repeat: p.q.repeat });
  }
  if (!info.correct && room.settings.wrongSec > 0) {
    p.fb = { qid: p.q.qid, order: p.q.order, choice, correctChoice: info.correctChoice, timeout: info.timeout };
    p.q = null;
    setMode(room, p, 'feedback', room.settings.wrongSec * 1000);
  } else {
    p.q = null;
    continueFlow(room, p);
  }
  return { correct: info.correct, choice, correctChoice: info.correctChoice };
}

function continueFlow(room, p) {
  p.fb = null;
  if (room.phase === 1) {
    if (p.p1Count >= room.settings.p1Cap) { setMode(room, p, 'capped'); return; }
    serveQuestion(room, p);
    return;
  }
  if (p.set.length >= SET_SIZE) { evaluateSet(room, p); return; }
  serveQuestion(room, p);
}

function addFloors(p, n, res) {
  p.floors += n;
  p.stats.built += n;
  res.floors += n;
}

function evaluateSet(room, p) {
  const phase = room.phase;
  const correct = p.set.filter((s) => s.correct).length;
  const size = p.set.length;
  p.set = [];
  p.setsDone += 1;
  const res = { n: p.setsDone, phase, correct, size, floors: 0, bomb: null, dmg: 0, lost: 0, item: null, action: null, shieldGone: false };
  p.last = res;
  if (phase === 2) {
    if (correct >= 2) addFloors(p, room.rules.p2.floor, res);
    if (correct >= SET_SIZE) {
      if (p.bomb) { p.bomb.stacks = Math.min(room.rules.p2.maxStacks, p.bomb.stacks + 1); res.bomb = 'charged'; }
      else { p.bomb = { stacks: 1 }; res.bomb = 'new'; }
      res.dmg = bombDmg(room.rules, p.bomb.stacks);
      openWindow(room, p, [{ kind: 'bomb', dmg: res.dmg }]);
      return;
    }
    if (p.bomb) res.lost = loseWeapons(room, p, 'streak');
    nextSet(room, p);
    return;
  }
  // Phase 3 (a shield has no time limit: it stays until a bomb hits it)
  if (correct >= 2) addFloors(p, room.rules.p3.floor, res);
  if (correct >= SET_SIZE) {
    if (p.arsenal) {
      const before = p.arsenal.miniStacks;
      p.arsenal.miniStacks = Math.min(room.rules.p3.maxMiniStacks, before + 1);
      res.item = p.arsenal.miniStacks > before ? 'mini' : 'maxed';
      res.mini = miniDmg(room.rules, p.arsenal.miniStacks);
      res.dmg = arsenalDmg(room.rules, p.arsenal);
      openWindow(room, p, arsenalBombs(room.rules, p.arsenal));
    } else {
      setMode(room, p, 'choose', room.settings.chooseSec * 1000);
    }
    return;
  }
  if (p.arsenal) res.lost = loseWeapons(room, p, 'streak');
  nextSet(room, p);
}

function nextSet(room, p) {
  p.window = null;
  if (p.setsDone >= capFor(room)) { setMode(room, p, 'capped'); return; }
  serveQuestion(room, p);
}

function openWindow(room, p, bombs) {
  p.window = {
    bombs: bombs.map((b) => ({ ...b, targetId: null, targetName: null, auto: false })),
    thrown: 0,
    canHold: p.setsDone < capFor(room)
  };
  const sec = room.settings.throwSec + (room.phase === 3 ? room.rules.p3.secPerMini * (bombs.length - 1) : 0);
  setMode(room, p, 'target', sec * 1000);
}

function doChoose(room, p, item, auto) {
  if (room.stage !== 'play' || p.mode !== 'choose') return 'not_now';
  if (item === 'shield') {
    p.shield = { hp: room.rules.p3.shieldHp };
    if (p.last) { p.last.item = 'shield'; p.last.auto = !!auto; }
    pushEvent(room, { type: 'shield', id: p.id, name: p.name, hp: p.shield.hp, auto: !!auto });
    log(room, `🛡️ ${p.name} raised a shield (blocks up to ${room.rules.p3.shieldHp} floors of the next bomb)${auto ? ' — chosen automatically' : ''}`, 'combat');
    nextSet(room, p);
    return null;
  }
  if (item === 'mega') {
    p.arsenal = { miniStacks: 0 };
    if (p.last) p.last.item = 'mega';
    log(room, `💣 ${p.name} took a Mega Bomb`, 'combat');
    openWindow(room, p, arsenalBombs(room.rules, p.arsenal));
    return null;
  }
  return 'bad_item';
}

function doThrow(room, p, targetId) {
  if (room.stage !== 'play' || p.mode !== 'target' || !p.window) return 'not_now';
  const w = p.window;
  const t = room.players.get(targetId);
  if (!t || t === p) return 'bad_target';
  throwBomb(room, p, w, t, false);
  if (w.thrown >= w.bombs.length) finishWindow(room, p, 'thrown');
  else { p.botAt = p.isBot ? vnow(room) + rand(500, 1100) : 0; dirty(room, p); }
  return null;
}

function doHold(room, p) {
  if (room.stage !== 'play' || p.mode !== 'target' || !p.window) return 'not_now';
  if (p.window.thrown > 0 || !p.window.canHold) return 'cannot_hold';
  const dmg = p.bomb ? bombDmg(room.rules, p.bomb.stacks) : p.arsenal ? arsenalDmg(room.rules, p.arsenal) : 0;
  log(room, `🔋 ${p.name} is holding ${dmg} damage`, 'combat');
  finishWindow(room, p, 'hold');
  return null;
}

function windowTimeout(room, p) {
  const w = p.window;
  if (!w) { nextSet(room, p); return; }
  if (w.thrown > 0) {
    // the volley has started: a bomb not aimed in time flies at the best target automatically
    while (w.thrown < w.bombs.length) {
      const t = bestTarget(room, p);
      if (!t) break;
      throwBomb(room, p, w, t, true);
    }
    finishWindow(room, p, 'thrown');
  } else if (w.canHold) {
    const dmg = p.bomb ? bombDmg(room.rules, p.bomb.stacks) : p.arsenal ? arsenalDmg(room.rules, p.arsenal) : 0;
    log(room, `🔋 ${p.name} is holding ${dmg} damage (time ran out)`, 'combat');
    finishWindow(room, p, 'hold');
  } else {
    finishWindow(room, p, 'lost');
  }
}

function finishWindow(room, p, how) {
  if (how === 'lost') loseWeapons(room, p, 'unthrown');
  else if (how === 'thrown') { p.bomb = null; p.arsenal = null; }
  if (p.last) p.last.action = how;
  nextSet(room, p);
}

function throwBomb(room, p, w, t, auto) {
  const b = w.bombs[w.thrown];
  b.targetId = t.id;
  b.targetName = t.name;
  b.auto = auto;
  w.thrown += 1;
  applyDamage(room, p, t, b.dmg, b.kind, auto);
}

function bestTarget(room, p) {
  const others = [...room.players.values()].filter((o) => o !== p);
  const score = (o) => o.floors - (o.shield ? o.shield.hp : 0);
  return others.sort((a, b) => score(b) - score(a) || b.floors - a.floors)[0] || null;
}

// The only place floors are taken away. It always runs inside the action queue, so it reads
// the current floors and shield, and the next bomb in the queue sees the result.
function applyDamage(room, from, to, dmg, kind, auto) {
  const before = to.floors;
  let absorbed = 0;
  let broke = false;
  const shieldBefore = to.shield ? to.shield.hp : 0;
  if (to.shield) {
    // one hit uses the shield up, however small the bomb
    absorbed = Math.min(to.shield.hp, dmg);
    to.shield = null;
    broke = true;
  }
  const lost = Math.min(to.floors, dmg - absorbed);
  to.floors -= lost;
  to.stats.absorbed += absorbed;
  to.stats.hits += 1;
  from.stats.destroyed += lost;
  from.stats.thrown += 1;
  const label = kind === 'mega' ? 'Mega Bomb' : kind === 'mini' ? 'Mini Bomb' : 'Bomb';
  log(room, `${from.name} → ${to.name}: ${label} (${dmg})${auto ? ' [auto-aimed]' : ''}` +
    (shieldBefore ? ` · shield blocked ${absorbed}, shield gone` : '') +
    ` · floors ${before}→${to.floors}`, 'combat');
  const ev = pushEvent(room, {
    type: 'attack', kind, from: from.id, fromName: from.name, fromAvatar: from.avatar, to: to.id, toName: to.name,
    dmg, absorbed, lost, before, after: to.floors, broke, auto: !!auto, seq: room.current ? room.current.seq : 0
  });
  // Every hit is stored on the victim, so their phone can always show who bombed them
  // (even if they were offline or busy when it happened).
  to.hits.push({ id: ev.id, fromName: from.name, fromAvatar: from.avatar, kind, dmg, absorbed, lost, phase: room.phase, t: ev.t });
  if (to.hits.length > 40) to.hits.shift();
  dirty(room, to);
}

function loseWeapons(room, p, reason) {
  const dmg = p.bomb ? bombDmg(room.rules, p.bomb.stacks) : p.arsenal ? arsenalDmg(room.rules, p.arsenal) : 0;
  if (!dmg) return 0;
  const n = p.bomb ? 1 : arsenalCount(p.arsenal);
  const what = p.bomb ? `a ${dmg}-damage bomb` : n > 1 ? `a Mega + Mini Bomb (${dmg} damage)` : `a Mega Bomb (${dmg} damage)`;
  const why = { streak: 'streak broken', phase: 'phase over', unthrown: 'not thrown in time', gameEnd: 'game over' }[reason] || reason;
  p.bomb = null;
  p.arsenal = null;
  if (p.last && reason === 'streak') p.last.lostN = n;
  pushEvent(room, { type: 'fizzle', id: p.id, name: p.name, reason, dmg, n });
  log(room, `💨 ${p.name} lost ${what} — ${why}`, 'combat');
  dirty(room, p);
  return dmg;
}

// ---------------------------------------------------------------------------
// Bots (to test alone or fill a demo)
// ---------------------------------------------------------------------------
function botAct(room, p) {
  if (p.mode === 'question' && p.q) {
    const q = room.qById.get(p.q.qid);
    const right = p.q.order.indexOf(q.answer);
    let choice = right;
    if (Math.random() > p.skill) {
      const wrongs = p.q.order.map((_, k) => k).filter((k) => k !== right);
      choice = wrongs[Math.floor(Math.random() * wrongs.length)];
    }
    handleAnswer(room, p, choice);
  } else if (p.mode === 'choose') {
    doChoose(room, p, Math.random() < 0.55 ? 'mega' : 'shield', false);
  } else if (p.mode === 'target' && p.window) {
    const w = p.window;
    const canGrow = room.phase === 2 ? p.bomb && p.bomb.stacks < room.rules.p2.maxStacks : p.arsenal && p.arsenal.miniStacks < room.rules.p3.maxMiniStacks;
    if (w.thrown === 0 && w.canHold && canGrow && Math.random() < 0.35) { doHold(room, p); return; }
    const opts = [...room.players.values()].filter((o) => o !== p).sort((a, b) => b.floors - a.floors).slice(0, 3);
    const t = opts.length ? opts[Math.floor(Math.random() * opts.length)] : bestTarget(room, p);
    if (t) doThrow(room, p, t.id);
  }
}

// ---------------------------------------------------------------------------
// Stages: lobby → [intro → play] × 3 → finale → ended
// ---------------------------------------------------------------------------
function startGame(room) {
  for (const p of room.players.values()) resetPlayer(p);
  Object.assign(room, { final: null, events: [], log: [], qstats: {}, phase: 0, paused: false, pausedAt: 0, pausedTotal: 0, lastTickV: 0 });
  room.gameStartV = vnow(room);
  log(room, `▶ Game started with ${room.players.size} players`, 'stage');
  goIntro(room, 1);
}

function goIntro(room, phase) {
  room.phase = phase;
  for (const p of room.players.values()) { blankPlay(p); setMode(room, p, 'idle'); }
  if (room.settings.introSec > 0) {
    room.stage = 'intro';
    room.deadline = vnow(room) + room.settings.introSec * 1000;
    pushEvent(room, { type: 'phase', phase });
    pubSoon(room, true);
  } else {
    beginPhase(room);
  }
}

function beginPhase(room) {
  room.stage = 'play';
  room.deadline = vnow(room) + phaseSec(room, room.phase) * 1000;
  log(room, `🚩 Phase ${room.phase} started (${Math.round(phaseSec(room, room.phase) / 6) / 10} min)`, 'stage');
  if (room.settings.introSec === 0) pushEvent(room, { type: 'phase', phase: room.phase });
  for (const p of room.players.values()) startPlayerPhase(room, p);
  pubSoon(room, true);
}

function startPlayerPhase(room, p) {
  blankPlay(p);
  serveQuestion(room, p);
}

function stopPlayers(room, reason) {
  for (const p of room.players.values()) {
    if (p.bomb || p.arsenal) loseWeapons(room, p, reason);
    p.q = null; p.fb = null; p.set = []; p.window = null;
    if (room.phase === 3 || reason === 'gameEnd') p.shield = null;
    setMode(room, p, 'idle');
  }
}

function advanceStage(room) {
  if (room.stage === 'intro') { beginPhase(room); return; }
  if (room.stage === 'play') {
    stopPlayers(room, 'phase');
    log(room, `⏹ Phase ${room.phase} ended`, 'stage');
    if (room.phase < 3) goIntro(room, room.phase + 1);
    else goFinale(room);
    return;
  }
  if (room.stage === 'finale') goEnded(room);
}

function computeFinal(room) {
  const list = [...room.players.values()].sort((a, b) =>
    b.floors - a.floors || b.stats.correct - a.stats.correct || a.stats.answered - b.stats.answered || a.name.localeCompare(b.name));
  let rank = 0;
  let prev = null;
  const ranking = list.map((p, i) => {
    if (!prev || prev.floors !== p.floors || prev.stats.correct !== p.stats.correct) rank = i + 1;
    prev = p;
    return { id: p.id, name: p.name, avatar: p.avatar, color: p.color, floors: p.floors, rank, isBot: p.isBot, correct: p.stats.correct, answered: p.stats.answered };
  });
  const award = (key) => {
    let best = null;
    for (const p of room.players.values()) if (p.stats[key] > 0 && (!best || p.stats[key] > best.stats[key])) best = p;
    return best ? { id: best.id, name: best.name, avatar: best.avatar, color: best.color, value: best.stats[key] } : null;
  };
  let answered = 0;
  let correct = 0;
  for (const p of room.players.values()) { answered += p.stats.answered; correct += p.stats.correct; }
  const missed = Object.entries(room.qstats)
    .filter(([, s]) => s.wrong > 0)
    .map(([qid, s]) => {
      const q = room.qById.get(Number(qid));
      return q ? { q: q.q, answer: q.options[q.answer], explain: q.explain, asked: s.asked, wrong: s.wrong } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.wrong - a.wrong || b.wrong / b.asked - a.wrong / a.asked)
    .slice(0, 6);
  return {
    ranking,
    awards: { builder: award('built'), destroyer: award('destroyed'), defender: award('absorbed') },
    accuracy: answered ? Math.round((100 * correct) / answered) : 0,
    missed
  };
}

function goFinale(room) {
  room.stage = 'finale';
  room.final = computeFinal(room);
  room.deadline = vnow(room) + room.settings.finaleSec * 1000;
  const top = room.final.ranking[0];
  log(room, `🏆 Finale — winner: ${top ? `${top.name} with ${top.floors} floors` : 'nobody'}`, 'stage');
  pushEvent(room, { type: 'finale' });
  for (const p of room.players.values()) dirty(room, p);
  pubSoon(room, true);
}

function goEnded(room) {
  room.stage = 'ended';
  room.deadline = 0;
  for (const p of room.players.values()) dirty(room, p);
  pubSoon(room, true);
}

function backToLobby(room) {
  room.stage = 'lobby';
  room.phase = 0;
  room.deadline = 0;
  room.final = null;
  room.paused = false;
  room.events = [];
  for (const p of room.players.values()) { resetPlayer(p); dirty(room, p); }
  log(room, '↩ Back to the lobby', 'stage');
  pubSoon(room, true);
}

// ---------------------------------------------------------------------------
// Question bank editing (works during the game, e.g. to fix a typo)
// ---------------------------------------------------------------------------
function editQuestion(room, a) {
  const clean = sanitizeQuestion(a.question);
  if (!clean) return fail('A question needs text, at least 2 options and a valid correct answer.');
  let q;
  if (a.id) {
    q = room.qById.get(Number(a.id));
    if (!q) return fail('not_found');
    Object.assign(q, clean);
    q.rev += 1;
    for (const p of room.players.values()) {
      if (p.q && p.q.qid === q.id) {
        if (p.q.order.length !== q.options.length) p.q.order = makeOrder(room, q);
        dirty(room, p);
      }
      if (p.fb && p.fb.qid === q.id) dirty(room, p);
    }
    log(room, `✏️ Question #${q.id} edited: “${q.q.slice(0, 60)}”`, 'admin');
  } else {
    q = { id: room.nextQid++, ...clean, rev: 0 };
    room.bank.push(q);
    room.qById.set(q.id, q);
    log(room, `➕ Question #${q.id} added`, 'admin');
  }
  room.customBank = true;
  return { ok: true, id: q.id };
}

// ---------------------------------------------------------------------------
// Events, log and state snapshots
// ---------------------------------------------------------------------------
function pushEvent(room, ev) {
  ev.id = ++room.evSeq;
  ev.t = gameClock(room);
  room.events.push(ev);
  if (room.events.length > 40) room.events.shift();
  io.to(room.code + ':all').emit('event', ev);
  return ev;
}

function log(room, text, kind = 'info') {
  room.log.push({ seq: room.current ? room.current.seq : room.seq, t: gameClock(room), text, kind });
  if (room.log.length > 500) room.log.shift();
  room.logRev = (room.logRev || 0) + 1;
}

function dirty(room, p) { room.dirty.add(p.id); }

function flush(room) {
  for (const id of room.dirty) {
    const p = room.players.get(id);
    if (p && p.socketId && !p.isBot) io.to(p.socketId).emit('me', privateState(room, p));
  }
  room.dirty.clear();
  pubSoon(room);
}

function pubSoon(room, immediate = false) {
  if (immediate) {
    clearTimeout(room.pubTimer);
    room.pubTimer = null;
    emitPub(room);
    return;
  }
  if (room.pubTimer) return;
  room.pubTimer = setTimeout(() => { room.pubTimer = null; emitPub(room); }, PUB_MS);
}

function emitPub(room) {
  if (!rooms.has(room.code)) return;
  io.to(room.code + ':all').emit('pub', publicState(room));
  const withLog = room.logSent !== room.logRev;
  room.logSent = room.logRev;
  io.to(room.code + ':host').emit('host', hostState(room, withLog));
}

function publicPlayer(room, p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar, color: p.color, plot: p.plot, floors: p.floors,
    connected: p.connected, isBot: p.isBot, mode: p.mode,
    weapon: p.bomb ? { kind: 'bomb', dmg: bombDmg(room.rules, p.bomb.stacks), n: 1 } : p.arsenal ? { kind: 'arsenal', dmg: arsenalDmg(room.rules, p.arsenal), n: arsenalCount(p.arsenal) } : null,
    shield: p.shield ? p.shield.hp : 0,
    progress: room.phase === 1 ? p.p1Count : p.setsDone,
    correct: p.stats.correct, answered: p.stats.answered
  };
}

function publicState(room) {
  return {
    code: room.code,
    stage: room.stage,
    phase: room.phase,
    deadline: room.deadline,
    vnow: vnow(room),
    clock: gameClock(room),
    paused: room.paused,
    settings: room.settings,
    rules: room.rules,
    setSize: SET_SIZE,
    players: [...room.players.values()].map((p) => publicPlayer(room, p)),
    final: room.final ? { ranking: room.final.ranking, awards: room.final.awards, accuracy: room.final.accuracy } : null
  };
}

function hostState(room, withLog) {
  const easy = room.bank.filter((q) => q.level === 'easy').length;
  return {
    log: withLog ? room.log.slice(-150) : undefined,
    events: room.events.slice(-12),
    final: room.final,
    bank: { size: room.bank.length, easy, hard: room.bank.length - easy, custom: room.customBank },
    roster: [...room.players.values()].map((p) => ({ id: p.id, sid: p.sid, waiting: p.waiting.length, socket: !!p.socketId }))
  };
}

function questionView(room, p) {
  const q = room.qById.get(p.q.qid);
  return {
    key: p.key, qid: q.id, rev: q.rev, text: q.q, options: p.q.order.map((o) => q.options[o]).filter((o) => o !== undefined),
    repeat: p.q.repeat, level: q.level, two: isTwoOption(q)
  };
}

function feedbackView(room, p) {
  const q = room.qById.get(p.fb.qid);
  return {
    key: p.key, rev: q ? q.rev : 0, text: q ? q.q : '', options: q ? p.fb.order.map((o) => q.options[o]).filter((o) => o !== undefined) : [],
    choice: p.fb.choice, correctChoice: p.fb.correctChoice, timeout: p.fb.timeout, explain: q ? q.explain : '', two: q ? isTwoOption(q) : false
  };
}

function privateState(room, p) {
  const me = {
    id: p.id, name: p.name, avatar: p.avatar, color: p.color, floors: p.floors,
    mode: p.mode, key: p.key, deadline: p.deadline, vnow: vnow(room),
    q: p.mode === 'question' && p.q ? questionView(room, p) : null,
    fb: p.mode === 'feedback' && p.fb ? feedbackView(room, p) : null,
    set: room.phase >= 2 ? p.set.map((s) => ({ correct: s.correct, repeat: s.repeat })) : [],
    progress: { done: room.phase === 1 ? p.p1Count : p.setsDone, cap: room.phase ? capFor(room) : 0 },
    last: p.last,
    bomb: p.bomb ? { stacks: p.bomb.stacks, dmg: bombDmg(room.rules, p.bomb.stacks) } : null,
    arsenal: p.arsenal ? { miniStacks: p.arsenal.miniStacks, mini: miniDmg(room.rules, p.arsenal.miniStacks), dmg: arsenalDmg(room.rules, p.arsenal), bombs: arsenalBombs(room.rules, p.arsenal) } : null,
    hits: p.hits.slice(-30),
    shield: p.shield ? { hp: p.shield.hp } : null,
    window: p.window ? {
      bombs: p.window.bombs.map((b) => ({ kind: b.kind, dmg: b.dmg, targetId: b.targetId, targetName: b.targetName, auto: b.auto })),
      thrown: p.window.thrown,
      canHold: p.window.canHold
    } : null,
    stats: { answered: p.stats.answered, correct: p.stats.correct, built: p.stats.built, destroyed: p.stats.destroyed },
    waiting: p.waiting.length,
    final: null
  };
  if ((room.stage === 'finale' || room.stage === 'ended') && room.final) {
    const r = room.final.ranking.find((x) => x.id === p.id);
    me.final = {
      rank: r ? r.rank : null,
      total: room.final.ranking.length,
      missed: [...p.stats.missed.entries()].map(([qid, m]) => {
        const q = room.qById.get(qid);
        return q ? { q: q.q, answer: q.options[q.answer], explain: q.explain, times: m.times, fixed: m.fixed } : null;
      }).filter(Boolean).sort((a, b) => Number(a.fixed) - Number(b.fixed) || b.times - a.times)
    };
  }
  return me;
}

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------
const reply = (cb, data) => { if (typeof cb === 'function') cb(data); };

io.on('connection', (socket) => {
  const hostRoom = () => rooms.get(socket.data.hostOf) || null;
  const playerCtx = () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return null;
    const p = room.players.get(socket.data.playerId);
    if (!p || p.socketId !== socket.id) return null;
    return { room, p };
  };
  const hostAction = (type, extra) => (data, cb) => {
    const room = hostRoom();
    if (!room) return reply(cb, fail('no_room'));
    enqueue(room, { type, ...(extra ? extra(data || {}) : {}) }, (res) => reply(cb, res));
  };

  // ---- Host ----
  socket.on('host:create', (data, cb) => {
    data = data || {};
    const room = createRoom(data.settings, data.bank, data.rules);
    socket.data.hostOf = room.code;
    socket.join(room.code + ':host');
    socket.join(room.code + ':all');
    reply(cb, { ok: true, code: room.code, token: room.hostToken });
    pubSoon(room, true);
  });

  socket.on('host:resume', (data, cb) => {
    const room = rooms.get(String((data && data.code) || ''));
    if (!room || room.hostToken !== (data && data.token)) return reply(cb, fail('no_room'));
    socket.data.hostOf = room.code;
    socket.join(room.code + ':host');
    socket.join(room.code + ':all');
    room.lastActivity = now();
    reply(cb, { ok: true, code: room.code, token: room.hostToken });
    pubSoon(room, true);
    socket.emit('host', hostState(room, true));
  });

  socket.on('host:start', hostAction('start'));
  socket.on('host:skip', hostAction('skip'));
  socket.on('host:pause', hostAction('pause'));
  socket.on('host:end', hostAction('endGame'));
  socket.on('host:lobby', hostAction('lobby'));
  socket.on('host:addBots', hostAction('addBots', (d) => ({ n: d.n })));
  socket.on('host:kick', hostAction('kick', (d) => ({ targetId: d.id })));
  socket.on('host:reset', hostAction('reset', (d) => ({ targetId: d.id })));
  socket.on('host:question', hostAction('editQuestion', (d) => ({ id: d.id, question: d.question })));
  socket.on('host:rules', hostAction('rules', (d) => ({ rules: d.reset ? null : d.rules || {} })));

  socket.on('host:settings', (data, cb) => {
    const room = hostRoom();
    if (!room) return reply(cb, fail('no_room'));
    room.settings = sanitizeSettings((data && data.settings) || {}, room.settings);
    log(room, '⚙️ Settings changed', 'admin');
    reply(cb, { ok: true, settings: room.settings });
    pubSoon(room, true);
  });

  socket.on('host:bank', (_, cb) => {
    const room = hostRoom();
    if (!room) return reply(cb, fail('no_room'));
    reply(cb, { ok: true, custom: room.customBank, bank: room.bank.map(({ id, q, options, answer, explain, level }) => ({ id, q, options, answer, explain, level })) });
  });

  socket.on('host:bankReplace', (data, cb) => {
    const room = hostRoom();
    if (!room) return reply(cb, fail('no_room'));
    if (room.stage !== 'lobby' && room.stage !== 'ended') return reply(cb, fail('Finish the game before replacing the whole bank.'));
    const bank = data && data.bank === null ? null : sanitizeBank(data && data.bank);
    if (data && data.bank !== null && !bank) return reply(cb, fail('Need at least 3 valid questions.'));
    setBank(room, bank || DEFAULT_QUESTIONS);
    room.customBank = !!bank;
    log(room, `📚 Question bank replaced (${room.bank.length} questions)`, 'admin');
    reply(cb, { ok: true, size: room.bank.length });
    pubSoon(room, true);
  });

  // ---- Player ----
  socket.on('player:join', (data, cb) => {
    data = data || {};
    const room = rooms.get(String(data.code || '').trim());
    if (!room) return reply(cb, fail('Room not found. Check the PIN on the big screen.'));
    enqueue(room, { type: 'join', socket, name: data.name, sid: data.sid, avatar: data.avatar }, (res) => {
      reply(cb, res);
      if (res && res.ok) socket.emit('pub', publicState(room)); // the new phone sees the town right away
    });
  });

  socket.on('player:resume', (data, cb) => {
    data = data || {};
    const room = rooms.get(String(data.code || ''));
    if (!room) return reply(cb, fail('no_room'));
    const p = [...room.players.values()].find((x) => !x.isBot && x.token === data.token);
    if (!p) return reply(cb, fail('no_player'));
    attachSocket(room, p, socket);
    reply(cb, { ok: true, code: room.code, token: p.token, id: p.id, name: p.name });
    socket.emit('pub', publicState(room));
    flush(room);
    pubSoon(room);
  });

  socket.on('player:leave', (_, cb) => {
    const ctx = playerCtx();
    if (!ctx) return reply(cb, { ok: true });
    const { room, p } = ctx;
    if (room.stage === 'lobby') {
      enqueue(room, { type: 'kick', targetId: p.id, silent: true }, () => reply(cb, { ok: true }));
    } else {
      detachSocket(room, p, null);
      reply(cb, { ok: true });
      pubSoon(room);
    }
  });

  const playerAction = (type, pick) => (data, cb) => {
    const ctx = playerCtx();
    if (!ctx) return reply(cb, fail('not_joined'));
    enqueue(ctx.room, { type, pid: ctx.p.id, ...pick(data || {}) }, (res) => reply(cb, res));
  };
  socket.on('answer', playerAction('answer', (d) => ({ key: d.key, choice: d.choice })));
  socket.on('throw', playerAction('throw', (d) => ({ targetId: d.targetId })));
  socket.on('hold', playerAction('hold', () => ({})));
  socket.on('choose', playerAction('choose', (d) => ({ item: d.item })));

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.get(socket.data.playerId);
    if (p && p.socketId === socket.id) {
      p.connected = false;
      p.socketId = null;
      pubSoon(room);
    }
  });
});

// Clean up rooms nobody has touched for 4 hours.
setInterval(() => {
  const cutoff = now() - 4 * 3600 * 1000;
  for (const [code, room] of rooms) {
    if (room.lastActivity < cutoff) {
      clearInterval(room.ticker);
      clearTimeout(room.pubTimer);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log('\n  🏡  HappyTown is running!\n');
  console.log(`  Host screen (projector):  http://localhost:${PORT}/host`);
  for (const ip of lanAddresses()) console.log(`  Players join on phones:   http://${ip}:${PORT}`);
  console.log('');
});
