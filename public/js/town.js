/* HappyTown town renderer: houses on streets, floors that grow, bombs that fly. */
(function (HT) {
  const svg = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
  const WIN = '#fff1b3';
  const LINE = '<rect y="37" width="100" height="3" fill="rgba(0,0,0,0.16)"/>';
  const TILES = [
    svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" preserveAspectRatio="none"><rect x="15" y="9" width="24" height="20" rx="2" fill="${WIN}"/><rect x="61" y="9" width="24" height="20" rx="2" fill="${WIN}"/>${LINE}</svg>`),
    svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" preserveAspectRatio="none"><rect x="10" y="10" width="18" height="18" rx="2" fill="${WIN}"/><rect x="41" y="10" width="18" height="18" rx="2" fill="${WIN}"/><rect x="72" y="10" width="18" height="18" rx="2" fill="${WIN}"/>${LINE}</svg>`),
    svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" preserveAspectRatio="none"><rect x="16" y="9" width="68" height="20" rx="2" fill="${WIN}"/><rect x="49" y="9" width="2" height="20" fill="rgba(0,0,0,0.12)"/>${LINE}</svg>`)
  ];
  // Final Revenge projectiles. `orient`: the direction the emoji points to (degrees, screen
  // coordinates), so it can be turned along its flight path. `drop`: falls from the sky.
  const PROJ = {
    crush: { e: '☄️', orient: 135, cls: 'huge', dur: 1500 },
    missile: { e: '🚀', orient: -45, cls: 'huge', dur: 1500 },
    self: { e: '🧨', cls: 'big', drop: true, dur: 1200 }
  };
  const TINY = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" preserveAspectRatio="none"><rect x="20" y="12" width="60" height="14" fill="rgba(255,241,179,0.75)"/>${LINE}</svg>`);

  class Town {
    constructor(el, opts) {
      this.el = el;
      this.opts = Object.assign({ compact: false, meId: null, sky: true, maxW: 0, onImpact: null, onBuild: null }, opts || {});
      el.classList.add('town');
      if (this.opts.compact) el.classList.add('town-compact');
      if (this.opts.sky) {
        const sky = document.createElement('div');
        sky.className = 'town-sky';
        sky.innerHTML = '<div class="sun"></div><div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div><div class="hills"></div>';
        el.appendChild(sky);
      }
      this.streetsEl = document.createElement('div');
      this.streetsEl.className = 'town-streets';
      el.appendChild(this.streetsEl);
      this.houses = new Map();
      this.players = [];
      this.override = new Map(); // floors shown while bombs are still in the air
      this.pending = new Map(); // target id -> attack events not landed yet
      this.shieldHold = new Map(); // keep the shield dome visible until the bomb that breaks it lands
      this.shown = new Map();
      this.rowsKey = '';
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(el);
    }

    setMe(id) { this.opts.meId = id; }

    update(players) {
      this.players = [...players].sort((a, b) => a.plot - b.plot);
      const ids = new Set(this.players.map((p) => p.id));
      for (const [id, h] of this.houses) if (!ids.has(id)) { h.el.remove(); this.houses.delete(id); this.shown.delete(id); }
      for (const p of this.players) {
        let h = this.houses.get(p.id);
        if (!h) h = this.createHouse(p);
        this.paintHouse(h, p);
      }
      this.layout();
    }

    createHouse(p) {
      const el = document.createElement('div');
      el.className = 'house pop-in';
      el.dataset.id = p.id;
      el.innerHTML = `
        <div class="h-stack">
          <div class="h-badges"></div>
          <div class="h-count">0</div>
          <div class="h-roof"></div>
          <div class="h-body"><div class="h-door"></div></div>
          <div class="h-shield"></div>
          <div class="h-sign">🚧</div>
        </div>
        <div class="h-name"></div>`;
      const h = {
        el,
        stack: el.querySelector('.h-stack'),
        badges: el.querySelector('.h-badges'),
        count: el.querySelector('.h-count'),
        roof: el.querySelector('.h-roof'),
        body: el.querySelector('.h-body'),
        shield: el.querySelector('.h-shield'),
        name: el.querySelector('.h-name')
      };
      const variant = (p.plot - 1) % 3;
      el.dataset.variant = variant;
      el.style.setProperty('--tile', TILES[variant]);
      this.houses.set(p.id, h);
      setTimeout(() => el.classList.remove('pop-in'), 700);
      return h;
    }

    paintHouse(h, p) {
      const el = h.el;
      el.style.setProperty('--c', p.color);
      const isMe = p.id === this.opts.meId;
      el.classList.toggle('me', isMe);
      el.classList.toggle('offline', !p.connected && !p.isBot);
      el.classList.toggle('shielded', !!p.shield || this.shieldHold.has(p.id));
      el.classList.toggle('aiming', p.mode === 'target');
      const nameHtml = (isMe ? '<span class="you">YOU</span>' : '') +
        `<span class="av">${HT.esc(p.avatar || '🙂')}</span><span class="nm">${HT.esc(p.name)}</span>`;
      if (h.nameHtml !== nameHtml) { h.name.innerHTML = nameHtml; h.nameHtml = nameHtml; }
      h.name.title = p.name;
      let b = '';
      if (p.weapon) b += `<span class="bd bd-bomb" title="Holding bombs">💣<small>${p.weapon.n > 1 ? `${p.weapon.n}×` : ''}${p.weapon.dmg}</small></span>`;
      if (p.shield) b += `<span class="bd bd-shield" title="Shield">🛡️<small>${p.shield}</small></span>`;
      if (p.mode === 'target') b += '<span class="bd bd-aim" title="Aiming">🎯</span>';
      else if (p.mode === 'choose') b += '<span class="bd bd-think" title="Choosing">🤔</span>';
      else if (p.mode === 'capped') b += '<span class="bd bd-done" title="Finished this phase">✓</span>';
      if (!p.connected && !p.isBot) b += '<span class="bd bd-off" title="Offline">💤</span>';
      if (h.badgeHtml !== b) { h.badges.innerHTML = b; h.badgeHtml = b; }

      const prev = this.shown.get(p.id);
      const target = this.override.has(p.id) ? this.override.get(p.id) : p.floors;
      if (prev !== undefined && target > prev && !this.override.has(p.id)) {
        this.floatText(p.id, `+${target - prev}`, 'good');
        el.classList.remove('grow');
        void el.offsetWidth;
        el.classList.add('grow');
        if (this.opts.onBuild) this.opts.onBuild(target - prev, p);
      }
      this.shown.set(p.id, target);
      h.count.textContent = target;
      el.classList.toggle('empty', target === 0);
    }

    displayedFloors(p) { return this.override.has(p.id) ? this.override.get(p.id) : p.floors; }

    layout() {
      const W = this.streetsEl.clientWidth;
      const H = this.streetsEl.clientHeight;
      if (!W || !H) return;
      const compact = this.opts.compact;
      const N = Math.max(1, this.players.length);
      const maxW = this.opts.maxW || (compact ? 64 : 170);
      const minW = compact ? 30 : 64;
      let best = null;
      for (let r = 1; r <= Math.min(N, 6); r++) {
        const cols = Math.ceil(N / r);
        const hw = Math.min(maxW, W / cols);
        const rowH = H / r;
        const score = Math.min(hw, rowH * (compact ? 0.35 : 0.5)) - (hw < minW ? 1000 : 0);
        if (!best || score > best.score) best = { r, cols, hw, rowH, score };
      }
      const { r, cols, hw, rowH } = best;
      const key = `${r}:${cols}:${this.players.map((p) => p.id).join(',')}`;
      if (key !== this.rowsKey) {
        this.rowsKey = key;
        this.streetsEl.innerHTML = '';
        const streets = [];
        for (let i = 0; i < r; i++) {
          const st = document.createElement('div');
          st.className = 'street';
          this.streetsEl.appendChild(st);
          streets.push(st);
        }
        this.players.forEach((p, i) => {
          const h = this.houses.get(p.id);
          if (h) streets[Math.floor(i / cols)].appendChild(h.el);
        });
      }
      const multi = r >= 2;
      const bw = hw * (compact ? 0.66 : multi ? 0.52 : 0.6);
      const ground = compact ? 14 : Math.max(26, Math.min(multi ? 30 : 36, hw * 0.28));
      const roofH = bw * (multi ? 0.36 : 0.42);
      const topReserve = roofH + (compact ? 4 : 52);
      const avail = Math.max(10, rowH - ground - topReserve - 8);
      let maxF = 0;
      for (const p of this.players) maxF = Math.max(maxF, this.displayedFloors(p));
      const fh = Math.max(compact ? 1 : 2, Math.min(compact ? 10 : Math.min(40, bw * 0.42), avail / Math.max(maxF, 8)));
      const s = this.el.style;
      s.setProperty('--hw', hw + 'px');
      s.setProperty('--bw', bw + 'px');
      s.setProperty('--fh', fh + 'px');
      s.setProperty('--roof', roofH + 'px');
      s.setProperty('--ground', ground + 'px');
      s.setProperty('--namefs', Math.max(10, Math.min(16, hw * 0.12)) + 'px');
      this.el.classList.toggle('tiny', fh < 7);
      this.el.classList.toggle('nonames', compact && hw < 50);
      if (fh < 7) s.setProperty('--tile-tiny', TINY);
      for (const p of this.players) {
        const h = this.houses.get(p.id);
        if (!h) continue;
        const bodyH = this.displayedFloors(p) * fh;
        h.body.style.height = bodyH + 'px';
        h.shield.style.height = bodyH + roofH + 18 + 'px';
      }
    }

    floatText(id, text, kind) {
      const h = this.houses.get(id);
      if (!h) return;
      const f = document.createElement('div');
      f.className = `float-txt ${kind || ''}`;
      f.textContent = text;
      h.stack.appendChild(f);
      setTimeout(() => f.remove(), 1600);
    }

    roofPoint(id) {
      const h = this.houses.get(id);
      if (!h) return null;
      const r = (h.el.classList.contains('empty') ? h.stack : h.roof).getBoundingClientRect();
      const b = h.body.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: Math.min(r.top + r.height / 2, b.bottom - 6) };
    }

    // Animate an attack event: the projectile flies, then the target shakes and loses floors.
    // Several bombs can be in the air towards the same house; each one lands in server order.
    attack(ev) {
      const target = this.houses.get(ev.to);
      if (!target) return;
      const queue = this.pending.get(ev.to) || [];
      queue.push(ev);
      this.pending.set(ev.to, queue);
      if (queue.length === 1) this.override.set(ev.to, ev.before);
      if (ev.absorbed > 0) this.shieldHold.set(ev.to, (this.shieldHold.get(ev.to) || 0) + 1);
      const spec = PROJ[ev.kind] || null;
      const b = this.roofPoint(ev.to);
      let a = this.roofPoint(ev.from);
      if (spec && b && (spec.drop || ev.from === ev.to)) a = { x: b.x + 30, y: Math.max(10, b.y - 420) };
      const finish = () => {
        const q = this.pending.get(ev.to) || [];
        const i = q.indexOf(ev);
        if (i >= 0) q.splice(i, 1);
        if (q.length) this.override.set(ev.to, q[0].before);
        else { this.pending.delete(ev.to); this.override.delete(ev.to); }
        if (ev.absorbed > 0) {
          const n = (this.shieldHold.get(ev.to) || 1) - 1;
          if (n > 0) this.shieldHold.set(ev.to, n); else this.shieldHold.delete(ev.to);
        }
        const p = this.players.find((x) => x.id === ev.to);
        if (p) this.paintHouse(target, p);
        this.shown.set(ev.to, this.override.has(ev.to) ? this.override.get(ev.to) : p ? p.floors : ev.after);
        this.layout();
        target.el.classList.remove('shake');
        void target.el.offsetWidth;
        target.el.classList.add('shake');
        if (ev.lost > 0) this.floatText(ev.to, `−${ev.lost} ${ev.fromAvatar || ''}`.trim(), 'bad');
        if (ev.absorbed > 0) {
          setTimeout(() => this.floatText(ev.to, `🛡️ ${ev.absorbed} blocked`, 'shield'), ev.lost > 0 ? 350 : 0);
          target.el.classList.add('shield-hit');
          setTimeout(() => target.el.classList.remove('shield-hit'), 900);
        }
        if (this.opts.onImpact) this.opts.onImpact(ev);
      };
      const visible = this.el.offsetParent !== null && this.el.getBoundingClientRect().width > 0;
      if (!a || !b || !visible) { finish(); return; }
      const big = ev.kind === 'mega' || ev.dmg >= 5 || !!spec;
      const proj = document.createElement('div');
      proj.className = 'projectile' + (this.opts.compact ? ' small' : spec ? ` ${spec.cls} k-${ev.kind}` : big ? ' big' : ev.kind === 'mini' ? ' proj-mini' : '');
      proj.textContent = spec ? spec.e : '💣';
      document.body.appendChild(proj);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const arc = spec && spec.drop ? 0 : Math.max(80, Math.min(320, dist * (spec ? 0.32 : 0.45))) * (this.opts.compact ? 0.6 : 1);
      const frames = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t - arc * 4 * t * (1 - t);
        let rot = t * 520;
        if (spec && spec.orient !== undefined) { // point along the flight path
          const dx = b.x - a.x;
          const dy = b.y - a.y - arc * 4 * (1 - 2 * t);
          rot = (Math.atan2(dy, dx) * 180) / Math.PI - spec.orient;
        } else if (spec && spec.drop) rot = Math.sin(t * Math.PI * 6) * 25;
        frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rot}deg) scale(${1 + 0.35 * Math.sin(Math.PI * t)})` });
      }
      const dur = this.opts.compact ? 700 : spec ? spec.dur : Math.max(750, Math.min(1300, 500 + dist * 0.8));
      const anim = proj.animate(frames, { duration: dur, easing: 'cubic-bezier(.45,.05,.55,.95)' });
      let done = false;
      const land = () => {
        if (done) return;
        done = true;
        proj.remove();
        this.explode(b, spec ? 'huge' : big, ev.absorbed > 0 && ev.lost === 0, target.el.style.getPropertyValue('--c'));
        finish();
      };
      anim.onfinish = land;
      setTimeout(land, dur + 400); // safety net (e.g. background tabs)
    }

    explode(pt, big, blocked, color) {
      const ex = document.createElement('div');
      ex.className = 'explosion' + (this.opts.compact ? ' small' : big === 'huge' ? ' big huge' : big ? ' big' : '') + (blocked ? ' blocked' : '');
      ex.style.left = pt.x + 'px';
      ex.style.top = pt.y + 'px';
      ex.innerHTML = `<span>${blocked ? '✨' : '💥'}</span>`;
      if (!blocked) {
        const n = this.opts.compact ? 6 : big === 'huge' ? 26 : big ? 14 : 9;
        for (let i = 0; i < n; i++) {
          const d = document.createElement('i');
          const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
          const r = this.opts.compact ? 25 + Math.random() * 15 : (big === 'huge' ? 170 : big ? 90 : 60) + Math.random() * 40;
          d.style.setProperty('--dx', Math.cos(ang) * r + 'px');
          d.style.setProperty('--dy', Math.sin(ang) * r - 30 + 'px');
          d.style.background = i % 3 === 0 ? '#ffb703' : color || '#888';
          ex.appendChild(d);
        }
      }
      document.body.appendChild(ex);
      setTimeout(() => ex.remove(), 1100);
    }
  }

  HT.Town = Town;
})(window.HT);
