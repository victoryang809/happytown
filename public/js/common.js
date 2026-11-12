/* Shared helpers for host + player screens */
window.HT = window.HT || {};
(function (HT) {
  HT.PHASES = {
    1: { name: 'Warm-up & Foundation', short: 'Warm-up', icon: '🌱', cls: 'p1' },
    2: { name: 'Interaction & Accumulation', short: 'Interaction', icon: '⚡', cls: 'p2' },
    3: { name: 'Tactical Decision', short: 'Tactics', icon: '♟️', cls: 'p3' }
  };

  // Keep in sync with AVATARS in server.js
  HT.AVATARS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵',
    '🐔', '🐧', '🐦', '🦄', '🐙', '🐢', '🦋', '🐝', '🐳', '🦉', '🐲', '🦖', '🐬', '🦀', '🐞'];

  const mins = (sec) => {
    if (sec % 60 === 0) return `${sec / 60} minute${sec === 60 ? '' : 's'}`;
    if (sec < 60) return `${sec} seconds`;
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} minutes`;
  };

  // Default rule values (the server sends the real ones in S.rules)
  HT.RULES = {
    p1: { floor: 1 },
    p2: { floor: 1, dmg: 2, step: 2, maxStacks: 3 },
    p3: { floor: 3, mega: 5, mini: 1, miniStep: 2, maxMiniStacks: 3, shieldHp: 5, secPerMini: 2 }
  };
  // Damage steps of a bomb that is held: e.g. 2 → 4 → 6
  HT.steps = (base, step, n) => Array.from({ length: n }, (_, i) => base + step * i).join(' → ');

  HT.rules = function (phase, s, r) {
    s = s || {};
    r = r || HT.RULES;
    const p1 = r.p1 || HT.RULES.p1;
    const p2 = r.p2 || HT.RULES.p2;
    const p3 = r.p3 || HT.RULES.p3;
    const fl = (n) => `${n} floor${n === 1 ? '' : 's'}`;
    if (phase === 1) return [
      ['⏱️', `<b>${mins(s.p1Sec || 120)}</b>. Answer at your own pace, up to <b>${s.p1Cap || 18} questions</b>.`],
      ['🧱', `Each correct answer builds <b>${fl(p1.floor)}</b>.`],
      ['⚡', `Right answers jump straight to the next question. Wrong ones show the answer for ${s.wrongSec || 3} seconds.`],
      ['🔁', 'Missed questions <b>come back later</b> until you get them right.']
    ];
    if (phase === 2) return [
      ['📝', `<b>${mins(s.p2Sec || 300)}</b>. Questions now come in <b>sets of 3</b>.`],
      ['🧱', `<b>2/3</b> correct → <b>+${fl(p2.floor)}</b>.`],
      ['💣', `<b>3/3</b> → +${fl(p2.floor)} <b>and a bomb</b> that destroys <b>${fl(p2.dmg)}</b>. You have <b>${s.throwSec || 5} seconds</b> to throw it.`],
      p2.maxStacks > 1 && p2.step > 0
        ? ['🔋', `Or <b>hold</b> it: each perfect set in a row adds <b>+${p2.step} damage</b> (${HT.steps(p2.dmg, p2.step, p2.maxStacks)}).`]
        : ['🔋', 'You can <b>hold</b> it for later, but it does not get stronger.'],
      ['💨', 'Miss a perfect set while holding and the bomb is <b>lost</b>. Bombs still held when the phase ends are lost too.']
    ];
    return [
      ['🧱', `<b>${mins(s.p3Sec || 360)}</b>. <b>2/3</b> or <b>3/3</b> correct → <b>+${p3.floor} floors</b>.`],
      ['🥇', `<b>3/3</b> → also choose: <b>💣 Mega Bomb</b> (${fl(p3.mega)}) or <b>🛡️ Shield</b> (blocks up to <b>${p3.shieldHp} floors</b> of the next bomb that hits you, then disappears).`],
      ['🔋', `Hold the Mega Bomb: your next perfect set adds a <b>Mini Bomb</b> (${fl(p3.mini)})` +
        (p3.maxMiniStacks > 1 && p3.miniStep > 0 ? `; each further perfect set adds <b>+${p3.miniStep}</b> to it (${HT.steps(p3.mini, p3.miniStep, p3.maxMiniStacks)}).` : '.')],
      ['🎯', 'Throw your bombs at <b>any house</b> (the same house twice is fine). <b>Quick Lock</b> hits the Top 3 fast!'],
      ['💨', 'Miss a perfect set while holding and <b>all</b> your bombs are lost.']
    ];
  };

  // Game clock. The server sends its "virtual now" (which stops while the game is paused).
  HT.clock = {
    offset: 0,
    sync(vnow) { if (vnow) this.offset = vnow - Date.now(); },
    now() { return Date.now() + this.offset; }
  };
  // Milliseconds left until a server deadline. While paused, time stands still at `frozenNow`.
  HT.left = function (deadline, paused, frozenNow) {
    if (!deadline) return 0;
    return Math.max(0, deadline - (paused ? frozenNow : HT.clock.now()));
  };

  HT.fmtClock = function (ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  HT.fmtStamp = function (ms) {
    const t = Math.max(0, ms);
    const m = Math.floor(t / 60000);
    const s = Math.floor((t % 60000) / 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.floor(t % 1000)).padStart(3, '0')}`;
  };

  HT.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  HT.$ = (sel, root) => (root || document).querySelector(sel);
  HT.$$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  HT.store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  HT.medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`);

  // Players sorted for the leaderboard (tallest first).
  HT.ranked = (players) => [...players].sort((a, b) => b.floors - a.floors || b.correct - a.correct || a.name.localeCompare(b.name));
  HT.rankOf = (players, id) => {
    const list = HT.ranked(players);
    const me = list.find((p) => p.id === id);
    if (!me) return 0;
    return list.filter((p) => p.floors > me.floors).length + 1;
  };

  HT.weaponLabel = (w) => (!w ? '' : w.kind === 'bomb' ? `💣${w.dmg}` : `💣${w.n > 1 ? '×' + w.n : ''} ${w.dmg}`);
})(window.HT);
