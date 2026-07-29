/* ==========================================================================
   THE BORING MINING GAME
   An original lunar colony sim in the classic colony-sim tradition:
   you pilot one unit of a swarm, the swarm navigates by evaporating scent
   trails, and a rival colony is doing the same thing to the same rock.

   No assets, code or data from any commercial game are used here.
   ========================================================================== */
'use strict';

/* ----------------------------------------------------------------- config */
const MW = 160, MH = 96, TS = 12;             // map tiles + tile size (px)
const WW = MW * TS, WH = MH * TS;             // world size in px
const VW = 960, VH = 540;                     // viewport
const N = MW * MH;

const VAC = 0, REG = 1, BAS = 2, ORE = 3, ICE = 4, TUN = 5, HUB = 6, RHUB = 7, BED = 8;

const SOLID = [false, true, true, true, true, false, false, false, true];
const HARD  = [0, 62, 190, 105, 78, 0, 0, 0, 1e9];   // bore work per tile

const DAY_LEN = 75, NIGHT_LEN = 55;
const PLAYER = 0, HELIOS = 1;

const DIFF = [
  { name: 'SURVEY RUN',       foeRate: 0.55, foeRaid: 95, hub: 800,  crawlers: 3 },
  { name: 'CLAIM DISPUTE',    foeRate: 0.90, foeRaid: 70, hub: 950,  crawlers: 5 },
  { name: 'HOSTILE TAKEOVER', foeRate: 1.35, foeRaid: 48, hub: 1150, crawlers: 7 },
];

const COST = {
  miner: { ore: 16, ice: 7,  pwr: 9  },
  guard: { ore: 26, ice: 11, pwr: 15 },
};

/* ------------------------------------------------------------------ state */
let map, dmg, tileDirty, dirtyList;
let scent, scentTmp;                 // ore/ice smell — travels through rock
const trail = [null, null];          // "there was ore this way" per colony
const alarm = [null, null];          // "fighting here" / rally beacons
const home  = [null, null];          // BFS distance to own hub through tunnels
let fieldTmp;

let drones, crawlers, parts, colonies, player, cam, clock, running, paused;
let over = false, overWin = false;
let diff = 0, muted = false, showBeacons = false;
let frame = 0, navDirty = true, navTimer = 0;
let logLines = [];

/* --------------------------------------------------------------- elements */
const $ = id => document.getElementById(id);
const view = $('view'), vctx = view.getContext('2d');
const mini = $('mini'), mctx = mini.getContext('2d');
const terrain = document.createElement('canvas');
terrain.width = WW; terrain.height = WH;
const tctx = terrain.getContext('2d');

/* ------------------------------------------------------------------ utils */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const idx = (tx, ty) => ty * MW + tx;
const inb = (tx, ty) => tx >= 0 && ty >= 0 && tx < MW && ty < MH;

function nrand(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;               // -1 .. 1
}
function noise2(x, y, sc, s) {
  const fx = x / sc, fy = y / sc;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = nrand(x0, y0, s), b = nrand(x0 + 1, y0, s);
  const c = nrand(x0, y0 + 1, s), d = nrand(x0 + 1, y0 + 1, s);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}
/* two octaves — one octave of value noise is too blobby for rock strata */
function fbm(x, y, sc, s) {
  return noise2(x, y, sc, s) * 0.64 + noise2(x, y, sc * 0.42, s + 97) * 0.36;
}
const rnd = (a, b) => a + Math.random() * (b - a);

function solidPx(px, py) {
  const tx = px / TS | 0, ty = py / TS | 0;
  if (!inb(tx, ty)) return true;
  return SOLID[map[idx(tx, ty)]];
}
function blocked(x, y, r) {
  return solidPx(x - r, y - r) || solidPx(x + r, y - r) ||
         solidPx(x - r, y + r) || solidPx(x + r, y + r);
}

/* ------------------------------------------------------------------ audio */
let actx = null;
function beep(freq, dur, type, gain) {
  if (muted) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.05, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
  } catch (e) { /* audio is a nicety, never a failure */ }
}
const sfx = {
  bore:    () => beep(70 + Math.random() * 30, 0.05, 'sawtooth', 0.025),
  crack:   () => beep(180, 0.16, 'square', 0.05),
  deposit: () => beep(520, 0.09, 'sine', 0.06),
  print:   () => { beep(330, 0.07, 'square', 0.05); setTimeout(() => beep(494, 0.1, 'square', 0.05), 70); },
  beacon:  () => beep(760, 0.07, 'sine', 0.05),
  hit:     () => beep(120, 0.07, 'sawtooth', 0.045),
  die:     () => beep(90, 0.3, 'sawtooth', 0.07),
  win:     () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.22, 'square', 0.06), i * 130)),
  lose:    () => [400, 320, 240, 150].forEach((f, i) => setTimeout(() => beep(f, 0.3, 'sawtooth', 0.06), i * 160)),
};

/* -------------------------------------------------------------- world gen */
function generate() {
  map = new Uint8Array(N);
  dmg = new Float32Array(N);
  tileDirty = new Uint8Array(N);
  dirtyList = [];

  const surf = new Int16Array(MW);
  for (let x = 0; x < MW; x++) {
    surf[x] = Math.round(19 + noise2(x, 0, 30, 11) * 3.4 + noise2(x, 0, 8, 12) * 1.3);
  }

  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const i = idx(x, y);
      if (x < 2 || x > MW - 3 || y > MH - 3) { map[i] = BED; continue; }
      const d = y - surf[x];
      if (d < 0) { map[i] = VAC; continue; }

      let t = REG;
      if (d > 3 && fbm(x, y, 13, 21) > 0.34 - d * 0.0040) t = BAS;
      if (d > 5 && fbm(x, y, 7.5, 31) > 0.44) t = ORE;
      if (d > 12 && fbm(x, y, 9, 41) > 0.47) t = ICE;
      // lava tubes: open natural caverns in the deep rock
      if (d > 30 && fbm(x, y, 15, 51) > 0.46) t = TUN;
      map[i] = t;
    }
  }

  // hubs, one per colony, with a chamber and a surface shaft
  const px = 20, ex = MW - 21;
  colonies = [
    makeColony(PLAYER, px, surf[px] + 7, HUB),
    makeColony(HELIOS, ex, surf[ex] + 7, RHUB),
  ];
  carveBase(colonies[0], surf[px]);
  carveBase(colonies[1], surf[ex]);

  paintSky();
  for (let i = 0; i < N; i++) markTile(i % MW, i / MW | 0);
}

function makeColony(id, tx, ty, tile) {
  const d = DIFF[diff];
  return {
    id, tx, ty, tile,
    x: tx * TS, y: ty * TS,
    ore: 30, ice: 14, pwr: 60, pwrMax: 120,
    integrity: d.hub, integrityMax: d.hub,
    printCd: 0, raidCd: d.foeRaid * 0.6,
    auto: id === HELIOS, mined: 0, printed: 0, lost: 0,
    assaultOn: false, underAttack: 0, warnCd: 0, idleCd: 25,
  };
}

function carveBase(c, surfY) {
  // chamber
  for (let y = c.ty - 5; y <= c.ty + 2; y++)
    for (let x = c.tx - 5; x <= c.tx + 5; x++)
      if (inb(x, y)) map[idx(x, y)] = TUN;
  // fabricator block
  for (let y = c.ty; y <= c.ty + 2; y++)
    for (let x = c.tx - 2; x <= c.tx + 2; x++)
      if (inb(x, y)) map[idx(x, y)] = c.tile;
  // shaft to the surface for the solar array
  for (let y = surfY - 1; y < c.ty - 4; y++)
    for (let x = c.tx - 1; x <= c.tx + 1; x++)
      if (inb(x, y)) map[idx(x, y)] = TUN;
  c.surfY = surfY;
}

/* ------------------------------------------------------------------ fields */
function initFields() {
  scent = new Float32Array(N); scentTmp = new Float32Array(N);
  fieldTmp = new Float32Array(N);
  for (let k = 0; k < 2; k++) {
    trail[k] = new Float32Array(N);
    alarm[k] = new Float32Array(N);
    home[k] = new Uint16Array(N);
  }
  for (let p = 0; p < 40; p++) relaxScent();
  rebuildNav();
}

