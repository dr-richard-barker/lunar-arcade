/* ==========================================================================
   REGOLITH ROVERS — boot, main loop, input and camera
   The simulation runs on a fixed 1/120 s step; the screen draws whenever the
   browser gives it a frame. Behind the title screen two CPU teams play an
   attract-mode match on a fresh arena.
   ========================================================================== */
'use strict';
var RR = globalThis.RR || (globalThis.RR = {});

(function () {
  const P = RR.physics, UI = RR.UI, DT = P.DT;
  const $ = id => document.getElementById(id);
  const canvas = $('view');
  const R = RR.createRenderer(canvas);
  R.resize();

  let G = null, mode = 'attract', paused = false, lastCfg = null;
  let fastHeld = false, fastToggle = false, acc = 0, last = performance.now();
  let camHold = 0, overview = false, userZoom = null;

  /* ------------------------------------------------------------ games */
  function attract() {
    mode = 'attract';
    G = RR.createGame({
      arena: Math.random() < 0.5 ? 'surface' : 'tube', seed: (Math.random() * 2 ** 31) >>> 0,
      teams: [{ ctrl: 'commander' }, { ctrl: 'specialist' }], dogsPerTeam: 3, turnTime: 0,
      planet: Math.floor(Math.random() * 3), training: false,
    });
    R.attach(G); G.start();
    $('hud').classList.add('off');
    snapCamera();
  }

  function startMission(cfg) {
    lastCfg = cfg;
    mode = 'play'; paused = false; overview = false; userZoom = null; camHold = 0;
    RR.Audio.init();
    G = RR.createGame(cfg);
    R.attach(G); UI.attach(G);
    UI.hideAll();
    $('hud').classList.remove('off');
    G.start();
    snapCamera();
    UI.redrawCompass();
  }

  function quitToTitle() {
    paused = false;
    RR.Audio.thrust(false);
    attract();
    UI.hideAll(); UI.show('screen-title');
  }

  /* ----------------------------------------------------------- camera */
  function baseZoom() { return Math.max(0.75, Math.min(2.2, R.vw / 760)); }
  function fitZoom() { return Math.min(R.vw / G.world.W, R.vh / G.world.H) * 0.98; }

  function camTarget() {
    if (overview) return { x: G.world.W / 2, y: G.world.H / 2 };
    const main = G.projectiles.find(p => p.main) || G.projectiles[0];
    if (main) return main;
    let fly = null, fs = 0;
    for (const d of G.dogs) if (d.alive && !d.grounded) { const s = Math.hypot(d.vx, d.vy) + 0.01; if (s > fs) { fs = s; fly = d; } }
    if (fly && !(fly === G.active && G.phase === 'aim' && fs < 0.5)) return fly;
    if (G.phase === 'aim' && RR.WEAPON[G.aim.weapon].kind === 'target' && G.aim.target && G.humanTurn()) return G.aim.target;
    if (G.active && G.active.alive) return G.active;
    return null;
  }

  function snapCamera() {
    const t = camTarget() || { x: G.world.W / 2, y: G.world.H / 2 };
    R.cam.x = t.x; R.cam.y = t.y; R.cam.zoom = mode === 'attract' ? baseZoom() * 0.8 : baseZoom();
  }

  function updateCamera(dt) {
    const cam = R.cam;
    const zTarget = overview ? fitZoom() : (userZoom || (mode === 'attract' ? baseZoom() * 0.8 : baseZoom()));
    cam.zoom += (zTarget - cam.zoom) * Math.min(1, dt * 5);
    if (camHold > 0) camHold -= dt;
    else {
      const t = camTarget();
      if (t) {
        const k = Math.min(1, dt * (G.projectiles.length ? 6 : 3.5));
        cam.x += (t.x - cam.x) * k; cam.y += (t.y - cam.y) * k;
      }
    }
    cam.x = Math.max(-200, Math.min(G.world.W + 200, cam.x));
    cam.y = Math.max(-1500, Math.min(G.world.H + 150, cam.y));
  }

  /* ------------------------------------------------------------- loop */
  function frame(now) {
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (G && !paused) {
      const ffOk = mode === 'attract' || G.phase !== 'aim' || G.isAI();
      const fast = (fastHeld || fastToggle) && ffOk;
      acc += dtReal * (fast ? 3 : 1);
      let steps = 0;
      while (acc >= DT && steps < 60) { G.update(DT); R.step(DT); acc -= DT; steps++; }
      if (steps >= 60) acc = 0;
      for (const e of G.drain()) {
        R.onEvent(e);
        if (mode === 'play') {
          RR.Audio.onEvent(e); UI.onEvent(e);
          if (e.type === 'turn') { camHold = 0; overview = false; }
          if (e.type === 'over') setTimeout(() => { if (mode === 'play' && G.over) { UI.results(G); UI.show('screen-over'); } }, 1600);
        }
      }
      if (mode === 'attract' && G.over) attract();
      RR.Audio.thrust(mode === 'play' && !!G.thrustVec);
      updateCamera(dtReal);
      if (mode === 'play') UI.update(G, fast);
    }
    if (G) R.draw();
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------- keyboard */
  const HELD = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ' ': 'fire' };

  function playing() { return mode === 'play' && !paused && G && !G.over; }

  window.addEventListener('keydown', ev => {
    const tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.key === 'Shift') { fastHeld = true; return; }
    if ((ev.key === 'Escape' || ev.key === 'p' || ev.key === 'P') && mode === 'play' && G && !G.over) { togglePause(); ev.preventDefault(); return; }
    if (!playing()) return;
    if (HELD[ev.key]) { G.input[HELD[ev.key]] = true; ev.preventDefault(); return; }
    if (ev.repeat) return;
    const k = ev.key;
    if (k === 'Enter') { G.jump(); ev.preventDefault(); }
    else if (/^[0-8]$/.test(k)) { const w = RR.WEAPONS.find(x => x.key === k); if (w) G.selectWeapon(w.id); }
    else if (k === 'q' || k === 'Q') G.setFuse(G.aim.fuse - 1);
    else if (k === 'e' || k === 'E') G.setFuse(G.aim.fuse + 1);
    else if (k === 'g' || k === 'G') G.cyclePlanet();
    else if (k === '[') G.setGravityDir(G.gdir - 15);
    else if (k === ']') G.setGravityDir(G.gdir + 15);
    else if (k === 'v' || k === 'V') G.setGravityDir(180);
    else if (k === 'f' || k === 'F') G.toggleAuto();
    else if (k === 'u' || k === 'U') G.setInfiniteAmmo(!G.infiniteAmmo);
    else if (k === 't' || k === 'T') toggleTraining();
    else if (k === 'm' || k === 'M') toggleMute();
    else if (k === 'z' || k === 'Z') toggleOverview();
    else if (k === '+' || k === '=') zoomBy(1.2);
    else if (k === '-' || k === '_') zoomBy(1 / 1.2);
  });
  window.addEventListener('keyup', ev => {
    if (ev.key === 'Shift') { fastHeld = false; return; }
    if (G && HELD[ev.key]) G.input[HELD[ev.key]] = false;
  });
  function clearInputs() { if (G) for (const k in G.input) G.input[k] = false; fastHeld = false; }
  window.addEventListener('blur', clearInputs);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInputs(); });

  /* -------------------------------------------------- pointer on canvas */
  const pointers = new Map();
  let pinch0 = null, dragFrom = null;
  canvas.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'touch') document.body.classList.add('touch');
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: userZoom || R.cam.zoom };
      dragFrom = null; return;
    }
    if (mode === 'play' && G && G.humanTurn() && RR.WEAPON[G.aim.weapon].kind === 'target') {
      const w = R.screenToWorld(ev.clientX, ev.clientY);
      G.setTarget(w.x, w.y); dragFrom = { target: true }; return;
    }
    dragFrom = { x: ev.clientX, y: ev.clientY };
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', ev => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2 && pinch0) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      userZoom = Math.max(0.3, Math.min(3, pinch0.z * d / Math.max(1, pinch0.d)));
      camHold = 2.5; return;
    }
    if (!dragFrom) return;
    if (dragFrom.target) { const w = R.screenToWorld(ev.clientX, ev.clientY); G.setTarget(w.x, w.y); return; }
    R.cam.x -= (ev.clientX - dragFrom.x) / R.cam.zoom;
    R.cam.y -= (ev.clientY - dragFrom.y) / R.cam.zoom;
    dragFrom = { x: ev.clientX, y: ev.clientY };
    camHold = 2.5;
  });
  const up = ev => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch0 = null;
    if (!pointers.size) { dragFrom = null; canvas.classList.remove('dragging'); }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', ev => { ev.preventDefault(); zoomBy(ev.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });

  function zoomBy(f) { userZoom = Math.max(0.3, Math.min(3, (userZoom || R.cam.zoom) * f)); overview = false; }

  /* ---------------------------------------------------------- touch pad */
  document.querySelectorAll('#touchpad button').forEach(b => {
    const k = b.dataset.k;
    const on = ev => {
      ev.preventDefault(); b.classList.add('held');
      if (!playing()) return;
      if (k === 'jump') G.jump(); else G.input[k] = true;
    };
    const off = () => { b.classList.remove('held'); if (G && k !== 'jump') G.input[k] = false; };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
  });

  /* ------------------------------------------------------- HUD buttons */
  function togglePause() {
    paused = !paused;
    clearInputs();
    if (paused) UI.show('screen-pause'); else UI.hideAll();
  }
  function toggleMute() {
    RR.Audio.setMuted(!RR.Audio.muted);
    $('b-sound').textContent = RR.Audio.muted ? '🔇' : '🔊';
    try { localStorage.setItem('rr_mute', RR.Audio.muted ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  function toggleTraining() {
    if (!G) return;
    G.cfg.training = !G.cfg.training;
    $('b-arc').classList.toggle('on', G.cfg.training);
    UI.toast(G.cfg.training ? 'Training aid on: predicted arc and launch speed' : 'Training aid off', 1600);
  }
  function toggleOverview() { overview = !overview; $('b-zoom').classList.toggle('on', overview); if (!overview) userZoom = null; }

  $('b-menu').addEventListener('click', () => { if (mode === 'play' && G && !G.over) togglePause(); });
  $('b-sound').addEventListener('click', toggleMute);
  $('b-arc').addEventListener('click', toggleTraining);
  $('b-zoom').addEventListener('click', toggleOverview);
  $('b-ff').addEventListener('click', () => { fastToggle = !fastToggle; $('b-ff').classList.toggle('on', fastToggle); });
  UI.initHud(() => (mode === 'play' && !paused ? G : null));

  /* ------------------------------------------------------------ screens */
  UI.initSetup();
  $('b-start').addEventListener('click', () => { startMission(UI.missionConfig()); $('b-arc').classList.toggle('on', !!G.cfg.training); });
  $('b-manual').addEventListener('click', () => UI.show('screen-manual'));
  $('b-controls').addEventListener('click', () => UI.show('screen-controls'));
  $('b-pmanual').addEventListener('click', () => UI.show('screen-manual'));
  $('b-pcontrols').addEventListener('click', () => UI.show('screen-controls'));
  $('b-resume').addEventListener('click', togglePause);
  $('b-quit').addEventListener('click', quitToTitle);
  $('b-rematch').addEventListener('click', () => {
    const cfg = Object.assign({}, lastCfg, { seed: (Math.random() * 2 ** 31) >>> 0 });
    if (UI.setup.arena === 'random') cfg.arena = Math.random() < 0.5 ? 'surface' : 'tube';
    startMission(cfg);
  });
  $('b-setup').addEventListener('click', quitToTitle);
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => UI.back()));

  window.addEventListener('resize', () => { R.resize(); UI.redrawCompass(); });
  try { if (localStorage.getItem('rr_mute') === '1') { RR.Audio.setMuted(true); $('b-sound').textContent = '🔇'; } } catch (e) { /* ignore */ }

  UI.show('screen-title');
  attract();
  requestAnimationFrame(frame);

  // for debugging and automated checks
  RR.debug = { get game() { return G; }, get mode() { return mode; }, renderer: R, start: cfg => startMission(Object.assign(UI.missionConfig(), cfg || {})) };
})();
