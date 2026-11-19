/* HappyTown — the Final Revenge show on the big screen.
   Everything is drawn from S.rv, which the server sends several times a second. Sounds and
   animations play when a new step starts; a host page that reloads in the middle of the revenge
   simply shows the current step without replaying it. */
(function (HT) {
  const { esc } = HT;
  const OUT = {
    crush: { ic: '💥', title: 'CRUSHED!', short: '−80%', rain: ['💥', '☄️', '😱', '🏚️', '💀'] },
    self: { ic: '🧨', title: 'SELF-DESTRUCT!', short: 'Self-destruct', rain: ['🤡', '😂', '🧨', '🤣', '🙈'] },
    missile: { ic: '🚀', title: 'ARMOR-PIERCING MISSILE!', short: 'Missile −10', rain: ['🚀', '🔥', '💀', '🎯', '😵'] }
  };
  const WHEEL_COLORS = { crush: '#e11d48', self: '#7c3aed', missile: '#f59e0b' };
  const PAIR_STEPS = ['duelIntro', 'duel', 'duelResult', 'spin', 'spinning', 'effect'];
  const LAND_MS = 1500; // the revenge projectile (town.js) lands this long after the effect starts
  const hash = (s) => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
  const fl = (n) => `${n} floor${n === 1 ? '' : 's'}`;
  const sec2 = (ms) => (ms / 1000).toFixed(2);

  // Captions for the avengers (picked per player, so they stay the same on every redraw)
  // (the numbers are already on the card, so the jokes do not repeat them)
  const BROKE_LINES = [
    () => 'Even the pigeons moved out. 🐦',
    () => 'Lives on instant noodles and hope. 🍜',
    (c) => (c.built > c.floors ? `Built ${fl(c.built)} in total. Kept ${c.floors}. Pain. 😭` : 'Their house is basically a tent. ⛺'),
    () => 'Mom called. She is disappointed. 📞',
    () => 'Bank account: 🦗🦗🦗',
    () => 'The view from down here is… cozy. 🕳️',
    () => 'Asked the bank for a loan. The bank laughed. 🏦😂'
  ];
  const VICTIM_LINES = [
    () => 'Trusts nobody anymore. Not even their mom. 🥲',
    (c) => (c.fan ? `Their #1 fan: ${c.fan.avatar} ${c.fan.name} (${c.fan.n} bomb${c.fan.n === 1 ? '' : 's'}). 💌` : 'Professional bomb catcher. Unpaid. 🧤'),
    () => 'Keeps the bomb shelter on speed dial. ☎️',
    (c) => (c.attackers > 1 ? `${c.attackers} different people bombed this house. So popular! 🎯` : 'Their house has more holes than Swiss cheese. 🧀'),
    () => 'Their house has more holes than Swiss cheese. 🧀'
  ];

  HT.RevengeShow = function (root, Sfx) {
    const content = root.querySelector('.rv-content');
    const fx = root.querySelector('.rv-fx');
    const arena = new HT.Town(root.querySelector('.rv-arena'), { sky: false, maxW: 260, onImpact: landed });
    let S = null;
    let key = -1; // the step on screen
    let later = []; // timers of the current step
    let dynKey = '';
    let lastBeep = null;
    let arenaKey = '';
    let heard = new Set(); // duel answers already announced with a sound
    const seenPicks = new Set();

    const P = (id) => (S && S.players.find((p) => p.id === id)) || { id, name: '?', avatar: '❔', color: '#888', floors: 0, shield: 0 };
    const pairOf = (rv) => (rv.idx >= 0 && rv.idx < rv.pairs.length ? rv.pairs[rv.idx] : null);
    const after = (ms, fn) => later.push(setTimeout(fn, ms));
    const stepLeft = () => HT.left(S.deadline, S.paused, S.vnow);
    const nm = (p) => `${esc(p.avatar)} <b>${esc(p.name)}</b>`;

    // -----------------------------------------------------------------------
    function render(state) {
      S = state;
      const rv = S && S.stage === 'revenge' ? S.rv : null;
      root.hidden = !rv;
      if (!rv) { if (key !== -1) stop(); return; }
      root.dataset.step = rv.step;
      root.classList.toggle('is-paused', !!S.paused);
      if (rv.key !== key) {
        const fresh = key !== -1 || HT.clock.now() - rv.at < 1500;
        key = rv.key;
        later.forEach(clearTimeout);
        later = [];
        dynKey = '';
        lastBeep = null;
        heard = new Set();
        content.innerHTML = (VIEWS[rv.step] || (() => ''))(rv);
        enter(rv, fresh);
      }
      updateArena(rv);
      update(rv);
      tick();
    }

    function stop() {
      key = -1;
      later.forEach(clearTimeout);
      later = [];
      content.innerHTML = '';
      fx.innerHTML = '';
      seenPicks.clear();
      arena.update([]);
      arenaKey = '';
    }

    // Sounds and effects when a step starts
    function enter(rv, fresh) {
      if (rv.step === 'spinning') startWheel(rv, fresh);
      if (rv.step === 'effect') { setWheel(rv); after(LAND_MS, () => { dynKey = ''; if (S && S.rv) update(S.rv); }); }
      if (!fresh) return;
      switch (rv.step) {
        case 'blackout': Sfx.powerDown(); after(1300, () => Sfx.thunder()); break;
        case 'reveal':
          Sfx.thunder(); after(400, () => Sfx.dunDun());
          rv.cast.forEach((c, i) => after(1700 + i * 1500, () => Sfx.boom(false)));
          after(1900 + rv.cast.length * 1500, () => Sfx.sadTrombone());
          break;
        case 'rules': Sfx.phase(); break;
        case 'pick': Sfx.sting(); break;
        case 'picked': Sfx.drum(); break;
        case 'duelIntro': Sfx.sting(); break;
        case 'duel': Sfx.beep(true); break;
        case 'duelResult': {
          const d = rv.duel;
          const pr = pairOf(rv);
          if (d && d.winner) { if (pr && d.winner === pr.t) Sfx.boing(); after(150, () => Sfx.fanfare()); }
          else Sfx.sadTrombone();
          break;
        }
        case 'spin': Sfx.drum(); break;
        case 'effect': {
          const out = rv.spin && rv.spin.outcome;
          if (out) after(LAND_MS, () => { emojiRain(OUT[out].rain, 34); shake(); flash(); if (out === 'self') Sfx.laugh(); });
          break;
        }
        case 'outro': Sfx.fanfare(); emojiRain(['💀', '😈', '🔥', '⚔️', '🏆'], 26); break;
        default:
      }
    }

    // Parts that change during a step: picks, duel answers, floors
    function update(rv) {
      let fp = '';
      const pr = pairOf(rv);
      if (rv.step === 'pick') fp = JSON.stringify(rv.picks) + ':' + S.players.map((p) => p.id + p.floors).join(',');
      else if (pr && PAIR_STEPS.includes(rv.step)) {
        const a = P(pr.a);
        const t = P(pr.t);
        fp = JSON.stringify([rv.duel && rv.duel.answers, a.floors, t.floors, a.shield, t.shield, pr.res]);
      }
      if (fp === dynKey) return;
      dynKey = fp;
      if (rv.step === 'pick') updatePick(rv);
      if (pr && PAIR_STEPS.includes(rv.step)) updateFighters(rv, pr);
    }

    function tick() {
      if (!S || S.stage !== 'revenge' || !S.rv) return;
      const rv = S.rv;
      const ms = stepLeft();
      const sec = Math.ceil(ms / 1000);
      content.querySelectorAll('[data-cd]').forEach((el) => { el.textContent = S.paused ? '⏸' : sec; });
      const bar = content.querySelector('[data-bar]');
      if (bar) bar.style.width = (100 * Math.max(0, Math.min(1, ms / (rv.ms || 1)))).toFixed(1) + '%';
      let beep = null;
      if ((rv.step === 'pick' && sec <= 5) || (rv.step === 'duel' && sec <= 3) || (rv.step === 'spin' && sec <= 3)) beep = sec;
      if (rv.step === 'duelIntro') {
        const n = Math.min(3, Math.max(1, Math.ceil((ms - 250) / Math.max(300, (rv.ms - 500) / 3))));
        const el = content.querySelector('[data-three]');
        if (el && el.textContent !== String(n)) { el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
        beep = n;
      }
      if (beep !== null && beep > 0 && beep !== lastBeep && !S.paused) { lastBeep = beep; Sfx.beep(false); }
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------
    function castCard(c, i) {
      const p = P(c.id);
      const lines = c.role === 'broke' ? BROKE_LINES : VICTIM_LINES;
      const line = c.role === 'victim' && !c.hits ? 'Nobody even bothered to bomb them. That is worse. 😶' : lines[(hash(c.id) + i) % lines.length](c);
      const stat = c.role === 'broke'
        ? `🏚️ ${fl(c.floors)} · rank #${c.rank} of ${S.players.length}`
        : `💣 bombed ${c.hits}× · −${fl(c.lost)}`;
      return `<div class="rv-card ${c.role}" style="--c:${p.color};--d:${(1.7 + i * 1.5).toFixed(1)}s">
        <div class="rv-role">${c.role === 'broke' ? '🥫 The Broke Club' : '🩹 Victim of the Year'}</div>
        <div class="rv-face"><span>${esc(p.avatar)}</span><i class="tear t1">💧</i><i class="tear t2">💧</i></div>
        <div class="rv-name">${esc(p.name)}</div>
        <div class="rv-stat">${stat}</div>
        <div class="rv-line">${esc(line)}</div>
      </div>`;
    }

    function avCol(c) {
      const p = P(c.id);
      return `<div class="av-col ${c.role}" style="--c:${p.color}">
        <div class="ac-role">${c.role === 'broke' ? '🥫 Broke Club' : '🩹 Victim of the Year'}</div>
        <div class="ac-av">${esc(p.avatar)}</div><div class="ac-name">${esc(p.name)}</div>
        <div class="ac-pick" data-pick="${c.id}"></div>
      </div>`;
    }

    function pairRow(pr, i) {
      const a = P(pr.a);
      const t = P(pr.t);
      return `<div class="pair" style="--d:${(0.2 + i * 0.45).toFixed(2)}s">
        <span class="pl"><span class="pn">${i + 1}</span><span class="pf" style="--c:${a.color}">${nm(a)}</span></span>
        <span class="vs">VS</span><span class="pr"><span class="pf" style="--c:${t.color}">${nm(t)}</span></span></div>`;
    }

    function fighter(p, side, role) {
      return `<div class="fighter ${side}" style="--c:${p.color}">
        <div class="f-role">${role}</div>
        <div class="f-main"><span class="f-av">${esc(p.avatar)}</span><div class="f-txt"><div class="f-name">${esc(p.name)}</div><div class="f-fl" data-fl="${p.id}"></div></div></div>
        <div class="f-st" data-st="${p.id}"></div>
      </div>`;
    }

    function pairFrame(rv, center) {
      const pr = pairOf(rv);
      if (!pr) return '';
      const c = rv.cast.find((x) => x.id === pr.a);
      return `<div class="rv-duel">
        <div class="rv-dhead"><span class="rv-dn">⚔️ Duel ${rv.idx + 1} of ${rv.pairs.length}</span>${rv.duel && rv.duel.round === 2 && rv.step !== 'spin' && rv.step !== 'spinning' && rv.step !== 'effect' ? '<span class="rv-sd">🔥 SUDDEN DEATH</span>' : ''}</div>
        ${fighter(P(pr.a), 'left', `😈 Avenger · ${c && c.role === 'victim' ? '🩹 Victim of the Year' : '🥫 Broke Club'}`)}
        ${fighter(P(pr.t), 'right', '🎯 The enemy')}
        <div class="rv-center">${center}</div>
      </div>`;
    }

    function duelCenter(rv, reveal) {
      const d = rv.duel;
      if (!d) return '';
      const pr = pairOf(rv);
      const who = (i) => (reveal ? [pr.a, pr.t].filter((id) => d.answers[id] && d.answers[id].choice === i).map((id) => esc(P(id).avatar)).join('') : '');
      return `<div class="rv-q k-${d.kind}">${esc(d.text)}</div>
        <div class="rv-opts">${d.options.map((o, i) => {
          const w = who(i);
          const cls = reveal ? (i === d.answer ? 'right' : w ? 'wrong' : 'dim') : '';
          return `<div class="rv-opt o${i} ${cls}"><span class="L">${'ABCD'[i]}</span><span class="t">${esc(o)}</span>${w ? `<span class="who">${w}</span>` : ''}</div>`;
        }).join('')}</div>
        ${reveal ? '' : '<div class="rv-bar"><i data-bar></i></div>'}`;
    }

    function duelResultText(rv) {
      const d = rv.duel;
      const pr = pairOf(rv);
      if (d && d.winner) {
        const w = P(d.winner);
        const ms = d.answers[d.winner] ? d.answers[d.winner].ms : 0;
        return pr && d.winner === pr.t
          ? `😱 <b>PLOT TWIST!</b> ${nm(w)} was faster (${sec2(ms)} s): the <b>enemy</b> spins the wheel!`
          : `⚡ ${nm(w)} wins in ${sec2(ms)} s! Time to spin… 🎡`;
      }
      return d && d.round === 1 ? '🤷 Nobody got it right… <b>🔥 SUDDEN DEATH!</b>' : '🕊️ Nobody got it right again. Peace… for now.';
    }

    function wheelHtml(rv, cls) {
      const n = rv.wheel.length;
      const seg = 360 / n;
      const grad = rv.wheel.map((w, i) => `${WHEEL_COLORS[w]} ${i * seg}deg ${(i + 1) * seg}deg`).join(', ');
      const labels = rv.wheel.map((w, i) => `<div class="wl ${w}" data-i="${i}" style="--a:${i * seg + seg / 2}deg"><span>${OUT[w].ic}</span><b>${OUT[w].short}</b></div>`).join('');
      return `<div class="wheel-wrap ${cls || ''}"><div class="wheel-pointer"></div>
        <div class="wheel" data-wheel style="background: repeating-conic-gradient(from -1deg, rgba(255,255,255,.95) 0 2deg, transparent 2deg ${seg}deg), conic-gradient(${grad})">${labels}</div>
        <div class="wheel-hub">🎡</div></div>`;
    }

    function effectBanner(rv) {
      const pr = pairOf(rv);
      const s = rv.spin;
      if (!s || !s.outcome) return '';
      const res = (pr && pr.res) || {};
      const by = P(s.by);
      const v = P(res.victim || s.other);
      let line;
      if (res.skipped) line = 'Nothing happened…';
      else if (s.outcome === 'self') line = res.lost ? `${nm(by)} blew up their OWN house: <b>−${res.lost}</b> (${res.before} → ${res.after}) 🤡` : `${nm(by)} had nothing left to blow up 🤷`;
      else if (s.outcome === 'missile') line = res.lost ? `${nm(v)} loses <b>${fl(res.lost)}</b> (${res.before} → ${res.after}) · shields can't stop it` : `${nm(v)} had no floors left to hit 🤷`;
      else if (res.absorbed && !res.lost) line = `${nm(v)}'s shield blocked all of it (🛡️ ${res.absorbed})! 😤 The shield is gone now.`;
      else if (res.absorbed) line = `${nm(v)} loses <b>${res.lost}</b> (${res.before} → ${res.after}) · 🛡️ the shield blocked ${res.absorbed}`;
      else line = res.lost ? `${nm(v)} loses 80%: <b>−${res.lost}</b> (${res.before} → ${res.after})` : `${nm(v)} had no floors left to crush 🤷`;
      return `<div class="rv-effect ${s.outcome}"><div class="ef-title">${OUT[s.outcome].ic} ${OUT[s.outcome].title}</div><div class="ef-line">${line}</div></div>`;
    }

    function recapRow(pr) {
      const r = pr.res || {};
      let txt;
      const minus = r.lost ? ` <i>−${r.lost}</i>` : r.absorbed ? ` (🛡️ blocked it all)` : ' (nothing left to lose 🤷)';
      if (r.outcome === 'self') txt = `${nm(P(r.by))} 🧨 blew up their own house${r.lost ? ` <i>−${r.lost}</i> 🤡` : ' (it was already empty 🤷)'}`;
      else if (r.outcome === 'missile') txt = `${nm(P(r.by))} 🚀 hit ${nm(P(r.victim))}${minus}`;
      else if (r.outcome === 'crush') txt = `${nm(P(r.by))} 💥 crushed ${nm(P(r.victim))}${minus}${r.lost && r.absorbed ? ` (🛡️ ${r.absorbed} blocked)` : ''}`;
      else if (r.peace) txt = `${nm(P(pr.a))} 🕊️ ${nm(P(pr.t))}: nobody answered, peace`;
      else txt = `${nm(P(pr.a))} ⚔️ ${nm(P(pr.t))}: skipped`;
      return `<div class="rc">${txt}${r.by && r.by === pr.t ? '<span class="twist">😱 plot twist</span>' : ''}</div>`;
    }

    const VIEWS = {
      blackout: () => `<div class="rv-black"><div class="rv-candle">🕯️</div><p class="rv-whisper">psst… who turned off the lights? 👀</p></div>`,
      reveal: (rv) => `<div class="rv-reveal">
          <div class="rv-kicker">⚠️ Breaking news from HappyTown ⚠️</div>
          <h1 class="rv-title">IT'S PAYBACK TIME</h1>
          <p class="rv-sub">The poorest houses in town have suffered in silence… <b>until now.</b> 😈</p>
          <div class="rv-cast">${rv.cast.map(castCard).join('')}</div>
        </div>`,
      rules: () => `<div class="rv-rules">
          <h1>⚔️ How revenge works</h1>
          <ol class="rv-steps">
            <li><span>🎯</span><div>Each avenger picks <b>ONE enemy</b> on their phone (no two the same).</div></li>
            <li><span>⚡</span><div><b>Reflex duel:</b> one quick question, <b>7 seconds</b>. The fastest <b>right</b> answer wins.</div></li>
            <li><span>🎡</span><div>The winner spins the <b>Wheel of Revenge</b>:</div></li>
          </ol>
          <div class="rv-legend">
            <div class="lg crush"><b>💥 Enemy −80%</b><small>they lose 80% of their floors</small><em>40%</em></div>
            <div class="lg self"><b>🧨 Self-destruct</b><small>your own house: 100% gone</small><em>40%</em></div>
            <div class="lg missile"><b>🚀 Missile −10</b><small>armor-piercing: ignores every shield</small><em>20%</em></div>
          </div>
          <p class="rv-warn">😈 Plot twist: if the <b>enemy</b> answers faster, <b>they</b> spin the wheel!</p>
          <p class="rv-lockmsg">📵 Everyone else: your phone is locked. Watch the big screen!</p>
        </div>`,
      pick: (rv) => `<div class="rv-pick">
          <div class="rv-head"><h1>🎯 Choose your enemy!</h1><div class="rv-cd" data-cd></div></div>
          <div class="rv-avengers">${rv.cast.map(avCol).join('')}</div>
          <div class="rv-tlabel">Who will it be? 👇</div>
          <div class="rv-targets" data-targets></div>
          <p class="rv-foot">📱 Avengers: choose on your phone · Everyone else: pray 🙏</p>
        </div>`,
      picked: (rv) => `<div class="rv-pairs"><h1>⚔️ Tonight's duels</h1>${rv.pairs.length ? `<div class="pairs">${rv.pairs.map(pairRow).join('')}</div>` : '<p class="rv-sub">Nobody left to take revenge on… 🦗</p>'}</div>`,
      duelIntro: (rv) => pairFrame(rv, `<div class="rv-vs"><div class="vs-n">VS</div><div class="three" data-three>3</div><p>Get ready… the fastest <b>right</b> answer wins!</p></div>`),
      duel: (rv) => pairFrame(rv, duelCenter(rv, false)),
      duelResult: (rv) => pairFrame(rv, duelCenter(rv, true) + `<div class="rv-result">${duelResultText(rv)}</div>`),
      spin: (rv) => pairFrame(rv, `${wheelHtml(rv)}<div class="rv-prompt">🎡 ${nm(P(rv.spin.by))}, press <b>SPIN</b> on your phone!<span class="auto">auto-spin in <b data-cd></b> s</span></div>`),
      spinning: (rv) => pairFrame(rv, `${wheelHtml(rv)}<div class="rv-prompt">🥁 Spinning…</div>`),
      effect: (rv) => pairFrame(rv, `${wheelHtml(rv, 'small')}${effectBanner(rv)}`),
      outro: (rv) => `<div class="rv-outro">
          <h1 class="rv-title small">REVENGE COMPLETE</h1>
          <div class="rv-recap">${rv.pairs.map(recapRow).join('') || '<p class="rv-sub">Nobody took revenge… 🦗</p>'}</div>
          <p class="rv-sub">🏆 And now… the <b>final ranking!</b></p>
        </div>`
    };

    // -----------------------------------------------------------------------
    // Live parts
    // -----------------------------------------------------------------------
    function updatePick(rv) {
      for (const c of rv.cast) {
        const el = content.querySelector(`[data-pick="${c.id}"]`);
        if (!el) continue;
        const pk = rv.picks[c.id];
        el.classList.toggle('done', !!pk);
        el.innerHTML = pk
          ? `<span>🎯</span>${nm(P(pk.targetId))}${pk.auto ? '<small>⏰ too slow: the tallest house was chosen</small>' : ''}`
          : '<span class="thinking">🤔 choosing<i>.</i><i>.</i><i>.</i></span>';
      }
      const box = content.querySelector('[data-targets]');
      if (!box) return;
      const taken = new Map(Object.entries(rv.picks).map(([a, x]) => [x.targetId, a]));
      const castIds = new Set(rv.cast.map((c) => c.id));
      const list = HT.ranked(S.players.filter((p) => !castIds.has(p.id)));
      box.classList.toggle('many', list.length > 18);
      box.innerHTML = list.map((p) => {
        const by = taken.get(p.id);
        const pop = by && !seenPicks.has(p.id);
        if (by) seenPicks.add(p.id);
        return `<div class="tchip ${by ? 'taken' : ''} ${pop ? 'pop' : ''}" style="--c:${p.color}"><span class="av">${esc(p.avatar)}</span><span class="nm">${esc(p.name)}</span>
          <span class="fl">${p.floors} 🏢</span>${by ? `<span class="by">🎯 ${esc(P(by).avatar)}</span>` : ''}</div>`;
      }).join('');
    }

    function statusOf(rv, pr, id) {
      const d = rv.duel;
      const s = rv.step;
      if (s === 'duelIntro') return '<span class="fst ready">😤 Ready…</span>';
      if (s === 'duel' || s === 'duelResult') {
        const x = d && d.answers[id];
        if (x) return x.correct ? `<span class="fst ok">✅ ${sec2(x.ms)} s</span>` : '<span class="fst no">❌ Wrong!</span>';
        return d && d.done ? '<span class="fst no">⌛ Too slow</span>' : '<span class="fst think">🤔 thinking…</span>';
      }
      if (s === 'effect' && pr.res && !pr.res.skipped) {
        if (pr.res.victim === id && !pr.res.lost) return `<span class="fst ok">${pr.res.absorbed ? '🛡️ Blocked!' : '🤷 Nothing to lose'}</span>`;
        if (pr.res.victim === id) return `<span class="fst no">${pr.res.outcome === 'self' ? '🧨' : '💥'} −${pr.res.lost}</span>`;
        return pr.res.outcome === 'self' ? '<span class="fst ok">😅 Saved!</span>' : '<span class="fst ok">😈 Revenge!</span>';
      }
      if (rv.spin) return rv.spin.by === id ? '<span class="fst ok">🎡 Spins the wheel</span>' : '<span class="fst think">😬 Praying…</span>';
      return '';
    }

    function updateFighters(rv, pr) {
      const flying = rv.step === 'effect' && pr.res && HT.clock.now() - rv.at < LAND_MS; // not landed yet
      for (const id of [pr.a, pr.t]) {
        const p = P(id);
        const floors = flying && pr.res.victim === id ? pr.res.before : p.floors;
        const shield = flying && pr.res.victim === id && pr.res.absorbed ? Math.max(p.shield, pr.res.absorbed) : p.shield;
        const f = content.querySelector(`[data-fl="${id}"]`);
        if (f) f.innerHTML = `🏢 <b>${floors}</b> floor${floors === 1 ? '' : 's'}${shield ? ` <span class="sh">🛡️ ${shield}</span>` : ''}`;
        const st = content.querySelector(`[data-st="${id}"]`);
        if (st) st.innerHTML = flying ? (rv.spin && rv.spin.by === id ? '<span class="fst ok">🎡 Spinner</span>' : '<span class="fst think">😱 Incoming…</span>') : statusOf(rv, pr, id);
      }
      if (rv.step === 'duel' && rv.duel) {
        for (const [id, x] of Object.entries(rv.duel.answers)) {
          if (heard.has(id)) continue;
          heard.add(id);
          if (x.correct) Sfx.ding(); else Sfx.buzzer();
        }
      }
    }

    function updateArena(rv) {
      const pr = PAIR_STEPS.includes(rv.step) ? pairOf(rv) : null;
      root.classList.toggle('with-arena', !!pr);
      if (!pr) { if (arenaKey) { arena.update([]); arenaKey = ''; } return; }
      const a = P(pr.a);
      const t = P(pr.t);
      const k = [a.id, a.floors, a.shield, t.id, t.floors, t.shield].join(':');
      if (k === arenaKey) return;
      arenaKey = k;
      // avenger on the left, enemy on the right
      arena.update([{ ...a, plot: 1, mode: 'idle' }, { ...t, plot: 2, mode: 'idle' }]);
    }

    // -----------------------------------------------------------------------
    // Wheel
    // -----------------------------------------------------------------------
    function wheelAngle(rv) {
      const seg = 360 / rv.wheel.length;
      return 360 * 6 + (360 - (rv.spin.slice + rv.spin.offset) * seg);
    }
    function startWheel(rv, fresh) {
      const w = content.querySelector('[data-wheel]');
      if (!w || !rv.spin || rv.spin.slice < 0) return;
      const R = wheelAngle(rv);
      const dur = Math.max(800, (rv.ms || 5500) - 500);
      if (!fresh) { w.style.transform = `rotate(${R}deg)`; return; }
      w.style.transform = 'rotate(0deg)';
      void w.offsetWidth;
      w.style.transition = `transform ${dur}ms cubic-bezier(.15,.55,.1,1)`;
      w.style.transform = `rotate(${R}deg)`;
      // clicks that slow down with the wheel
      let t = 0;
      let gap = 40;
      while (t < dur - 150) { after(t, () => Sfx.wheelTick()); t += gap; gap *= 1.085; }
      after(dur, () => { Sfx.ding(); markWin(rv); });
    }
    function setWheel(rv) {
      const w = content.querySelector('[data-wheel]');
      if (!w || !rv.spin || rv.spin.slice < 0) return;
      w.style.transform = `rotate(${wheelAngle(rv) % 360}deg)`;
      markWin(rv);
    }
    function markWin(rv) {
      content.querySelectorAll('.wl').forEach((el) => el.classList.toggle('win', Number(el.dataset.i) === rv.spin.slice));
    }

    // -----------------------------------------------------------------------
    // Effects
    // -----------------------------------------------------------------------
    function onEvent(ev) {
      if (ev.type === 'attack' && ['crush', 'missile', 'self'].includes(ev.kind)) {
        arena.attack(ev);
        if (ev.kind === 'missile') Sfx.missile(); else if (ev.kind === 'self') Sfx.fuse(); else Sfx.whistle();
        return true;
      }
      if (ev.type === 'rvPick') { Sfx.lock(); return true; }
      return false;
    }

    function landed(ev) {
      Sfx.boom(true);
      if (ev.kind === 'missile' && P(ev.to).shield) setTimeout(() => arena.floatText(ev.to, '🚀 shield ignored!', 'shield'), 350);
    }

    function emojiRain(list, n) {
      for (let i = 0; i < n; i++) {
        const e = document.createElement('span');
        e.className = 'rain';
        e.textContent = list[i % list.length];
        e.style.left = (Math.random() * 96).toFixed(1) + '%';
        e.style.fontSize = Math.round(30 + Math.random() * 50) + 'px';
        e.style.animationDuration = Math.round(2200 + Math.random() * 1800) + 'ms';
        e.style.animationDelay = Math.round(Math.random() * 900) + 'ms';
        fx.appendChild(e);
        setTimeout(() => e.remove(), 5200);
      }
    }
    function shake() { root.classList.remove('shake'); void root.offsetWidth; root.classList.add('shake'); }
    function flash() {
      const f = document.createElement('div');
      f.className = 'rv-flash';
      fx.appendChild(f);
      setTimeout(() => f.remove(), 700);
    }

    return { render, tick, onEvent };
  };
})(window.HT);