/* Ore smell. Relaxed in place with alternating scan direction, so a change
   (a mined-out seam) propagates out within a few frames on its own. */
let scentDir = 0;
function relaxScent() {
  const fwd = (scentDir++ & 1) === 0;
  const start = fwd ? 0 : N - 1, end = fwd ? N : -1, step = fwd ? 1 : -1;
  for (let i = start; i !== end; i += step) {
    const t = map[i];
    if (t === ORE || t === ICE) { scent[i] = 1; continue; }
    if (t === BED) { scent[i] = 0; continue; }
    const x = i % MW, y = (i / MW) | 0;
    let m = 0;
    if (x > 0)      { const v = scent[i - 1];  if (v > m) m = v; }
    if (x < MW - 1) { const v = scent[i + 1];  if (v > m) m = v; }
    if (y > 0)      { const v = scent[i - MW]; if (v > m) m = v; }
    if (y < MH - 1) { const v = scent[i + MW]; if (v > m) m = v; }
    scent[i] = m * (SOLID[t] ? 0.895 : 0.962);
  }
}

/* Pheromone: diffuse + evaporate, but only through open space. */
function diffuse(f, evap) {
  fieldTmp.set(f);
  for (let y = 1; y < MH - 1; y++) {
    for (let x = 1; x < MW - 1; x++) {
      const i = idx(x, y);
      if (SOLID[map[i]]) { f[i] = 0; continue; }
      let s = 0, n = 0;
      if (!SOLID[map[i - 1]])  { s += fieldTmp[i - 1];  n++; }
      if (!SOLID[map[i + 1]])  { s += fieldTmp[i + 1];  n++; }
      if (!SOLID[map[i - MW]]) { s += fieldTmp[i - MW]; n++; }
      if (!SOLID[map[i + MW]]) { s += fieldTmp[i + MW]; n++; }
      const avg = n ? s / n : fieldTmp[i];
      const v = (fieldTmp[i] * 0.66 + avg * 0.34) * evap;
      f[i] = v < 0.0009 ? 0 : v > 3 ? 3 : v;
    }
  }
}

/* Breadth-first distance from each hub through connected open tiles. */
const bfsQ = new Int32Array(N);
function rebuildNav() {
  for (let k = 0; k < 2; k++) {
    const h = home[k], c = colonies[k];
    h.fill(65535);
    let head = 0, tail = 0;
    for (let y = c.ty - 1; y <= c.ty + 3; y++)
      for (let x = c.tx - 3; x <= c.tx + 3; x++)
        if (inb(x, y) && !SOLID[map[idx(x, y)]]) { h[idx(x, y)] = 0; bfsQ[tail++] = idx(x, y); }
    while (head < tail) {
      const i = bfsQ[head++], d = h[i] + 1;
      const x = i % MW, y = (i / MW) | 0;
      if (x > 0      && h[i - 1]  === 65535 && !SOLID[map[i - 1]])  { h[i - 1]  = d; bfsQ[tail++] = i - 1; }
      if (x < MW - 1 && h[i + 1]  === 65535 && !SOLID[map[i + 1]])  { h[i + 1]  = d; bfsQ[tail++] = i + 1; }
      if (y > 0      && h[i - MW] === 65535 && !SOLID[map[i - MW]]) { h[i - MW] = d; bfsQ[tail++] = i - MW; }
      if (y < MH - 1 && h[i + MW] === 65535 && !SOLID[map[i + MW]]) { h[i + MW] = d; bfsQ[tail++] = i + MW; }
    }
  }
  navDirty = false;
}

/* Direction of steepest increase of a float field, at a tile. */
function grad(f, tx, ty, out) {
  let bx = 0, by = 0, best = -1;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const x = tx + dx, y = ty + dy;
    if (!inb(x, y)) continue;
    const v = f[idx(x, y)];
    if (v > best) { best = v; bx = dx; by = dy; }
  }
  out[0] = bx; out[1] = by; return best;
}

/* Step downhill on a BFS field: the open neighbour closest to the hub. */
function navHome(f, tx, ty, out) {
  let cur = f[idx(tx, ty)], bx = 0, by = 0, best = cur;
  if (cur === 65535) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const x = tx + dx, y = ty + dy;
    if (!inb(x, y)) continue;
    const v = f[idx(x, y)];
    if (v < best) { best = v; bx = dx; by = dy; }
  }
  out[0] = bx; out[1] = by;
  return bx !== 0 || by !== 0;
}

/* ---------------------------------------------------------------- entities */
function spawnDrone(col, caste, x, y) {
  const guard = caste === 'guard';
  const d = {
    col, caste, x, y, vx: 0, vy: 0,
    hp: guard ? 130 : 80, max: guard ? 130 : 80,
    ore: 0, ice: 0, cap: 3,
    state: 'search', dig: -1, wob: Math.random() * 6.28,
    cd: 0, hurt: 0, alive: true, boreTile: -1, assault: false,
    stuck: 0, panic: 0, px: 0, py: 0,
  };
  drones.push(d);
  return d;
}

function spawnCrawler(x, y) {
  crawlers.push({ x, y, vx: 0, vy: 0, hp: 110, max: 110, cd: 0, wob: Math.random() * 6.28, alive: true });
}

function puff(x, y, col, n) {
  for (let i = 0; i < n; i++)
    parts.push({ x, y, vx: rnd(-45, 45), vy: rnd(-45, 45), life: rnd(0.25, 0.7), age: 0, c: col });
}

/* ------------------------------------------------------------------ mining */
function markTile(tx, ty) {
  const i = idx(tx, ty);
  if (!tileDirty[i]) { tileDirty[i] = 1; dirtyList.push(i); }
}

/* Apply bore work to a tile. Returns true if it broke this call. */
function bore(tx, ty, work, colId, taker, hubFactor) {
  if (!inb(tx, ty)) return false;
  const i = idx(tx, ty), t = map[i];

  // Boring a fabricator damages the colony instead of the rock
  if (t === HUB || t === RHUB) {
    const c = colonies[t === HUB ? PLAYER : HELIOS];
    if (c.id === colId) return false;
    c.integrity -= work * (hubFactor || 0.09);
    c.underAttack = 6;
    // A fabricator under the drill screams for help — this is what turns the
    // defending colony's guards around.
    const f = alarm[c.id];
    for (let y = c.ty - 4; y <= c.ty + 3; y++)
      for (let x = c.tx - 5; x <= c.tx + 5; x++)
        if (inb(x, y) && !SOLID[map[idx(x, y)]])
          f[idx(x, y)] = Math.min(3, f[idx(x, y)] + work * 0.030);
    if (Math.random() < 0.25) puff(tx * TS + 6, ty * TS + 6, '#ff8a5a', 1);
    return false;
  }
  if (!SOLID[t] || t === BED) return false;

  dmg[i] += work;
  if (Math.random() < 0.2) puff(tx * TS + rnd(2, 10), ty * TS + rnd(2, 10), t === ORE ? '#d2953f' : t === ICE ? '#6fd6e8' : '#6b6355', 1);
  if (dmg[i] < HARD[t]) return false;

  // broke through — cargo is capped on the total, not per resource
  if (taker) {
    const room = taker.cap - (taker.ore + taker.ice);
    if (room > 0) {
      const gain = Math.min(2, room);
      if (t === ORE) taker.ore += gain;
      else if (t === ICE) taker.ice += gain;
    }
  }
  map[i] = TUN; dmg[i] = 0;
  markTile(tx, ty);
  navDirty = true;
  puff(tx * TS + 6, ty * TS + 6, t === ORE ? '#d2953f' : t === ICE ? '#6fd6e8' : '#7a7266', 7);
  return true;
}

