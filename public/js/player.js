/* HappyTown v2 — player phone screen (landscape) */
(function () {
  const { $, esc, store, clock } = HT;
  const socket = io();
  const params = new URLSearchParams(location.search);
  const L = {
    session: store.get('ht:player2', null), // { code, token }
    joined: false,
    busy: false,
    screenKey: '',
    joinError: '',
    avatar: store.get('ht:avatar', null),
    bannerN: null,
    bannerUntil: 0,
    seenHit: null, // id of the last bomb hit already shown on this phone
    lastHitAt: 0,
    resTab: 'rank', // results screen: rank | hits | review
    rvAnswer: null // my answer in the current revenge duel { key, choice, correct, ms }
  };
  if (!HT.AVATARS.includes(L.avatar)) L.avatar = HT.AVATARS[Math.floor(Math.random() * HT.AVATARS.length)];
  let S = null; // shared state (town, phase, timers)
  let me = null; // my own state
  const main = $('#main');
  const mini = new HT.Town($('#miniTown'), { compact: true });
  const LETTERS = 'ABCD';

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------
  socket.on('connect', () => {
    $('#conn').hidden = true;
    const wanted = params.get('room');
    if (L.session && (!wanted || wanted === L.session.code)) {
      socket.emit('player:resume', L.session, (res) => {
        if (res && res.ok) L.joined = true;
        else { L.joined = false; L.session = null; store.del('ht:player2'); }
        render(true);
      });
    } else render(true);
  });
  socket.on('disconnect', () => { if (L.joined) $('#conn').hidden = false; });
  socket.on('kicked', () => leave('You were removed from the town by the host.'));
  socket.on('replaced', () => leave('The host reset your connection. Join again with your Student ID to get your house back.'));
  socket.on('pub', (pub) => {
    if (!L.joined) return;
    clock.sync(pub.vnow);
    S = pub;
    render();
  });
  socket.on('me', (m) => {
    if (!L.joined) return;
    me = m;
    checkHits();
    render();
  });
  socket.on('event', onEvent);

  function leave(msg) {
    L.joined = false;
    L.session = null;
    store.del('ht:player2');
    S = null;
    me = null;
    L.seenHit = null;
    L.joinError = msg || '';
    render(true);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const frozen = () => (S ? S.vnow : 0);
  const personalLeft = () => (me ? HT.left(me.deadline, S && S.paused, frozen()) : 0);
  const phaseLeft = () => (S ? HT.left(S.deadline, S.paused, frozen()) : 0);
  const opponents = () => (S ? S.players.filter((p) => p.id !== me.id) : []);
  const rankOf = (id) => HT.rankOf(S.players, id);

  function setScreen(key, html, after) {
    if (L.screenKey === key) return false;
    L.screenKey = key;
    L.busy = false;
    main.innerHTML = html;
    main.scrollTop = 0;
    if (after) after();
    tick();
    return true;
  }

  function chrome({ hud, mini: showMini }) {
    $('#hud').hidden = !hud;
    document.body.classList.toggle('show-mini', !!showMini);
  }

  function personalTotal() {
    const s = S.settings;
    switch (me.mode) {
      case 'question': return (S.phase === 1 ? s.p1QSec : s.setQSec) * 1000;
      case 'feedback': return s.wrongSec * 1000;
      case 'choose': return s.chooseSec * 1000;
      case 'target': return (s.throwSec + (S.phase === 3 && me.window ? S.rules.p3.secPerMini * (me.window.bombs.length - 1) : 0)) * 1000;
      default: return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  function render(force) {
    if (force) L.screenKey = '';
    const inGame = L.joined && !!S && !!me;
    document.body.classList.toggle('ingame', inGame);
    if (!L.joined) { chrome({}); renderJoin(); return; }
    if (!inGame) return; // joined, waiting for the first update
    $('#pausedOv').hidden = !S.paused;
    document.body.classList.toggle('rv-mode', S.stage === 'revenge');
    mini.setMe(me.id);
    mini.update(S.players);
    updateHud();
    switch (S.stage) {
      case 'lobby': renderLobby(); break;
      case 'intro': renderIntro(); break;
      case 'play': renderPlay(); break;
      case 'revenge': renderRevenge(); break;
      default: renderEnd(); break;
    }
  }

  function updateHud() {
    if (!S.phase) return;
    const ph = HT.PHASES[S.phase];
    const chip = $('#hudPhase');
    chip.className = `chip ${S.stage === 'revenge' ? 'rv' : ph.cls}`;
    chip.textContent = S.stage === 'revenge' ? '💀 Final Revenge' : `${ph.icon} P${S.phase} ${ph.short}`;
    $('#hudFloors').textContent = me.floors;
    $('#hudRank').textContent = `#${rankOf(me.id)}/${S.players.length}`;
    const w = me.bomb ? `💣 ${me.bomb.dmg}` : me.arsenal ? `💣 ${me.arsenal.miniStacks ? `${S.rules.p3.mega}+${me.arsenal.mini}` : me.arsenal.dmg}` : '';
    $('#hudBomb').hidden = !w;
    $('#hudBomb').textContent = w;
    $('#hudShield').hidden = !me.shield;
    if (me.shield) $('#hudShield').textContent = `🛡️ ${me.shield.hp}`;
    $('#hudAv').textContent = me.avatar;
    const pr = me.progress;
    $('#hudProg').textContent = S.stage !== 'play' ? '' : S.phase === 1 ? `Question ${Math.min(pr.done + 1, pr.cap)}/${pr.cap}` : `Set ${Math.min(pr.done + 1, pr.cap)}/${pr.cap}`;
    $('#miniCap').textContent = `You: ${me.floors} 🏢 · #${rankOf(me.id)}`;
    // the last bomb that hit me stays in the status bar for 30 seconds
    const last = me.hits && me.hits[me.hits.length - 1];
    const hh = $('#hudHit');
    const showHit = last && S.stage === 'play' && Date.now() - L.lastHitAt < 30000;
    hh.hidden = !showHit;
    if (showHit) {
      hh.textContent = `💥 ${last.fromAvatar} ${last.fromName} ${last.lost ? `−${last.lost}` : '🛡️'}`;
      hh.title = `Last bomb: ${last.fromName}`;
    }
  }

  function tick() {
    if (!S || !me || !L.joined) return;
    const pl = phaseLeft();
    const ht = $('#hudTime');
    if (ht) {
      ht.textContent = S.paused ? '⏸' : HT.fmtClock(pl);
      ht.classList.toggle('urgent', S.stage === 'play' && pl < 20000);
    }
    const total = personalTotal();
    const left = personalLeft();
    const frac = total ? Math.max(0, Math.min(1, left / total)) : 0;
    for (const el of document.querySelectorAll('.js-bar')) el.style.width = (frac * 100).toFixed(1) + '%';
    for (const el of document.querySelectorAll('.js-cd')) el.textContent = Math.ceil(left / 1000);
    if (S.stage === 'revenge' && S.rv) { // revenge steps count down with the step clock
      const rf = Math.max(0, Math.min(1, pl / (S.rv.ms || 1)));
      for (const el of document.querySelectorAll('.js-rvbar')) el.style.width = (rf * 100).toFixed(1) + '%';
      for (const el of document.querySelectorAll('.js-rvcd')) el.textContent = S.paused ? '⏸' : Math.ceil(pl / 1000);
    }
    const ic = $('#introCd');
    if (ic) ic.textContent = S.paused ? 'Paused' : `Starting in ${Math.ceil(pl / 1000)}s…`;
    const ban = $('#banner');
    if (ban && Date.now() > L.bannerUntil) ban.classList.add('gone');
    if ($('#finaleWait') && !inFinaleReveal()) render(true);
    const hh = $('#hudHit');
    if (hh && !hh.hidden && Date.now() - L.lastHitAt >= 30000) hh.hidden = true;
  }
  setInterval(tick, 100);

  // ---- Join ----
  function renderJoin() {
    $('#pausedOv').hidden = true;
    const code = params.get('room') || (L.session && L.session.code) || '';
    const fresh = setScreen('join', `
      <section class="join">
        <div class="join-hero">
          <div class="ic">🏡</div>
          <h1>HappyTown</h1>
          <p>Answer right. Build high. Bomb wisely.</p>
        </div>
        <form class="join-form card" id="joinForm" autocomplete="off">
          <div class="row2">
            <div class="field"><label for="jCode">Game PIN</label>
              <input id="jCode" class="code" inputmode="numeric" maxlength="6" placeholder="0000" value="${esc(code)}"></div>
            <div class="field"><label for="jSid">Student ID</label>
              <input id="jSid" maxlength="24" placeholder="e.g. 2251010123" value="${esc(store.get('ht:sid', ''))}" autocapitalize="characters"></div>
          </div>
          <div class="field"><label for="jName">Your name (shown on the big screen)</label>
            <input id="jName" maxlength="16" placeholder="e.g. Linh" value="${esc(store.get('ht:name', ''))}"></div>
          <div class="field"><label>Pick your avatar</label>
            <div class="avatars" id="avatars">${HT.AVATARS.map((a) => `<button type="button" class="av-btn ${a === L.avatar ? 'on' : ''}" data-av="${a}">${a}</button>`).join('')}</div></div>
          <p class="err-msg" id="joinErr"></p>
          <button class="btn big green" id="joinBtn">Join the town ▶</button>
          <p class="join-note">Lost connection? Join again with the <b>same Student ID</b> and your house comes back.</p>
        </form>
      </section>`, () => {
      $('#joinForm').onsubmit = (e) => { e.preventDefault(); join(); };
      $('#avatars').onclick = (e) => {
        const b = e.target.closest('[data-av]');
        if (!b) return;
        L.avatar = b.dataset.av;
        document.querySelectorAll('.av-btn').forEach((x) => x.classList.toggle('on', x === b));
      };
      const sel = document.querySelector('.av-btn.on');
      const row = $('#avatars');
      if (sel) row.scrollLeft = sel.offsetLeft - row.offsetLeft - row.clientWidth / 2 + sel.clientWidth / 2;
    });
    if (fresh || L.joinError) $('#joinErr').textContent = L.joinError;
  }

  function goLandscape() {
    // Android Chrome can lock the orientation in full screen; iPhones show the "turn your phone" hint instead.
    try {
      const el = document.documentElement;
      const req = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
      if (req && req.then) {
        req.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {});
      }
    } catch (e) { /* not supported */ }
  }

  function join() {
    const code = $('#jCode').value.trim();
    const sid = $('#jSid').value.trim();
    const name = $('#jName').value.trim();
    const err = $('#joinErr');
    if (!/^\d{4,6}$/.test(code)) { err.textContent = 'Enter the PIN from the big screen.'; return; }
    if (!sid) { err.textContent = 'Enter your Student ID.'; return; }
    if (!name) { err.textContent = 'Enter your name.'; return; }
    store.set('ht:name', name);
    store.set('ht:sid', sid);
    store.set('ht:avatar', L.avatar);
    goLandscape();
    $('#joinBtn').disabled = true;
    socket.emit('player:join', { code, name, sid, avatar: L.avatar }, (res) => {
      $('#joinBtn').disabled = false;
      if (!res || !res.ok) { L.joinError = (res && res.error) || 'Could not join.'; err.textContent = L.joinError; return; }
      L.joinError = '';
      L.seenHit = null;
      L.session = { code, token: res.token };
      store.set('ht:player2', L.session);
      L.joined = true;
      if (params.get('room') !== code) history.replaceState(null, '', `/?room=${code}`);
      if (res.restored) setTimeout(() => toast(`🔁 Welcome back, ${res.name}! Your ${res.floors}-floor house is restored.`, 'good'), 300);
      main.innerHTML = '<section class="center-screen"><div class="card center"><div class="big-emoji">🏗️</div><p class="p-title">Joining…</p></div></section>';
      L.screenKey = 'joining';
    });
  }

  // ---- Lobby ----
  function renderLobby() {
    chrome({ hud: false, mini: true });
    setScreen(`lobby:${me.name}:${me.avatar}:${S.settings.p1Sec}:${S.settings.p2Sec}:${S.settings.p3Sec}:${S.rules.p1.floor}`, `
      <section class="lobby">
        <div class="card center">
          <div class="lobby-av">${me.avatar}</div>
          <div class="p-title">You're in, ${esc(me.name)}!</div>
          <p class="p-sub">Find your house on the big screen. ⏳ Waiting for the host to start… <b id="lobbyN"></b></p>
        </div>
        <div class="card phase-list">
          <div><span>🌱</span><b>${minLabel(S.settings.p1Sec)}</b> Each right answer = ${S.rules.p1.floor} floor${S.rules.p1.floor === 1 ? '' : 's'}</div>
          <div><span>⚡</span><b>${minLabel(S.settings.p2Sec)}</b> Sets of 3 · perfect set = 💣</div>
          <div><span>♟️</span><b>${minLabel(S.settings.p3Sec)}</b> Mega Bomb or Shield · tallest wins</div>
        </div>
        <button class="link-btn" id="leaveBtn">Leave this town</button>
      </section>`, () => {
      $('#leaveBtn').onclick = () => socket.emit('player:leave', null, () => leave(''));
    });
    const n = $('#lobbyN');
    if (n) n.textContent = `(${S.players.length} in town)`;
  }

  function minLabel(sec) {
    const m = sec / 60;
    return `${Number.isInteger(m) ? m : m.toFixed(1)} min`;
  }

  // ---- Intro (rules) ----
  function renderIntro() {
    chrome({ hud: true, mini: false });
    const ph = HT.PHASES[S.phase];
    setScreen(`intro:${S.phase}`, `
      <section class="intro ${ph.cls}">
        <div class="intro-head">
          <div class="intro-kicker">Phase ${S.phase} of 3</div>
          <div class="intro-title">${ph.icon} ${esc(ph.name)}</div>
          <p class="intro-cd" id="introCd"></p>
        </div>
        <ul class="intro-rules">${HT.rules(S.phase, S.settings, S.rules).map(([i, t]) => `<li><span>${i}</span><div>${t}</div></li>`).join('')}</ul>
      </section>`);
  }

  // ---- Play ----
  function renderPlay() {
    switch (me.mode) {
      case 'question': renderQuestion(); break;
      case 'feedback': renderFeedback(); break;
      case 'choose': renderChoose(); break;
      case 'target': renderTarget(); break;
      case 'capped': renderCapped(); break;
      default: renderWaiting(); break;
    }
  }

  function bannerText(r) {
    if (!r) return '';
    const parts = [`<b>Set ${r.correct}/${r.size}</b>`];
    if (r.floors) parts.push(`+${r.floors} 🧱`);
    if (r.bomb === 'new') parts.push(r.action === 'hold' ? '💣 bomb held' : r.action === 'thrown' ? '💣 bomb thrown' : '💣 bomb earned');
    if (r.bomb === 'charged') parts.push(r.action === 'hold' ? `🔋 bomb charged to ${r.dmg}` : `💣 ${r.dmg}-damage bomb thrown`);
    if (r.item === 'shield') parts.push('🛡️ shield up');
    if (r.item === 'mega') parts.push(r.action === 'hold' ? '💣 Mega Bomb held' : '💣 Mega Bomb thrown');
    if (r.item === 'mini' || r.item === 'maxed') {
      parts.push(r.action === 'hold' ? (r.item === 'maxed' ? `🔋 Mini Bomb at max (${r.mini})` : `🔋 Mini Bomb now ${r.mini}`) : '💥 Mega + Mini thrown');
    }
    if (r.lost) parts.push(`💨 your bomb${r.lostN > 1 ? 's' : ''} (${r.lost} damage) ${r.lostN > 1 ? 'were' : 'was'} lost`);
    if (!r.floors && !r.bomb && !r.item && !r.lost) parts.push('no floor this time');
    return parts.join(' · ');
  }

  function dotsHtml(active) {
    if (S.phase === 1) return '';
    const dots = [];
    for (let i = 0; i < S.setSize; i++) {
      const s = me.set[i];
      dots.push(`<i class="${s ? (s.correct ? 'ok' : 'no') : i === active ? 'cur' : ''}"></i>`);
    }
    return `<div class="q-dots">${dots.join('')}</div>`;
  }

  function sizeClass(text) {
    return text.length > 170 ? 'xlong' : text.length > 105 ? 'long' : '';
  }

  function maybeBanner() {
    if (S.phase === 1 || !me.last || me.last.n === L.bannerN) return '';
    L.bannerN = me.last.n;
    L.bannerUntil = Date.now() + 3200;
    return `<div class="result-banner" id="banner">${bannerText(me.last)}</div>`;
  }

  function optionsHtml(q, answered) {
    const cls = `opts n${q.options.length} ${q.two ? 'two' : ''} ${answered ? 'answered' : ''}`;
    return `<div class="${cls}" id="opts">${q.options.map((o, i) => {
      let st = '';
      if (answered) st = i === q.correctChoice ? 'right' : i === q.choice ? 'wrong' : '';
      return `<button class="opt ${st}" data-i="${i}"><span class="L">${q.two ? (i === 0 ? '✔' : '✖') : LETTERS[i]}</span><span class="t">${esc(o)}</span></button>`;
    }).join('')}</div>`;
  }

  function renderQuestion() {
    chrome({ hud: true, mini: false });
    const q = me.q;
    if (!q) return;
    const slot = me.set.length;
    setScreen(`q:${q.key}:${q.rev}`, `
      <section class="qa">
        <div class="q-left">
          ${maybeBanner()}
          <div class="q-meta">
            <span class="q-tag">${S.phase === 1 ? '🌱 Warm-up' : `Question ${slot + 1} of ${S.setSize}`}</span>
            ${dotsHtml(slot)}
          </div>
          ${q.repeat ? '<div class="repeat-tag">🔁 Second chance: you missed this one before</div>' : ''}
          <div class="q-card"><p class="q-text ${sizeClass(q.text)}">${esc(q.text)}</p></div>
          <div class="q-timer"><i class="js-bar"></i></div>
        </div>
        ${optionsHtml(q, false)}
      </section>`, () => {
      $('#opts').onclick = (e) => {
        const b = e.target.closest('.opt');
        if (!b || L.busy || S.paused) return;
        L.busy = true;
        b.classList.add('picked');
        socket.emit('answer', { key: q.key, choice: Number(b.dataset.i) }, (res) => {
          if (!res || !res.ok) { L.busy = false; b.classList.remove('picked'); return; }
          if (res.correct) {
            if (S.phase === 1) flash(S.rules.p1.floor ? `✓ +${S.rules.p1.floor} 🧱` : '✓');
            else if (slot < S.setSize - 1) flash('✓');
            if (navigator.vibrate) navigator.vibrate(25);
          } else if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
        });
      };
    });
  }

  function renderFeedback() {
    chrome({ hud: true, mini: false });
    const f = me.fb;
    if (!f) return;
    setScreen(`fb:${f.key}:${f.rev}`, `
      <section class="qa">
        <div class="q-left">
          <div class="q-meta"><span class="q-tag">${S.phase === 1 ? 'Warm-up' : `Question ${me.set.length} of ${S.setSize}`}</span>${dotsHtml(-1)}</div>
          <div class="q-card small"><p class="q-text ${sizeClass(f.text)}">${esc(f.text)}</p></div>
          <div class="fb-box">
            <div class="fb-title">${f.timeout ? '⏰ Time\'s up!' : '❌ Not quite!'}</div>
            <div class="fb-ans">✓ ${esc(f.options[f.correctChoice] || '')}</div>
            ${f.explain ? `<div class="fb-ex">💡 ${esc(f.explain)}</div>` : ''}
            <div class="fb-next">🔁 It will come back later · next in <b class="js-cd"></b>s</div>
          </div>
        </div>
        ${optionsHtml(f, true)}
      </section>`);
  }

  function renderChoose() {
    chrome({ hud: true, mini: false });
    const r = S.rules.p3;
    setScreen(`choose:${me.key}`, `
      <section class="choose">
        <div class="choose-head">
          <div><b>🥇 Perfect 3/3!</b> +${r.floor} floors. Now pick one:</div>
          <div class="cd-pill"><b class="js-cd"></b>s</div>
        </div>
        <div class="cbar"><i class="js-bar"></i></div>
        <div class="choose-grid" id="picks">
          <button class="pick shield" data-item="shield"><span class="ic">🛡️</span><span class="t">Shield</span><span class="d">Blocks up to ${r.shieldHp} floors of the next bomb that hits you, then disappears</span></button>
          <button class="pick mega" data-item="mega"><span class="ic">💣</span><span class="t">Mega Bomb</span><span class="d">Destroys ${r.mega} floors. Hold it: your next perfect set adds a Mini Bomb (${r.mini})${r.miniStep > 0 && r.maxMiniStacks > 1 ? ` that grows +${r.miniStep} each set` : ''}</span></button>
        </div>
        <p class="hint">No choice in time = Shield</p>
      </section>`, () => {
      $('#picks').onclick = (e) => {
        const b = e.target.closest('[data-item]');
        if (!b || L.busy) return;
        L.busy = true;
        b.classList.add('picked');
        socket.emit('choose', { item: b.dataset.item }, (res) => { if (!res || !res.ok) L.busy = false; });
      };
    });
  }

  // ---- Throw window (Quick Lock + carousel) ----
  function targetPool() {
    return HT.ranked(opponents()); // any house, the same house twice is allowed
  }

  function renderTarget() {
    chrome({ hud: true, mini: false });
    const w = me.window;
    if (!w) return;
    const volley = w.bombs.length > 1;
    const r2 = S.rules.p2;
    const r3 = S.rules.p3;
    const canGrow = S.phase === 2 ? me.bomb && me.bomb.stacks < r2.maxStacks : me.arsenal && me.arsenal.miniStacks < r3.maxMiniStacks;
    const holdLabel = S.phase === 2
      ? (canGrow ? `Hold · next perfect set → ${me.bomb.dmg + r2.step} damage` : 'Hold (already at max power)')
      : (!canGrow ? 'Hold (fully charged)' : me.arsenal && me.arsenal.miniStacks
        ? `Hold · next perfect set → Mini ${me.arsenal.mini + r3.miniStep}`
        : `Hold · next perfect set adds a Mini Bomb (${r3.mini})`);
    const fresh = setScreen(`target:${me.key}`, `
      <section class="target">
        <div class="t-head">
          <div class="t-title">💣 Throw! <span class="cd-pill"><b class="js-cd"></b>s</span></div>
          <div class="t-bombs" id="tBombs"></div>
          <div class="t-act" id="tAct"></div>
        </div>
        <div class="cbar red"><i class="js-bar"></i></div>
        <div class="quick">
          <div class="quick-lbl">⚡ Quick<br>Lock</div>
          <div class="quick-btns" id="quick"></div>
        </div>
        <div class="carousel" id="carousel"></div>
      </section>`, () => {
      const onPick = (e) => {
        const b = e.target.closest('[data-t]');
        if (!b || L.busy || S.paused) return;
        L.busy = true;
        b.classList.add('picked');
        socket.emit('throw', { targetId: b.dataset.t }, (res) => {
          L.busy = false;
          if (!res || !res.ok) b.classList.remove('picked');
        });
      };
      $('#quick').onclick = onPick;
      $('#carousel').onclick = onPick;
      $('#tAct').onclick = (e) => {
        if (!e.target.closest('#holdBtn') || L.busy) return;
        L.busy = true;
        socket.emit('hold', null, () => { L.busy = false; });
      };
    });
    // Dynamic parts are redrawn only when a bomb is thrown: the target order stays still during the
    // window, so a card never jumps away from under a student's finger.
    const fp = `${w.thrown}`;
    const main2 = $('#tBombs');
    if (!main2) return;
    if (!fresh && main2.dataset.fp === fp) return;
    main2.dataset.fp = fp;
    main2.innerHTML = w.bombs.map((b, i) => `<span class="bchip k-${b.kind} ${i < w.thrown ? 'done' : i === w.thrown ? 'now' : ''}">
      ${b.kind === 'mega' ? 'Mega' : b.kind === 'mini' ? 'Mini' : 'Bomb'} <b>${b.dmg}</b>${b.targetName ? ` → ${esc(b.targetName)} ✓` : i === w.thrown ? ' → ?' : ''}</span>`).join('');
    // Hold is only possible before the first bomb of the window is thrown
    $('#tAct').innerHTML = w.canHold && w.thrown === 0
      ? `<button class="btn small ghost hold" id="holdBtn">🔋 ${holdLabel}</button>`
      : `<span class="t-warn">${w.thrown > 0 ? 'Not aimed in time? It flies at the top house' : volley ? 'Tap a house for each bomb (the same house twice is OK)' : 'Last set of this phase: throw it or lose it'}</span>`;
    const pool = targetPool();
    const card = (p, cls) => {
      const rk = rankOf(p.id);
      return `<button class="${cls}" data-t="${p.id}" style="--c:${p.color}">
        <span class="tc-rank">${HT.medal(rk)}</span><span class="tc-av">${esc(p.avatar)}</span>
        <span class="tc-name">${esc(p.name)}</span>
        <span class="tc-fl">🏢 ${p.floors}${p.shield ? ` <span class="tc-sh">🛡️${p.shield}</span>` : ''}</span></button>`;
    };
    $('#quick').innerHTML = pool.slice(0, 3).map((p) => card(p, 'qbtn')).join('') || '<p class="p-sub">Nobody else is in town yet.</p>';
    $('#carousel').innerHTML = pool.slice(3).map((p) => card(p, 'tcard')).join('') +
      (pool.length > 3 ? '' : '<div class="car-empty">That\'s everyone!</div>');
  }

  function renderCapped() {
    chrome({ hud: true, mini: true });
    const pr = me.progress;
    setScreen(`capped:${S.phase}`, `
      <section class="wait">
        <div class="card center">
          <div class="big-emoji">🎉</div>
          <div class="p-title">Phase ${S.phase} complete!</div>
          <p class="p-sub">You finished all ${pr.cap} ${S.phase === 1 ? 'questions' : 'sets'} of this phase.<br>Watch the big screen: the next part starts when the timer runs out.</p>
          <div class="wait-stats"><span>✅ ${me.stats.correct}/${me.stats.answered} correct</span><span>🏢 ${me.floors} floors</span>${me.waiting ? `<span>🔁 ${me.waiting} to review</span>` : ''}</div>
          <div id="cappedHits"></div>
        </div>
      </section>`);
    const ch = $('#cappedHits');
    const html = hitsSummary((me.hits || []).filter((h) => h.phase === S.phase), `💥 Bombed by in Phase ${S.phase}`);
    if (ch && ch.dataset.h !== html) { ch.innerHTML = html; ch.dataset.h = html; }
  }

  function renderWaiting() {
    chrome({ hud: true, mini: true });
    setScreen(`wait:${S.phase}:${me.mode}`, `
      <section class="wait"><div class="card center"><div class="big-emoji">🚧</div><div class="p-title">Get ready…</div>
      <p class="p-sub">Your questions appear in a moment.</p></div></section>`);
  }

  // ---- Final Revenge ----
  // Only the avengers and the two players of the current duel use their phone; everyone else
  // gets a locked screen that points to the big screen.
  function rvP(id) { return S.players.find((p) => p.id === id) || { id, name: '?', avatar: '❔', color: '#888', floors: 0 }; }
  const rvName = (p) => `${esc(p.avatar)} <b>${esc(p.name)}</b>`;

  function renderRevenge() {
    chrome({ hud: true, mini: false });
    const rv = S.rv;
    if (!rv) return;
    const step = rv.step;
    const mine = rv.cast.find((c) => c.id === me.id);
    const pr = rv.idx >= 0 && rv.idx < rv.pairs.length ? rv.pairs[rv.idx] : null;
    const inPair = !!pr && (pr.a === me.id || pr.t === me.id);
    const foe = inPair ? rvP(pr.a === me.id ? pr.t : pr.a) : null;
    const chooserId = Object.keys(rv.picks).find((a) => rv.picks[a].targetId === me.id);
    const myPairIdx = rv.pairs.findIndex((x) => x.a === me.id || x.t === me.id);
    const roleName = mine ? (mine.role === 'broke' ? '🥫 The Broke Club' : '🩹 Victim of the Year') : '';

    if (['blackout', 'reveal', 'rules'].includes(step)) {
      if (mine) {
        rvScreen(`chosen:${step}`, 'chosen', `<div class="rv-emoji shake">😈</div><h2>YOU have been chosen!</h2>
          <div class="rv-role">${roleName}</div>
          <p>It's payback time. Watch the big screen, then pick your enemy here. 🎯</p>`, () => buzz([200, 80, 200]));
      } else rvLockScreen(step, step === 'blackout' ? '🕯️' : '📵', step === 'blackout' ? 'Uh-oh… the lights went out' : 'Phones are locked',
        step === 'blackout' ? 'Look at the big screen! 👀' : 'Look at the big screen! 👀 Something terrible is about to happen…');
      return;
    }
    if (step === 'pick') {
      if (mine && !rv.picks[me.id]) { renderRvPicker(rv); return; }
      if (mine) {
        const t = rvP(rv.picks[me.id].targetId);
        rvScreen('pick:done', 'chosen', `<div class="rv-emoji">🎯</div><h2>You chose ${rvName(t)}!</h2>
          <p>${rv.picks[me.id].auto ? 'Time ran out, so the tallest house left was chosen for you.' : 'Revenge is coming…'} Waiting for the others <b id="rvN"></b></p>`);
        $('#rvN').textContent = `(${Object.keys(rv.picks).length}/${rv.cast.length})`;
        return;
      }
      if (chooserId) {
        rvScreen(`pick:target:${chooserId}`, 'doomed', `<div class="rv-emoji shake">😱</div><h2>${rvName(rvP(chooserId))} chose YOU!</h2>
          <p>Get ready for a reflex duel. Answer faster than them or… 💀</p>`, () => buzz([300, 100, 300, 100, 300]));
        return;
      }
      rvLockScreen('pick', '🙏', 'Phones are locked', 'The avengers are choosing their enemies… pray it\'s not you!');
      $('#rvSt').textContent = `🎯 ${Object.keys(rv.picks).length}/${rv.cast.length} avengers have chosen`;
      return;
    }
    if (step === 'picked') {
      if (myPairIdx >= 0) {
        const x = rv.pairs[myPairIdx];
        rvScreen('picked:mine', 'chosen', `<div class="rv-emoji">⚔️</div><h2>Your duel: #${myPairIdx + 1} of ${rv.pairs.length}</h2>
          <p>You vs ${rvName(rvP(x.a === me.id ? x.t : x.a))}. Fastest <b>right</b> answer wins!</p>`);
      } else rvLockScreen('picked', '⚔️', 'The duels are about to begin', 'Look at the big screen! 👀');
      return;
    }
    if (step === 'outro') { rvLockScreen('outro', '☠️', 'Revenge complete!', 'The final ranking is coming… 🏆'); return; }
    if (!inPair) {
      const p = pr ? `⚔️ Duel ${rv.idx + 1} of ${rv.pairs.length}: ${esc(rvP(pr.a).name)} vs ${esc(rvP(pr.t).name)}` : '';
      rvLockScreen('duels', '📵', 'Phones are locked', 'Look at the big screen! 👀');
      const later = myPairIdx > rv.idx ? ` · ⏳ your duel is #${myPairIdx + 1}` : '';
      $('#rvSt').innerHTML = p + later;
      return;
    }
    const d = rv.duel;
    if (step === 'duelIntro') {
      rvScreen(`duelIntro:${rv.idx}`, 'chosen', `<div class="rv-emoji">⚔️</div><h2>DUEL! You vs ${rvName(foe)}</h2>
        <p>One quick question. The fastest <b>right</b> answer spins the wheel. Get ready… <b class="js-rvcd"></b></p>`, () => buzz(120));
      return;
    }
    if (step === 'duel' && d) { renderRvDuel(rv, d, foe); return; }
    if (step === 'duelResult' && d) {
      const won = d.winner === me.id;
      let html;
      if (won) html = `<div class="rv-emoji">🏆</div><h2>You win! (${(d.answers[me.id].ms / 1000).toFixed(2)} s)</h2><p>Get ready to <b>SPIN</b> the Wheel of Revenge! 🎡</p>`;
      else if (d.winner) html = `<div class="rv-emoji">😭</div><h2>${rvName(foe)} was faster…</h2><p>Now THEY spin the wheel. Pray for a self-destruct! 🙏</p>`;
      else if (d.round === 1) html = '<div class="rv-emoji">🔥</div><h2>Nobody got it right!</h2><p>SUDDEN DEATH: one more question. Get ready!</p>';
      else html = '<div class="rv-emoji">🕊️</div><h2>Nobody got it right again</h2><p>Peace… for now.</p>';
      rvScreen(`duelResult:${rv.key}`, won ? 'win' : 'chosen', html, () => buzz(won ? [80, 40, 80] : 200));
      return;
    }
    if (step === 'spin' && rv.spin) {
      if (rv.spin.by === me.id) renderRvSpin(rv);
      else rvScreen('spin:wait', 'doomed', `<div class="rv-emoji shake">😬</div><h2>${rvName(foe)} is about to spin…</h2><p>Look at the big screen! 👀</p>`);
      return;
    }
    if (step === 'spinning') { rvScreen('spinning', 'chosen', '<div class="rv-emoji spin">🎡</div><h2>The wheel is spinning…</h2><p>Look at the big screen! 👀</p>'); return; }
    if (step === 'effect') {
      const r = pr.res || {};
      let html = '<div class="rv-emoji">🤷</div><h2>Nothing happened</h2>';
      if (r.victim === me.id && r.outcome === 'self') {
        html = r.lost ? `<div class="rv-emoji">🤡</div><h2>You blew up your own house!</h2><p>Self-destruct: −${r.lost} floor${r.lost === 1 ? '' : 's'}. Oops.</p>`
          : '<div class="rv-emoji">🤷</div><h2>Self-destruct!</h2><p>…but your house was already empty. Nothing lost!</p>';
      } else if (r.victim === me.id && !r.lost) {
        html = r.absorbed ? `<div class="rv-emoji">🛡️</div><h2>Your shield saved you!</h2><p>It blocked all ${r.absorbed} floors (and is gone now).</p>`
          : `<div class="rv-emoji">🤷</div><h2>${rvName(foe)} attacked…</h2><p>…but you had nothing left to lose!</p>`;
      } else if (r.victim === me.id) html = `<div class="rv-emoji">💥</div><h2>${rvName(foe)} got you!</h2><p>${r.outcome === 'missile' ? '🚀 Armor-piercing missile' : '💥 Crushed'}: −${r.lost} floor${r.lost === 1 ? '' : 's'}${r.absorbed ? ` (🛡️ your shield blocked ${r.absorbed})` : ''}</p>`;
      else if (r.outcome === 'self') html = `<div class="rv-emoji">😅</div><h2>${rvName(foe)} blew up their own house!</h2><p>You are safe. Lucky!</p>`;
      else if (r.outcome) html = `<div class="rv-emoji">😈</div><h2>Revenge!</h2><p>${rvName(foe)} lost ${r.lost} floor${r.lost === 1 ? '' : 's'}${r.absorbed ? ` (their shield blocked ${r.absorbed})` : ''}.</p>`;
      rvScreen(`effect:${rv.idx}`, r.victim === me.id ? 'doomed' : 'win', html);
    }
  }

  function buzz(pattern) { if (navigator.vibrate) navigator.vibrate(pattern); }

  function rvScreen(key, cls, inner, after) {
    setScreen(`rv:${S.rv.key}:${key}`, `<section class="rv-big ${cls}"><div class="rv-box">${inner}</div></section>`, after);
  }
  function rvLockScreen(key, icon, title, sub) {
    setScreen(`rv:${S.rv.key}:lock:${key}`, `<section class="rv-big lock"><div class="rv-box"><div class="rv-emoji">${icon}</div><h2>${esc(title)}</h2><p>${esc(sub)}</p><div class="rv-st" id="rvSt"></div></div></section>`);
  }

  function renderRvPicker(rv) {
    const fresh = setScreen(`rv:${rv.key}:picker`, `
      <section class="rv-pickp">
        <div class="hd"><div>🎯 Choose your enemy!</div><div class="cd-pill"><b class="js-rvcd"></b>s</div></div>
        <div class="cbar red"><i class="js-rvbar"></i></div>
        <div class="rv-grid" id="rvGrid"></div>
        <p class="rv-hint">One enemy each, no two the same. No choice in time = the tallest house left.</p>
      </section>`, () => {
      buzz([100, 50, 100]);
      $('#rvGrid').onclick = (e) => {
        const b = e.target.closest('[data-t]');
        if (!b || L.busy || S.paused || b.classList.contains('taken')) return;
        L.busy = true;
        b.classList.add('picked');
        socket.emit('rv:pick', { targetId: b.dataset.t }, (res) => {
          L.busy = false;
          if (!res || !res.ok) {
            b.classList.remove('picked');
            if (res && res.error === 'taken') toast('Too slow, someone took that house! Pick another one.', 'meh');
          } else buzz(60);
        });
      };
    });
    const taken = new Map(Object.entries(rv.picks).map(([a, x]) => [x.targetId, a]));
    const castIds = new Set(rv.cast.map((c) => c.id));
    const list = HT.ranked(S.players.filter((p) => !castIds.has(p.id)));
    const fp = JSON.stringify(rv.picks) + list.map((p) => p.id + p.floors).join(',');
    const grid = $('#rvGrid');
    if (!grid || (!fresh && grid.dataset.fp === fp)) return;
    grid.dataset.fp = fp;
    grid.innerHTML = list.map((p) => {
      const by = taken.get(p.id);
      return `<button class="rv-t ${by ? 'taken' : ''}" data-t="${p.id}" style="--c:${p.color}"><span class="av">${esc(p.avatar)}</span>
        <span class="nm">${esc(p.name)}</span><span class="fl">${by ? `<span class="tk">🎯 ${esc(rvP(by).name)}</span>` : `🏢 ${p.floors}${p.shield ? ` 🛡️${p.shield}` : ''}`}</span></button>`;
    }).join('');
  }

  function renderRvDuel(rv, d, foe) {
    if (!L.rvAnswer || L.rvAnswer.key !== rv.key) L.rvAnswer = null;
    // after a reload the server still knows my answer (but not which button it was)
    if (!L.rvAnswer && d.answers[me.id]) L.rvAnswer = { key: rv.key, choice: -1, correct: d.answers[me.id].correct, ms: d.answers[me.id].ms };
    const fresh = setScreen(`rv:${rv.key}:duel`, `
      <section class="rv-duelp">
        <div class="qbox">
          <div class="rv-tag">⚔️ vs ${rvName(foe)}${d.round === 2 ? ' · 🔥 SUDDEN DEATH' : ''}</div>
          <div class="qt">${esc(d.text)}</div>
          <div class="q-timer"><i class="js-rvbar"></i></div>
          <div class="rv-msg" id="rvMsg">Fastest <b>right</b> answer wins! ⚡</div>
        </div>
        <div class="rv-ops" id="rvOps">${d.options.map((o, i) => `<button class="rv-op o${i}" data-i="${i}">${esc(o)}</button>`).join('')}</div>
      </section>`, () => {
      buzz(80);
      $('#rvOps').onclick = (e) => {
        const b = e.target.closest('[data-i]');
        if (!b || L.busy || L.rvAnswer || S.paused) return;
        L.busy = true;
        b.classList.add('picked');
        $('#rvOps').classList.add('answered');
        const key = rv.key;
        socket.emit('rv:answer', { key, choice: Number(b.dataset.i) }, (res) => {
          L.busy = false;
          if (!res || !res.ok) { if (S.rv && S.rv.key === key) { b.classList.remove('picked'); $('#rvOps').classList.remove('answered'); } return; }
          L.rvAnswer = { key, choice: Number(b.dataset.i), correct: res.correct, ms: res.ms };
          buzz(res.correct ? 40 : [60, 40, 60]);
          render(); // a right answer ends the duel: the result screen may already be here
        });
      };
    });
    const ops = $('#rvOps');
    if (L.rvAnswer && ops) { // keep my answer marked
      ops.classList.add('answered');
      const mineBtn = ops.querySelector(`[data-i="${L.rvAnswer.choice}"]`);
      if (mineBtn) mineBtn.classList.add('picked', L.rvAnswer.correct ? 'right' : 'wrong');
    }
    const msg = $('#rvMsg');
    if (!msg) return;
    const theirs = d.answers[foe.id];
    let html = 'Fastest <b>right</b> answer wins! ⚡';
    if (L.rvAnswer) html = L.rvAnswer.correct ? `✅ Right! ${(L.rvAnswer.ms / 1000).toFixed(2)} s` : `❌ Wrong!${theirs ? '' : ` Now pray ${esc(foe.name)} gets it wrong too… 🙏`}`;
    else if (theirs && !theirs.correct) html = `❌ ${esc(foe.name)} answered wrong. Your chance! ⚡`;
    if (fresh || msg.dataset.h !== html) { msg.innerHTML = html; msg.dataset.h = html; }
  }

  function renderRvSpin(rv) {
    setScreen(`rv:${rv.key}:spin`, `
      <section class="rv-big win"><div class="rv-box">
        <p class="rv-k">🏆 You won the duel! Spin the Wheel of Revenge:</p>
        <button class="spin-btn" id="spinBtn">🎡 SPIN!</button>
        <p class="rv-k small">auto-spin in <b class="js-rvcd"></b> s</p>
      </div></section>`, () => {
      buzz([60, 30, 60]);
      $('#spinBtn').onclick = () => {
        if (L.busy || S.paused) return;
        L.busy = true;
        $('#spinBtn').classList.add('picked');
        buzz(150);
        socket.emit('rv:spin', null, () => { L.busy = false; });
      };
    });
  }

  // ---- Finale & results ----
  // For the first 12 seconds of the finale the big screen reveals the podium, so phones say "look up".
  function inFinaleReveal() {
    return S.stage === 'finale' && S.settings.finaleSec * 1000 - phaseLeft() < 12000;
  }

  function renderEnd() {
    const F = me.final;
    if (inFinaleReveal()) {
      chrome({ hud: false, mini: false });
      setScreen('finale-wait', `
        <section class="center-screen" id="finaleWait"><div class="card center finale-card">
          <div class="big-emoji">🎆</div><div class="p-title">Look at the big screen!</div>
          <p class="p-sub">The winners of HappyTown are being revealed…</p></div></section>`);
      return;
    }
    chrome({ hud: false, mini: false });
    if (!F || !S.final) return;
    const top = S.final.ranking.slice(0, 3);
    const acc = me.stats.answered ? Math.round((100 * me.stats.correct) / me.stats.answered) : 0;
    const missed = F.missed || [];
    const fresh = setScreen(`end:${S.stage}:${S.final.ranking.length}`, `
      <section class="results">
        <div class="res-left">
          <div class="card center">
            <div class="res-medal">${F.rank && F.rank <= 3 ? HT.medal(F.rank) : me.avatar}</div>
            <div class="res-rank">#${F.rank} <small>of ${F.total}</small></div>
            <div class="p-title">${F.rank === 1 ? 'You built the tallest house!' : F.rank <= 3 ? 'You are a HappyTown winner!' : 'Well played!'}</div>
            <p class="p-sub">🏢 ${me.floors} floors · ✅ ${me.stats.correct}/${me.stats.answered} (${acc}%)</p>
          </div>
          <div class="card podium-sm">${top.map((r) => `<div><span>${HT.medal(r.rank)}</span><span>${esc(r.avatar)}</span><span class="nm">${esc(r.name)}</span><span class="fl">${r.floors} 🏢</span></div>`).join('')}</div>
        </div>
        <div class="res-right card">
          <div class="res-tabs" id="resTabs">
            <button data-tab="rank">🏆 Ranking</button>
            <button data-tab="hits">💥 Bombed by</button>
            <button data-tab="review">📚 Review <small>(optional)</small></button>
          </div>
          <div data-pane="rank"><ol class="rank-list">${S.final.ranking.map((r) => `<li class="${r.id === me.id ? 'me' : r.rank <= 3 ? 'top' : ''}">
            <span class="rk">${r.rank <= 3 ? HT.medal(r.rank) : `#${r.rank}`}</span><span>${esc(r.avatar)}</span><span class="nm">${esc(r.name)}${r.id === me.id ? ' (you)' : ''}</span><span class="fl">${r.floors} 🏢</span></li>`).join('')}</ol></div>
          <div data-pane="hits">${hitsSummary(me.hits || [], '💥 Who bombed you') || '<p class="p-sub">💥 Nobody bombed your house. Lucky you!</p>'}</div>
          <div data-pane="review">
            <div class="rv-skip"><span class="p-title small">📚 Your review list</span><button class="btn small ghost" id="skipReview">Skip ✕</button></div>
            ${missed.length ? `<ul class="recap">${missed.map((m) => `<li class="${m.fixed ? 'fixed' : 'no'}"><span class="mk">${m.fixed ? '🔁✅' : '❌'}</span>
              <b>${esc(m.q)}</b><span class="a">✓ ${esc(m.answer)}</span>${m.explain ? `<span class="x">${esc(m.explain)}</span>` : ''}</li>`).join('')}</ul>
              <p class="p-sub tiny">🔁✅ = you missed it at first but got it right later.</p>`
        : '<p class="p-sub">You didn\'t miss a single question. Brilliant! 🌟</p>'}
          </div>
        </div>
      </section>`, () => {
      $('#resTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { L.resTab = b.dataset.tab; showResTab(); } };
      $('#skipReview').onclick = () => { L.resTab = 'rank'; showResTab(); };
    });
    if (fresh) showResTab();
  }

  function showResTab() {
    document.querySelectorAll('#resTabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === L.resTab));
    document.querySelectorAll('.res-right [data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== L.resTab; });
    const meRow = document.querySelector('.rank-list li.me');
    const box = document.querySelector('.res-right');
    if (L.resTab === 'rank' && meRow && box) { // show my own row in the middle of the list
      box.scrollTop = Math.max(0, meRow.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight / 2);
    }
  }

  // -------------------------------------------------------------------------
  // Events (bombs, shields…)
  // -------------------------------------------------------------------------
  function onEvent(ev) {
    if (!L.joined || !me) return;
    if (ev.type === 'attack') {
      if (document.body.classList.contains('show-mini')) mini.attack(ev);
      if (ev.from === me.id && !ev.self) {
        const what = ev.lost > 0 ? `−${ev.lost}` : ev.absorbed ? 'blocked by a shield' : 'no floors left';
        toast(`🎯 ${{ mega: 'Mega', mini: 'Mini', crush: 'Your revenge', missile: 'Your missile' }[ev.kind] || 'Bomb'} hit ${ev.toName}: ${what}${ev.auto ? ' (auto-aimed)' : ''}`, ev.lost > 0 ? 'good' : 'meh');
      }
    }
    if (ev.type === 'fizzle' && ev.id === me.id) {
      const why = { streak: 'the streak broke', phase: 'the phase ended', unthrown: 'it wasn\'t thrown in time', gameEnd: 'the game ended' }[ev.reason] || '';
      toast(`💨 Your bomb${ev.n > 1 ? 's' : ''} (${ev.dmg} damage) ${ev.n > 1 ? 'were' : 'was'} lost: ${why}`, 'meh');
    }
  }

  // -------------------------------------------------------------------------
  // "Who bombed me?" Every bomb that hits me is stored on the server (me.hits), so the phone
  // always shows who threw it: one card per bomb (several can be on screen at once), and a
  // summary of what happened while the phone was offline.
  // -------------------------------------------------------------------------
  const kindName = (k) => ({ mega: 'Mega Bomb', mini: 'Mini Bomb', crush: 'Revenge crush (−80%)', missile: 'Armor-piercing missile', self: 'Self-destruct' }[k] || 'Bomb');
  const seenKey = () => `ht:seenHit:${L.session ? L.session.token : ''}`;

  function checkHits() {
    const hits = me.hits || [];
    const lastId = hits.length ? hits[hits.length - 1].id : 0;
    if (L.seenHit === null) {
      const stored = store.get(seenKey(), null);
      if (stored === null) {
        // first time on this phone (e.g. rejoined on a new phone): sum up what happened so far
        if (hits.length) showAway(hits, true);
        L.seenHit = lastId;
        store.set(seenKey(), lastId);
        return;
      }
      L.seenHit = stored;
    }
    const fresh = hits.filter((h) => h.id > L.seenHit);
    if (!fresh.length) return;
    L.seenHit = lastId;
    store.set(seenKey(), lastId);
    L.lastHitAt = Date.now();
    if (fresh.length > 3) showAway(fresh, false); // e.g. the phone was offline for a while
    else fresh.forEach(showHit);
    if (fresh.some((h) => h.lost > 0)) {
      document.body.classList.remove('hit'); void document.body.offsetWidth; document.body.classList.add('hit');
      if (navigator.vibrate) navigator.vibrate([150, 60, 250]);
    } else if (navigator.vibrate) navigator.vibrate(80);
  }

  function hitCard(cls, avatar, html, ms) {
    const box = $('#hitStack');
    const c = document.createElement('div');
    c.className = `hit-card ${cls}`;
    c.innerHTML = `<span class="hc-av">${esc(avatar)}</span><div class="hc-txt">${html}</div>`;
    box.appendChild(c);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { c.classList.add('out'); setTimeout(() => c.remove(), 400); }, ms);
  }

  function showHit(h) {
    const who = `<b>${esc(h.fromName)}</b>`;
    if (h.self) {
      hitCard('bad', '🧨', `You blew up your own house! 🤡<small>Self-destruct · −${h.lost} floor${h.lost === 1 ? '' : 's'}</small>`, 6000);
    } else if (h.lost > 0) {
      hitCard('bad', h.fromAvatar, `💥 ${who} bombed you!<small>${kindName(h.kind)} · −${h.lost} floor${h.lost > 1 ? 's' : ''}${h.absorbed ? ` · 🛡️ blocked ${h.absorbed}` : ''}</small>`, 5500);
    } else if (h.absorbed > 0) {
      hitCard('blue', h.fromAvatar, `🛡️ Your shield blocked ${who}'s ${kindName(h.kind)}!<small>Blocked ${h.absorbed} · the shield is used up</small>`, 5500);
    } else {
      hitCard('meh', h.fromAvatar, `💣 ${who} bombed you<small>You had no floors to lose</small>`, 5000);
    }
  }

  // Bombs grouped by attacker, most damage first
  function groupHits(hits) {
    const by = new Map();
    for (const h of hits) {
      const name = h.self ? 'Yourself (self-destruct)' : h.fromName;
      const x = by.get(name) || { name, avatar: h.self ? '🧨' : h.fromAvatar, n: 0, lost: 0, blocked: 0 };
      x.n += 1; x.lost += h.lost; x.blocked += h.absorbed;
      by.set(name, x);
    }
    return [...by.values()].sort((a, b) => b.lost - a.lost || b.n - a.n);
  }

  function showAway(hits, sinceStart) {
    const groups = groupHits(hits);
    const items = groups.slice(0, 3).map((x) => `${esc(x.avatar)} ${esc(x.name)} ×${x.n} −${x.lost}${x.blocked ? ` 🛡️${x.blocked}` : ''}`).join(' · ') +
      (groups.length > 3 ? ' · …' : '');
    const n = hits.length;
    const title = sinceStart
      ? `<b>${n} bomb${n > 1 ? 's' : ''}</b> ${n > 1 ? 'have' : 'has'} hit your house so far`
      : `<b>${n} bombs hit you</b> while you were away`;
    hitCard('bad', '💥', `${title}<small>${items}</small>`, 8000);
  }

  // A short list of who bombed me, grouped by attacker
  function hitsSummary(hits, title) {
    if (!hits.length) return '';
    const rows = groupHits(hits).map((x) =>
      `<span class="hs-chip">${esc(x.avatar)} <b>${esc(x.name)}</b> ×${x.n} <i>−${x.lost}</i>${x.blocked ? ` 🛡️${x.blocked}` : ''}</span>`).join('');
    return `<div class="hs"><div class="hs-title">${title}</div><div class="hs-list">${rows}</div></div>`;
  }

  let toastTimer = null;
  function toast(msg, kind) {
    const old = document.querySelector('.p-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = `p-toast ${kind || ''}`;
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3200);
  }

  function flash(text) {
    const f = document.createElement('div');
    f.className = 'flash';
    f.textContent = text;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 750);
  }

  render(true);
})();
