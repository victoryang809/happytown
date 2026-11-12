/* HappyTown v2 — host / projector screen */
(function () {
  const { $, $$, esc, store, clock } = HT;
  const socket = io();
  let S = null; // shared state
  let HX = { log: [], events: [], final: null, bank: {}, roster: [] }; // host-only extras
  let session = store.get('ht:host2', null);
  let joinBase = location.origin;
  let feedEvents = [];
  let lastTickSec = null;
  let adminTab = 'game';
  let bankCache = null;
  let editing = null; // question being edited in the admin panel

  // -------------------------------------------------------------------------
  // Sound effects (synthesised, no files needed)
  // -------------------------------------------------------------------------
  const Sfx = {
    ctx: null,
    on: store.get('ht:sound', true),
    lastPop: 0,
    ensure() {
      if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(freq, dur, type = 'sine', vol = 0.12, to = null, delay = 0) {
      if (!this.on) return;
      const c = this.ensure(); if (!c) return;
      const t = c.currentTime + delay;
      const o = c.createOscillator(); const g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol = 0.4, delay = 0) {
      if (!this.on) return;
      const c = this.ensure(); if (!c) return;
      const t = c.currentTime + delay;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = c.createGain(); g.gain.value = vol;
      src.connect(f).connect(g).connect(c.destination); src.start(t);
    },
    pop() { const n = performance.now(); if (n - this.lastPop < 350) return; this.lastPop = n; this.tone(440, 0.12, 'triangle', 0.1, 990); },
    whoosh() { this.tone(1200, 0.5, 'sawtooth', 0.03, 300); },
    boom(big) { this.noise(big ? 0.9 : 0.55, big ? 0.7 : 0.5); this.tone(120, big ? 0.6 : 0.4, 'sine', 0.35, 35); },
    shield() { this.tone(880, 0.25, 'sine', 0.08); this.tone(1320, 0.35, 'sine', 0.07, null, 0.08); },
    fizzle() { this.noise(0.4, 0.15); this.tone(600, 0.4, 'sine', 0.05, 150); },
    tick() { this.tone(1100, 0.05, 'square', 0.04); },
    phase() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, null, i * 0.12)); },
    drum() { for (let i = 0; i < 10; i++) this.noise(0.08, 0.12, i * 0.09); },
    fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, i === 5 ? 0.7 : 0.2, 'triangle', 0.14, null, i * 0.14)); },
    firework() { this.noise(0.35, 0.08); }
  };
  document.addEventListener('pointerdown', () => Sfx.ensure(), { once: true });

  // -------------------------------------------------------------------------
  // Town
  // -------------------------------------------------------------------------
  const town = new HT.Town($('#town'), {
    onBuild: () => Sfx.pop(),
    onImpact: (ev) => { if (ev.lost > 0) Sfx.boom(ev.dmg >= 5); else Sfx.shield(); }
  });

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------
  function createRoom() {
    socket.emit('host:create', { settings: store.get('ht:settings3', null), bank: store.get('ht:bank3', null), rules: store.get('ht:rules1', null) }, (res) => {
      if (!res || !res.ok) return toast('Could not create a room');
      session = { code: res.code, token: res.token };
      store.set('ht:host2', session);
      feedEvents = [];
      bankCache = null;
      renderJoin();
    });
  }
  socket.on('connect', () => {
    if (session) {
      socket.emit('host:resume', session, (res) => {
        if (res && res.ok) renderJoin();
        else { session = null; store.del('ht:host2'); createRoom(); }
      });
    } else createRoom();
  });
  socket.on('disconnect', () => toast('Connection lost — reconnecting…'));
  socket.on('pub', (pub) => {
    clock.sync(pub.vnow);
    const prevStage = S && S.stage;
    S = pub;
    if (prevStage !== S.stage) onStageChange(prevStage);
    render();
  });
  socket.on('host', (h) => {
    const log = h.log || HX.log;
    HX = { ...h, log };
    if (!feedEvents.length && h.events) feedEvents = h.events.slice(-8);
    if (h.log && adminTab === 'log') renderLog();
    if (S) renderLobby(); // the lobby shows the question bank info, which comes with this update
    if (S && S.stage === 'ended') renderFinale();
  });
  socket.on('event', (ev) => {
    if (ev.type === 'attack') { town.attack(ev); Sfx.whoosh(); }
    if (ev.type === 'shield') { Sfx.shield(); town.floatText(ev.id, '🛡️ Shield up!', 'shield'); }
    if (ev.type === 'fizzle') { Sfx.fizzle(); town.floatText(ev.id, '💨 bomb lost', 'shield'); }
    if (ev.type === 'phase') Sfx.phase();
    if (feedText(ev)) {
      feedEvents.push(ev);
      if (feedEvents.length > 8) feedEvents.shift();
      renderFeed();
    }
  });

  async function computeJoinBase() {
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      try {
        const info = await (await fetch('/api/info')).json();
        if (info.lanAddresses && info.lanAddresses.length) joinBase = `http://${info.lanAddresses[0]}:${location.port || info.port}`;
      } catch (e) { /* keep origin */ }
    }
    renderJoin();
  }
  function renderJoin() {
    if (!session) return;
    const url = `${joinBase}/?room=${session.code}`;
    $('#joinUrl').textContent = joinBase.replace(/^https?:\/\//, '');
    $('#joinCode').textContent = session.code;
    $('#pinTop').textContent = session.code;
    const src = `/api/qr?data=${encodeURIComponent(url)}`;
    if ($('#qr').getAttribute('src') !== src) $('#qr').src = src;
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const left = () => (S ? HT.left(S.deadline, S.paused, S.vnow) : 0);

  function onStageChange(prev) {
    if (S.stage === 'finale') startFinale();
    if (S.stage === 'ended') startFireworks();
    if (S.stage === 'lobby' || S.stage === 'intro') stopFireworks();
    if (prev === 'lobby' && S.stage !== 'lobby') Sfx.ensure();
  }

  function render() {
    if (!S) return;
    document.body.dataset.stage = S.stage;
    town.update(S.players);
    renderTop();
    renderLobby();
    renderIntro();
    renderBanner();
    renderFeed();
    renderFinale();
    $('#bottombar').hidden = !['intro', 'play'].includes(S.stage);
    $('#pinPill').hidden = S.stage === 'lobby';
    if (!$('#admin').hidden) renderAdmin(false);
    tickTimers();
  }

  function renderTop() {
    const t = $('#tbPhase');
    if (S.stage === 'lobby') t.textContent = 'Waiting for players…';
    else if (S.stage === 'finale' || S.stage === 'ended') t.textContent = '🏆 Finale';
    else {
      const ph = HT.PHASES[S.phase];
      t.innerHTML = `<span class="chip ${ph.cls}">${ph.icon} Phase ${S.phase}</span> ${esc(ph.name)}`;
    }
    const s = S.settings;
    const segs = [
      { cls: 'p1', w: s.p1Sec, label: `Warm-up ${HT.fmtClock(s.p1Sec * 1000)}` },
      { cls: 'p2', w: s.p2Sec, label: `Interaction ${HT.fmtClock(s.p2Sec * 1000)}` },
      { cls: 'p3', w: s.p3Sec, label: `Tactics ${HT.fmtClock(s.p3Sec * 1000)}` },
      { cls: 'fin', w: Math.max(s.finaleSec, 45), label: 'Finale' }
    ];
    const tl = $('#timeline');
    const key = segs.map((x) => x.label).join('|');
    if (tl.dataset.key !== key) {
      tl.dataset.key = key;
      tl.innerHTML = segs.map((x) => `<div class="seg ${x.cls}" style="--w:${x.w}"><i></i><span>${x.label}</span></div>`).join('');
    }
    $('#phaseClock').hidden = S.stage === 'lobby';
  }

  function tickTimers() {
    if (!S) return;
    const ms = left();
    const s = S.settings;
    // timeline fill
    const segs = $$('#timeline .seg');
    const curIdx = S.stage === 'finale' || S.stage === 'ended' ? 3 : S.phase - 1;
    segs.forEach((el, i) => {
      let fill = 0;
      if (S.stage === 'lobby') fill = 0;
      else if (i < curIdx) fill = 100;
      else if (i === curIdx) {
        if (S.stage === 'play') fill = 100 * (1 - ms / ([s.p1Sec, s.p2Sec, s.p3Sec][i] * 1000));
        else if (S.stage === 'finale') fill = 100 * (1 - ms / (s.finaleSec * 1000));
        else if (S.stage === 'ended') fill = 100;
      }
      el.style.setProperty('--fill', Math.max(0, Math.min(100, fill)).toFixed(1) + '%');
      el.classList.toggle('now', i === curIdx && S.stage !== 'lobby' && S.stage !== 'ended');
    });
    // big clock
    const pc = $('#phaseClock');
    const lbl = { intro: `Phase ${S.phase} starts in`, play: `Phase ${S.phase} ends in`, finale: 'Finale', ended: 'Game over' }[S.stage] || '';
    $('#phaseClockLbl').textContent = S.paused ? 'Paused' : lbl;
    $('#phaseClockTime').textContent = S.stage === 'ended' ? '🏁' : S.paused ? '⏸' : HT.fmtClock(ms);
    const urgent = S.stage === 'play' && !S.paused && ms <= 10000;
    pc.classList.toggle('urgent', urgent);
    const sec = Math.ceil(ms / 1000);
    if (urgent && sec <= 5 && sec > 0 && sec !== lastTickSec) { lastTickSec = sec; Sfx.tick(); }
    const ic = $('#introCount');
    if (ic) ic.textContent = S.paused ? 'Paused' : `Starting in ${sec}s…`;
    if (S.stage === 'finale') finaleStep();
  }
  setInterval(tickTimers, 200);

  function renderLobby() {
    const show = S.stage === 'lobby';
    $('#lobby').hidden = !show;
    if (!show) return;
    const bots = S.players.filter((p) => p.isBot).length;
    $('#lobbyCount').textContent = S.players.length;
    $('#lobbyCountLbl').textContent = (S.players.length === 1 ? 'player' : 'players') + ' in town' + (bots ? ` (${bots} bot${bots > 1 ? 's' : ''})` : '');
    $('#startBtn').disabled = S.players.length === 0;
    const names = S.players.map((p) => `<span>${esc(p.avatar)} ${esc(p.name)}</span>`).join('');
    if ($('#lobbyNames').dataset.h !== names) { $('#lobbyNames').innerHTML = names; $('#lobbyNames').dataset.h = names; }
    const b = HX.bank || {};
    const s = S.settings;
    $('#bankInfo').textContent = `${b.custom ? 'Custom' : 'Default'} bank · ${b.size || 0} questions${S.settings.mix ? ', mixed in every phase' : ` (${b.easy || 0} easy for Phase 1, ${b.hard || 0} hard for Phases 2–3)`} · ` +
      `${HT.fmtClock(s.p1Sec * 1000)} + ${HT.fmtClock(s.p2Sec * 1000)} + ${HT.fmtClock(s.p3Sec * 1000)} + finale`;
  }

  let introKey = '';
  function renderIntro() {
    const ov = $('#intro');
    if (S.stage !== 'intro') { ov.hidden = true; introKey = ''; return; }
    ov.hidden = false;
    const key = `${S.phase}:${S.paused}`;
    if (introKey === key) return;
    introKey = key;
    const ph = HT.PHASES[S.phase];
    ov.innerHTML = `
      <div class="intro-card ${ph.cls}">
        <div class="intro-kicker">Phase ${S.phase} of 3 · ${HT.fmtClock([0, S.settings.p1Sec, S.settings.p2Sec, S.settings.p3Sec][S.phase] * 1000)} on the clock</div>
        <h1>${ph.icon} ${esc(ph.name)}</h1>
        <ul class="rules">${HT.rules(S.phase, S.settings, S.rules).map(([i, t]) => `<li><span>${i}</span><div>${t}</div></li>`).join('')}</ul>
        <div class="intro-foot">
          <div class="intro-count" id="introCount"></div>
          <button class="btn big ${S.phase === 3 ? 'purple' : S.phase === 2 ? '' : 'green'}" id="introGo">Let's go! ▶</button>
        </div>
      </div>`;
    $('#introGo').onclick = () => { Sfx.ensure(); socket.emit('host:skip'); };
  }

  function renderBanner() {
    const b = $('#banner');
    let html = '';
    let cls = '';
    if (S.paused && S.stage !== 'lobby' && S.stage !== 'ended') { html = '⏸ Game paused'; cls = 'paused'; }
    else if (S.stage === 'play') {
      const humans = S.players;
      const aiming = humans.filter((p) => p.mode === 'target' || p.mode === 'choose').length;
      const capped = humans.filter((p) => p.mode === 'capped').length;
      const answering = humans.filter((p) => p.mode === 'question' || p.mode === 'feedback').length;
      cls = HT.PHASES[S.phase].cls;
      const what = S.phase === 1 ? '📱 Answer fast to build floors!' : S.phase === 2 ? '💣 Perfect sets earn bombs!' : '♟️ Mega Bomb or Shield?';
      html = `${what} <span class="count">${answering} answering${aiming ? ` · 🎯 ${aiming} aiming` : ''}${capped ? ` · ✓ ${capped} finished` : ''}</span>`;
    }
    b.hidden = !html;
    b.className = 'banner ' + cls;
    if (b.dataset.html !== html) { b.innerHTML = html; b.dataset.html = html; }
  }

  function feedText(ev) {
    const n = (s) => `<b>${esc(s)}</b>`;
    switch (ev.type) {
      case 'attack': {
        const what = ev.kind === 'mega' ? `🚀 ${n(ev.fromName)} fired a MEGA bomb at ${n(ev.toName)}` : ev.kind === 'mini' ? `💣 ${n(ev.fromName)} hit ${n(ev.toName)} with a Mini Bomb` : `💣 ${n(ev.fromName)} bombed ${n(ev.toName)}`;
        const res = ev.lost > 0 ? ` −${ev.lost}` : '';
        const sh = ev.absorbed > 0 ? ` (🛡️ blocked ${ev.absorbed}, shield gone)` : '';
        return { html: what + res + sh, cls: 'bad', id: ev.from };
      }
      case 'shield': return { html: `🛡️ ${n(ev.name)} raised a shield`, cls: 'blue', id: ev.id };
      case 'fizzle': return { html: `💨 ${n(ev.name)} lost ${ev.n > 1 ? 'a Mega + Mini Bomb' : 'a bomb'} (${ev.dmg} damage)${ev.reason === 'phase' ? ' · phase over' : ev.reason === 'streak' ? ' · streak broken' : ''}`, cls: 'meh', id: ev.id };
      case 'shieldGone': return { html: `🫧 ${n(ev.name)}'s shield faded`, cls: 'meh', id: ev.id };
      case 'rejoin': return { html: `🔁 ${n(ev.name)} is back (${ev.floors} floors restored)`, cls: 'good', id: ev.id };
      default: return null;
    }
  }

  function renderFeed() {
    const el = $('#feed');
    if (!S || !['intro', 'play'].includes(S.stage)) { el.innerHTML = ''; el.dataset.key = ''; return; }
    const key = feedEvents.map((e) => e.id).join(',');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.innerHTML = feedEvents.slice(-6).reverse().map((ev) => {
      const f = feedText(ev);
      if (!f) return '';
      const p = S.players.find((x) => x.id === f.id);
      return `<div class="feed-item ${f.cls}"><span class="dot">${p ? esc(p.avatar) : '•'}</span><span>${f.html}</span></div>`;
    }).join('');
  }

  // -------------------------------------------------------------------------
  // Finale: fireworks + podium reveal (3rd → 2nd → 1st), then results
  // -------------------------------------------------------------------------
  let finaleView = '';
  let revealed = 0;
  function startFinale() {
    revealed = 0;
    finaleView = '';
    startFireworks();
    Sfx.drum();
  }
  function finaleElapsed() {
    return S.stage === 'finale' ? S.settings.finaleSec * 1000 - left() : Infinity;
  }
  function finaleStep() {
    const t = finaleElapsed();
    const want = t >= 8000 ? 3 : t >= 5000 ? 2 : t >= 2500 ? 1 : 0;
    if (want !== revealed) {
      revealed = want;
      $$('.pod').forEach((el) => el.classList.toggle('show', Number(el.dataset.step) <= revealed));
      if (revealed === 3) { Sfx.fanfare(); fw.burst(8); }
      else if (revealed > 0) { Sfx.boom(false); fw.burst(3); }
      const dr = $('#drumroll');
      if (dr) dr.textContent = revealed === 3 ? '🎉 Congratulations!' : '🥁 …';
    }
    if (t >= 12000 && finaleView === 'podium') renderFinale();
  }

  function renderFinale() {
    const ov = $('#finale');
    const show = S.stage === 'finale' || S.stage === 'ended';
    ov.hidden = !show;
    if (!show) { finaleView = ''; return; }
    const F = (HX && HX.final) || S.final;
    if (!F) return;
    const view = finaleElapsed() < 12000 ? 'podium' : 'results';
    const key = `${view}:${S.stage}:${F.ranking.map((r) => r.id + r.floors).join(',')}:${(HX.final && HX.final.missed || []).length}`;
    if (finaleView === key || (view === 'podium' && finaleView === 'podium')) return;
    finaleView = view === 'podium' ? 'podium' : key;
    const box = $('#finaleContent');
    const top = F.ranking.slice(0, 3);
    if (view === 'podium') {
      const order = [top[1], top[0], top[2]];
      box.innerHTML = `<div class="reveal">
        <h1>🏆 The winners of HappyTown are…</h1>
        <div class="podium">${order.map((r) => {
          if (!r) return '<div class="pod"></div>';
          const step = r === top[2] ? 1 : r === top[1] ? 2 : 3;
          const cls = r === top[0] ? 'r1' : r === top[1] ? 'r2' : 'r3';
          return `<div class="pod ${cls}" data-step="${step}" style="--c:${r.color}">
            <div class="medal">${HT.medal(r.rank)}</div><div class="pav">${esc(r.avatar)}</div>
            <div class="pname">${esc(r.name)}</div><div class="pfloors">${r.floors} floors</div><div class="block">${r.rank}</div></div>`;
        }).join('')}</div>
        <div class="drumroll" id="drumroll">🥁 …</div></div>`;
      revealed = -1;
      finaleStep();
      return;
    }
    const aw = F.awards || {};
    const award = (a, ic, t, unit) => `<div class="award"><div class="ic">${ic}</div><div class="t">${t}</div>
      <div class="n">${a ? `${esc(a.avatar)} ${esc(a.name)}` : '—'}</div><div class="v">${a ? `${a.value} ${unit}` : ''}</div></div>`;
    const board = F.ranking.map((r) => `<li><span class="rk">${HT.medal(r.rank)}</span><span class="av">${esc(r.avatar)}</span>
      <span>${esc(r.name)}</span><span class="acc">${r.correct}/${r.answered} ✓</span><span class="fl">${r.floors} 🏢</span></li>`).join('');
    const missed = ((HX.final && HX.final.missed) || []).map((m) => `<li><span class="mp">${Math.round((100 * m.wrong) / m.asked)}% missed</span>
      <div class="mq">${esc(m.q)}</div><div class="ma">✓ ${esc(m.answer)}</div>${m.explain ? `<div class="mx">${esc(m.explain)}</div>` : ''}</li>`).join('');
    box.innerHTML = `<div class="end-wrap">
        <div class="end-title"><h1>🏆 The winners of HappyTown!</h1>
          <div class="end-actions">${S.stage === 'ended' ? '<button class="btn green" id="againBtn">🔁 Play again</button><button class="btn ghost" id="newBtn">🆕 New room</button>' : ''}</div>
        </div>
        <div>
          <div class="mini-podium">${top.map((r) => `<div><span>${HT.medal(r.rank)}</span><span class="av">${esc(r.avatar)}</span><span>${esc(r.name)}</span><span>${r.floors} 🏢</span></div>`).join('')}</div>
          <div class="awards">
            ${award(aw.builder, '🏗️', 'Master Builder', 'floors built')}
            ${award(aw.destroyer, '💣', 'Top Bomber', 'floors destroyed')}
            ${award(aw.defender, '🛡️', 'Iron Shield', 'damage blocked')}
          </div>
          <h2 style="margin-top:16px">Leaderboard · class accuracy ${F.accuracy}%</h2>
          <ol class="board">${board}</ol>
        </div>
        <div>
          <h2>📚 Let's review: most-missed questions</h2>
          ${missed ? `<ul class="missed">${missed}</ul>` : '<p class="lobby-hint">Nobody missed a question. Impressive!</p>'}
        </div>
      </div>`;
    const again = $('#againBtn');
    if (again) again.onclick = () => socket.emit('host:lobby');
    const nb = $('#newBtn');
    if (nb) nb.onclick = newRoom;
  }

  // Fireworks (canvas particles)
  const fw = {
    canvas: $('#fireworks'), ctx: null, parts: [], rockets: [], running: false, last: 0, nextLaunch: 0,
    resize() { const c = this.canvas; c.width = c.clientWidth * devicePixelRatio; c.height = c.clientHeight * devicePixelRatio; },
    launch() {
      const c = this.canvas;
      this.rockets.push({ x: (0.15 + Math.random() * 0.7) * c.width, y: c.height, vy: -(c.height * (0.9 + Math.random() * 0.35)), target: c.height * (0.15 + Math.random() * 0.35), hue: Math.floor(Math.random() * 360) });
    },
    explode(x, y, hue) {
      const n = 60 + Math.floor(Math.random() * 40);
      const sp = this.canvas.height * (0.18 + Math.random() * 0.12);
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n;
        const v = sp * (0.5 + Math.random() * 0.5);
        this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, hue: hue + Math.random() * 30 });
      }
      Sfx.firework();
    },
    burst(n) { for (let i = 0; i < n; i++) setTimeout(() => this.launch(), i * 140); },
    frame(ts) {
      if (!this.running) return;
      const dt = Math.min(0.05, (ts - (this.last || ts)) / 1000);
      this.last = ts;
      const c = this.canvas; const g = this.ctx;
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'lighter';
      if (ts > this.nextLaunch) { this.launch(); this.nextLaunch = ts + 450 + Math.random() * 700; }
      for (const r of this.rockets) {
        r.y += r.vy * dt;
        g.fillStyle = `hsl(${r.hue},100%,75%)`;
        g.fillRect(r.x - 2, r.y - 6, 4, 12);
        if (r.y <= r.target) { r.done = true; this.explode(r.x, r.y, r.hue); }
      }
      this.rockets = this.rockets.filter((r) => !r.done);
      const grav = c.height * 0.35;
      for (const p of this.parts) {
        p.vy += grav * dt; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 0.7;
        g.fillStyle = `hsla(${p.hue},100%,62%,${Math.max(0, p.life)})`;
        g.beginPath(); g.arc(p.x, p.y, 2.2 * devicePixelRatio, 0, Math.PI * 2); g.fill();
      }
      this.parts = this.parts.filter((p) => p.life > 0);
      requestAnimationFrame((t) => this.frame(t));
    }
  };
  function startFireworks() {
    if (fw.running) return;
    fw.ctx = fw.canvas.getContext('2d');
    fw.running = true;
    requestAnimationFrame(() => { fw.resize(); fw.burst(4); requestAnimationFrame((t) => fw.frame(t)); });
  }
  function stopFireworks() { fw.running = false; fw.parts = []; fw.rockets = []; }
  window.addEventListener('resize', () => { if (fw.running) fw.resize(); });

  // -------------------------------------------------------------------------
  // Admin panel (press A)
  // -------------------------------------------------------------------------
  function openAdmin(tab) {
    if (tab) adminTab = tab;
    $('#admin').hidden = false;
    renderAdmin(true);
  }
  function closeAdmin() { $('#admin').hidden = true; editing = null; }
  $('#adminFab').onclick = () => ($('#admin').hidden ? openAdmin() : closeAdmin());
  $('#adminClose').onclick = closeAdmin;
  $('#adminTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { adminTab = b.dataset.tab; renderAdmin(true); } };
  $$('[data-open]').forEach((b) => { b.onclick = () => openAdmin(b.dataset.open); });

  function renderAdmin(fresh) {
    if (!S) return;
    $$('#adminTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === adminTab));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== adminTab; });
    if (adminTab === 'game') renderGameTab(fresh);
    if (adminTab === 'players') renderPlayers();
    if (adminTab === 'questions' && fresh) loadBank();
    if (adminTab === 'rules' && fresh) fillRules(S.rules);
    if (adminTab === 'log' && fresh) renderLog();
  }

  // ---- Game tab ----
  const SETTING_FIELDS = [
    ['sP1', 'p1Sec', 60], ['sP2', 'p2Sec', 60], ['sP3', 'p3Sec', 60], ['sFin', 'finaleSec', 1], ['sIntro', 'introSec', 1],
    ['sQ1', 'p1QSec', 1], ['sQ2', 'setQSec', 1], ['sWrong', 'wrongSec', 1], ['sThrow', 'throwSec', 1], ['sChoose', 'chooseSec', 1],
    ['sC1', 'p1Cap', 1], ['sC2', 'p2Cap', 1], ['sC3', 'p3Cap', 1]
  ];
  function fillSettings(s) {
    for (const [id, key, div] of SETTING_FIELDS) $('#' + id).value = Math.round((s[key] / div) * 100) / 100;
    $('#sShuffle').checked = !!s.shuffle;
    $('#sMix').checked = !!s.mix;
  }
  function renderGameTab(fresh) {
    $('#pauseBtn').textContent = S.paused ? '▶ Resume' : '⏸ Pause';
    $('#soundBtn').textContent = Sfx.on ? '🔊 Sound on' : '🔇 Sound off';
    const note = {
      lobby: 'Skip and End are available once the game has started.',
      intro: `Skip starts Phase ${S.phase} now.`,
      play: `Skip ends Phase ${S.phase} now${S.phase < 3 ? ' and moves to the next phase' : ' and starts the finale'}.`,
      finale: 'Skip jumps to the results.',
      ended: 'The game is over. Use Back to lobby to play again with the same players.'
    }[S.stage] || '';
    $('#skipNote').textContent = note;
    if (fresh) fillSettings(S.settings);
  }
  $('#pauseBtn').onclick = () => socket.emit('host:pause');
  $('#skipBtn').onclick = () => socket.emit('host:skip');
  $('#endBtn').onclick = () => { if (confirm('End the game now and go to the finale?')) socket.emit('host:end'); };
  $('#lobbyBtn').onclick = () => { if (S.stage === 'lobby' || confirm('Go back to the lobby? Floors are reset, players stay.')) socket.emit('host:lobby'); };
  $('#newRoomBtn').onclick = newRoom;
  $('#soundBtn').onclick = () => { Sfx.on = !Sfx.on; store.set('ht:sound', Sfx.on); if (Sfx.on) Sfx.pop(); renderGameTab(false); };
  $('#fsBtn').onclick = toggleFullscreen;
  $('#saveSettings').onclick = () => {
    const settings = { shuffle: $('#sShuffle').checked, mix: $('#sMix').checked };
    for (const [id, key, div] of SETTING_FIELDS) settings[key] = Number($('#' + id).value) * div;
    socket.emit('host:settings', { settings }, (res) => {
      if (!res || !res.ok) return toast('Could not save settings');
      store.set('ht:settings3', res.settings);
      fillSettings(res.settings);
      toast(S.stage === 'play' ? 'Saved: timers apply from the next phase' : 'Settings saved');
    });
  };
  $('#defaultSettings').onclick = () => {
    store.del('ht:settings3');
    const d = { p1Sec: 120, p2Sec: 300, p3Sec: 360, finaleSec: 60, introSec: 8, p1QSec: 15, setQSec: 20, wrongSec: 3, throwSec: 5, chooseSec: 5, p1Cap: 18, p2Cap: 9, p3Cap: 10, shuffle: true, mix: true };
    fillSettings(d);
    toast('Defaults loaded: press Save settings');
  };
  function newRoom() {
    if (S && S.players.some((p) => !p.isBot) && !confirm('Start a new room? Players will need the new PIN.')) return;
    store.del('ht:host2');
    session = null;
    stopFireworks();
    createRoom();
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  }

  // ---- Damage tab: bomb damage, shield and floors ----
  const RULE_FIELDS = [
    ['rP1Floor', 'p1', 'floor'],
    ['rP2Floor', 'p2', 'floor'], ['rP2Dmg', 'p2', 'dmg'], ['rP2Step', 'p2', 'step'], ['rP2Max', 'p2', 'maxStacks'],
    ['rP3Floor', 'p3', 'floor'], ['rP3Mega', 'p3', 'mega'], ['rP3Mini', 'p3', 'mini'], ['rP3MiniStep', 'p3', 'miniStep'],
    ['rP3MiniMax', 'p3', 'maxMiniStacks'], ['rP3Shield', 'p3', 'shieldHp']
  ];
  function fillRules(r) {
    for (const [id, ph, k] of RULE_FIELDS) $('#' + id).value = r[ph][k];
    rulesPreview();
  }
  function readRules() {
    const r = { p1: {}, p2: {}, p3: {} };
    for (const [id, ph, k] of RULE_FIELDS) r[ph][k] = Number($('#' + id).value);
    return r;
  }
  function rulesPreview() {
    const r = readRules();
    const ok = (x) => Number.isFinite(x);
    const fl = (n) => `${n} floor${n === 1 ? '' : 's'}`;
    if ([r.p2.dmg, r.p2.step, r.p2.maxStacks].every(ok)) {
      $('#rP2Prev').textContent = `Bomb: ${HT.steps(r.p2.dmg, r.p2.step, Math.max(1, r.p2.maxStacks))}` +
        ` · a perfect set gives +${fl(r.p2.floor)} and a bomb`;
    }
    if ([r.p3.mega, r.p3.mini, r.p3.miniStep, r.p3.maxMiniStacks].every(ok)) {
      const maxMini = r.p3.mini + r.p3.miniStep * (Math.max(1, r.p3.maxMiniStacks) - 1);
      const mega = r.p3.mega;
      $('#rP3Prev').textContent = `Mini: ${HT.steps(r.p3.mini, r.p3.miniStep, Math.max(1, r.p3.maxMiniStacks))} · full arsenal Mega ${mega} + Mini ${maxMini} = ${mega + maxMini}` +
        ` · a Mega on a shield destroys ${Math.max(0, mega - r.p3.shieldHp)}`;
    }
  }
  $('#rulesForm').addEventListener('input', rulesPreview);
  $('#rulesForm').addEventListener('submit', (e) => e.preventDefault());
  $('#saveRules').onclick = () => {
    socket.emit('host:rules', { rules: readRules() }, (res) => {
      if (!res || !res.ok) return toast('Could not save the rules');
      store.set('ht:rules1', res.rules);
      fillRules(res.rules);
      toast(S && S.stage === 'play' ? 'Saved: the new numbers apply right now' : 'Damage and floors saved');
    });
  };
  $('#defaultRules').onclick = () => {
    if (!confirm('Go back to the default damage and floors?')) return;
    socket.emit('host:rules', { reset: true }, (res) => {
      if (!res || !res.ok) return toast('Could not reset the rules');
      store.del('ht:rules1');
      fillRules(res.rules);
      toast('Default damage and floors restored');
    });
  };

  // ---- Players tab ----
  function renderPlayers() {
    const roster = new Map((HX.roster || []).map((r) => [r.id, r]));
    $('#pCount').textContent = `(${S.players.length})`;
    const rows = HT.ranked(S.players).map((p) => {
      const r = roster.get(p.id) || {};
      const status = p.isBot ? '🤖 bot' : p.connected ? '<span class="st-on">● online</span>' : '<span class="st-off">● offline</span>';
      return `<tr><td>${esc(p.avatar)}</td><td class="nm">${esc(p.name)}</td><td class="sid">${esc(r.sid || '—')}</td><td>${status}</td>
        <td>${p.floors}</td><td>${p.correct}/${p.answered}</td>
        <td class="acts">${!p.isBot && r.socket ? `<button class="reset" data-reset="${p.id}" title="Disconnect this device so the student can rejoin elsewhere">Reset</button>` : ''}<button class="kick" data-kick="${p.id}">Kick</button></td></tr>`;
    }).join('');
    const tb = $('#pRows');
    if (tb.dataset.h !== rows) { tb.innerHTML = rows || '<tr><td colspan="7">No players yet.</td></tr>'; tb.dataset.h = rows; }
  }
  $('#pRows').onclick = (e) => {
    const k = e.target.closest('[data-kick]');
    const r = e.target.closest('[data-reset]');
    const p = S.players.find((x) => x.id === (k ? k.dataset.kick : r ? r.dataset.reset : ''));
    if (!p) return;
    if (k && confirm(`Remove ${p.name} from the town? Their house disappears.`)) socket.emit('host:kick', { id: p.id });
    if (r) socket.emit('host:reset', { id: p.id }, () => toast(`${p.name} can now rejoin with their Student ID`));
  };

  // ---- Questions tab ----
  function loadBank(cb) {
    socket.emit('host:bank', null, (res) => {
      if (!res || !res.ok) return;
      bankCache = res.bank;
      renderQList();
      if (cb) cb();
    });
  }
  function renderQList() {
    if (!bankCache) return;
    const q = $('#qSearch').value.trim().toLowerCase();
    const lv = $('#qFilter').value;
    const list = bankCache.filter((x) => (!lv || x.level === lv) && (!q || x.q.toLowerCase().includes(q) || x.options.some((o) => o.toLowerCase().includes(q))));
    $('#qList').innerHTML = list.slice(0, 200).map((x) => `<button class="q-item" data-qid="${x.id}"><span class="lv ${x.level}">${x.level}</span>
      <span class="qt">#${x.id} ${esc(x.q)}<span class="qa">✓ ${esc(x.options[x.answer])}</span></span></button>`).join('') ||
      '<p class="note">No questions match.</p>';
    renderEditor();
  }
  function renderEditor() {
    const box = $('#qEditor');
    if (!editing) { box.innerHTML = ''; return; }
    const e = editing;
    const opts = [0, 1, 2, 3].map((i) => e.options[i] || '');
    box.innerHTML = `<div class="admin-sec q-edit" style="border:2px solid var(--blue)">
      <b>${e.id ? `Edit question #${e.id}` : 'New question'}</b>
      <textarea id="eQ" placeholder="Question">${esc(e.q)}</textarea>
      ${opts.map((o, i) => `<label class="opt-row"><span>${'ABCD'[i]}</span><input type="radio" name="eAns" value="${i}" ${e.answer === i ? 'checked' : ''} title="Correct answer">
        <input type="text" id="eO${i}" value="${esc(o)}" placeholder="${i < 2 ? 'Option (required)' : 'Option (optional)'}"></label>`).join('')}
      <textarea id="eX" placeholder="Explanation shown after a wrong answer (optional)" style="min-height:50px">${esc(e.explain || '')}</textarea>
      <div class="row"><select id="eL"><option value="easy" ${e.level === 'easy' ? 'selected' : ''}>Easy (Phase 1)</option><option value="hard" ${e.level !== 'easy' ? 'selected' : ''}>Hard (Phases 2–3)</option></select>
        <span style="flex:1"></span><button class="btn small ghost" id="eCancel">Cancel</button><button class="btn small green" id="eSave">Save</button></div>
      <div class="status" id="eStatus"></div></div>`;
    $('#eCancel').onclick = () => { editing = null; renderEditor(); };
    $('#eSave').onclick = saveQuestion;
    box.scrollIntoView({ block: 'nearest' });
  }
  function saveQuestion() {
    const raw = [0, 1, 2, 3].map((i) => $('#eO' + i).value.trim());
    const checked = document.querySelector('input[name="eAns"]:checked');
    const ans = checked ? Number(checked.value) : -1;
    const options = [];
    let answer = -1;
    raw.forEach((o, i) => { if (o) { if (i === ans) answer = options.length; options.push(o); } });
    const st = $('#eStatus');
    if (!$('#eQ').value.trim() || options.length < 2) { st.className = 'status err'; st.textContent = 'Write the question and at least 2 options.'; return; }
    if (answer < 0) { st.className = 'status err'; st.textContent = 'Tick the correct option (it must not be empty).'; return; }
    const question = { q: $('#eQ').value.trim(), options, answer, explain: $('#eX').value.trim(), level: $('#eL').value };
    socket.emit('host:question', { id: editing.id || null, question }, (res) => {
      if (!res || !res.ok) { st.className = 'status err'; st.textContent = (res && res.error) || 'Could not save'; return; }
      toast(editing.id ? `Question #${res.id} updated` : `Question #${res.id} added`);
      editing = null;
      loadBank(rememberBank);
    });
  }
  function rememberBank() {
    if (bankCache) store.set('ht:bank3', bankCache.map(({ q, options, answer, explain, level }) => ({ q, options, answer, explain, level })));
  }
  $('#qSearch').oninput = renderQList;
  $('#qFilter').onchange = renderQList;
  $('#qAdd').onclick = () => { editing = { id: null, q: '', options: ['', '', '', ''], answer: 0, explain: '', level: 'hard' }; renderEditor(); };
  $('#qList').onclick = (e) => {
    const b = e.target.closest('[data-qid]');
    if (!b) return;
    const x = bankCache.find((q) => q.id === Number(b.dataset.qid));
    if (x) { editing = JSON.parse(JSON.stringify(x)); renderEditor(); }
  };

  // Spreadsheet import / export
  function parseDelimited(text) {
    const delim = text.includes('\t') ? '\t' : ',';
    const rows = [];
    let row = []; let cell = ''; let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
      } else if (ch === '"' && cell === '') inQ = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  // Column positions. Without a header row the order is Question | A | B | C | D | Correct | Explanation | Level.
  // A header row is read to find the columns, so a sheet laid out like HappyTown_Questions.xlsx
  // (No. | Phase | Topic | Question | Option A–D | Correct Answer) can be pasted as it is.
  const DEFAULT_MAP = { q: 0, opts: [1, 2, 3, 4], corr: 5, explain: 6, level: 7 };
  function columnMap(head) {
    const find = (re) => head.findIndex((h) => re.test(h));
    const m = {
      q: find(/^(question|câu hỏi)\b/i),
      opts: ['a', 'b', 'c', 'd'].map((x) => find(new RegExp(`^(option|answer|choice|đáp án|lựa chọn)?\\s*${x}$`, 'i'))),
      corr: find(/correct|đáp án đúng|^answer$/i),
      explain: find(/explan|giải thích/i),
      level: find(/^(level|phase|difficulty|độ khó|giai đoạn)$/i)
    };
    return m.q >= 0 && m.opts[0] >= 0 && m.opts[1] >= 0 && m.corr >= 0 ? m : null;
  }
  const levelOf = (x) => (/^e|^phase\s*1\b|^p?1$|^dễ/i.test(String(x || '').trim()) ? 'easy' : 'hard');
  function parseBank(text) {
    const out = []; const errors = [];
    let map = null;
    parseDelimited(text).forEach((cols, i) => {
      cols = cols.map((c) => (c || '').trim());
      if (cols.every((c) => !c)) return;
      if (!map && !out.length && cols.some((c) => /^(question|câu hỏi)$/i.test(c))) { map = columnMap(cols) || DEFAULT_MAP; return; } // header row
      const m = map || DEFAULT_MAP;
      const get = (k) => (k >= 0 ? cols[k] || '' : '');
      const q = get(m.q);
      const [a, b, c, d] = m.opts.map(get);
      const corrRaw = get(m.corr);
      const explain = get(m.explain);
      const levelRaw = get(m.level);
      const corr = corrRaw.toUpperCase();
      let idx = corr.length === 1 ? 'ABCD'.indexOf(corr) : -1;
      if (idx < 0 && /^[1-4]$/.test(corr)) idx = Number(corr) - 1;
      const raw = [a, b, c, d];
      if (idx < 0 && corrRaw) idx = raw.findIndex((o) => o && o.toLowerCase() === corrRaw.toLowerCase());
      if (!q) { errors.push(`row ${i + 1}: missing question`); return; }
      const options = []; let answer = -1;
      raw.forEach((o, k) => { if (o) { if (k === idx) answer = options.length; options.push(o); } });
      if (options.length < 2) { errors.push(`row ${i + 1}: needs at least 2 options`); return; }
      if (answer < 0) { errors.push(`row ${i + 1}: correct answer must be A, B, C or D`); return; }
      out.push({ q, options, answer, explain, level: levelOf(levelRaw) });
    });
    return { out, errors };
  }
  function bankToText(bank) {
    const cell = (s) => { s = String(s || '').replace(/[\t\r\n]+/g, ' '); return /^"/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct', 'Explanation', 'Level'].join('\t');
    return [head, ...bank.map((q) => [q.q, ...[0, 1, 2, 3].map((k) => q.options[k] || ''), 'ABCD'[q.answer], q.explain || '', q.level === 'easy' ? 'Easy' : 'Hard'].map(cell).join('\t'))].join('\n');
  }
  function bulkStatus() {
    const { out, errors } = parseBank($('#bulkText').value);
    const st = $('#bulkStatus');
    const easy = out.filter((q) => q.level === 'easy').length;
    st.className = 'status ' + (errors.length || out.length < 3 ? 'err' : 'okk');
    st.textContent = `${out.length} questions ready (${easy} easy, ${out.length - easy} hard)` + (out.length < 3 ? ' — need at least 3' : '') +
      (errors.length ? ` · ${errors.length} row(s) skipped: ${errors.slice(0, 2).join('; ')}${errors.length > 2 ? '…' : ''}` : '');
  }
  $('#bulkText').oninput = bulkStatus;
  $('#bulkLoad').onclick = () => loadBank(() => { $('#bulkText').value = bankToText(bankCache); bulkStatus(); });
  $('#bulkCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#bulkText').value); toast('Copied: paste it into a spreadsheet'); }
    catch (e) { $('#bulkText').select(); document.execCommand('copy'); toast('Copied'); }
  };
  $('#bulkReplace').onclick = () => {
    const { out } = parseBank($('#bulkText').value);
    if (out.length < 3) return toast('Need at least 3 valid questions');
    socket.emit('host:bankReplace', { bank: out }, (res) => {
      if (!res || !res.ok) return toast((res && res.error) || 'Could not replace the bank');
      toast(`${res.size} questions loaded`);
      loadBank(rememberBank);
    });
  };
  $('#bulkDefault').onclick = () => {
    if (!confirm('Go back to the default question bank?')) return;
    socket.emit('host:bankReplace', { bank: null }, (res) => {
      if (!res || !res.ok) return toast((res && res.error) || 'Could not reset the bank');
      store.del('ht:bank3');
      toast(`Default bank loaded (${res.size} questions)`);
      loadBank(() => { $('#bulkText').value = bankToText(bankCache); bulkStatus(); });
    });
  };

  // ---- Log tab ----
  function renderLog() {
    const onlyCombat = $('#logCombat').checked;
    const items = (HX.log || []).filter((l) => !onlyCombat || l.kind === 'combat').slice(-150).reverse();
    $('#logList').innerHTML = items.map((l) => `<li class="k-${l.kind}"><span class="seq">#${l.seq}</span><span class="tm">${HT.fmtStamp(l.t)}</span><span>${esc(l.text)}</span></li>`).join('') ||
      '<li><span></span><span></span><span>Nothing yet.</span></li>';
  }
  $('#logCombat').onchange = renderLog;

  // -------------------------------------------------------------------------
  // Lobby buttons & hotkeys
  // -------------------------------------------------------------------------
  $('#startBtn').onclick = () => {
    Sfx.ensure();
    socket.emit('host:start', null, (res) => { if (!res || !res.ok) toast(res && res.error === 'no_players' ? 'Wait for at least one player' : 'Could not start'); });
  };
  $('#botBtn').onclick = () => socket.emit('host:addBots', { n: 1 });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Escape') { if (!$('#admin').hidden) closeAdmin(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'a') { e.preventDefault(); $('#admin').hidden ? openAdmin() : closeAdmin(); }
    else if (k === 'p' && S && S.stage !== 'lobby') { e.preventDefault(); socket.emit('host:pause'); }
    else if (k === 'f') { e.preventDefault(); toggleFullscreen(); }
  });

  let toastTimer = null;
  function toast(msg) {
    let t = $('.toast-host');
    if (!t) { t = document.createElement('div'); t.className = 'toast-host'; document.body.appendChild(t); }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2600);
  }

  computeJoinBase();
})();