/* ------------------------------------------------------------------- input */
const keys = {};
addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
  if (keys[e.key.toLowerCase()]) return;
  keys[e.key.toLowerCase()] = true;
  if (!running) return;
  const k = e.key.toLowerCase();
  // any steering input takes the stick back from the autopilot
  if (auto.on && (k.length === 1 && 'wasd'.includes(k) || k.startsWith('arrow'))) setAuto(false);
  if (k === 'f') setAuto(!auto.on);
  if (k === '[') setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed) - 1)]);
  if (k === ']') setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)]);
  if (k === 'p') togglePause();
  if (k === 'm') showBeacons = !showBeacons;
  if (k === 'escape') quitToTitle();
  if (over) return;
  if (k === '1') order('miner');
  if (k === '2') order('guard');
  if (k === '3') { colonies[PLAYER].auto = !colonies[PLAYER].auto; log(colonies[PLAYER].auto ? 'Autofab <b>engaged</b> — 2 miners per guard.' : 'Autofab disengaged.'); }
  if (k === 'q') dropBeacon(trail[PLAYER], 2.4, '#ffc857', 'Ore beacon dropped. Miners will sweep here.');
  if (k === 'e') dropBeacon(alarm[PLAYER], 2.6, '#ff9d5a', 'Rally beacon dropped. Guards converging.');
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function dropBeacon(field, amount, colour, msg) {
  if (!player || !player.alive) return;
  const tx = player.x / TS | 0, ty = player.y / TS | 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = tx + dx, y = ty + dy;
    if (!inb(x, y) || SOLID[map[idx(x, y)]]) continue;
    field[idx(x, y)] += amount * (1 - (Math.abs(dx) + Math.abs(dy)) / 6);
  }
  puff(player.x, player.y, colour, 10);
  sfx.beacon(); log(msg);
}

function order(caste) {
  const c = colonies[PLAYER], k = COST[caste];
  if (c.ore < k.ore || c.ice < k.ice || c.pwr < k.pwr) {
    log('<span class="warn">Fabricator short on ' +
      (c.ore < k.ore ? 'ore' : c.ice < k.ice ? 'ice' : 'power') + '.</span>');
    return;
  }
  c.ore -= k.ore; c.ice -= k.ice; c.pwr -= k.pwr; c.printed++;
  spawnDrone(PLAYER, caste, c.x + rnd(-20, 20), c.y - 18);
  sfx.print(); log('Fabricator printed a <b>' + caste + '</b>.');
}

/* -------------------------------------------------------------------- log */
function log(html) {
  logLines.unshift({ html, age: 0 });
  if (logLines.length > 6) logLines.pop();
  renderLog();
}
function renderLog() {
  $('ticker').innerHTML = logLines
    .map((l, i) => '<div style="opacity:' + (1 - i * 0.16).toFixed(2) + '">' + l.html + '</div>')
    .join('');
}

/* -------------------------------------------------------------------- game */
function startGame() {
  drones = []; crawlers = []; parts = []; logLines = [];
  clock = { t: 0, day: true, phase: DAY_LEN, elapsed: 0 };
  over = false; overWin = false; paused = false; showBeacons = false;
  frame = 0; acc = 0;
  auto.mode = 'mine'; auto.beaconCd = 0; auto.orderCd = 0; auto.sieging = false;

  generate();
  initFields();

  for (let k = 0; k < 2; k++) {
    const c = colonies[k];
    for (let i = 0; i < 6; i++) spawnDrone(k, i < 4 ? 'miner' : 'guard', c.x + rnd(-30, 30), c.y - 20);
  }
  player = drones[0];
  player.isPlayer = true; player.cap = 4; player.hp = player.max = 150;

  const nCrawl = DIFF[diff].crawlers;
  let placed = 0, guardTries = 0;
  while (placed < nCrawl && guardTries++ < 4000) {
    const tx = 10 + (Math.random() * (MW - 20) | 0), ty = 58 + (Math.random() * (MH - 62) | 0);
    if (!inb(tx, ty) || SOLID[map[idx(tx, ty)]]) continue;
    spawnCrawler(tx * TS + 6, ty * TS + 6); placed++;
  }

  cam = { x: player.x - VW / 2, y: player.y - VH / 2 };
  running = true;
  show('screen-game');
  log('Colony <b>BORE-1</b> deployed. Contract: ' + DIFF[diff].name + '.');
  log('Bore a seam, haul it home. <b>SPACE</b> to bore.');
}

function togglePause() {
  if (over) return;
  paused = !paused;
  const b = $('banner');
  if (paused) {
    $('banner-title').textContent = 'PAUSED';
    $('banner-body').innerHTML = 'Contract: ' + DIFF[diff].name +
      ' &middot; swarm ' + drones.filter(d => d.col === PLAYER && d.alive).length +
      ' &middot; ore mined ' + Math.round(colonies[PLAYER].mined);
    $('btn-banner').textContent = 'RESUME';
    b.classList.add('on');
  } else b.classList.remove('on');
}

function endGame(win) {
  over = true; overWin = win; paused = true;
  const c = colonies[PLAYER];
  $('banner-title').textContent = win ? 'SEAM SECURED' : 'COLONY LOST';
  $('banner-title').style.color = win ? 'var(--amber)' : 'var(--red)';
  $('banner-body').innerHTML = win
    ? 'Helios Extraction has withdrawn from Mare Ingenii.<br>Ore mined: <b>' + Math.round(c.mined) +
      '</b> &middot; drones printed: <b>' + c.printed + '</b> &middot; time: <b>' + fmt(clock.elapsed) + '</b>'
    : 'The fabricator is slag. Without it there are no more drones.<br>Ore mined: <b>' +
      Math.round(c.mined) + '</b> &middot; survived: <b>' + fmt(clock.elapsed) + '</b>';
  $('btn-banner').textContent = 'PLAY AGAIN';
  $('banner').classList.add('on');
  win ? sfx.win() : sfx.lose();
  try {
    const rec = JSON.parse(localStorage.getItem('bmg_rec') || '{}');
    rec[diff] = rec[diff] || { w: 0, l: 0 };
    win ? rec[diff].w++ : rec[diff].l++;
    localStorage.setItem('bmg_rec', JSON.stringify(rec));
  } catch (e) {}
}

const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

function quitToTitle() { running = false; $('banner').classList.remove('on'); show('screen-title'); }

/* ------------------------------------------------------------------ update */
const g0 = [0, 0], g1 = [0, 0];

function update(dt) {
  frame++;
  clock.elapsed += dt;
  clock.phase -= dt;
  if (clock.phase <= 0) {
    clock.day = !clock.day;
    clock.phase = clock.day ? DAY_LEN : NIGHT_LEN;
    log(clock.day ? '<span class="good">Sunrise.</span> Solar array back to full charge.'
                  : '<span class="warn">Lunar night.</span> Power trickling — print sparingly.');
  }

  if (frame % 2 === 0) relaxScent();
  if (frame % 3 === 0) {
    diffuse(trail[0], 0.9955); diffuse(trail[1], 0.9955);
    diffuse(alarm[0], 0.993);  diffuse(alarm[1], 0.993);
  }
  navTimer -= dt;
  if (navDirty && navTimer <= 0) { rebuildNav(); navTimer = 0.35; }

  updatePlayer(dt);
  for (const d of drones) if (d.alive && !d.isPlayer) updateDrone(d, dt);
  for (const c of crawlers) if (c.alive) updateCrawler(c, dt);
  combat(dt);
  for (const c of colonies) updateColony(c, dt);

  // reap
  if (frame % 30 === 0) {
    drones = drones.filter(d => d.alive || d.isPlayer);
    crawlers = crawlers.filter(c => c.alive);
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 22 * dt;
    if (p.age > p.life) parts.splice(i, 1);
  }

  // camera
  const tx = clamp(player.x - VW / 2, 0, WW - VW);
  const ty = clamp(player.y - VH / 2, 0, WH - VH);
  cam.x = lerp(cam.x, tx, 1 - Math.pow(0.0009, dt));
  cam.y = lerp(cam.y, ty, 1 - Math.pow(0.0009, dt));

  if (!over) {
    if (colonies[HELIOS].integrity <= 0) endGame(true);
    else if (colonies[PLAYER].integrity <= 0) endGame(false);
  }
}

/* --------------------------------------------------------------- the pilot */
let faceX = 1, faceY = 0;

