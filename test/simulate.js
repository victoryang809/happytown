// HappyTown — full-game simulation with rule checks.
// Run with `npm test`. It starts its own server on port 3999 (or TEST_PORT) and plays a fast game
// (20 s / 36 s / 48 s phases) with scripted players and bots, then prints ✅ / ❌ for each rule.
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const PORT = Number(process.env.TEST_PORT) || 3999;
const URL = `http://localhost:${PORT}`;
const QUESTIONS = require('../questions.js');
const byText = new Map(QUESTIONS.map((q) => [q.q, q]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...a);
const fails = [];
const check = (cond, msg) => { if (!cond) { fails.push(msg); log('❌', msg); } else log('✅', msg); };

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const finish = (code) => { srv.kill(); process.exit(code); };
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${URL}/healthz`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('the server did not start');
}

const connect = () => new Promise((r) => { const s = io(URL, { transports: ['websocket'], forceNew: true }); s.on('connect', () => r(s)); });
const emit = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));

(async () => {
  await waitForServer();
  log(`server running on ${URL} — playing a fast test game (about 2 minutes)…`);
  const host = await connect();
  let H = null; let HX = null;
  const events = [];
  host.on('pub', (s) => { H = s; });
  host.on('host', (s) => { HX = { ...HX, ...s, log: s.log || (HX && HX.log) }; });
  host.on('event', (e) => events.push(e));
  const room = await emit(host, 'host:create', {
    settings: { p1Sec: 20, p2Sec: 36, p3Sec: 48, finaleSec: 4, introSec: 1, p1QSec: 4, setQSec: 5, wrongSec: 1, throwSec: 2, chooseSec: 2 }
  });
  log('room', room.code);

  // ---------------------------------------------------------------- players
  const specs = [
    { name: 'Perfect Pam', sid: 'S001', acc: 1, speed: 80 },
    { name: 'Shield Sam', sid: 'S002', acc: 1, speed: 120 },
    { name: 'Wrong Wes', sid: 'S003', acc: 0, speed: 120 },
    { name: 'Mixed Mia', sid: 'S004', acc: 'mia', speed: 120 },
    { name: 'Flaky Flo', sid: 'S005', acc: 1, speed: 150 },
    { name: 'Holder Hal', sid: 'S006', acc: 1, speed: 1500 }
  ];
  const P = {};
  async function joinPlayer(spec, sock) {
    const s = sock || await connect();
    const res = await emit(s, 'player:join', { code: room.code, name: spec.name, sid: spec.sid, avatar: '🐼' });
    const pl = P[spec.name] || { spec, seen: [], answered: new Set(), missedTexts: new Set(), repeats: 0, repeatOk: 0, spacingOk: true, lastServed: new Map(), sets: 0, stats: {} };
    pl.sock = s; pl.res = res; pl.me = null;
    s.on('me', (me) => { pl.me = me; drive(pl); });
    s.on('pub', (pub) => { pl.pub = pub; });
    P[spec.name] = pl;
    return res;
  }
  for (const sp of specs) { const r = await joinPlayer(sp); check(r.ok && !r.restored, `join ${sp.name}`); }
  // same Student ID while the first device is still connected → refused
  const dupSock = await connect();
  const dup = await emit(dupSock, 'player:join', { code: room.code, name: 'Imposter', sid: 's001' });
  check(!dup.ok && /already playing/.test(dup.error), 'second device with a live Student ID is refused');
  dupSock.close();
  await emit(host, 'host:addBots', { n: 3 });
  await sleep(300);
  check(H.players.length === 9, 'lobby has 9 players: ' + H.players.length);

  let raceArmed = false; // set during phase 2 to make Pam and Sam throw at the same target in the same tick
  const raceReady = new Map();
  let raceDone = false;

  function correctIndex(q) {
    const src = byText.get(q.text);
    return q.options.indexOf(src.options[src.answer]);
  }

  function drive(pl) {
    const me = pl.me;
    if (!me) return;
    const sp = pl.spec;
    // a question that timed out (e.g. while the game was paused) also goes on the review list
    if (me.mode === 'feedback' && me.fb && me.fb.timeout) pl.missedTexts.add(me.fb.text);
    if (me.mode === 'question' && me.q && !pl.answered.has(me.q.key)) {
      pl.answered.add(me.q.key);
      const q = me.q;
      pl.served = (pl.served || 0) + 1;
      if (q.repeat) {
        pl.repeats += 1;
        if (pl.missedTexts.has(q.text)) pl.repeatOk += 1;
        else (pl.badRepeats = pl.badRepeats || []).push(q.text);
        const at = pl.lastServed.get(q.text);
        if (at !== undefined && pl.served - at < 3) pl.spacingOk = false;
      }
      pl.lastServed.set(q.text, pl.served);
      const src = byText.get(q.text);
      if (src && H) (pl.levels = pl.levels || {})[`${H.phase}:${src.level}`] = true;
      const right = correctIndex(q);
      let want = true;
      if (sp.acc === 0) want = false;
      if (sp.acc === 'mia') {
        // Mia: perfect first set in phase 2 (gets a bomb and holds it), then 2/3 sets (bomb is lost)
        const slot = me.set.length;
        want = !(H && H.phase >= 2 && (pl.sets >= 1) && slot === 2);
      }
      const choice = want ? right : (right + 1) % q.options.length;
      setTimeout(async () => {
        const r = await emit(pl.sock, 'answer', { key: q.key, choice });
        if (!r.ok) return;
        if (r.correct !== want) fails.push(`answer correctness ${sp.name}`);
        if (r.correct) pl.missedTexts.delete(q.text); else pl.missedTexts.add(q.text);
        if (H.phase >= 2 && me.set.length === 2) pl.sets += 1;
      }, sp.speed);
    }
    if (me.mode === 'choose' && !pl.chose?.[me.key]) {
      pl.chose = { ...(pl.chose || {}), [me.key]: true };
      const item = sp.name === 'Shield Sam' ? 'shield' : 'mega';
      setTimeout(() => emit(pl.sock, 'choose', { item }), 100);
    }
    if (me.mode === 'target' && me.window && !pl.aimed?.[`${me.key}:${me.window.thrown}`]) {
      pl.aimed = { ...(pl.aimed || {}), [`${me.key}:${me.window.thrown}`]: true };
      const pub = H;
      const others = pub.players.filter((x) => x.id !== me.id);
      const ranked = [...others].sort((a, b) => b.floors - a.floors);
      // Pam throws her Mini at the same house as her Mega (free throwing allows it)
      const first = me.window.bombs[0] && me.window.bombs[0].targetId;
      if (sp.name === 'Perfect Pam' && me.window.thrown > 0 && first) ranked.unshift(others.find((o) => o.id === first));
      // race: in phase 2, Pam and Sam wait for each other and bomb Mia in the same tick
      if (raceArmed && !raceDone && H.phase === 2 && (sp.name === 'Perfect Pam' || sp.name === 'Shield Sam')) {
        raceReady.set(sp.name, me.key);
        const ready = ['Perfect Pam', 'Shield Sam'].every((n) => P[n].me && P[n].me.mode === 'target' && raceReady.get(n) === P[n].me.key);
        if (ready) {
          raceDone = true;
          const mia = others.find((o) => o.name === 'Mixed Mia');
          log('⚡ race: Pam and Sam both throw at Mia in the same tick');
          P['Perfect Pam'].sock.emit('throw', { targetId: mia.id }, () => {});
          P['Shield Sam'].sock.emit('throw', { targetId: mia.id }, () => {});
        }
        return;
      }
      let action = 'throw';
      if (sp.name === 'Holder Hal' && me.window.canHold && me.window.thrown === 0) action = 'hold';
      if (sp.name === 'Mixed Mia' && me.window.canHold && me.window.thrown === 0) action = 'hold';
      if (sp.name === 'Perfect Pam' && me.window.thrown === 0 && me.window.canHold) {
        if (H.phase === 2 && me.bomb && me.bomb.stacks < H.rules.p2.maxStacks) action = 'hold';
        if (H.phase === 3 && me.arsenal && me.arsenal.miniStacks < H.rules.p3.maxMiniStacks) action = 'hold';
      }
      setTimeout(() => {
        if (action === 'hold') emit(pl.sock, 'hold', {});
        else if (ranked[0]) emit(pl.sock, 'throw', { targetId: ranked[0].id });
      }, 60);
    }
  }

  // ---------------------------------------------------------------- run
  await emit(host, 'host:start', {});
  let lastKey = '';
  let paused = false;
  let floGone = false;
  let floBack = false;
  let edited = false;
  const tStart = Date.now();
  while (Date.now() - tStart < 200000) {
    await sleep(100);
    if (!H) continue;
    const key = `${H.stage}:${H.phase}`;
    if (key !== lastKey) {
      lastKey = key;
      log(`== ${H.stage} phase ${H.phase} ==  ` + H.players.map((p) => `${p.name.split(' ')[1] || p.name}:${p.floors}${p.weapon ? '💣' + p.weapon.dmg : ''}${p.shield ? '🛡' + p.shield : ''}`).join(' '));
      for (const p of H.players) if (p.floors < 0) fails.push('negative floors');
    }
    // pause test in phase 1
    if (H.stage === 'play' && H.phase === 1 && !paused && Date.now() - tStart > 4000) {
      paused = true;
      const before = H.deadline - H.vnow;
      await emit(host, 'host:pause', {});
      await sleep(1500);
      const mid = H.deadline - H.vnow;
      await emit(host, 'host:pause', {});
      await sleep(400);
      const after = H.deadline - H.vnow;
      check(H.paused === false && Math.abs(mid - before) < 400, `pause freezes the phase timer (left ${before}→${mid} while paused)`);
      check(after > before - 1200, `timer continues after resume (left ${after})`);
    }
    // admin edits a question mid-game
    if (H.stage === 'play' && H.phase === 1 && !edited && Date.now() - tStart > 7000) {
      edited = true;
      const b = await emit(host, 'host:bank', {});
      const q = b.bank[0];
      const r = await emit(host, 'host:question', { id: q.id, question: { ...q, q: `${q.q} (FIXED)` } });
      const b2 = await emit(host, 'host:bank', {});
      check(r.ok && b2.bank.find((x) => x.id === q.id).q.endsWith('(FIXED)'), 'host can fix a question during the game');
      const newText = b2.bank.find((x) => x.id === q.id).q;
      byText.set(newText, QUESTIONS.find((x) => x.q === q.q));
      // a player who missed the old wording will see the corrected wording come back
      for (const pl of Object.values(P)) if (pl.missedTexts.has(q.q)) pl.missedTexts.add(newText);
    }
    // Flo drops at the start of phase 2 and comes back on a NEW device with her Student ID
    if (H.stage === 'play' && H.phase === 2 && !floGone) {
      floGone = true;
      raceArmed = true;
      const flo = P['Flaky Flo'];
      flo.floorsAtDrop = H.players.find((p) => p.name === 'Flaky Flo').floors;
      flo.sock.disconnect();
      log('Flo disconnected with', flo.floorsAtDrop, 'floors');
    }
    if (H.stage === 'play' && H.phase === 2 && floGone && !floBack && Date.now() - tStart > 0) {
      const pFlo = H.players.find((p) => p.name === 'Flaky Flo');
      if (pFlo && !pFlo.connected) {
        floBack = true;
        const res = await joinPlayer(specs[4]);
        check(res.ok && res.restored && res.floors === P['Flaky Flo'].floorsAtDrop, `Flo rejoined on a new device with her Student ID (floors ${res.floors})`);
      }
    }
    if (H.stage === 'intro') host.emit('host:skip', {}, () => {});
    if (H.stage === 'ended') break;
  }
  await sleep(500);
  check(H.stage === 'ended', 'game reached the end');

  // ---------------------------------------------------------------- checks
  const attacks = events.filter((e) => e.type === 'attack');
  const fizz = events.filter((e) => e.type === 'fizzle');
  log('events:', JSON.stringify(events.reduce((m, e) => { const k = e.type + (e.kind ? ':' + e.kind : '') + (e.reason ? ':' + e.reason : ''); m[k] = (m[k] || 0) + 1; return m; }, {})));

  // race condition
  const race = attacks.filter((e) => e.toName === 'Mixed Mia' && (e.fromName === 'Perfect Pam' || e.fromName === 'Shield Sam') && e.kind === 'bomb');
  const pair = race.find((e, i) => race[i + 1] && race[i + 1].seq === e.seq + 1);
  if (pair) {
    const next = race[race.indexOf(pair) + 1];
    log(`race: #${pair.seq} ${pair.fromName} → Mia ${pair.before}→${pair.after} ; #${next.seq} ${next.fromName} → Mia ${next.before}→${next.after}`);
    check(next.before === pair.after, 'simultaneous bombs on the same house are applied one after the other (no lost update)');
  } else check(raceDone && race.length >= 2, 'race scenario happened');

  const pam = P['Perfect Pam'];
  const pamBombs = attacks.filter((e) => e.fromName === 'Perfect Pam');
  check(attacks.some((e) => e.kind === 'bomb' && e.dmg === 2), 'Phase 2: a new bomb destroys 2 floors');
  check(pamBombs.some((e) => e.kind === 'bomb' && e.dmg === 6), 'Phase 2: a held bomb grows 2 → 4 → 6');
  check(!attacks.some((e) => e.kind === 'bomb' && e.dmg > 6), 'Phase 2: bombs never go above 6');
  // volley: Mega + one Mini that grew 1 → 3 → 5
  const volley = pamBombs.filter((e) => e.kind === 'mega' || e.kind === 'mini');
  const groups = [];
  for (const e of volley) { if (e.kind === 'mega') groups.push([e]); else if (groups.length) groups[groups.length - 1].push(e); }
  const full = groups.find((g) => g.length === 2 && g[1].dmg === 5);
  log('Pam volleys:', JSON.stringify(groups.map((g) => g.map((e) => `${e.kind}${e.dmg}→${e.toName}`))));
  check(!!full, 'Phase 3: holding the Mega, the Mini Bomb grows 1 → 3 → 5');
  check(!attacks.some((e) => e.kind === 'mini' && e.dmg > 5) && !groups.some((g) => g.length > 2), 'Phase 3: at most one Mini, max 5 damage');
  if (full) check(full[0].to === full[1].to, 'Mega and Mini can hit the same house (free throwing)');
  check(pam.repeats === 0, 'a player who never misses never gets review questions');
  const lv = pam.levels || {};
  log('Pam saw levels:', Object.keys(lv).sort().join(' '));
  check(lv['1:easy'] && lv['1:hard'] && lv['3:easy'] && lv['3:hard'], 'questions are mixed in every phase (default setting)');

  const wes = P['Wrong Wes'];
  log(`Wes: repeats ${wes.repeats}, repeats that were missed before ${wes.repeatOk}, spacing ok ${wes.spacingOk}`);
  if (wes.badRepeats) log('unexpected repeats:', JSON.stringify(wes.badRepeats));
  check(wes.repeats > 5 && wes.repeatOk === wes.repeats, 'missed questions come back (and only missed ones)');
  check(wes.spacingOk, 'a missed question comes back after at least 2 other questions');

  check(fizz.some((e) => e.name === 'Mixed Mia' && e.reason === 'streak'), 'held bomb is lost when the next set is not perfect');
  check(fizz.some((e) => e.reason === 'phase'), 'bombs still held when a phase ends are lost');
  const shieldHits = attacks.filter((e) => e.absorbed > 0);
  log('shield hits:', JSON.stringify(shieldHits.map((e) => `${e.kind}${e.dmg} blocked ${e.absorbed}, lost ${e.lost}`)));
  check(shieldHits.length > 0, 'shields absorb damage');
  check(shieldHits.every((e) => e.broke && e.absorbed === Math.min(5, e.dmg) && e.lost === Math.min(e.before, Math.max(0, e.dmg - 5))),
    'a shield blocks up to 5 floors of ONE bomb, then disappears');
  const megaOnShield = shieldHits.find((e) => e.kind === 'mega');
  if (megaOnShield) check(megaOnShield.lost === 0, 'a Mega Bomb (5) on a shield destroys nothing');
  else log('(no Mega hit a shield in this run)');
  check(!events.some((e) => e.type === 'shieldGone'), 'a shield has no time limit (it only disappears when hit)');
  // the victim always knows who bombed them
  let hitChecks = 0;
  let hitOk = true;
  for (const pl of Object.values(P)) {
    const mine = attacks.filter((e) => e.to === pl.res.id).slice(-30);
    const hits = (pl.me && pl.me.hits) || [];
    for (const e of mine) {
      hitChecks += 1;
      const h = hits.find((x) => x.id === e.id);
      if (!h || h.fromName !== e.fromName || h.lost !== e.lost || !h.fromAvatar) { hitOk = false; log('missing hit record', e.id, e.fromName, '→', e.toName); }
    }
  }
  check(hitChecks > 0 && hitOk, `each victim's phone has a record of who bombed them (${hitChecks} hits checked)`);

  // caps
  const capLog = (HX.log || []).length;
  log('host log entries:', capLog);
  const pamP1 = HX.log.find((l) => /Phase 1 ended/.test(l.text));
  check(!!pamP1, 'phase 1 ended by its timer');
  // final
  const F = HX.final;
  log('FINAL', F.ranking.map((r) => `${r.rank}.${r.name}=${r.floors}(${r.correct}/${r.answered})`).join('  '));
  check(F.ranking.length === 9 && F.missed.length > 0, 'final ranking and most-missed list');
  const pamMe = P['Perfect Pam'].me;
  check(pamMe.final && pamMe.final.rank >= 1, 'players receive their final rank');
  const wesMe = P['Wrong Wes'].me;
  check(wesMe.final && wesMe.final.missed.length > 5, 'players receive a personal review list');
  const pamAnswered = F.ranking.find((r) => r.name === 'Perfect Pam').answered;
  log('Pam answered', pamAnswered, 'questions (cap = 18 + 9×3 + 10×3 = 75)');
  check(pamAnswered <= 75, 'per-phase caps respected');

  // ---------------------------------------------------------------- game 2: damage and floors set by the host
  log('— game 2: custom damage and floors set by the host —');
  const clamp = await emit(host, 'host:rules', { rules: { p2: { dmg: 999 } } });
  check(clamp.ok && clamp.rules.p2.dmg === 50, `out-of-range numbers are clamped (bomb damage 999 → ${clamp.rules && clamp.rules.p2.dmg})`);
  await emit(host, 'host:lobby', {});
  const custom = { p1: { floor: 2 }, p2: { floor: 1, dmg: 4, step: 3, maxStacks: 2 }, p3: { floor: 3, mega: 7, mini: 2, miniStep: 1, maxMiniStacks: 2, shieldHp: 6 } };
  const set = await emit(host, 'host:rules', { rules: custom });
  check(set.ok && set.rules.p2.dmg === 4 && set.rules.p3.mega === 7 && set.rules.p3.shieldHp === 6, 'the host can set damage, shield and floors');
  await emit(host, 'host:settings', { settings: { p1Sec: 8, p2Sec: 14, p3Sec: 16, finaleSec: 3, introSec: 1 } });
  await sleep(500);
  check(H.rules && H.rules.p1.floor === 2 && H.rules.p3.shieldHp === 6, 'all screens receive the new numbers');
  const g2Start = events.length;
  let p1Floors = null;
  await emit(host, 'host:start', {});
  const t2 = Date.now();
  while (Date.now() - t2 < 90000) {
    await sleep(100);
    if (H.stage === 'intro') {
      if (H.phase === 2 && p1Floors === null) p1Floors = H.players.find((x) => x.name === 'Perfect Pam').floors;
      host.emit('host:skip', {}, () => {});
    }
    if (H.stage === 'ended') break;
  }
  const ev2 = events.slice(g2Start);
  const at2 = ev2.filter((e) => e.type === 'attack');
  log('game 2 attacks:', JSON.stringify(at2.map((e) => `${e.kind}${e.dmg}${e.absorbed ? `(🛡${e.absorbed})` : ''}`)));
  check(p1Floors === 36, `Phase 1 gives 2 floors per correct answer (Pam: 18 correct → ${p1Floors} floors)`);
  const b2 = at2.filter((e) => e.kind === 'bomb');
  check(b2.length > 0 && b2.every((e) => e.dmg === 4 || e.dmg === 7) && b2.some((e) => e.dmg === 7),
    'Phase 2 bombs use the new numbers (4 → 7, max 2 levels)');
  const m2 = at2.filter((e) => e.kind === 'mega');
  check(m2.length > 0 && m2.every((e) => e.dmg === 7), 'Mega Bombs destroy 7 floors');
  const mi2 = at2.filter((e) => e.kind === 'mini');
  check(mi2.length > 0 && mi2.every((e) => e.dmg === 2 || e.dmg === 3) && mi2.some((e) => e.dmg === 3), 'Mini Bombs use the new numbers (2 → 3)');
  check(ev2.filter((e) => e.type === 'shield').every((e) => e.hp === 6) && at2.filter((e) => e.absorbed).every((e) => e.absorbed === Math.min(6, e.dmg)),
    'shields block up to 6 floors');
  log(fails.length ? `FAILURES: ${fails.length}\n` + [...new Set(fails)].join('\n') : 'ALL CHECKS PASSED');
  finish(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); finish(1); });
