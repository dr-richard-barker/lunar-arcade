/* ==========================================================================
   REGOLITH ROVERS — setup screen, HUD, compass and results
   ========================================================================== */
'use strict';
var RR = globalThis.RR || (globalThis.RR = {});

(function () {
  const P = RR.physics;
  const $ = id => document.getElementById(id);
  const CTRL_LABEL = { human: 'HUMAN', cadet: 'CPU · CADET', specialist: 'CPU · SPECIALIST', commander: 'CPU · COMMANDER' };
  const PLANET_COLOR = ['#e9e6dd', '#ff7a4a', '#5aa7ff'];
  const COMPASS_NAMES = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  /* ------------------------------------------------------------ setup */
  const DEFAULTS = {
    arena: 'surface', dogs: 3, timer: 45, planet: 0, training: 1,
    teams: [{ name: RR.TEAM_NAMES[0], ctrl: 'human' }, { name: RR.TEAM_NAMES[1], ctrl: 'specialist' }],
  };
  let setup = load();

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('rr_settings') || 'null'); } catch (e) { s = null; }
    s = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), s || {});
    if (!Array.isArray(s.teams) || s.teams.length < 2) s.teams = JSON.parse(JSON.stringify(DEFAULTS.teams));
    s.teams = s.teams.slice(0, 4);
    const q = new URLSearchParams(location.search);
    if (q.has('training')) s.training = q.get('training') === '0' ? 0 : 1;
    if (q.get('arena') === 'tube' || q.get('arena') === 'surface') s.arena = q.get('arena');
    return s;
  }
  function save() { try { localStorage.setItem('rr_settings', JSON.stringify(setup)); } catch (e) { /* private mode */ } }

  function bindOpts(id, key, num) {
    const box = $(id);
    const sync = () => box.querySelectorAll('.opt').forEach(o => o.classList.toggle('sel', String(setup[key]) === o.dataset.v));
    box.addEventListener('click', ev => {
      const o = ev.target.closest('.opt'); if (!o) return;
      setup[key] = num ? Number(o.dataset.v) : o.dataset.v; sync(); save();
    });
    sync();
  }

  function renderTeams() {
    const box = $('o-teams');
    box.innerHTML = '';
    setup.teams.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'teamrow';
      row.innerHTML = `<span class="sw" style="background:${RR.TEAM_COLORS[i]}"></span>
        <input type="text" maxlength="22" aria-label="Team ${i + 1} name">
        <select aria-label="Team ${i + 1} controller">
          <option value="human">Human</option><option value="cadet">CPU · Cadet</option>
          <option value="specialist">CPU · Specialist</option><option value="commander">CPU · Commander</option>
        </select>
        <button title="Remove team" aria-label="Remove team ${i + 1}">✕</button>`;
      const inp = row.querySelector('input'), sel = row.querySelector('select'), del = row.querySelector('button');
      inp.value = t.name; sel.value = t.ctrl;
      inp.addEventListener('input', () => { t.name = inp.value; save(); });
      sel.addEventListener('change', () => { t.ctrl = sel.value; save(); });
      del.disabled = setup.teams.length <= 2;
      del.addEventListener('click', () => { setup.teams.splice(i, 1); save(); renderTeams(); });
      box.appendChild(row);
    });
    $('b-addteam').disabled = setup.teams.length >= 4;
  }

  function initSetup() {
    bindOpts('o-arena', 'arena');
    bindOpts('o-dogs', 'dogs', true);
    bindOpts('o-timer', 'timer', true);
    bindOpts('o-planet', 'planet', true);
    bindOpts('o-training', 'training', true);
    renderTeams();
    $('b-addteam').addEventListener('click', () => {
      if (setup.teams.length >= 4) return;
      const i = setup.teams.length;
      setup.teams.push({ name: RR.TEAM_NAMES[i], ctrl: 'cadet' });
      save(); renderTeams();
    });
  }

  function missionConfig(seed) {
    const arena = setup.arena === 'random' ? (Math.random() < 0.5 ? 'surface' : 'tube') : setup.arena;
    return {
      arena, seed: seed != null ? seed : (Math.random() * 2 ** 31) >>> 0,
      teams: setup.teams.map((t, i) => ({ name: (t.name || '').trim() || RR.TEAM_NAMES[i], ctrl: t.ctrl, color: RR.TEAM_COLORS[i] })),
      dogsPerTeam: setup.dogs, turnTime: setup.timer, planet: setup.planet, gdir: 180, training: !!setup.training,
    };
  }

  /* ---------------------------------------------------------- screens */
  let stack = [];
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    if (id) { $(id).classList.add('active'); stack.push(id); }
  }
  function back() {
    stack.pop();
    const prev = stack.pop();
    show(prev || null);
  }
  function hideAll() { stack = []; document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); }

  /* --------------------------------------------------------------- HUD */
  let G = null, last = {}, toastTimer = 0;

  function attach(game) {
    G = game; last = {};
    const bar = $('weapons');
    bar.innerHTML = '';
    for (const w of RR.WEAPONS) {
      const b = document.createElement('button');
      b.className = 'wslot'; b.dataset.w = w.id;
      b.title = `${w.name} (${w.key}) — ${w.desc}`;
      b.innerHTML = `<span class="k">${w.key}</span>${w.icon}<span class="n"></span>`;
      b.addEventListener('click', () => G && G.selectWeapon(w.id));
      bar.appendChild(b);
    }
    const tb = $('hud-teams');
    tb.innerHTML = '';
    for (const t of G.teams) {
      const r = document.createElement('div');
      r.className = 'tbar';
      r.innerHTML = `<span class="nm" style="color:${t.color}"></span><span class="bar" style="background:${t.color}"></span>`;
      r.querySelector('.nm').textContent = t.name;
      tb.appendChild(r);
    }
  }

  function setText(id, v) { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } }
  function setFlag(el, cls, on, key) { if (last[key] !== on) { last[key] = on; el.classList.toggle(cls, on); } }

  function update(game, ff) {
    G = game;
    const team = G.team(), dog = G.active;
    if (team) {
      setText('h-team', team.name);
      if (last.sw !== team.color) { last.sw = team.color; $('h-swatch').style.background = team.color; }
      setText('h-dog', dog ? dog.name : '—');
      setText('h-hp', dog ? String(dog.hp) : '');
      setText('h-ctrl', team.ctrl !== 'human' ? CTRL_LABEL[team.ctrl] : team.auto ? '◈ AUTO AI' : '');
    }
    let tm = '', ph = '';
    if (G.phase === 'aim') {
      tm = G.timer === Infinity ? '∞' : String(Math.ceil(G.timer));
      ph = G.isAI() ? (G.ai && G.ai.stage === 'think' ? 'COMPUTING' : 'AIMING') : (G.thrusting ? 'THRUSTER' : 'YOUR MOVE');
    } else if (G.phase === 'flight') { tm = ''; ph = 'IN FLIGHT'; }
    else if (G.phase === 'retreat') { tm = String(Math.ceil(G.retreat)); ph = 'RETREAT'; }
    else if (G.phase === 'settle') { tm = ''; ph = 'SETTLING'; }
    else if (G.phase === 'over') { tm = '—'; ph = 'MISSION OVER'; }
    setText('h-timer', tm); setText('h-phase', ph);
    setFlag($('h-timer'), 'low', G.phase === 'aim' && G.timer <= 5, 'low');
    if (G.phase === 'aim' && !G.isAI() && G.timer !== Infinity && G.timer <= 5) {
      const s = Math.ceil(G.timer);
      if (last.tick !== s) { last.tick = s; RR.Audio.tick(); }
    }

    const auto = $('b-auto');
    const canAuto = !!team && team.ctrl === 'human' && !G.over;
    if (last.canAuto !== canAuto) { last.canAuto = canAuto; auto.disabled = !canAuto; auto.title = canAuto ? 'Hand this team to the AI (F)' : 'This team is computer-controlled'; }
    setFlag(auto, 'on', !!team && (team.auto || team.ctrl !== 'human'), 'autoOn');
    setFlag($('b-ammo'), 'on', G.infiniteAmmo, 'ammoOn');

    const canG = G.canSetGravity();
    const pl = P.PLANETS[G.planet];
    setText('p-icon', pl.icon); setText('p-name', pl.name.toUpperCase()); setText('p-g', pl.g.toFixed(2) + ' m/s²');
    if (last.canG !== canG) {
      last.canG = canG;
      $('b-planet').disabled = !canG; $('g-readout').disabled = !canG;
      $('compass').classList.toggle('locked', !canG);
    }
    setText('g-readout', `g points ${COMPASS_NAMES[Math.round(G.gdir / 22.5) % 16]} · ${G.gdir}°`);
    drawCompass();

    // weapons
    const human = G.humanTurn();
    const wkey = [G.aim.weapon, human, G.infiniteAmmo, team ? team.idx : -1, team ? JSON.stringify(team.ammo) : ''].join('|');
    if (last.wkey !== wkey) {
      last.wkey = wkey;
      document.querySelectorAll('.wslot').forEach(b => {
        const id = b.dataset.w, n = team ? G.ammoOf(team, id) : 0;
        b.classList.toggle('sel', id === G.aim.weapon);
        b.disabled = !human || n <= 0;
        b.querySelector('.n').textContent = n === Infinity ? (RR.WEAPON[id].ammo === Infinity ? '' : '∞') : String(n);
      });
    }
    const showFuse = G.aim.weapon === 'ball' && G.phase === 'aim';
    setFlag($('fuse'), 'off', !showFuse, 'fuseOff');
    setText('fuse-s', G.aim.fuse + ' s');

    setText('info-line', infoLine());
    setFlag($('ff-badge'), 'off', !ff, 'ff');

    // team bars
    const bars = $('hud-teams').children;
    G.teams.forEach((t, i) => {
      const hp = t.dogs.reduce((s, d) => s + (d.alive ? d.hp : 0), 0);
      const key = 't' + i;
      const v = hp + '|' + (G.teamIdx === i) + '|' + G.teamAlive(t);
      if (last[key] !== v && bars[i]) {
        last[key] = v;
        bars[i].querySelector('.bar').style.width = Math.round(hp / (t.dogs.length * 100) * 120) + 'px';
        bars[i].classList.toggle('turn', G.teamIdx === i);
        bars[i].classList.toggle('dead', !G.teamAlive(t));
      }
    });
  }

  function infoLine() {
    const parts = [];
    const W = RR.WEAPON[G.aim.weapon], pl = P.PLANETS[G.planet];
    if (G.phase === 'aim' && G.active) {
      if (W.kind === 'charge') {
        parts.push(`${W.name} · aim ${Math.round(G.aim.angle)}°`);
        const pw = G.aim.charging ? G.aim.power : (G.cfg.training ? G.aim.lastPower : null);
        if (pw != null) parts.push(`launch ${(Math.max(0.03, pw) * P.V_MAX).toFixed(1)} m/s`);
        if (W.fuse) parts.push(`fuse ${G.aim.fuse} s`);
      } else if (W.id === 'thrust') {
        const twr = W.accel / pl.g;
        parts.push(G.thrusting ? `fuel ${Math.max(0, G.thrustFuel).toFixed(1)} s` : 'Thruster Pack');
        parts.push(`thrust/weight ${twr.toFixed(2)} on ${pl.name}`);
      } else if (W.kind === 'target') parts.push('Supply Drop · pick a point, then fire');
      else parts.push(W.name);
    }
    if (G.lastShot) {
      const s = G.lastShot;
      parts.push(s.how === 'lost' ? `last shot left the arena after ${s.t.toFixed(1)} s` : `last shot ${s.t.toFixed(1)} s in flight, ${s.dist.toFixed(1)} m`);
    }
    return parts.join('  ·  ');
  }

  /* ---------------------------------------------------------- compass */
  let compassKey = '';
  function drawCompass() {
    const c = $('compass');
    const w = c.clientWidth || 110, dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = [G.planet, G.gdir, G.canSetGravity(), w, dpr].join('|');
    if (key === compassKey) return;
    compassKey = key;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(w * dpr); }
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, w);
    const cx = w / 2, cy = w / 2, r = w / 2 - 3;
    const gr = x.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
    gr.addColorStop(0, '#1b2638'); gr.addColorStop(1, '#0a101a');
    x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.strokeStyle = '#3b6ea5'; x.lineWidth = 2; x.stroke();
    for (let b = 0; b < 360; b += 15) {
      const a = b * Math.PI / 180, long = b % 90 === 0, mid = b % 45 === 0;
      const r0 = r - (long ? 9 : mid ? 7 : 4);
      x.strokeStyle = long ? '#c9d3e0' : '#4d5d74'; x.lineWidth = long ? 1.6 : 1;
      x.beginPath(); x.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); x.lineTo(cx + Math.sin(a) * (r - 2), cy - Math.cos(a) * (r - 2)); x.stroke();
    }
    x.fillStyle = '#8291a8'; x.font = `700 ${Math.max(9, w * 0.1)}px ui-monospace,Menlo,monospace`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const lr = r - w * 0.17;
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, b]) => {
      const a = b * Math.PI / 180; x.fillText(t, cx + Math.sin(a) * lr, cy - Math.cos(a) * lr);
    });
    const g = P.PLANETS[G.planet].g;
    const L = r * (0.32 + 0.42 * Math.sqrt(g / 9.81));
    const a = G.gdir * Math.PI / 180, ux = Math.sin(a), uy = -Math.cos(a), px = -uy, py = ux;
    const col = PLANET_COLOR[G.planet];
    x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 3.2; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx - ux * r * 0.18, cy - uy * r * 0.18); x.lineTo(cx + ux * (L - 8), cy + uy * (L - 8)); x.stroke();
    x.beginPath(); x.moveTo(cx + ux * L, cy + uy * L); x.lineTo(cx + ux * (L - 11) + px * 6, cy + uy * (L - 11) + py * 6);
    x.lineTo(cx + ux * (L - 11) - px * 6, cy + uy * (L - 11) - py * 6); x.closePath(); x.fill();
    x.fillStyle = '#e3e9f2'; x.beginPath(); x.arc(cx, cy, 3.5, 0, 7); x.fill();
  }

  function compassBearing(ev) {
    const rc = $('compass').getBoundingClientRect();
    const dx = ev.clientX - (rc.left + rc.width / 2), dy = ev.clientY - (rc.top + rc.height / 2);
    if (Math.hypot(dx, dy) < 6) return null;
    return Math.atan2(dx, -dy) * 180 / Math.PI;
  }

  function initHud(getGame) {
    const c = $('compass');
    let drag = false;
    c.addEventListener('pointerdown', ev => {
      const g = getGame(); if (!g || !g.canSetGravity()) return;
      drag = true; c.setPointerCapture(ev.pointerId);
      const b = compassBearing(ev); if (b != null) g.setGravityDir(b);
      ev.preventDefault();
    });
    c.addEventListener('pointermove', ev => {
      const g = getGame(); if (!drag || !g) return;
      const b = compassBearing(ev); if (b != null) g.setGravityDir(b);
    });
    const stop = () => { drag = false; };
    c.addEventListener('pointerup', stop); c.addEventListener('pointercancel', stop);
    c.addEventListener('dblclick', () => { const g = getGame(); if (g) g.setGravityDir(180); });
    $('g-readout').addEventListener('click', () => { const g = getGame(); if (g) g.setGravityDir(180); });
    $('b-planet').addEventListener('click', () => { const g = getGame(); if (g) g.cyclePlanet(); });
    $('b-auto').addEventListener('click', () => { const g = getGame(); if (g) g.toggleAuto(); });
    $('b-ammo').addEventListener('click', () => { const g = getGame(); if (g) g.setInfiniteAmmo(!g.infiniteAmmo); });
    $('b-fuse-dn').addEventListener('click', () => { const g = getGame(); if (g) g.setFuse(g.aim.fuse - 1); });
    $('b-fuse-up').addEventListener('click', () => { const g = getGame(); if (g) g.setFuse(g.aim.fuse + 1); });
  }

  /* ------------------------------------------------------------ toasts */
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  function onEvent(e) {
    const pl = P.PLANETS[G.planet];
    switch (e.type) {
      case 'turn': {
        const tag = e.team.ctrl !== 'human' ? ' · CPU' : e.team.auto ? ' · ◈ AUTO AI' : '';
        toast(`${e.team.name}: ${e.dog.name}'s turn${tag}`, 2000); break;
      }
      case 'thrust':
        toast(e.twr < 1
          ? `Thrust-to-weight ${e.twr.toFixed(2)} under ${pl.name} gravity: too weak to lift off level ground`
          : `Thrust-to-weight ${e.twr.toFixed(2)} on ${pl.name}: hold FIRE to burn, aim to steer`, 3400); break;
      case 'heavy': toast(`Thrust-to-weight ${e.twr.toFixed(2)}: ${pl.name} gravity wins — the pack can't lift you`, 3400); break;
      case 'lost': toast(`${e.dog.name} drifted out of the arena. Signal lost.`); break;
      case 'down': toast(`${e.dog.name} powered down.`); break;
      case 'noammo': toast(`Out of ${e.weapon.name}.`, 1600); break;
      case 'timeout': toast("Time's up.", 1400); break;
      case 'skip': toast('Turn skipped.', 1400); break;
      case 'auto': toast(`◈ Auto AI ${e.on ? 'on' : 'off'} for ${e.team.name}`, 1800); break;
      case 'ammo': toast(e.on ? '∞ Ammo on: every kit is bottomless' : '∞ Ammo off', 1800); break;
    }
  }

  /* ----------------------------------------------------------- results */
  function results(game) {
    const g = game;
    $('over-title').textContent = g.winner ? `${g.winner.name.toUpperCase()} WINS` : 'NO TEAM LEFT STANDING';
    $('over-title').style.color = g.winner ? g.winner.color : '';
    const badges = [];
    const autoTeams = g.teams.filter(t => t.usedAuto).map(t => t.name);
    if (autoTeams.length) badges.push(`◈ AUTO AI — ${autoTeams.join(', ')}`);
    if (g.usedInfinite) badges.push('∞ AMMO MATCH');
    if (!badges.length) badges.push('MANUAL');
    $('over-badges').innerHTML = badges.map(b => `<span class="badge">${escapeHtml(b)}</span>`).join(' ');
    const rows = g.teams.map(t => `<tr><td style="color:${t.color}">${escapeHtml(t.name)}</td><td>${t.dogs.filter(d => d.alive).length}/${t.dogs.length}</td><td>${t.shots}</td><td>${t.dealt}</td></tr>`).join('');
    const L = g.stats.longest;
    $('over-stats').innerHTML = `<table class="facts" style="margin:12px auto">
      <tr><th>team</th><th>dogs left</th><th>shots</th><th>damage dealt</th></tr>${rows}</table>
      <p class="dim">${g.turn} turns · ${g.stats.lostToSpace} dog${g.stats.lostToSpace === 1 ? '' : 's'} lost out of the arena${L ? ` · longest hit ${L.dist.toFixed(1)} m in ${L.t.toFixed(1)} s on ${P.PLANETS[L.planet].name}` : ''}</p>`;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  RR.UI = { initSetup, missionConfig, show, back, hideAll, attach, update, initHud, toast, onEvent, results,
    get setup() { return setup; }, redrawCompass() { compassKey = ''; } };
})();