function updatePlayer(dt) {
  const p = player;
  if (!p.alive) { p.boreTile = -1; relink(); return; }

  let ax = 0, ay = 0, boring = keys[' '];
  if (auto.on) {
    const cmd = autopilot(dt);
    ax = cmd.x; ay = cmd.y; boring = cmd.bore;
  } else {
    if (keys['a'] || keys['arrowleft'])  ax -= 1;
    if (keys['d'] || keys['arrowright']) ax += 1;
    if (keys['w'] || keys['arrowup'])    ay -= 1;
    if (keys['s'] || keys['arrowdown'])  ay += 1;
  }
  if (ax || ay) {
    const m = Math.hypot(ax, ay);
    faceX = ax / m; faceY = ay / m;
    p.vx += (ax / m) * 900 * dt;
    p.vy += (ay / m) * 900 * dt;
  }
  const drag = Math.pow(0.0015, dt);
  p.vx *= drag; p.vy *= drag;
  const sp = Math.hypot(p.vx, p.vy), MAXV = 165;
  if (sp > MAXV) { p.vx = p.vx / sp * MAXV; p.vy = p.vy / sp * MAXV; }
  moveEnt(p, dt, 3.0);

  // bore what we are facing
  p.boreTile = -1;
  if (boring) {
    // orthogonal drill, same reason as the swarm: keeps tunnels traversable
    const ptx = p.x / TS | 0, pty = p.y / TS | 0;
    const ax = Math.abs(faceX) >= Math.abs(faceY);
    const ox = ax ? Math.sign(faceX) : 0, oy = ax ? 0 : Math.sign(faceY);
    let btx = -1, bty = -1;
    for (let step = 1; step <= 2; step++) {
      const cx = ptx + ox * step, cy = pty + oy * step;
      if (!inb(cx, cy)) break;
      const t = map[idx(cx, cy)];
      if (SOLID[t] || t === RHUB) { btx = cx; bty = cy; break; }
    }
    if (btx >= 0) {
      p.boreTile = idx(btx, bty);
      if (bore(btx, bty, 165 * dt, PLAYER, p, 0.22)) sfx.crack();
      else if (frame % 5 === 0) sfx.bore();
    }
  }

  deposit(p, dt);
  // the pilot lays a trail too, whenever loaded — you teach the swarm routes
  if (p.ore + p.ice > 0) layTrail(p, dt, 1.1);
}

/* ==========================================================================
   AUTOPLAY — an agent that flies DRONE-01 and runs the colony.

   It reads exactly the same fields the swarm reads (ore scent to prospect,
   the home BFS to haul, the alarm field to fight) and drives the same four
   verbs a human has: move, bore, drop a beacon, print. Nothing is privileged.
   ========================================================================== */
const auto = { on: false, mode: 'mine', beaconCd: 0, orderCd: 0, sieging: false, wob: 0, saidMode: '' };

function setAuto(on) {
  auto.on = on;
  auto.mode = 'mine'; auto.beaconCd = 0; auto.orderCd = 0; auto.sieging = false;
  $('btn-auto').textContent = 'AUTOPLAY: ' + (on ? 'ON' : 'OFF');
  $('btn-auto').classList.toggle('on', on);
  if (!running) return;
  log(on ? '<b>Autoplay engaged.</b> Colony AI has DRONE-01 — any movement key takes it back.'
         : '<b>Autoplay disengaged.</b> You have the controls.');
}

function autopilot(dt) {
  const p = player, c = colonies[PLAYER], foe = colonies[HELIOS];
  const tx = p.x / TS | 0, ty = p.y / TS | 0;
  if (!inb(tx, ty)) return { x: 0, y: 1, bore: false };

  c.auto = true;                               // let the fabricator run itself
  auto.beaconCd -= dt; auto.orderCd -= dt; auto.wob += dt * 2.1;

  const guards = drones.filter(d => d.alive && d.col === PLAYER && d.caste === 'guard').length;

  // Top up guards by hand when the ratio drifts — autofab alone is miner-heavy.
  if (auto.orderCd <= 0 && guards < 5 && affordable(c, 'guard')) { order('guard'); auto.orderCd = 6; }

  // ---- pick a mode ----
  const loaded = p.ore + p.ice >= p.cap;
  const hurt = p.hp < p.max * 0.32;
  // Gate the assault on fighting strength, not on banked ore — autofab keeps
  // the ore bank near zero by design, so an ore threshold never fires.
  if (!auto.sieging && guards >= 8 && c.integrity > c.integrityMax * 0.55) {
    auto.sieging = true;
    log('<span class="good">Autoplay: swarm is strong enough — moving on Helios.</span>');
  }
  if (c.integrity < c.integrityMax * 0.35) auto.sieging = false;   // stop attacking, go home

  auto.mode = c.underAttack > 0 ? 'defend'
            : hurt              ? 'repair'
            : loaded            ? 'haul'
            : auto.sieging      ? 'siege'
            : 'mine';

  let wx = 0, wy = 0, bore = true;

  if (auto.mode === 'defend' || auto.mode === 'repair' || auto.mode === 'haul') {
    if (navHome(home[PLAYER], tx, ty, g0)) { wx = g0[0]; wy = g0[1]; }
    else { wx = Math.sign(c.x - p.x); wy = Math.sign(c.y - p.y); }
    // Reinforce the route home so the swarm inherits the road we just proved.
    if (auto.mode === 'haul' && auto.beaconCd <= 0 && scent[idx(tx, ty)] > 0.55) {
      auto.beaconCd = 7;
      dropBeacon(trail[PLAYER], 2.4, '#ffc857', 'Autoplay marked a seam for the miners.');
    }
  } else if (auto.mode === 'siege') {
    if (navHome(home[HELIOS], tx, ty, g0)) { wx = g0[0]; wy = g0[1]; }
    else { wx = Math.sign(foe.x - p.x); wy = Math.sign(foe.y - p.y); }
    // Call the guards in once we are close enough for it to mean anything.
    if (auto.beaconCd <= 0 && Math.hypot(foe.x - p.x, foe.y - p.y) < 230) {
      auto.beaconCd = 5;
      dropBeacon(alarm[PLAYER], 2.6, '#ff9d5a', 'Autoplay called the guards onto the fabricator.');
    }
  } else {
    // prospect: follow the ore smell, with enough wander to escape flat patches
    const sg = grad(scent, tx, ty, g0);
    const tg = grad(trail[PLAYER], tx, ty, g1);
    wx = g0[0] * (0.9 + sg) + g1[0] * Math.min(0.5, tg * 0.4) + Math.cos(auto.wob) * 0.35;
    wy = g0[1] * (0.9 + sg) + g1[1] * Math.min(0.5, tg * 0.4) + Math.sin(auto.wob * 1.4) * 0.35;
  }

  // same stuck-breaker the swarm uses
  if (Math.hypot(p.vx, p.vy) < 14) p.stuck = (p.stuck || 0) + dt; else p.stuck = 0;
  if (p.stuck > 0.9) { p.stuck = 0; p.panic = 1.3; const a = Math.random() * 6.2832; p.px = Math.cos(a); p.py = Math.sin(a); }
  if (p.panic > 0) { p.panic -= dt; wx = p.px; wy = p.py; }

  const m = Math.hypot(wx, wy) || 1;
  return { x: wx / m, y: wy / m, bore };
}

function relink() {
  const alt = drones.filter(d => d.alive && d.col === PLAYER && !d.isPlayer);
  if (!alt.length) {
    if (colonies[PLAYER].integrity > 0 && affordable(colonies[PLAYER], 'miner')) return; // wait for a print
    if (!over) endGame(false);
    return;
  }
  alt.sort((a, b) => (Math.hypot(a.x - player.x, a.y - player.y)) - (Math.hypot(b.x - player.x, b.y - player.y)));
  const n = alt[0];
  player.isPlayer = false;
  player = n; n.isPlayer = true; n.cap = 4; n.max = 150; n.hp = Math.max(n.hp, 90);
  puff(n.x, n.y, '#ffc857', 14);
  log('<span class="warn">DRONE-01 destroyed.</span> Link transferred to nearest unit.');
}

/* --------------------------------------------------------------- swarm AI */
function updateDrone(d, dt) {
  d.cd -= dt; d.hurt -= dt;
  const tx = d.x / TS | 0, ty = d.y / TS | 0;
  if (!inb(tx, ty)) { d.alive = false; return; }
  const c = colonies[d.col], foe = colonies[1 - d.col];
  const full = d.ore + d.ice >= d.cap;
  let wx = 0, wy = 0;                       // wish direction

  if (d.caste === 'guard') {
    const al = alarm[d.col][idx(tx, ty)];
    if (al > 0.02) {
      // close enough to smell the fight — home in on it
      grad(alarm[d.col], tx, ty, g0); wx = g0[0]; wy = g0[1];
      d.state = 'defend';
    } else if (c.underAttack > 0) {
      // Alarm scent evaporates long before it crosses the map, so a colony
      // whose fabricator is being drilled recalls its guards outright.
      if (navHome(home[d.col], tx, ty, g0)) { wx = g0[0]; wy = g0[1]; }
      else { wx = Math.sign(c.x - d.x); wy = Math.sign(c.y - d.y); }
      d.state = 'defend';
    } else if (d.assault) {
      if (navHome(home[1 - d.col], tx, ty, g0)) { wx = g0[0]; wy = g0[1]; }
      else { wx = Math.sign(foe.x - d.x); wy = Math.sign(foe.y - d.y); }
      d.state = 'assault';
    } else {
      // patrol the home tunnels
      d.wob += dt * 1.4;
      if (home[d.col][idx(tx, ty)] > 34) { navHome(home[d.col], tx, ty, g0); wx = g0[0]; wy = g0[1]; }
      else { wx = Math.cos(d.wob); wy = Math.sin(d.wob * 0.7); }
      d.state = 'patrol';
    }
  } else if (full || (d.ore + d.ice > 0 && d.cd < -6)) {
    d.state = 'home';
    if (navHome(home[d.col], tx, ty, g0)) { wx = g0[0]; wy = g0[1]; }
    else { wx = Math.sign(c.x - d.x); wy = Math.sign(c.y - d.y); }
    layTrail(d, dt, 1.0);
  } else {
    d.state = 'search';
    // follow ore smell, biased by the colony's own trail highway
    const sg = grad(scent, tx, ty, g0);
    const tg = grad(trail[d.col], tx, ty, g1);
    d.wob += dt * 2.2;
    wx = g0[0] * (0.55 + sg) + g1[0] * Math.min(0.9, tg * 0.8) + Math.cos(d.wob) * 0.5;
    wy = g0[1] * (0.55 + sg) + g1[1] * Math.min(0.9, tg * 0.8) + Math.sin(d.wob * 1.3) * 0.5;
  }

  // Stuck-breaker: a drone pinned against geometry commits to one random
  // heading for a moment, which puts rock in front of it and lets the bore
  // step below cut a way out.
  if (Math.hypot(d.vx, d.vy) < 14) d.stuck += dt; else d.stuck = 0;
  if (d.stuck > 0.9) {
    d.stuck = 0; d.panic = 1.3;
    const a = Math.random() * 6.2832;
    d.px = Math.cos(a); d.py = Math.sin(a);
  }
  if (d.panic > 0) { d.panic -= dt; wx = d.px; wy = d.py; }

  const wm = Math.hypot(wx, wy) || 1;
  wx /= wm; wy /= wm;

  // If rock is in the way of where we want to go, bore through it — but only
  // ever orthogonally. A diagonal-only opening cannot be traversed by an
  // axis-separated collider, so a drone that digs diagonally bricks itself in.
  const ax = Math.abs(wx) >= Math.abs(wy);
  const ntx = tx + (ax ? Math.sign(wx) : 0);
  const nty = ty + (ax ? 0 : Math.sign(wy));
  if (inb(ntx, nty)) {
    const t = map[idx(ntx, nty)];
    if (SOLID[t] && t !== BED) {
      // miners bore anything; guards only bore to reach the enemy
      if (d.caste === 'miner' || d.state === 'assault' || d.state === 'defend')
        if (bore(ntx, nty, (d.caste === 'miner' ? 58 : 34) * dt, d.col, d.caste === 'miner' ? d : null))
          d.cd = 0;
    } else if (t === RHUB || t === HUB) {
      if ((t === HUB ? PLAYER : HELIOS) !== d.col) bore(ntx, nty, 42 * dt, d.col, null);
    }
  }

  const acc = d.caste === 'guard' ? 460 : 400;
  d.vx += wx * acc * dt; d.vy += wy * acc * dt;
  const drag = Math.pow(0.004, dt);
  d.vx *= drag; d.vy *= drag;
  const sp = Math.hypot(d.vx, d.vy), MAXV = d.caste === 'guard' ? 105 : 88;
  if (sp > MAXV) { d.vx = d.vx / sp * MAXV; d.vy = d.vy / sp * MAXV; }
  moveEnt(d, dt, 2.5);
  deposit(d, dt);
}

function layTrail(d, dt, strength) {
  const tx = d.x / TS | 0, ty = d.y / TS | 0;
  if (!inb(tx, ty) || SOLID[map[idx(tx, ty)]]) return;
  const f = trail[d.col], i = idx(tx, ty);
  const v = f[i] + strength * dt * 2.4;
  f[i] = v > 3 ? 3 : v;
}

function deposit(d, dt) {
  const tx = d.x / TS | 0, ty = d.y / TS | 0;
  if (!inb(tx, ty)) return;
  const t = map[idx(tx, ty)];
  if (t !== (d.col === PLAYER ? HUB : RHUB)) return;
  // Sitting on your own fabricator repairs you, cargo or not — otherwise a
  // damaged drone that comes home empty has no way back to full.
  d.hp = Math.min(d.max, d.hp + 26 * dt);
  if (d.ore + d.ice <= 0) return;
  const c = colonies[d.col];
  c.ore += d.ore; c.ice += d.ice; c.mined += d.ore + d.ice;
  if (d.isPlayer) { sfx.deposit(); log('Unloaded <b>' + d.ore + ' ore</b>, <b>' + d.ice + ' ice</b>.'); }
  d.ore = 0; d.ice = 0; d.cd = 0;
}

function moveEnt(e, dt, r) {
  const nx = e.x + e.vx * dt, ny = e.y + e.vy * dt;
  let mx = false, my = false;
  if (!blocked(nx, e.y, r)) { e.x = nx; mx = true; } else e.vx *= -0.2;
  if (!blocked(e.x, ny, r)) { e.y = ny; my = true; } else e.vy *= -0.2;
  // corner slip: natural lava tubes can join diagonally, and neither axis
  // alone gets through one. Squeeze through on a tighter radius.
  if (!mx && !my && !blocked(nx, ny, r * 0.62)) { e.x = nx; e.y = ny; }

  // Corridor centring. Tunnels are one tile wide, so a body drifting off the
  // centre line catches on the corners of a staircase and wedges there for
  // good. Pull toward the middle of whichever axis is walled in.
  const tx = e.x / TS | 0, ty = e.y / TS | 0;
  if (inb(tx, ty)) {
    const k = 1 - Math.pow(0.015, dt);
    if (solidPx(e.x, (ty - 1) * TS + 6) && solidPx(e.x, (ty + 1) * TS + 6))
      e.y = lerp(e.y, ty * TS + TS / 2, k);
    if (solidPx((tx - 1) * TS + 6, e.y) && solidPx((tx + 1) * TS + 6, e.y))
      e.x = lerp(e.x, tx * TS + TS / 2, k);
  }

  e.x = clamp(e.x, TS * 2, WW - TS * 2);
  e.y = clamp(e.y, 4, WH - TS * 3);
}

/* ------------------------------------------------------------------ hazard */
function updateCrawler(c, dt) {
  c.cd -= dt;
  let target = null, bd = 150;
  for (const d of drones) {
    if (!d.alive) continue;
    const dist = Math.hypot(d.x - c.x, d.y - c.y);
    if (dist < bd) { bd = dist; target = d; }
  }
  let wx, wy;
  if (target) { wx = target.x - c.x; wy = target.y - c.y; const m = Math.hypot(wx, wy) || 1; wx /= m; wy /= m; }
  else { c.wob += dt * 0.8; wx = Math.cos(c.wob); wy = Math.sin(c.wob * 0.6) * 0.5; }
  c.vx += wx * 260 * dt; c.vy += wy * 260 * dt;
  const drag = Math.pow(0.004, dt);
  c.vx *= drag; c.vy *= drag;
  const sp = Math.hypot(c.vx, c.vy);
  if (sp > 72) { c.vx = c.vx / sp * 72; c.vy = c.vy / sp * 72; }
  moveEnt(c, dt, 4.0);
}

/* ------------------------------------------------------------------ combat */
function combat(dt) {
  for (let i = 0; i < drones.length; i++) {
    const a = drones[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < drones.length; j++) {
      const b = drones[j];
      if (!b.alive || b.col === a.col) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx * dx + dy * dy > 196) continue;
      hurt(a, (b.caste === 'guard' ? 30 : 15) * dt, b);
      hurt(b, (a.caste === 'guard' ? 30 : 15) * dt, a);
    }
    for (const c of crawlers) {
      if (!c.alive) continue;
      const dx = c.x - a.x, dy = c.y - a.y;
      if (dx * dx + dy * dy > 260) continue;
      hurt(a, 34 * dt, null);
      c.hp -= (a.caste === 'guard' ? 26 : 12) * dt;
      if (c.hp <= 0) { c.alive = false; puff(c.x, c.y, '#b06be0', 16); if (a.col === PLAYER) log('<span class="good">Tube crawler killed.</span>'); }
    }
  }
}

function hurt(d, amount, from) {
  d.hp -= amount; d.hurt = 0.25;
  const tx = d.x / TS | 0, ty = d.y / TS | 0;
  if (inb(tx, ty) && !SOLID[map[idx(tx, ty)]]) {
    const f = alarm[d.col], i = idx(tx, ty);
    f[i] = Math.min(3, f[i] + amount * 0.05);
  }
  if (d.isPlayer && Math.random() < 0.12) sfx.hit();
  if (d.hp <= 0 && d.alive) {
    d.alive = false;
    colonies[d.col].lost++;
    puff(d.x, d.y, d.col === PLAYER ? '#ffc857' : '#ff5a5a', 14);
    if (d.isPlayer) { sfx.die(); }
    else if (d.col === PLAYER && Math.random() < 0.4) log('<span class="warn">Drone lost</span> to Helios.');
  }
}

/* --------------------------------------------------------------- economics */
function affordable(c, caste) {
  const k = COST[caste];
  return c.ore >= k.ore && c.ice >= k.ice && c.pwr >= k.pwr;
}

function updateColony(c, dt) {
  // solar
  const sun = clock.day ? 7.2 : 0.8;
  c.pwr = Math.min(c.pwrMax, c.pwr + sun * dt * (c.id === HELIOS ? DIFF[diff].foeRate : 1));

  c.underAttack -= dt; c.warnCd -= dt;
  if (c.id === PLAYER && c.underAttack > 0 && c.warnCd <= 0) {
    c.warnCd = 9;
    log('<span class="warn">FABRICATOR UNDER ATTACK</span> — guards are converging.');
    sfx.hit();
  }

  c.printCd -= dt;
  const mine = drones.filter(d => d.alive && d.col === c.id);
  const miners = mine.filter(d => d.caste === 'miner').length;
  const guards = mine.length - miners;

  if (c.auto && c.printCd <= 0 && mine.length < 46) {
    const want = guards * 2 < miners ? 'guard' : 'miner';
    if (affordable(c, want)) {
      const k = COST[want];
      c.ore -= k.ore; c.ice -= k.ice; c.pwr -= k.pwr; c.printed++;
      spawnDrone(c.id, want, c.x + rnd(-20, 20), c.y - 18);
      c.printCd = c.id === HELIOS ? 3.4 / DIFF[diff].foeRate : 3.0;
      if (c.id === PLAYER) sfx.print();
    } else c.printCd = 1.2;
  }

  // nudge a player who is hoarding ore and not growing the swarm
  if (c.id === PLAYER && !c.auto && affordable(c, 'miner') && mine.length < 30) {
    c.idleCd -= dt;
    if (c.idleCd <= 0) {
      c.idleCd = 55;
      log('Fabricator idle with <b>' + Math.floor(c.ore) + ' ore</b> banked — ' +
          '<kbd>1</kbd> miner, <kbd>2</kbd> guard, <kbd>3</kbd> autofab.');
    }
  } else if (c.id === PLAYER) c.idleCd = 25;

  // raids
  if (c.id === HELIOS) {
    c.raidCd -= dt;
    if (c.raidCd <= 0) {
      c.raidCd = DIFF[diff].foeRaid;
      const squad = mine.filter(d => d.caste === 'guard' && !d.assault).slice(0, 3 + diff * 2);
      squad.forEach(d => d.assault = true);
      if (squad.length) log('<span class="warn">Helios raid inbound</span> — ' + squad.length + ' guards.');
    }
  } else if (mine.length === 0 && !affordable(c, 'miner') && !over) {
    endGame(false);
  }

  // A rally beacon planted near the Helios fabricator reads as an assault order:
  // the guards stop patrolling and push for the enemy hub.
  if (c.id === PLAYER && frame % 15 === 0) {
    const f = colonies[HELIOS];
    let near = 0;
    for (let y = f.ty - 6; y <= f.ty + 4; y++)
      for (let x = f.tx - 7; x <= f.tx + 7; x++)
        if (inb(x, y)) { const v = alarm[PLAYER][idx(x, y)]; if (v > near) near = v; }
    const on = near > 0.06;
    if (on !== c.assaultOn) {
      c.assaultOn = on;
      log(on ? '<span class="good">Guards ordered onto the Helios fabricator.</span>'
             : 'Assault order lapsed — guards falling back to patrol.');
    }
    for (const d of mine) if (d.caste === 'guard') d.assault = on;
  }
}

/* ------------------------------------------------------------------ render */
const COL = {
  [VAC]: '#05070c', [REG]: '#4a4438', [BAS]: '#2b2f36', [ORE]: '#7d5a2c',
  [ICE]: '#2f6b7c', [TUN]: '#12161d', [HUB]: '#6b5416', [RHUB]: '#6b1f1f', [BED]: '#0a0c10',
};

function paintSky() {
  const g = tctx.createLinearGradient(0, 0, 0, 24 * TS);
  g.addColorStop(0, '#04060b'); g.addColorStop(1, '#0a0f18');
  tctx.fillStyle = g; tctx.fillRect(0, 0, WW, 26 * TS);
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * WW, y = Math.random() * 22 * TS;
    const a = 0.25 + Math.random() * 0.65;
    tctx.fillStyle = 'rgba(210,225,255,' + a.toFixed(2) + ')';
    tctx.fillRect(x | 0, y | 0, 1, 1);
  }
}

function drawTile(i) {
  const x = (i % MW) * TS, y = ((i / MW) | 0) * TS, t = map[i];
  if (t === VAC) return;                                     // sky stays painted
  tctx.fillStyle = COL[t];
  tctx.fillRect(x, y, TS, TS);
  if (t === REG || t === BAS) {
    tctx.fillStyle = 'rgba(255,255,255,.035)';
    tctx.fillRect(x, y, TS, 1);
    tctx.fillStyle = 'rgba(0,0,0,.20)';
    tctx.fillRect(x, y + TS - 1, TS, 1);
    if (((i * 2654435761) >>> 26) < 8) {
      tctx.fillStyle = 'rgba(255,255,255,.05)';
      tctx.fillRect(x + 3 + (i % 4), y + 4 + (i % 3), 2, 2);
    }
  }
  if (t === ORE) {
    tctx.fillStyle = '#d2953f';
    for (let k = 0; k < 3; k++) {
      const ox = ((i * 7 + k * 31) % 8) + 1, oy = ((i * 13 + k * 17) % 8) + 1;
      tctx.fillRect(x + ox, y + oy, 2, 2);
    }
  }
  if (t === ICE) {
    tctx.fillStyle = '#8fe6f5';
    tctx.fillRect(x + 2, y + 3, 3, 2); tctx.fillRect(x + 6, y + 7, 3, 2);
  }
  if (t === HUB || t === RHUB) {
    tctx.fillStyle = t === HUB ? '#ffc857' : '#ff5a5a';
    tctx.fillRect(x + 1, y + 1, TS - 2, 2);
    tctx.fillStyle = 'rgba(0,0,0,.35)';
    tctx.fillRect(x + 2, y + 5, TS - 4, TS - 7);
  }
  if (t === TUN) {
    tctx.fillStyle = 'rgba(0,0,0,.35)';
    tctx.fillRect(x, y, TS, 2);
  }
}

function flushTiles() {
  if (!dirtyList.length) return;
  for (const i of dirtyList) {
    if (map[i] === VAC) { /* keep the painted sky */ }
    else { drawTile(i); }
    tileDirty[i] = 0;
  }
  dirtyList.length = 0;
}

function render() {
  flushTiles();
  const cx = Math.round(cam.x), cy = Math.round(cam.y);

  vctx.fillStyle = '#05070c';
  vctx.fillRect(0, 0, VW, VH);
  vctx.drawImage(terrain, cx, cy, VW, VH, 0, 0, VW, VH);

  vctx.save();
  vctx.translate(-cx, -cy);

  drawSky(cx, cy);
  if (showBeacons) drawBeacons(cx, cy);
  drawHubs();

  // bore reticle
  if (player.boreTile >= 0) {
    const bx = (player.boreTile % MW) * TS, by = ((player.boreTile / MW) | 0) * TS;
    const t = map[player.boreTile];
    const prog = t === HUB || t === RHUB ? 0 : clamp(dmg[player.boreTile] / (HARD[t] || 1), 0, 1);
    vctx.strokeStyle = 'rgba(255,200,87,.85)'; vctx.lineWidth = 1;
    vctx.strokeRect(bx + .5, by + .5, TS - 1, TS - 1);
    vctx.fillStyle = 'rgba(255,200,87,.30)';
    vctx.fillRect(bx, by + TS - TS * prog, TS, TS * prog);
    vctx.strokeStyle = 'rgba(255,200,87,.55)';
    vctx.beginPath(); vctx.moveTo(player.x, player.y); vctx.lineTo(bx + TS / 2, by + TS / 2); vctx.stroke();
  }

  for (const c of crawlers) if (c.alive) drawCrawler(c);
  for (const d of drones) if (d.alive && !d.isPlayer) drawDrone(d);
  drawDrone(player, true);

  for (const p of parts) {
    const a = 1 - p.age / p.life;
    vctx.fillStyle = p.c;
    vctx.globalAlpha = a * 0.85;
    vctx.fillRect(p.x - 1, p.y - 1, 3, 3);
  }
  vctx.globalAlpha = 1;
  vctx.restore();

  // night tint over the surface band
  if (!clock.day) {
    vctx.fillStyle = 'rgba(10,20,50,.20)';
    vctx.fillRect(0, 0, VW, VH);
  }
  // vignette
  const vg = vctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VH * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.5)');
  vctx.fillStyle = vg; vctx.fillRect(0, 0, VW, VH);

  if (auto.on) {
    const lbl = 'AUTOPLAY · ' + auto.mode.toUpperCase();
    vctx.font = '700 11px ui-monospace,monospace';
    const w = vctx.measureText(lbl).width + 18;
    vctx.fillStyle = 'rgba(255,200,87,.92)';
    vctx.fillRect(12, 12, w, 22);
    vctx.fillStyle = '#05070c';
    vctx.fillText(lbl, 21, 27);
  }
  if (speed !== 1) {
    vctx.font = '700 11px ui-monospace,monospace';
    vctx.fillStyle = 'rgba(111,214,232,.9)';
    vctx.fillText(speed + '×', 12, auto.on ? 50 : 26);
  }

  if (frame % 6 === 0) drawMini();
  updateHud();
}

function drawSky(cx, cy) {
  if (cy > 26 * TS) return;
  // Earth, fixed in the lunar sky
  const ex = 300, ey = 90;
  vctx.save();
  vctx.globalAlpha = 0.95;
  const eg = vctx.createRadialGradient(ex - 8, ey - 8, 3, ex, ey, 30);
  eg.addColorStop(0, '#8fc4ff'); eg.addColorStop(0.55, '#3f6fae'); eg.addColorStop(1, '#101c30');
  vctx.fillStyle = eg;
  vctx.beginPath(); vctx.arc(ex, ey, 26, 0, 6.2832); vctx.fill();
  vctx.fillStyle = 'rgba(120,190,140,.45)';
  vctx.beginPath(); vctx.ellipse(ex - 6, ey + 4, 10, 6, .4, 0, 6.2832); vctx.fill();
  vctx.restore();

  // sun tracks the day phase
  const frac = clock.day ? 1 - clock.phase / DAY_LEN : -1;
  if (frac >= 0) {
    const sx = 120 + frac * (WW - 240), sy = 150 - Math.sin(frac * Math.PI) * 95;
    const sg = vctx.createRadialGradient(sx, sy, 2, sx, sy, 46);
    sg.addColorStop(0, 'rgba(255,246,220,.95)'); sg.addColorStop(0.3, 'rgba(255,214,130,.35)');
    sg.addColorStop(1, 'rgba(255,200,87,0)');
    vctx.fillStyle = sg;
    vctx.beginPath(); vctx.arc(sx, sy, 46, 0, 6.2832); vctx.fill();
  }
}

function drawBeacons(cx, cy) {
  const x0 = Math.max(0, (cx / TS | 0) - 1), x1 = Math.min(MW, (cx + VW) / TS + 1 | 0);
  const y0 = Math.max(0, (cy / TS | 0) - 1), y1 = Math.min(MH, (cy + VH) / TS + 1 | 0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = idx(x, y);
    if (SOLID[map[i]]) continue;
    const tp = trail[0][i], tr = trail[1][i], ap = alarm[0][i];
    if (tp > 0.02) { vctx.fillStyle = 'rgba(255,200,87,' + Math.min(.5, tp * .32).toFixed(3) + ')'; vctx.fillRect(x * TS, y * TS, TS, TS); }
    if (tr > 0.02) { vctx.fillStyle = 'rgba(255,90,90,'  + Math.min(.5, tr * .32).toFixed(3) + ')'; vctx.fillRect(x * TS, y * TS, TS, TS); }
    if (ap > 0.02) { vctx.fillStyle = 'rgba(255,140,60,' + Math.min(.5, ap * .35).toFixed(3) + ')'; vctx.fillRect(x * TS + 3, y * TS + 3, TS - 6, TS - 6); }
  }
}

function drawHubs() {
  for (const c of colonies) {
    const glow = c.id === PLAYER ? '255,200,87' : '255,90,90';
    const g = vctx.createRadialGradient(c.x, c.y + 12, 4, c.x, c.y + 12, 70);
    g.addColorStop(0, 'rgba(' + glow + ',.28)'); g.addColorStop(1, 'rgba(' + glow + ',0)');
    vctx.fillStyle = g;
    vctx.beginPath(); vctx.arc(c.x, c.y + 12, 70, 0, 6.2832); vctx.fill();

    // solar array on the surface
    const sy = c.surfY * TS;
    vctx.fillStyle = clock.day ? 'rgba(' + glow + ',.9)' : 'rgba(' + glow + ',.35)';
    vctx.fillRect(c.x - 26, sy - 7, 52, 3);
    vctx.fillStyle = 'rgba(' + glow + ',.35)';
    vctx.fillRect(c.x - 1, sy - 7, 2, 7);

    vctx.font = '700 9px ui-monospace,monospace';
    vctx.fillStyle = 'rgba(' + glow + ',.85)';
    vctx.textAlign = 'center';
    vctx.fillText(c.id === PLAYER ? 'BORE-1' : 'HELIOS', c.x, sy - 12);
    vctx.textAlign = 'left';
  }
}

function drawDrone(d, isPlayer) {
  if (!d.alive) return;
  const a = Math.atan2(d.vy, d.vx);
  const base = d.col === PLAYER ? '#ffc857' : '#ff5a5a';
  vctx.save();
  vctx.translate(d.x, d.y); vctx.rotate(a);
  if (isPlayer) {
    vctx.strokeStyle = 'rgba(255,200,87,.55)'; vctx.lineWidth = 1;
    vctx.beginPath(); vctx.arc(0, 0, 9 + Math.sin(frame * 0.12) * 1.2, 0, 6.2832); vctx.stroke();
  }
  vctx.fillStyle = d.hurt > 0 ? '#ffffff' : base;
  if (d.caste === 'guard') {
    vctx.beginPath();
    vctx.moveTo(6, 0); vctx.lineTo(-3, 4.5); vctx.lineTo(-1.5, 0); vctx.lineTo(-3, -4.5);
    vctx.closePath(); vctx.fill();
  } else {
    vctx.beginPath();
    vctx.moveTo(5, 0); vctx.lineTo(-2, 3.4); vctx.lineTo(-4, 0); vctx.lineTo(-2, -3.4);
    vctx.closePath(); vctx.fill();
  }
  // headlamp
  vctx.fillStyle = 'rgba(255,255,255,.85)';
  vctx.fillRect(4, -1, 2, 2);
  vctx.restore();

  // cargo pips
  const load = d.ore + d.ice;
  if (load > 0) {
    for (let k = 0; k < load; k++) {
      vctx.fillStyle = k < d.ore ? '#d2953f' : '#6fd6e8';
      vctx.fillRect(d.x - 4 + k * 3, d.y - 9, 2, 2);
    }
  }
  if (isPlayer) {
    vctx.fillStyle = 'rgba(255,200,87,.9)';
    vctx.font = '700 8px ui-monospace,monospace';
    vctx.textAlign = 'center';
    vctx.fillText('01', d.x, d.y + 15);
    vctx.textAlign = 'left';
  }
}

function drawCrawler(c) {
  vctx.save();
  vctx.translate(c.x, c.y);
  vctx.fillStyle = '#b06be0';
  vctx.beginPath(); vctx.ellipse(0, 0, 7, 5, Math.atan2(c.vy, c.vx), 0, 6.2832); vctx.fill();
  vctx.strokeStyle = 'rgba(176,107,224,.8)'; vctx.lineWidth = 1.4;
  for (let k = -1; k <= 1; k += 2) {
    vctx.beginPath();
    vctx.moveTo(0, 0);
    vctx.lineTo(k * 8, Math.sin(frame * 0.2 + k) * 6);
    vctx.stroke();
  }
  vctx.fillStyle = '#ffd0ff';
  vctx.fillRect(-1, -1, 2, 2);
  vctx.restore();
}

function drawMini() {
  const sx = mini.width / MW, sy = mini.height / MH;
  mctx.fillStyle = '#05070c'; mctx.fillRect(0, 0, mini.width, mini.height);
  for (let y = 0; y < MH; y += 1) {
    for (let x = 0; x < MW; x += 1) {
      const t = map[idx(x, y)];
      if (t === VAC) continue;
      mctx.fillStyle = t === ORE ? '#8a6224' : t === ICE ? '#2f6b7c'
        : t === TUN ? '#161c26' : t === HUB ? '#ffc857' : t === RHUB ? '#ff5a5a'
        : t === BAS ? '#22262c' : '#332f28';
      mctx.fillRect(x * sx, y * sy, sx + 0.6, sy + 0.6);
    }
  }
  for (const d of drones) {
    if (!d.alive) continue;
    mctx.fillStyle = d.col === PLAYER ? '#ffc857' : '#ff5a5a';
    mctx.fillRect(d.x / TS * sx - 0.5, d.y / TS * sy - 0.5, 1.6, 1.6);
  }
  mctx.fillStyle = '#ffffff';
  mctx.fillRect(player.x / TS * sx - 1.5, player.y / TS * sy - 1.5, 3, 3);
  mctx.strokeStyle = 'rgba(255,255,255,.35)'; mctx.lineWidth = 1;
  mctx.strokeRect(cam.x / TS * sx, cam.y / TS * sy, VW / TS * sx, VH / TS * sy);
}

/* --------------------------------------------------------------------- HUD */
function updateHud() {
  const c = colonies[PLAYER], f = colonies[HELIOS];
  const mine = drones.filter(d => d.alive && d.col === PLAYER);
  $('hud-ore').textContent = Math.floor(c.ore);
  $('hud-ice').textContent = Math.floor(c.ice);
  $('hud-pow').style.width = (c.pwr / c.pwrMax * 100) + '%';
  $('hud-swarm').textContent = mine.length;
  $('hud-cargo').textContent = (player.ore + player.ice) + '/' + player.cap;
  $('hud-hp').style.width = clamp(player.hp / player.max * 100, 0, 100) + '%';
  $('hud-hub').style.width = clamp(c.integrity / c.integrityMax * 100, 0, 100) + '%';
  $('hud-foe').style.width = clamp(f.integrity / f.integrityMax * 100, 0, 100) + '%';
  $('hud-phase').textContent = clock.day ? 'DAY' : 'NIGHT';
  $('hud-phase').style.color = clock.day ? 'var(--amber)' : 'var(--ice)';
  $('hud-clock').textContent = fmt(clock.phase);
}

/* -------------------------------------------------------------------- loop */
/* The simulation always advances in fixed 1/60s steps; the speed dial changes
   how many of those steps a wall-clock frame is worth. Fixed steps keep the
   collision and bore maths identical at 0.25x and at 8x. */
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
let speed = 1, last = 0, acc = 0;

function setSpeed(v) {
  speed = v;
  $('speed-dial').value = String(v);
  try { localStorage.setItem('bmg_speed', String(v)); } catch (e) {}
}

function loop(ts) {
  requestAnimationFrame(loop);
  const real = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  if (!running) return;
  if (!paused) {
    const STEP = 1 / 60;
    acc += real * speed;
    let n = 0;
    while (acc >= STEP && n < 24) { update(STEP); acc -= STEP; n++; }
    if (acc > 0.5) acc = 0;                    // never bank a backlog
  }
  render();
}

/* ------------------------------------------------------------------- shell */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

$('btn-start').onclick = () => { if (actx && actx.state === 'suspended') actx.resume(); startGame(); };
$('btn-help-title').onclick = () => show('screen-help');
$('btn-help-back').onclick = () => show('screen-title');
$('btn-quit').onclick = quitToTitle;
$('btn-banner').onclick = () => { if (over) startGame(); else togglePause(); };
$('btn-auto').onclick = () => setAuto(!auto.on);
$('speed-dial').onchange = e => setSpeed(+e.target.value);
$('btn-mute').onclick = () => {
  muted = !muted;
  $('btn-mute').textContent = 'SOUND: ' + (muted ? 'OFF' : 'ON');
  try { localStorage.setItem('bmg_mute', muted ? '1' : '0'); } catch (e) {}
};

document.querySelectorAll('#diff-opts .opt').forEach(o => {
  o.onclick = () => {
    document.querySelectorAll('#diff-opts .opt').forEach(x => x.classList.remove('sel'));
    o.classList.add('sel');
    diff = +o.dataset.diff;
    try { localStorage.setItem('bmg_diff', diff); } catch (e) {}
  };
});

try {
  const sp = +localStorage.getItem('bmg_speed');
  if (SPEEDS.includes(sp)) setSpeed(sp);
  muted = localStorage.getItem('bmg_mute') === '1';
  $('btn-mute').textContent = 'SOUND: ' + (muted ? 'OFF' : 'ON');
  const d = +localStorage.getItem('bmg_diff');
  if (d >= 0 && d <= 2) {
    diff = d;
    document.querySelectorAll('#diff-opts .opt').forEach(x => x.classList.toggle('sel', +x.dataset.diff === d));
  }
} catch (e) {}

requestAnimationFrame(loop);
