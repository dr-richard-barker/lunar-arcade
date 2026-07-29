/* ==========================================================================
   THE BORING MINING GAME
   A lunar ISRU drone-swarm sim. You pilot one drone of a mining swarm; the
   swarm itself navigates by evaporating scent fields, the surface plant builds
   itself out as tonnage lands, and a rival extraction colony is working the
   same rock from the far side of the mare.

   No assets, code or data from any commercial game are used here.
   ========================================================================== */
'use strict';

/* ----------------------------------------------------------------- config */
const MW = 176, MH = 104, TS = 16;            // map tiles + tile size (px)
const WW = MW * TS, WH = MH * TS;             // world size in px
const VW = 1280, VH = 720;                    // viewport (backing store)
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
  miner: { ore: 12, ice: 6,  pwr: 9  },
  guard: { ore: 20, ice: 10, pwr: 15 },
};

/* ------------------------------------------------------------------ state */
let map, dmg, tileDirty, dirtyList;
let scent, scentTmp;                 // ore/ice smell — travels through rock
const trail = [null, null];          // "there was ore this way" per colony
const alarm = [null, null];          // "fighting here" / rally beacons
const home  = [null, null];          // BFS distance to own hub through tunnels
let fieldTmp;

let drones, crawlers, parts, ships, colonies, player, cam, clock, running, paused;
let over = false, overWin = false;
let diff = 0, muted = false, showBeacons = false;
let frame = 0, navDirty = true, navTimer = 0;
let swarmPeak = 0, autoUsed = false, lastRun = null;

/* Tripwire config. Declared up here because the URL-flag parser below arms it
   at top level, and a `const` cannot be touched before its initialiser runs. */
const TRIP = {
  on: false,
  eps: 1.2,            // px of travel below which an agent counts as motionless
  idle: 25,            // seconds motionless AND unproductive before it is wedged
  transient: 90,       // seconds a *transient* agent state may persist
  autoTransient: 60,   // seconds a *transient* autoplay mode may persist
  fired: [],
};
/* Only states that are supposed to finish get policed. 'search' and 'patrol'
   are steady states an agent can legitimately hold for a whole contract, so
   flagging them on duration alone produces noise, and a noisy tripwire is one
   that gets ignored. 'home' must terminate at the hub; 'repair' was the mode
   that actually deadlocked, because its exit depended on unloading cargo. */
const TRANSIENT_STATES = ['home'];
const TRANSIENT_MODES  = ['repair', 'haul', 'defend'];
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
/* ==========================================================================
   SIMULATION RNG
   World generation was always deterministic (nrand/noise2/fbm above), but the
   agents were not, which made a soak failure impossible to replay. These are
   the *simulation* draws; cosmetic randomness (audio timbre, dust particles,
   whether a hit plays a sound) deliberately stays on Math.random() so visual
   noise can never consume simulation entropy and shift an outcome.
   ========================================================================== */
let seed0 = 0, seedState = 0;
function mulberry32() {
  seedState = (seedState + 0x6D2B79F5) | 0;
  let t = seedState;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function setSeed(n) { seed0 = n >>> 0; seedState = seed0; }
const srnd = () => mulberry32();                       // 0..1, seeded
const rnd = (a, b) => a + srnd() * (b - a);            // seeded range
const sangle = () => srnd() * 6.2832;
/* Cosmetics get their OWN unseeded generator. This matters more than it looks:
   particle spawns are gated by unseeded chance but were drawing from the seeded
   stream, so the number of draws differed between two runs of the same seed and
   the simulation desynchronised. Visual noise must never touch sim entropy. */
const crnd = (a, b) => a + Math.random() * (b - a);

function solidPx(px, py) {
  const tx = px / TS | 0, ty = py / TS | 0;
  if (!inb(tx, ty)) return true;
  return SOLID[map[idx(tx, ty)]];
}
function blocked(x, y, r) {
  return solidPx(x - r, y - r) || solidPx(x + r, y - r) ||
         solidPx(x - r, y + r) || solidPx(x + r, y + r);
}

/* ==========================================================================
   AUDIO
   One small synth engine, five swappable sound packs, and an adaptive score
   that reads the same colony state the HUD does. Everything is generated at
   runtime — there are no audio files anywhere in this project.
   ========================================================================== */
let actx = null, masterBus, sfxBus, musBus, noiseBuf;
let musicOn = true, pack = 'industrial';

function audioInit() {
  if (actx) return actx;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterBus = actx.createGain(); masterBus.gain.value = 0.9; masterBus.connect(actx.destination);
    sfxBus = actx.createGain(); sfxBus.gain.value = 1.0; sfxBus.connect(masterBus);
    musBus = actx.createGain(); musBus.gain.value = 0.0; musBus.connect(masterBus);
    const n = actx.sampleRate * 1.5, b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = b;
    musNext = actx.currentTime + 0.08;
  } catch (e) { actx = null; }
  return actx;
}
function audioResume() { if (actx && actx.state === 'suspended') actx.resume(); }

/* ---- two primitives: a pitched voice and a filtered noise burst ---- */
function tone(o) {
  if (!actx) return;
  const t0 = o.at != null ? o.at : actx.currentTime + (o.delay || 0);
  const dur = o.dur, osc = actx.createOscillator(), g = actx.createGain();
  osc.type = o.type || 'square';
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + (o.atk || 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = osc;
  if (o.cut) {
    const f = actx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = o.cut; f.Q.value = o.q || 1;
    osc.connect(f); node = f;
  }
  node.connect(g); g.connect(o.dest || sfxBus);
  osc.start(t0); osc.stop(t0 + dur + 0.03);
}
function noise(o) {
  if (!actx) return;
  const t0 = o.at != null ? o.at : actx.currentTime + (o.delay || 0);
  const dur = o.dur;
  const s = actx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  s.playbackRate.value = 0.7 + Math.random() * 0.6;
  const f = actx.createBiquadFilter();
  f.type = o.filter || 'lowpass';
  f.frequency.setValueAtTime(o.cut || 1400, t0);
  if (o.cut2) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.cut2), t0 + dur);
  f.Q.value = o.q || 1;
  const g = actx.createGain();
  g.gain.setValueAtTime(Math.max(0.0002, o.gain), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
  s.start(t0); s.stop(t0 + dur + 0.03);
}
const seq = (notes, o) => notes.forEach((f, i) => tone(Object.assign({}, o, { f, delay: i * (o.gap || 0.14) })));

/* ==========================================================================
   SOUND PACKS
   Each pack renders the same ten game events in its own voice, and declares
   how the adaptive score should be instrumented.
   ========================================================================== */
const PACKS = {
  industrial: {
    label: 'INDUSTRIAL', blurb: 'Bore drills, servos and hull clunks.',
    mus: { bass: 'sawtooth', lead: 'square', cut: 900, drums: 0.5, swing: 0 },
    bore:    () => noise({ dur: .07, gain: .045, cut: 850, cut2: 320, q: 5 }),
    crack:   () => { noise({ dur: .24, gain: .11, cut: 1900, cut2: 130, q: 2 });
                     tone({ f: 155, f2: 58, dur: .2, gain: .05, type: 'square' }); },
    deposit: () => { tone({ f: 430, dur: .07, gain: .06, type: 'triangle' });
                     tone({ f: 645, dur: .1, gain: .045, type: 'triangle', delay: .06 }); },
    print:   () => { tone({ f: 210, f2: 430, dur: .17, gain: .06, type: 'sawtooth', cut: 1600 });
                     noise({ dur: .09, gain: .035, cut: 2600, delay: .15 }); },
    beacon:  () => tone({ f: 870, f2: 1310, dur: .1, gain: .05, type: 'sine' }),
    hit:     () => { noise({ dur: .09, gain: .08, cut: 2600, cut2: 620 });
                     tone({ f: 112, f2: 70, dur: .09, gain: .045, type: 'square' }); },
    die:     () => { noise({ dur: .5, gain: .11, cut: 1500, cut2: 90 });
                     tone({ f: 125, f2: 42, dur: .45, gain: .06, type: 'sawtooth' }); },
    launch:  () => { noise({ dur: 2.4, gain: .15, cut: 620, cut2: 190, q: .7 });
                     tone({ f: 62, f2: 36, dur: 2.1, gain: .07, type: 'sawtooth' }); },
    win:     () => seq([392, 523, 659, 784], { dur: .3, gain: .06, type: 'square', gap: .15 }),
    lose:    () => seq([330, 262, 196, 131], { dur: .42, gain: .06, type: 'sawtooth', gap: .19 }),
  },

  laser: {
    label: 'LASER', blurb: 'Coherent-beam mining. Everything goes pew.',
    mus: { bass: 'square', lead: 'sawtooth', cut: 2200, drums: 0.3, swing: 0 },
    bore:    () => tone({ f: 1500 + Math.random() * 500, f2: 700, dur: .05, gain: .028, type: 'sawtooth' }),
    crack:   () => { tone({ f: 2400, f2: 180, dur: .22, gain: .07, type: 'sawtooth' });
                     tone({ f: 1200, f2: 90, dur: .25, gain: .04, type: 'sine', delay: .02 }); },
    deposit: () => { tone({ f: 600, f2: 1800, dur: .12, gain: .055, type: 'sine' });
                     tone({ f: 1800, dur: .07, gain: .03, type: 'sine', delay: .1 }); },
    print:   () => seq([660, 990, 1320], { dur: .09, gain: .05, type: 'square', gap: .06 }),
    beacon:  () => tone({ f: 2000, f2: 3400, dur: .09, gain: .045, type: 'sine' }),
    hit:     () => tone({ f: 1800, f2: 260, dur: .1, gain: .06, type: 'sawtooth' }),
    die:     () => { tone({ f: 1400, f2: 60, dur: .5, gain: .07, type: 'sawtooth' });
                     noise({ dur: .3, gain: .05, cut: 3000, cut2: 300, delay: .04 }); },
    launch:  () => { tone({ f: 200, f2: 2600, dur: 1.9, gain: .07, type: 'sawtooth' });
                     tone({ f: 100, f2: 1300, dur: 2.1, gain: .05, type: 'square' }); },
    win:     () => seq([880, 1174, 1568, 2093], { dur: .26, gain: .055, type: 'sawtooth', gap: .13 }),
    lose:    () => seq([1200, 800, 500, 260], { dur: .34, gain: .06, type: 'sawtooth', gap: .16 }),
  },

  demolition: {
    label: 'DEMOLITION', blurb: 'Shaped charges. Deep booms and rubble.',
    mus: { bass: 'sine', lead: 'triangle', cut: 700, drums: 1.0, swing: 0 },
    bore:    () => noise({ dur: .08, gain: .05, cut: 500, cut2: 180, q: 2 }),
    crack:   () => { noise({ dur: .55, gain: .17, cut: 1100, cut2: 60, q: 1 });
                     tone({ f: 90, f2: 30, dur: .5, gain: .11, type: 'sine' }); },
    deposit: () => { tone({ f: 160, f2: 240, dur: .16, gain: .07, type: 'triangle' });
                     noise({ dur: .16, gain: .05, cut: 700, cut2: 200 }); },
    print:   () => { noise({ dur: .28, gain: .08, cut: 1500, cut2: 300 });
                     tone({ f: 70, f2: 130, dur: .26, gain: .08, type: 'sine' }); },
    beacon:  () => { tone({ f: 300, f2: 520, dur: .14, gain: .055, type: 'triangle' });
                     noise({ dur: .1, gain: .03, cut: 1800 }); },
    hit:     () => { noise({ dur: .16, gain: .1, cut: 1400, cut2: 200 });
                     tone({ f: 80, f2: 44, dur: .15, gain: .07, type: 'sine' }); },
    die:     () => { noise({ dur: .85, gain: .17, cut: 1600, cut2: 50 });
                     tone({ f: 70, f2: 26, dur: .8, gain: .11, type: 'sine' }); },
    launch:  () => { noise({ dur: 3.0, gain: .2, cut: 420, cut2: 140, q: .6 });
                     tone({ f: 48, f2: 28, dur: 2.6, gain: .12, type: 'sine' });
                     noise({ dur: .6, gain: .12, cut: 2200, cut2: 200 }); },
    win:     () => [0, .22, .44].forEach(d => { noise({ dur: .6, gain: .13, cut: 1200, cut2: 70, delay: d });
                     tone({ f: 90, f2: 34, dur: .55, gain: .09, type: 'sine', delay: d }); }),
    lose:    () => { noise({ dur: 1.6, gain: .18, cut: 900, cut2: 40 });
                     tone({ f: 60, f2: 20, dur: 1.5, gain: .1, type: 'sine' }); },
  },

  drums: {
    label: 'PERCUSSION', blurb: 'The whole operation played on a kit.',
    mus: { bass: 'triangle', lead: 'square', cut: 1400, drums: 1.4, swing: 0.18 },
    bore:    () => noise({ dur: .035, gain: .035, cut: 9000, filter: 'highpass' }),   // hat
    crack:   () => { noise({ dur: .17, gain: .12, cut: 2200, filter: 'highpass' });    // snare
                     tone({ f: 190, f2: 150, dur: .12, gain: .05, type: 'triangle' }); },
    deposit: () => tone({ f: 220, f2: 120, dur: .22, gain: .09, type: 'sine' }),       // tom
    print:   () => { tone({ f: 400, dur: .05, gain: .06, type: 'square' });            // rim
                     tone({ f: 300, dur: .05, gain: .05, type: 'square', delay: .08 }); },
    beacon:  () => noise({ dur: .5, gain: .05, cut: 7000, filter: 'highpass' }),       // ride
    hit:     () => { tone({ f: 150, f2: 90, dur: .14, gain: .08, type: 'sine' });      // floor tom
                     noise({ dur: .06, gain: .04, cut: 3000, filter: 'highpass' }); },
    die:     () => { noise({ dur: 1.1, gain: .1, cut: 5000, filter: 'highpass' });     // crash
                     tone({ f: 110, f2: 45, dur: .4, gain: .09, type: 'sine' }); },
    launch:  () => { tone({ f: 120, f2: 34, dur: .6, gain: .14, type: 'sine' });       // big kick
                     noise({ dur: 2.4, gain: .09, cut: 6000, filter: 'highpass' });
                     [0, .18, .36, .54].forEach(d => tone({ f: 260 - d * 200, dur: .18, gain: .07, type: 'sine', delay: d })); },
    win:     () => [0, .16, .32, .48].forEach((d, i) => { tone({ f: 130, f2: 40, dur: .2, gain: .11, type: 'sine', delay: d });
                     if (i === 3) noise({ dur: 1.2, gain: .1, cut: 5000, filter: 'highpass', delay: d }); }),
    lose:    () => [0, .2, .45, .8].forEach(d => { tone({ f: 100, f2: 36, dur: .3, gain: .1, type: 'sine', delay: d });
                     noise({ dur: .3, gain: .06, cut: 2000, filter: 'highpass', delay: d }); }),
  },

  electro: {
    label: 'ELECTRO', blurb: 'Chiptune blips over a full synth score.',
    mus: { bass: 'sawtooth', lead: 'square', cut: 1800, drums: 1.0, swing: 0.12 },
    bore:    () => tone({ f: 320 + Math.random() * 90, dur: .035, gain: .022, type: 'square' }),
    crack:   () => seq([740, 1100], { dur: .09, gain: .055, type: 'square', gap: .05 }),
    deposit: () => seq([523, 784, 1047], { dur: .07, gain: .05, type: 'square', gap: .05 }),
    print:   () => seq([392, 523, 659], { dur: .08, gain: .05, type: 'triangle', gap: .05 }),
    beacon:  () => tone({ f: 1319, f2: 1976, dur: .1, gain: .045, type: 'triangle' }),
    hit:     () => tone({ f: 220, f2: 110, dur: .08, gain: .055, type: 'square' }),
    die:     () => seq([440, 330, 220, 110], { dur: .12, gain: .06, type: 'square', gap: .08 }),
    launch:  () => { seq([131, 196, 262, 392, 523], { dur: .16, gain: .06, type: 'sawtooth', gap: .12 });
                     tone({ f: 65, dur: 2.2, gain: .06, type: 'sawtooth', cut: 800 }); },
    win:     () => seq([523, 659, 784, 1047, 1319], { dur: .22, gain: .055, type: 'square', gap: .12 }),
    lose:    () => seq([415, 349, 277, 208], { dur: .3, gain: .06, type: 'square', gap: .17 }),
  },
};
const PACK_IDS = Object.keys(PACKS);

/* ---- event dispatch: every call site keeps using sfx.<event>() ---- */
function play(ev) {
  if (muted) return;
  if (!audioInit()) return;
  const fn = (PACKS[pack] || PACKS.industrial)[ev];
  if (fn) { try { fn(); } catch (e) { /* never let a sound break the sim */ } }
}
const sfx = {
  bore:    () => play('bore'),    crack: () => play('crack'),
  deposit: () => play('deposit'), print: () => play('print'),
  beacon:  () => play('beacon'),  hit:   () => play('hit'),
  die:     () => play('die'),     launch: () => play('launch'),
  win:     () => play('win'),     lose:  () => play('lose'),
};

/* ==========================================================================
   ADAPTIVE SCORE
   A 16th-note sequencer on wall-clock time (not sim time, so it does not
   chipmunk at 8x). What it plays is driven by the colony: layers enter as the
   swarm grows, it goes to a minor sixth and drops an octave at lunar night,
   and a raid on the fabricator pushes it to full intensity.
   ========================================================================== */
const PENT = [0, 3, 5, 7, 10, 12, 15, 19];       // minor pentatonic, two octaves
let musNext = 0, musStep = 0, musI = 0;

function musIntensity() {
  if (!running || !colonies || !drones) return 0;
  const c = colonies[PLAYER];
  const swarm = drones.reduce((n, d) => n + (d.alive && d.col === PLAYER ? 1 : 0), 0);
  let i = Math.min(0.75, swarm / 30);
  if (typeof auto !== 'undefined' && auto.sieging) i = Math.max(i, 0.85);
  if (c.underAttack > 0) i = 1;
  if (over) i = 0;
  return i;
}

function musicScheduler() {
  if (!actx) return;
  const wantMusic = musicOn && !muted && running && !paused && !over;
  musBus.gain.setTargetAtTime(wantMusic ? 0.5 : 0.0, actx.currentTime, 0.35);
  if (!wantMusic) { musNext = Math.max(musNext, actx.currentTime + 0.05); return; }

  musI += (musIntensity() - musI) * 0.08;
  const P = (PACKS[pack] || PACKS.industrial).mus;
  const bpm = 82 + musI * 46;
  const st = 60 / bpm / 4;                              // one 16th

  while (musNext < actx.currentTime + 0.16) {
    scheduleStep(musStep, musNext, P, st);
    const swing = (musStep % 2) ? 0 : (P.swing || 0) * st;
    musNext += st + swing - ((musStep % 2) ? (P.swing || 0) * st : 0);
    musStep++;
  }
}

function scheduleStep(s, at, P, st) {
  const night = clock && !clock.day;
  const root = night ? 98 : 110;                        // G2 at night, A2 by day
  const bar = s % 16, I = musI;
  const nf = k => root * Math.pow(2, PENT[((k % PENT.length) + PENT.length) % PENT.length] / 12);

  // bass pulse — always present, this is the heartbeat of the plant
  if (bar % 4 === 0) {
    const step4 = (s / 4 | 0) % 4;
    tone({ f: root * (step4 === 2 ? 1.5 : step4 === 3 ? 1.335 : 1), dur: st * 3.4,
           gain: .085, type: P.bass, cut: P.cut * 0.5, dest: musBus, at });
  }

  // kick + hats scale in with the operation
  if (P.drums > 0.2 && I > 0.18 && bar % 8 === 0)
    tone({ f: 105, f2: 38, dur: .22, gain: .1 * P.drums, type: 'sine', dest: musBus, at });
  if (P.drums > 0.2 && I > 0.5 && bar % 4 === 2)
    noise({ dur: .035, gain: .022 * P.drums, cut: 8000, filter: 'highpass', dest: musBus, at });
  if (P.drums > 0.8 && I > 0.7 && bar === 8)
    noise({ dur: .16, gain: .07 * P.drums, cut: 2400, filter: 'highpass', dest: musBus, at });

  // arpeggio — enters once the swarm is properly working
  if (I > 0.32 && bar % 2 === 0) {
    const k = [0, 2, 4, 3, 1, 4, 2, 5][(s / 2 | 0) % 8];
    tone({ f: nf(k) * 2, dur: st * 1.7, gain: .045 + I * 0.02, type: P.lead,
           cut: P.cut, dest: musBus, at });
  }

  // night pad — a held fifth, only in the dark
  if (night && bar === 0)
    tone({ f: root * 1.5, dur: st * 15, gain: .03, type: 'triangle', cut: 700, dest: musBus, at });

  // siege / raid lead — the top layer, only when it matters
  if (I > 0.82 && bar % 8 === 4) {
    const k = [4, 5, 6, 5][(s / 8 | 0) % 4];
    tone({ f: nf(k) * 2, f2: nf(k) * 3, dur: st * 2.6, gain: .05, type: P.lead,
           cut: P.cut * 1.4, dest: musBus, at });
  }
}
setInterval(musicScheduler, 25);


/* -------------------------------------------------------------- world gen */
function generate() {
  map = new Uint8Array(N);
  dmg = new Float32Array(N);
  tileDirty = new Uint8Array(N);
  dirtyList = [];

  const surf = new Int16Array(MW);
  for (let x = 0; x < MW; x++) {
    surf[x] = Math.round(22 + noise2(x, 0, 30, 11) * 3.6 + noise2(x, 0, 8, 12) * 1.4);
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
  const px = 22, ex = MW - 23;
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
    shipped: 0, pendingShip: 0, launchCd: 40, tier: 0,
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
    state: 'search', dig: -1, wob: srnd() * 6.28,
    cd: 0, hurt: 0, alive: true, boreTile: -1, assault: false,
    stuck: 0, panic: 0, px: 0, py: 0, _boreT: 0,
    // stamped now, not 0: a drone printed at t=300s has not been idle for 300s
    _lastWin: clock ? clock.elapsed : 0,
  };
  drones.push(d);
  return d;
}

function spawnCrawler(x, y) {
  crawlers.push({ x, y, vx: 0, vy: 0, hp: 110, max: 110, cd: 0, wob: srnd() * 6.28, alive: true });
}

function puff(x, y, col, n) {
  for (let i = 0; i < n; i++)
    parts.push({ x, y, vx: crnd(-45, 45), vy: crnd(-45, 45), life: crnd(0.25, 0.7), age: 0, c: col });
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
    if (Math.random() < 0.25) puff(tx * TS + TS / 2, ty * TS + TS / 2, '#ff8a5a', 1);
    return false;
  }
  if (!SOLID[t] || t === BED) return false;

  dmg[i] += work;
  if (Math.random() < 0.2) puff(tx * TS + crnd(3, TS - 3), ty * TS + crnd(3, TS - 3), t === ORE ? '#d2953f' : t === ICE ? '#6fd6e8' : '#6b6355', 1);
  if (dmg[i] < HARD[t]) return false;

  // broke through — cargo is capped on the total, not per resource
  if (taker) {
    taker._lastWin = clock.elapsed;
    const room = taker.cap - (taker.ore + taker.ice);
    if (room > 0) {
      const gain = Math.min(2, room);
      if (t === ORE) taker.ore += gain;
      else if (t === ICE) taker.ice += gain;
    }
  }
  map[i] = TUN; dmg[i] = 0;
  markTile(tx, ty);
  if (tx > 0) markTile(tx - 1, ty);
  if (tx < MW - 1) markTile(tx + 1, ty);
  if (ty > 0) markTile(tx, ty - 1);
  if (ty < MH - 1) markTile(tx, ty + 1);
  navDirty = true;
  puff(tx * TS + TS / 2, ty * TS + TS / 2, t === ORE ? '#d2953f' : t === ICE ? '#6fd6e8' : '#7a7266', 7);
  return true;
}

/* ------------------------------------------------------------------- input */
/* ==========================================================================
   INPUT
   Every action is addressed by name, never by hard-coded key, so the whole
   scheme can be rebound at runtime. The same actions are reachable from a
   pointer, a touch screen and the on-screen pads.
   ========================================================================== */
const DEFAULT_BINDS = {
  up:          ['w', 'arrowup'],
  down:        ['s', 'arrowdown'],
  left:        ['a', 'arrowleft'],
  right:       ['d', 'arrowright'],
  bore:        [' '],
  oreBeacon:   ['q'],
  rallyBeacon: ['e'],
  printMiner:  ['1'],
  printGuard:  ['2'],
  autofab:     ['3'],
  beacons:     ['m'],
  recentre:    ['c'],
  autoplay:    ['f'],
  pause:       ['p'],
  speedDown:   ['['],
  speedUp:     [']'],
  mute:        ['n'],
  audioPack:   ['b'],
  music:       ['v'],
};
const ACTION_INFO = {
  up:          ['Thrust up',            'move'],
  down:        ['Thrust down',          'move'],
  left:        ['Thrust left',          'move'],
  right:       ['Thrust right',         'move'],
  bore:        ['Bore (hold)',          'move'],
  oreBeacon:   ['Drop ore beacon',      'swarm'],
  rallyBeacon: ['Drop rally beacon',    'swarm'],
  printMiner:  ['Print mining drone',   'swarm'],
  printGuard:  ['Print guard drone',    'swarm'],
  autofab:     ['Toggle autofab',       'swarm'],
  beacons:     ['Beacon overlay',       'view'],
  recentre:    ['Recentre on DRONE-01', 'view'],
  autoplay:    ['Autoplay on/off',      'view'],
  pause:       ['Pause',                'view'],
  speedDown:   ['Slower',               'view'],
  speedUp:     ['Faster',               'view'],
  mute:        ['Mute audio',           'audio'],
  audioPack:   ['Next audio pack',      'audio'],
  music:       ['Score on/off',         'audio'],
};
const MOVE_ACTIONS = ['up', 'down', 'left', 'right'];

let binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
try {
  const saved = JSON.parse(localStorage.getItem('bmg_binds') || 'null');
  if (saved && typeof saved === 'object')
    for (const a in DEFAULT_BINDS) if (Array.isArray(saved[a]) && saved[a].length) binds[a] = saved[a];
} catch (e) {}
function saveBinds() { try { localStorage.setItem('bmg_binds', JSON.stringify(binds)); } catch (e) {} }

/* ---- URL flags: ?debug=1 arms the tripwires, ?seed=N pins the world ---- */
let pinnedSeed = null;
try {
  const q = new URLSearchParams(location.search);
  if (q.get('debug') === '1' || q.has('test')) TRIP.on = true;
  const sd = q.get('seed');
  if (sd !== null && sd !== '' && Number.isFinite(+sd)) pinnedSeed = (+sd) >>> 0;
} catch (e) {}

const keys = {};
const normKey = e => (e.key === ' ' ? ' ' : e.key.toLowerCase());
function actionFor(k) { for (const a in binds) if (binds[a].includes(k)) return a; return null; }
function isDown(a) { const b = binds[a]; for (let i = 0; i < b.length; i++) if (keys[b[i]]) return true; return false; }
function keyLabel(k) {
  if (k === ' ') return 'SPACE';
  if (k.startsWith('arrow')) return { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' }[k] || k;
  if (k === 'escape') return 'ESC';
  return k.toUpperCase();
}

/* ---- rebinding capture ---- */
let capturing = null;                 // action name while waiting for a key

addEventListener('keydown', e => {
  const k = normKey(e);

  if (capturing) {                     // swallow the keystroke, assign it
    e.preventDefault();
    if (k !== 'escape') assignKey(capturing, k);
    capturing = null;
    renderControls();
    return;
  }

  if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
  if (keys[k]) return;
  keys[k] = true;
  if (!running) return;

  const a = actionFor(k);
  if (k === 'escape') { quitToTitle(); return; }
  if (!a) return;

  // any steering input takes the stick back from the autopilot
  if (auto.on && MOVE_ACTIONS.includes(a)) setAuto(false);
  if (MOVE_ACTIONS.includes(a)) followPlayer();

  if (a === 'autoplay')   setAuto(!auto.on);
  if (a === 'mute')       setMuted(!muted);
  if (a === 'music')      setMusic(!musicOn);
  if (a === 'audioPack')  setPack(PACK_IDS[(PACK_IDS.indexOf(pack) + 1) % PACK_IDS.length], true);
  if (a === 'speedDown')  setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed) - 1)]);
  if (a === 'speedUp')    setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)]);
  if (a === 'pause')      togglePause();
  if (a === 'beacons')    showBeacons = !showBeacons;
  if (a === 'recentre')   followPlayer();
  if (over) return;
  if (a === 'printMiner') order('miner');
  if (a === 'printGuard') order('guard');
  if (a === 'autofab') {
    colonies[PLAYER].auto = !colonies[PLAYER].auto;
    log(colonies[PLAYER].auto ? 'Autofab <b>engaged</b> — 2 miners per guard.' : 'Autofab disengaged.');
  }
  if (a === 'oreBeacon')   dropBeacon(trail[PLAYER], 2.4, '#ffc857', 'Ore beacon dropped. Miners will sweep here.');
  if (a === 'rallyBeacon') dropBeacon(alarm[PLAYER], 2.6, '#ff9d5a', 'Rally beacon dropped. Guards converging.');
});
addEventListener('keyup', e => { keys[normKey(e)] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function assignKey(action, k) {
  // a key belongs to one action at a time
  for (const a in binds) {
    if (a === action) continue;
    const i = binds[a].indexOf(k);
    if (i >= 0) {
      binds[a].splice(i, 1);
      if (!binds[a].length) binds[a] = ['—'];      // placeholder: unbound
    }
  }
  binds[action] = [k];
  saveBinds();
}

/* ==========================================================================
   POINTER + TOUCH
   Dragging the world steers DRONE-01 toward the pointer and bores whatever it
   runs into; dragging the minimap flies the camera anywhere on the claim.
   ========================================================================== */
let ptr = { active: false, x: 0, y: 0 };     // world coords of a held pointer
let touchBore = false, touchMode = false;

function setTouchMode(on) {
  touchMode = on;
  $('touchpad').classList.toggle('on', on);
  document.querySelector('.stage').classList.toggle('touch', on);
  $('btn-touch').classList.toggle('on', on);
  try { localStorage.setItem('bmg_touch', on ? '1' : '0'); } catch (e) {}
}

/* screen -> world, accounting for the canvas being CSS-scaled.
   Returns null if the canvas has no layout box (hidden tab, collapsed
   container) — otherwise the scale factor is Infinity and NaN reaches the
   drone's velocity, which would corrupt the run permanently. */
function viewToWorld(ev) {
  const r = view.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return {
    x: cam.x + (ev.clientX - r.left) * (VW / r.width),
    y: cam.y + (ev.clientY - r.top) * (VH / r.height),
  };
}

view.addEventListener('pointerdown', ev => {
  if (!running || over) return;
  if (ev.pointerType === 'touch' && !touchMode) setTouchMode(true);
  ev.preventDefault();
  view.setPointerCapture(ev.pointerId);
  if (auto.on) setAuto(false);
  const w = viewToWorld(ev);
  if (!w) return;
  ptr.active = true; ptr.x = w.x; ptr.y = w.y;
  followPlayer();
});
view.addEventListener('pointermove', ev => {
  if (!ptr.active) return;
  const w = viewToWorld(ev);
  if (!w) return;
  ptr.x = w.x; ptr.y = w.y;
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(t =>
  view.addEventListener(t, () => { ptr.active = false; }));
view.addEventListener('contextmenu', e => e.preventDefault());

/* ---- minimap: click or drag to fly the camera ---- */
let miniDrag = false;
function miniToCam(ev) {
  const r = mini.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const fx = clamp((ev.clientX - r.left) / r.width, 0, 1);
  const fy = clamp((ev.clientY - r.top) / r.height, 0, 1);
  cam.free = true;
  cam.tx = clamp(fx * WW - VW / 2, 0, WW - VW);
  cam.ty = clamp(fy * WH - VH / 2, 0, WH - VH);
  $('btn-recentre').classList.add('on');
}
mini.addEventListener('pointerdown', ev => {
  if (!running) return;
  ev.preventDefault(); ev.stopPropagation();
  mini.setPointerCapture(ev.pointerId);
  miniDrag = true; miniToCam(ev);
});
mini.addEventListener('pointermove', ev => { if (miniDrag) miniToCam(ev); });
['pointerup', 'pointercancel'].forEach(t =>
  mini.addEventListener(t, () => { miniDrag = false; }));

function followPlayer() {
  if (!cam) return;
  cam.free = false;
  $('btn-recentre').classList.remove('on');
}

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
  spawnDrone(PLAYER, caste, c.x + rnd(-26, 26), c.y - 24);
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
  drones = []; crawlers = []; parts = []; ships = []; logLines = [];
  clock = { t: 0, day: true, phase: DAY_LEN, elapsed: 0 };
  over = false; overWin = false; paused = false; showBeacons = false;
  frame = 0; acc = 0;
  // Seed the contract. A pinned ?seed= replays an exact run; otherwise the
  // chosen seed is recorded on the league row so any run can be reproduced.
  setSeed(pinnedSeed !== null ? pinnedSeed : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  TRIP.fired.length = 0; TRIP._amode = null; TRIP._aage = 0;
  $('banner').classList.remove('on');
  $('banner-title').style.color = '';
  auto.mode = 'mine'; auto.beaconCd = 0; auto.orderCd = 0; auto.sieging = false;
  swarmPeak = 0; autoUsed = auto.on;

  generate();
  initFields();

  for (let k = 0; k < 2; k++) {
    const c = colonies[k];
    for (let i = 0; i < 6; i++) spawnDrone(k, i < 4 ? 'miner' : 'guard', c.x + rnd(-40, 40), c.y - 26);
  }
  player = drones[0];
  player.isPlayer = true; player.cap = 4; player.hp = player.max = 150;

  const nCrawl = DIFF[diff].crawlers;
  let placed = 0, guardTries = 0;
  while (placed < nCrawl && guardTries++ < 4000) {
    const tx = 10 + (srnd() * (MW - 20) | 0), ty = 58 + (srnd() * (MH - 62) | 0);
    if (!inb(tx, ty) || SOLID[map[idx(tx, ty)]]) continue;
    spawnCrawler(tx * TS + TS / 2, ty * TS + TS / 2); placed++;
  }

  cam = { x: player.x - VW / 2, y: player.y - VH / 2, free: false, tx: 0, ty: 0 };
  running = true;
  followPlayer();
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
  const rec = recordResult(win);
  lastRun = rec;
  $('banner-title').textContent = win ? 'SEAM SECURED' : 'COLONY LOST';
  $('banner-title').style.color = win ? 'var(--amber)' : 'var(--red)';
  $('banner-body').innerHTML = win
    ? 'Helios Extraction has withdrawn from Mare Ingenii.<br>Ore mined: <b>' + Math.round(c.mined) +
      '</b> &middot; shipped to Earth: <b>' + Math.round(c.shipped) + ' t</b> &middot; plant tier: <b>' +
      c.tier + '</b><br>Drones printed: <b>' + c.printed + '</b> &middot; time: <b>' + fmt(clock.elapsed) + '</b>'
    : 'The fabricator is slag. Without it there are no more drones.<br>Ore mined: <b>' +
      Math.round(c.mined) + '</b> &middot; shipped: <b>' + Math.round(c.shipped) +
      ' t</b> &middot; survived: <b>' + fmt(clock.elapsed) + '</b>';
  $('banner-body').innerHTML +=
    '<br><span class="scoreline">SCORE <b>' + rec.score.toLocaleString('en-US') + '</b>' +
    ' &middot; rank <b>#' + rec.rank + '</b> of ' + rec.total +
    (rec.auto ? ' &middot; flown by <b>AGENT</b>' : '') +
    (rec.best && rec.total > 1 ? ' &middot; <b class="pb">NEW BEST</b>' : '') + '</span>';
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

/* ==========================================================================
   LEAGUE TABLE
   Every finished contract — flown by hand or by the agent — is scored and
   filed. The record is kept in localStorage and is also read back by the
   Mission Control dashboard.
   ========================================================================== */
const DIFF_MUL = [1.0, 1.35, 1.8];
const LEAGUE_KEY = 'bmg_league';

function scoreRun(r) {
  // Tonnage shipped to Earth is the contract; everything else is supporting work.
  const base  = r.shipped * 10 + r.mined * 2 + r.tier * 60 + r.printed * 4;
  const swift = r.win ? Math.max(0, 1500 - r.time) * 2 : 0;
  return Math.round((base + swift) * DIFF_MUL[r.diff] * (r.win ? 1.5 : 0.7));
}
function loadLeague() {
  try { const a = JSON.parse(localStorage.getItem(LEAGUE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function saveLeague(a) {
  try { localStorage.setItem(LEAGUE_KEY, JSON.stringify(a.slice(0, 60))); } catch (e) {}
}

function recordResult(win) {
  const c = colonies[PLAYER];
  const r = {
    ts: Date.now(), diff: diff, win: win,
    time: Math.round(clock.elapsed),
    mined: Math.round(c.mined), shipped: Math.round(c.shipped),
    tier: c.tier, printed: c.printed, lost: c.lost,
    peak: swarmPeak, hub: Math.round(Math.max(0, c.integrity)),
    auto: autoUsed, seed: seed0, v: 2,
  };
  r.score = scoreRun(r);
  const all = loadLeague();
  all.push(r);
  all.sort((a, b) => b.score - a.score);
  saveLeague(all);
  r.rank = all.findIndex(x => x.ts === r.ts) + 1;
  r.total = all.length;
  r.best = all.length > 0 && all[0].ts === r.ts;
  return r;
}

function renderLeague(highlightTs) {
  const all = loadLeague();
  const el = $('league-body');
  if (!all.length) {
    el.innerHTML = '<p class="dim">No contracts on record yet. Finish a run and it lands here.</p>';
    return;
  }
  const wins = all.filter(r => r.win).length;
  const rows = all.slice(0, 20).map((r, i) => {
    const hl = r.ts === highlightTs ? ' class="me"' : '';
    const d = new Date(r.ts);
    const date = String(d.getDate()).padStart(2, '0') + '/' +
                 String(d.getMonth() + 1).padStart(2, '0');
    return '<tr' + hl + '>' +
      '<td class="rank">' + (i + 1) + '</td>' +
      '<td class="score">' + r.score.toLocaleString('en-US') + '</td>' +
      '<td class="' + (r.win ? 'w' : 'l') + '">' + (r.win ? 'SECURED' : 'LOST') + '</td>' +
      '<td>' + (DIFF[r.diff] ? DIFF[r.diff].name : '—') + '</td>' +
      '<td>' + (r.auto ? '<span class="ag">AGENT</span>' : 'PILOT') + '</td>' +
      '<td>' + fmt(r.time) + '</td>' +
      '<td>' + r.shipped + ' t</td>' +
      '<td>' + r.mined + '</td>' +
      '<td>' + r.tier + '</td>' +
      '<td>' + r.peak + '</td>' +
      '<td class="dt">' + date + '</td></tr>';
  }).join('');
  el.innerHTML =
    '<p class="dim">' + all.length + ' contract' + (all.length === 1 ? '' : 's') + ' on record · ' +
      wins + ' secured · best score <b style="color:var(--amber)">' +
      all[0].score.toLocaleString('en-US') + '</b></p>' +
    '<div class="tablewrap"><table class="league">' +
    '<thead><tr><th>#</th><th>SCORE</th><th>RESULT</th><th>CONTRACT</th><th>PILOT</th>' +
    '<th>TIME</th><th>SHIPPED</th><th>MINED</th><th>TIER</th><th>PEAK</th><th>DATE</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    '<p class="footnote">Score = shipped&times;10 + mined&times;2 + tier&times;60 + printed&times;4, ' +
    'plus a speed bonus for a win, all scaled by contract difficulty. Runs flown by the ' +
    'autoplay agent are filed as AGENT.</p>';
}

function quitToTitle() { running = false; $('banner').classList.remove('on'); show('screen-title'); }

/* ------------------------------------------------------------------ update */
const g0 = [0, 0], g1 = [0, 0];

/* ==========================================================================
   TRIPWIRES  (armed with ?debug=1, or by the soak harness)

   Every bug ever found in this game was a *liveness* failure, not a wrong
   value: agents that stopped moving while still claiming to be busy, a state
   whose exit could never fire, a NaN that quietly poisoned a velocity. None
   would be caught by a unit test on any single component — the wedging bug
   lived between a correct collider and a world shape it could not traverse.
   So the check is not "is this value right" but "is anything stuck".
   ========================================================================== */
function tripFail(kind, detail) {
  if (TRIP.fired.some(f => f.kind === kind)) return;   // once per kind, loudly
  const rec = { kind, detail, at: +clock.elapsed.toFixed(1), frame };
  TRIP.fired.push(rec);
  console.error('[TRIPWIRE] ' + kind + ' @ t=' + rec.at + 's', detail);
  if (typeof log === 'function') log('<span class="warn">TRIPWIRE: ' + kind + '</span>');
}

const finite2 = (a, b) => Number.isFinite(a) && Number.isFinite(b);

function checkTripwires(dt) {
  // 1. NaN sweep — one poisoned coordinate ruins the run from that frame on
  if (!finite2(cam.x, cam.y)) tripFail('nan-camera', { x: cam.x, y: cam.y });
  for (const d of drones) {
    if (!d.alive) continue;
    if (!finite2(d.x, d.y) || !finite2(d.vx, d.vy))
      { tripFail('nan-drone', { col: d.col, caste: d.caste, x: d.x, y: d.y, vx: d.vx, vy: d.vy }); break; }
  }
  for (const c of crawlers)
    if (c.alive && !finite2(c.x, c.y)) { tripFail('nan-crawler', { x: c.x, y: c.y }); break; }
  for (const s of ships)
    if (!finite2(s.x, s.y)) { tripFail('nan-ship', { x: s.x, y: s.y }); break; }

  // 2. Motionless but active, and 3. stale AI state
  for (const d of drones) {
    if (!d.alive) continue;
    // Wedged means motionless *and* achieving nothing. A drone parked on a
    // basalt seam is stationary by design, so movement alone proves little —
    // what proves a wedge is that it has not broken a tile or unloaded either.
    if (d._lx === undefined) { d._lx = d.x; d._ly = d.y; d._still = 0; }
    const travelled = Math.hypot(d.x - d._lx, d.y - d._ly);
    d._still = travelled < TRIP.eps ? d._still + dt : 0;
    d._lx = d.x; d._ly = d.y;
    const notDrilling = clock.elapsed - (d._boreT === undefined ? 0 : d._boreT);
    if (d._still > TRIP.idle && notDrilling > TRIP.idle)
      tripFail('agent-wedged', { col: d.col, caste: d.caste, state: d.state,
        x: Math.round(d.x), y: Math.round(d.y), stillFor: +d._still.toFixed(1),
        notDrillingFor: +notDrilling.toFixed(1), stuckTimer: +(d.stuck || 0).toFixed(1),
        panic: +(d.panic || 0).toFixed(1), speed: +Math.hypot(d.vx, d.vy).toFixed(1),
        tile: map[idx(d.x / TS | 0, d.y / TS | 0)] });

    if (d._pstate !== d.state) { d._pstate = d.state; d._stateAge = 0; }
    d._stateAge = (d._stateAge || 0) + dt;
    if (TRANSIENT_STATES.includes(d.state) && d._stateAge > TRIP.transient)
      tripFail('state-stuck', { col: d.col, caste: d.caste, state: d.state,
        heldFor: +d._stateAge.toFixed(1), cargo: d.ore + d.ice,
        homeDist: home[d.col][idx(d.x / TS | 0, d.y / TS | 0)] });
  }

  // the pilot's own autopilot mode is the state that deadlocked before
  if (auto.on) {
    if (TRIP._amode !== auto.mode) { TRIP._amode = auto.mode; TRIP._aage = 0; }
    TRIP._aage = (TRIP._aage || 0) + dt;
    if (TRANSIENT_MODES.includes(auto.mode) && TRIP._aage > TRIP.autoTransient)
      tripFail('autoplay-mode-stuck', { mode: auto.mode, heldFor: +TRIP._aage.toFixed(1),
        hp: Math.round(player.hp), max: player.max, cargo: player.ore + player.ice });
  }
}

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
  updateShips(dt);

  if (TRIP.on && frame % 6 === 0) checkTripwires(dt * 6);

  // reap
  if (frame % 30 === 0) {
    drones = drones.filter(d => d.alive || d.isPlayer);
    crawlers = crawlers.filter(c => c.alive);
    let n = 0;
    for (const d of drones) if (d.alive && d.col === PLAYER) n++;
    if (n > swarmPeak) swarmPeak = n;
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 22 * dt;
    if (p.age > p.life) parts.splice(i, 1);
  }

  // camera — follows DRONE-01 unless the minimap has taken it somewhere
  const tx = cam.free ? cam.tx : clamp(player.x - VW / 2, 0, WW - VW);
  const ty = cam.free ? cam.ty : clamp(player.y - VH / 2, 0, WH - VH);
  const k = 1 - Math.pow(cam.free ? 0.000002 : 0.0009, dt);
  cam.x = lerp(cam.x, tx, k);
  cam.y = lerp(cam.y, ty, k);

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

  let ax = 0, ay = 0, boring = isDown('bore') || touchBore;
  if (auto.on) {
    const cmd = autopilot(dt);
    ax = cmd.x; ay = cmd.y; boring = cmd.bore;
  } else {
    if (isDown('left'))  ax -= 1;
    if (isDown('right')) ax += 1;
    if (isDown('up'))    ay -= 1;
    if (isDown('down'))  ay += 1;
    // A held pointer (mouse or finger) flies the drone at it and bores what it
    // meets — this is the whole control scheme on a touch screen.
    if (!ax && !ay && ptr.active) {
      const dx = ptr.x - p.x, dy = ptr.y - p.y, d = Math.hypot(dx, dy);
      if (d > 9 && isFinite(d)) { ax = dx / d; ay = dy / d; boring = true; }
    }
  }
  if (ax || ay) {
    const m = Math.hypot(ax, ay);
    faceX = ax / m; faceY = ay / m;
    p.vx += (ax / m) * 1200 * dt;
    p.vy += (ay / m) * 1200 * dt;
  }
  const drag = Math.pow(0.0015, dt);
  p.vx *= drag; p.vy *= drag;
  const sp = Math.hypot(p.vx, p.vy), MAXV = 220;
  if (sp > MAXV) { p.vx = p.vx / sp * MAXV; p.vy = p.vy / sp * MAXV; }
  moveEnt(p, dt, 4.0);

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
      if (bore(btx, bty, 175 * dt, PLAYER, p, 0.22)) sfx.crack();
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
  if (on) autoUsed = true;
  auto.mode = 'mine'; auto.beaconCd = 0; auto.orderCd = 0; auto.sieging = false;
  swarmPeak = 0; autoUsed = auto.on;
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
    if (auto.beaconCd <= 0 && Math.hypot(foe.x - p.x, foe.y - p.y) < 300) {
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
  p._dt = (p._dt || 0) + dt;
  if (p._dt >= 0.5) {
    const sx = p._sx === undefined ? p.x : p._sx, sy = p._sy === undefined ? p.y : p._sy;
    p.stuck = Math.hypot(p.x - sx, p.y - sy) < 6 ? (p.stuck || 0) + p._dt : 0;
    p._sx = p.x; p._sy = p.y; p._dt = 0;
  }
  if (p.stuck > 0.9) { p.stuck = 0; p.panic = 1.3; const a = sangle(); p.px = Math.cos(a); p.py = Math.sin(a); }
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
  // Displacement, not speed. A drone orbiting a local minimum of the scent
  // field carries real velocity and gets nowhere, so a speed test never fires
  // and it can idle away an entire contract. Net progress is the only signal
  // that distinguishes "working" from "busy".
  d._dt = (d._dt || 0) + dt;
  if (d._dt >= 0.5) {
    const sx = d._sx === undefined ? d.x : d._sx, sy = d._sy === undefined ? d.y : d._sy;
    d.stuck = Math.hypot(d.x - sx, d.y - sy) < 6 ? d.stuck + d._dt : 0;
    d._sx = d.x; d._sy = d.y; d._dt = 0;
  }
  if (d.stuck > 0.9) {
    d.stuck = 0; d.panic = 1.3;
    const a = sangle();
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
      if (d.caste === 'miner' || d.state === 'assault' || d.state === 'defend') {
        d._boreT = clock.elapsed;                     // drilling counts as working
        if (bore(ntx, nty, (d.caste === 'miner' ? 58 : 34) * dt, d.col, d.caste === 'miner' ? d : null))
          d.cd = 0;
      }
    } else if (t === RHUB || t === HUB) {
      if ((t === HUB ? PLAYER : HELIOS) !== d.col) { d._boreT = clock.elapsed; bore(ntx, nty, 42 * dt, d.col, null); }
    }
  }

  const acc = d.caste === 'guard' ? 610 : 530;
  d.vx += wx * acc * dt; d.vy += wy * acc * dt;
  const drag = Math.pow(0.004, dt);
  d.vx *= drag; d.vy *= drag;
  const sp = Math.hypot(d.vx, d.vy), MAXV = d.caste === 'guard' ? 140 : 117;
  if (sp > MAXV) { d.vx = d.vx / sp * MAXV; d.vy = d.vy / sp * MAXV; }
  moveEnt(d, dt, 3.4);
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
  // A third of every ore delivery is set aside for the Earth-return contract;
  // the rest is feedstock the fabricator can actually spend.
  const cut = Math.round(d.ore * 0.34);
  c.pendingShip += cut;
  c.ore += d.ore - cut; c.ice += d.ice; c.mined += d.ore + d.ice;
  if (d.isPlayer) { sfx.deposit(); log('Unloaded <b>' + d.ore + ' ore</b>, <b>' + d.ice + ' ice</b>.'); }
  d.ore = 0; d.ice = 0; d.cd = 0; d._lastWin = clock.elapsed;
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
    if (solidPx(e.x, (ty - 1) * TS + TS / 2) && solidPx(e.x, (ty + 1) * TS + TS / 2))
      e.y = lerp(e.y, ty * TS + TS / 2, k);
    if (solidPx((tx - 1) * TS + TS / 2, e.y) && solidPx((tx + 1) * TS + TS / 2, e.y))
      e.x = lerp(e.x, tx * TS + TS / 2, k);
  }

  e.x = clamp(e.x, TS * 2, WW - TS * 2);
  e.y = clamp(e.y, 4, WH - TS * 3);
}

/* ------------------------------------------------------------------ hazard */
function updateCrawler(c, dt) {
  c.cd -= dt;
  let target = null, bd = 200;
  for (const d of drones) {
    if (!d.alive) continue;
    const dist = Math.hypot(d.x - c.x, d.y - c.y);
    if (dist < bd) { bd = dist; target = d; }
  }
  let wx, wy;
  if (target) { wx = target.x - c.x; wy = target.y - c.y; const m = Math.hypot(wx, wy) || 1; wx /= m; wy /= m; }
  else { c.wob += dt * 0.8; wx = Math.cos(c.wob); wy = Math.sin(c.wob * 0.6) * 0.5; }
  c.vx += wx * 345 * dt; c.vy += wy * 345 * dt;
  const drag = Math.pow(0.004, dt);
  c.vx *= drag; c.vy *= drag;
  const sp = Math.hypot(c.vx, c.vy);
  if (sp > 96) { c.vx = c.vx / sp * 96; c.vy = c.vy / sp * 96; }
  moveEnt(c, dt, 5.4);
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
      if (dx * dx + dy * dy > 340) continue;
      hurt(a, (b.caste === 'guard' ? 30 : 15) * dt, b);
      hurt(b, (a.caste === 'guard' ? 30 : 15) * dt, a);
    }
    for (const c of crawlers) {
      if (!c.alive) continue;
      const dx = c.x - a.x, dy = c.y - a.y;
      if (dx * dx + dy * dy > 450) continue;
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

  // The surface plant builds itself out as cumulative tonnage lands.
  const nt = tierOf(c);
  if (nt > c.tier) {
    c.tier = nt;
    if (c.id === PLAYER)
      log('<span class="good">Plant expanded</span> to <b>tier ' + nt + '</b> — new module online.');
  }

  // Surplus ore goes to Earth orbit. A reserve is always kept back for printing.
  c.launchCd -= dt;
  if (c.launchCd <= 0) {
    if (c.pendingShip >= 15 && c.tier >= 1) {
      const load = Math.min(70, Math.floor(c.pendingShip));
      c.pendingShip -= load; c.shipped += load;
      launchShip(c, load);
      c.launchCd = 30;
    } else c.launchCd = 6;
  }

  c.printCd -= dt;
  const mine = drones.filter(d => d.alive && d.col === c.id);
  const miners = mine.filter(d => d.caste === 'miner').length;
  const guards = mine.length - miners;

  if (c.auto && c.printCd <= 0 && mine.length < 34) {
    const want = guards * 2 < miners ? 'guard' : 'miner';
    if (affordable(c, want)) {
      const k = COST[want];
      c.ore -= k.ore; c.ice -= k.ice; c.pwr -= k.pwr; c.printed++;
      spawnDrone(c.id, want, c.x + rnd(-26, 26), c.y - 24);
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
  [VAC]: '#04060a', [REG]: '#6a6459', [BAS]: '#3a3f47', [ORE]: '#7c6a4e',
  [ICE]: '#3d6b78', [TUN]: '#0c1016', [HUB]: '#c2ccd8', [RHUB]: '#8f4a45', [BED]: '#12161c',
};

/* Stable per-tile hash, so rock texture never shimmers between redraws. */
const th = i => (Math.imul(i | 0, 0x9e3779b1) >>> 24);

function paintSky() {
  const g = tctx.createLinearGradient(0, 0, 0, 30 * TS);
  g.addColorStop(0, '#020408'); g.addColorStop(1, '#080d15');
  tctx.fillStyle = g; tctx.fillRect(0, 0, WW, 32 * TS);
  for (let i = 0; i < 620; i++) {
    const x = Math.random() * WW, y = Math.random() * 26 * TS;
    const a = 0.2 + Math.random() * 0.7;
    tctx.fillStyle = 'rgba(214,228,255,' + a.toFixed(2) + ')';
    tctx.fillRect(x | 0, y | 0, 1, 1);
    if (a > 0.85) { tctx.globalAlpha = 0.25; tctx.fillRect((x | 0) - 1, y | 0, 3, 1); tctx.fillRect(x | 0, (y | 0) - 1, 1, 3); tctx.globalAlpha = 1; }
  }
}

function drawTile(i) {
  const x = (i % MW) * TS, y = ((i / MW) | 0) * TS, t = map[i];
  if (t === VAC) return;
  const h = th(i);

  /* ---- bored tunnel: an engineered bore, not a hole ---- */
  if (t === TUN) {
    tctx.fillStyle = '#0c1016'; tctx.fillRect(x, y, TS, TS);
    tctx.fillStyle = 'rgba(140,175,215,.06)'; tctx.fillRect(x, y, TS, 1);
    tctx.fillStyle = 'rgba(0,0,0,.5)';        tctx.fillRect(x, y + TS - 2, TS, 2);
    if ((h & 3) === 0) {                       // occasional wall rib
      tctx.fillStyle = 'rgba(120,170,220,.10)';
      tctx.fillRect(x + (h & 8 ? 3 : TS - 4), y + 2, 1, TS - 4);
    }
    return;
  }

  /* ---- fabricator structure ---- */
  if (t === HUB || t === RHUB) {
    const hot = t === HUB;
    tctx.fillStyle = hot ? '#aab6c4' : '#8f4a45';
    tctx.fillRect(x, y, TS, TS);
    tctx.fillStyle = 'rgba(255,255,255,.22)'; tctx.fillRect(x, y, TS, 2);
    tctx.fillStyle = 'rgba(0,0,0,.45)';       tctx.fillRect(x, y + TS - 3, TS, 3);
    tctx.fillStyle = hot ? 'rgba(30,44,60,.85)' : 'rgba(40,16,16,.85)';
    tctx.fillRect(x + 2, y + 4, TS - 4, TS - 8);
    tctx.fillStyle = hot ? '#6fd6e8' : '#ff8a7a';       // status lamp
    if ((h & 3) === 0) tctx.fillRect(x + 4, y + 6, 2, 2);
    // hazard chevron
    if ((h & 7) === 1) {
      tctx.fillStyle = 'rgba(255,200,87,.5)';
      tctx.fillRect(x + 3, y + TS - 6, TS - 6, 1);
    }
    return;
  }

  /* ---- rock ----
     Shade only at real surfaces. Outlining every tile turns a rock mass into a
     waffle grid; lighting just the exposed faces makes it read as one body of
     stone with a bored void cut through it. */
  tctx.fillStyle = COL[t];
  tctx.fillRect(x, y, TS, TS);

  const gx = i % MW, gy = (i / MW) | 0;
  const openU = gy > 0      && !SOLID[map[i - MW]];
  const openD = gy < MH - 1 && !SOLID[map[i + MW]];
  const openL = gx > 0      && !SOLID[map[i - 1]];
  const openR = gx < MW - 1 && !SOLID[map[i + 1]];

  if (openU) {                                   // sunlit / lamplit cut face
    tctx.fillStyle = 'rgba(255,252,240,.16)'; tctx.fillRect(x, y, TS, 2);
    tctx.fillStyle = 'rgba(255,252,240,.07)'; tctx.fillRect(x, y + 2, TS, 1);
  }
  if (openD) { tctx.fillStyle = 'rgba(0,0,0,.45)'; tctx.fillRect(x, y + TS - 2, TS, 2); }
  if (openL) { tctx.fillStyle = 'rgba(0,0,0,.22)'; tctx.fillRect(x, y, 2, TS); }
  if (openR) { tctx.fillStyle = 'rgba(0,0,0,.22)'; tctx.fillRect(x + TS - 2, y, 2, TS); }

  // regolith grain / basalt fracture
  if (t === REG) {
    tctx.fillStyle = 'rgba(255,255,255,.045)';
    tctx.fillRect(x + (h % 11) + 1, y + ((h >> 3) % 11) + 2, 2, 1);
    tctx.fillStyle = 'rgba(0,0,0,.14)';
    tctx.fillRect(x + ((h >> 2) % 12), y + ((h >> 5) % 12), 2, 2);
  } else if (t === BAS) {
    tctx.fillStyle = 'rgba(0,0,0,.30)';
    tctx.fillRect(x + ((h >> 1) % 10) + 2, y + 1, 1, TS - 2);
    tctx.fillStyle = 'rgba(180,205,230,.05)';
    tctx.fillRect(x + 1, y + ((h >> 4) % 12) + 1, TS - 2, 1);
  } else if (t === ORE) {
    // ilmenite: dark host rock carrying bright metallic flecks
    tctx.fillStyle = 'rgba(0,0,0,.22)'; tctx.fillRect(x + 1, y + 1, TS - 2, TS - 2);
    for (let k = 0; k < 5; k++) {
      const ox = ((h * (k + 3)) % (TS - 5)) + 2, oy = ((h * (k + 7) >> 2) % (TS - 5)) + 2;
      tctx.fillStyle = k & 1 ? '#e8bb63' : '#b98a4a';
      tctx.fillRect(x + ox, y + oy, 2, 2);
      tctx.fillStyle = 'rgba(255,240,200,.55)';
      tctx.fillRect(x + ox, y + oy, 1, 1);
    }
  } else if (t === ICE) {
    tctx.fillStyle = 'rgba(140,230,250,.16)'; tctx.fillRect(x + 1, y + 1, TS - 2, TS - 2);
    tctx.fillStyle = '#a8ecf8';
    tctx.fillRect(x + 3, y + 4, 4, 2); tctx.fillRect(x + 8, y + 9, 4, 2);
    tctx.fillStyle = 'rgba(255,255,255,.75)';
    tctx.fillRect(x + 3, y + 4, 1, 1); tctx.fillRect(x + 8, y + 9, 1, 1);
  } else if (t === BED) {
    tctx.fillStyle = 'rgba(0,0,0,.5)';
    tctx.fillRect(x + 2, y + 2, TS - 4, TS - 4);
  }
}

function flushTiles() {
  if (!dirtyList.length) return;
  for (const i of dirtyList) {
    if (map[i] !== VAC) {
      const x = (i % MW) * TS, y = ((i / MW) | 0) * TS;
      tctx.clearRect(x, y, TS, TS);
      tctx.fillStyle = '#04060a'; tctx.fillRect(x, y, TS, TS);
      drawTile(i);
    }
    tileDirty[i] = 0;
  }
  dirtyList.length = 0;
}

/* ------------------------------------------------------- the main draw pass */
function render() {
  flushTiles();
  const cx = Math.round(cam.x), cy = Math.round(cam.y);

  vctx.fillStyle = '#04060a';
  vctx.fillRect(0, 0, VW, VH);
  vctx.drawImage(terrain, cx, cy, VW, VH, 0, 0, VW, VH);

  vctx.save();
  vctx.translate(-cx, -cy);

  drawSky(cx, cy);
  if (showBeacons) drawBeacons(cx, cy);
  for (const c of colonies) drawBase(c);
  drawShips();

  if (player.boreTile >= 0) {
    const bx = (player.boreTile % MW) * TS, by = ((player.boreTile / MW) | 0) * TS;
    const t = map[player.boreTile];
    const prog = t === HUB || t === RHUB ? 0 : clamp(dmg[player.boreTile] / (HARD[t] || 1), 0, 1);
    vctx.fillStyle = 'rgba(255,200,87,.26)';
    vctx.fillRect(bx, by + TS - TS * prog, TS, TS * prog);
    vctx.strokeStyle = 'rgba(255,200,87,.9)'; vctx.lineWidth = 1;
    // engineering-style corner ticks rather than a plain box
    const L = 5;
    vctx.beginPath();
    vctx.moveTo(bx + .5, by + L); vctx.lineTo(bx + .5, by + .5); vctx.lineTo(bx + L, by + .5);
    vctx.moveTo(bx + TS - L, by + .5); vctx.lineTo(bx + TS - .5, by + .5); vctx.lineTo(bx + TS - .5, by + L);
    vctx.moveTo(bx + .5, by + TS - L); vctx.lineTo(bx + .5, by + TS - .5); vctx.lineTo(bx + L, by + TS - .5);
    vctx.moveTo(bx + TS - L, by + TS - .5); vctx.lineTo(bx + TS - .5, by + TS - .5); vctx.lineTo(bx + TS - .5, by + TS - L);
    vctx.stroke();
    vctx.strokeStyle = 'rgba(255,200,87,.35)';
    vctx.beginPath(); vctx.moveTo(player.x, player.y); vctx.lineTo(bx + TS / 2, by + TS / 2); vctx.stroke();
  }

  for (const c of crawlers) if (c.alive) drawCrawler(c);
  for (const d of drones) if (d.alive && !d.isPlayer) drawDrone(d);
  drawDrone(player, true);

  for (const p of parts) {
    vctx.globalAlpha = (1 - p.age / p.life) * 0.85;
    vctx.fillStyle = p.c;
    vctx.fillRect(p.x - 1, p.y - 1, 3, 3);
  }
  vctx.globalAlpha = 1;
  vctx.restore();

  if (!clock.day) { vctx.fillStyle = 'rgba(8,18,44,.22)'; vctx.fillRect(0, 0, VW, VH); }

  const vg = vctx.createRadialGradient(VW / 2, VH / 2, VH * 0.38, VW / 2, VH / 2, VH * 0.98);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.5)');
  vctx.fillStyle = vg; vctx.fillRect(0, 0, VW, VH);

  if (auto.on) {
    const lbl = 'AUTOPLAY · ' + auto.mode.toUpperCase();
    vctx.font = '700 12px ui-monospace,monospace';
    vctx.fillStyle = 'rgba(255,200,87,.92)';
    vctx.fillRect(14, 14, vctx.measureText(lbl).width + 20, 24);
    vctx.fillStyle = '#05070c'; vctx.fillText(lbl, 24, 30);
  }
  if (speed !== 1) {
    vctx.font = '700 12px ui-monospace,monospace';
    vctx.fillStyle = 'rgba(111,214,232,.9)';
    vctx.fillText(speed + '×', 14, auto.on ? 56 : 30);
  }
  if (cam.free) {
    const lbl = 'FREE LOOK · RECENTRE TO RESUME TRACKING';
    vctx.font = '700 11px ui-monospace,monospace';
    const w = vctx.measureText(lbl).width + 18;
    vctx.fillStyle = 'rgba(111,214,232,.9)';
    vctx.fillRect(VW / 2 - w / 2, 14, w, 22);
    vctx.fillStyle = '#04070c';
    vctx.textAlign = 'center';
    vctx.fillText(lbl, VW / 2, 29);
    vctx.textAlign = 'left';
  }

  if (frame % 6 === 0) drawMini();
  updateHud();
}

function drawSky(cx, cy) {
  if (cy > 30 * TS) return;

  // Earth, fixed in the lunar sky
  const ex = 420, ey = 110;
  const eg = vctx.createRadialGradient(ex - 11, ey - 11, 4, ex, ey, 38);
  eg.addColorStop(0, '#a8d4ff'); eg.addColorStop(.5, '#3f74b4'); eg.addColorStop(1, '#0d1728');
  vctx.fillStyle = eg;
  vctx.beginPath(); vctx.arc(ex, ey, 33, 0, 6.2832); vctx.fill();
  vctx.fillStyle = 'rgba(126,196,146,.42)';
  vctx.beginPath(); vctx.ellipse(ex - 8, ey + 5, 13, 8, .4, 0, 6.2832); vctx.fill();
  vctx.beginPath(); vctx.ellipse(ex + 10, ey - 9, 7, 5, -.3, 0, 6.2832); vctx.fill();
  vctx.fillStyle = 'rgba(255,255,255,.30)';
  vctx.beginPath(); vctx.ellipse(ex + 4, ey + 14, 11, 4, .2, 0, 6.2832); vctx.fill();

  // sun tracks the day phase
  const frac = clock.day ? 1 - clock.phase / DAY_LEN : -1;
  if (frac >= 0) {
    const sx = 160 + frac * (WW - 320), sy = 185 - Math.sin(frac * Math.PI) * 120;
    const sg = vctx.createRadialGradient(sx, sy, 3, sx, sy, 60);
    sg.addColorStop(0, 'rgba(255,250,232,.98)'); sg.addColorStop(.28, 'rgba(255,224,150,.32)');
    sg.addColorStop(1, 'rgba(255,200,87,0)');
    vctx.fillStyle = sg;
    vctx.beginPath(); vctx.arc(sx, sy, 60, 0, 6.2832); vctx.fill();
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
    if (ap > 0.02) { vctx.fillStyle = 'rgba(255,140,60,' + Math.min(.5, ap * .35).toFixed(3) + ')'; vctx.fillRect(x * TS + 4, y * TS + 4, TS - 8, TS - 8); }
  }
}

/* ==========================================================================
   THE SURFACE PLANT
   Every colony has an ISRU plant on the surface above its shaft. It gains a
   module each time cumulative delivered tonnage crosses a tier threshold, so
   a productive colony visibly builds itself out.
   ========================================================================== */
const TIERS = [0, 70, 170, 320, 520, 800];
function tierOf(c) { let t = 0; for (let i = 1; i < TIERS.length; i++) if (c.mined >= TIERS[i]) t = i; return t; }

function drawBase(c) {
  const mine = c.id === PLAYER;
  const key = mine ? '255,200,87' : '255,90,90';
  const sy = c.surfY * TS;                       // ground line
  const tier = c.tier;
  const lit = clock.day;

  // buried glow so you can find the shaft from below
  const g = vctx.createRadialGradient(c.x, c.y + TS, 6, c.x, c.y + TS, 110);
  g.addColorStop(0, 'rgba(' + key + ',.22)'); g.addColorStop(1, 'rgba(' + key + ',0)');
  vctx.fillStyle = g;
  vctx.beginPath(); vctx.arc(c.x, c.y + TS, 110, 0, 6.2832); vctx.fill();

  vctx.save();
  vctx.translate(c.x, sy);

  const W = 34 + tier * 7;                       // plant footprint grows with output

  // --- concrete-sintered pad ---
  vctx.fillStyle = '#4c4740';
  vctx.fillRect(-W, -4, W * 2, 5);
  vctx.fillStyle = 'rgba(255,255,255,.10)';
  vctx.fillRect(-W, -4, W * 2, 1);

  // --- main ISRU processing block: white NASA hardware ---
  const bh = 16 + tier * 3;
  vctx.fillStyle = '#cdd6e0'; vctx.fillRect(-19, -4 - bh, 38, bh);
  vctx.fillStyle = '#9aa6b4'; vctx.fillRect(-19, -4 - bh, 38, 3);
  vctx.fillStyle = '#2c333d'; vctx.fillRect(-15, -bh, 30, bh - 8);
  // module seams
  vctx.fillStyle = 'rgba(0,0,0,.30)';
  for (let k = -12; k < 15; k += 9) vctx.fillRect(k, -4 - bh + 3, 1, bh - 3);
  // status lamps
  vctx.fillStyle = lit ? '#6fd6e8' : '#2c6b78';
  vctx.fillRect(-13, -bh - 1, 3, 2); vctx.fillRect(10, -bh - 1, 3, 2);
  // colony marking
  vctx.fillStyle = 'rgba(' + key + ',.95)';
  vctx.fillRect(-19, -4 - bh, 38, 1);
  vctx.font = '700 8px ui-monospace,monospace';
  vctx.textAlign = 'center';
  vctx.fillText(mine ? 'BORE-1 ISRU' : 'HELIOS ISRU', 0, -8 - bh);

  // --- solar arrays: one pair per tier, tilted to the sun ---
  const panels = 1 + Math.min(3, tier);
  for (let k = 0; k < panels; k++) {
    const px = -W + 8 + k * 15, py = -8 - (k % 2) * 4;
    vctx.save(); vctx.translate(px, py); vctx.rotate(-0.22);
    vctx.fillStyle = lit ? '#2f5f96' : '#16283d';
    vctx.fillRect(-7, -2, 14, 4);
    vctx.strokeStyle = 'rgba(180,215,255,.45)'; vctx.lineWidth = .6;
    vctx.beginPath(); vctx.moveTo(-7, 0); vctx.lineTo(7, 0); vctx.stroke();
    vctx.restore();
    vctx.fillStyle = '#8b95a3'; vctx.fillRect(px - 1, py, 2, -py - 4);
  }
  for (let k = 0; k < panels; k++) {
    const px = W - 8 - k * 15, py = -8 - (k % 2) * 4;
    vctx.save(); vctx.translate(px, py); vctx.rotate(0.22);
    vctx.fillStyle = lit ? '#2f5f96' : '#16283d';
    vctx.fillRect(-7, -2, 14, 4);
    vctx.restore();
    vctx.fillStyle = '#8b95a3'; vctx.fillRect(px - 1, py, 2, -py - 4);
  }

  // --- tier 2+: high-gain dish, pointed at Earth ---
  if (tier >= 2) {
    vctx.save(); vctx.translate(-W + 16, -4 - bh - 6);
    vctx.fillStyle = '#8b95a3'; vctx.fillRect(-1, 0, 2, 7);
    vctx.fillStyle = '#e2e8ef';
    vctx.beginPath(); vctx.ellipse(0, -1, 6, 4, -0.5, 0, 6.2832); vctx.fill();
    vctx.fillStyle = '#5a6472';
    vctx.beginPath(); vctx.ellipse(0, -1, 3.4, 2.2, -0.5, 0, 6.2832); vctx.fill();
    vctx.restore();
  }
  // --- tier 3+: volatile storage tanks ---
  if (tier >= 3) {
    for (let k = 0; k < 2; k++) {
      const px = 24 + k * 11;
      vctx.fillStyle = '#dfe6ee';
      vctx.beginPath(); vctx.ellipse(px, -11, 5, 7, 0, 0, 6.2832); vctx.fill();
      vctx.fillStyle = 'rgba(111,214,232,.55)'; vctx.fillRect(px - 5, -13, 10, 1.5);
      vctx.fillStyle = '#8b95a3'; vctx.fillRect(px - 1, -4, 2, 4);
    }
  }
  // --- tier 4+: radiator fins ---
  if (tier >= 4) {
    for (let k = 0; k < 3; k++) {
      vctx.fillStyle = 'rgba(226,232,239,.85)';
      vctx.fillRect(-30 - k * 6, -4 - bh + 4, 3, bh - 6);
    }
  }
  // --- tier 5: pressurised habitat dome ---
  if (tier >= 5) {
    vctx.fillStyle = '#e8eef5';
    vctx.beginPath(); vctx.arc(-W + 30, -4, 11, Math.PI, 0); vctx.fill();
    vctx.fillStyle = 'rgba(111,214,232,.5)';
    vctx.fillRect(-W + 26, -8, 3, 3); vctx.fillRect(-W + 32, -8, 3, 3);
  }

  // --- launch pad + gantry (from tier 1) ---
  if (tier >= 1) {
    const px = W - 4;
    vctx.fillStyle = '#3d3a35'; vctx.fillRect(px - 13, -6, 26, 6);
    vctx.fillStyle = 'rgba(255,200,87,.35)';
    for (let k = -10; k < 11; k += 5) vctx.fillRect(px + k, -6, 2, 1);
    vctx.fillStyle = '#8b95a3'; vctx.fillRect(px + 11, -24, 2, 18);
    c.padX = c.x + px; c.padY = sy - 6;
  } else { c.padX = c.x + W - 4; c.padY = sy - 4; }

  vctx.textAlign = 'left';
  vctx.restore();

  // shaft lip markers
  vctx.fillStyle = 'rgba(' + key + ',.55)';
  vctx.fillRect(c.x - TS * 2, sy - 1, 3, 2);
  vctx.fillRect(c.x + TS * 2 - 3, sy - 1, 3, 2);
}

/* ------------------------------------------------------- cargo to LEO/Earth */
function launchShip(c, load) {
  ships.push({
    x: c.padX || c.x, y: c.padY || c.surfY * TS - 6,
    vy: -14, age: 0, load, col: c.id, spent: false,
  });
  if (c.id === PLAYER) {
    sfx.launch();
    log('<span class="good">CARGO LAUNCH</span> — <b>' + load + ' t</b> of ore away to Earth orbit. ' +
        'Total shipped: <b>' + Math.round(c.shipped) + ' t</b>.');
  }
}

function updateShips(dt) {
  for (let i = ships.length - 1; i >= 0; i--) {
    const s = ships[i];
    s.age += dt;
    s.vy -= 105 * dt;                                  // ascent burn
    s.y += s.vy * dt;
    // exhaust plume + regolith kicked off the pad
    if (s.age < 3.2) {
      for (let k = 0; k < 2; k++)
        parts.push({ x: s.x + crnd(-3, 3), y: s.y + 12, vx: crnd(-70, 70), vy: crnd(30, 130),
                     life: crnd(0.3, 0.8), age: 0, c: k ? '#ffd08a' : '#fff3d6' });
    }
    if (s.y < -260) ships.splice(i, 1);
  }
}

function drawShips() {
  for (const s of ships) {
    const key = s.col === PLAYER ? '#ffc857' : '#ff5a5a';
    vctx.save();
    vctx.translate(s.x, s.y);
    // plume
    const pl = vctx.createLinearGradient(0, 8, 0, 40);
    pl.addColorStop(0, 'rgba(255,240,200,.85)'); pl.addColorStop(1, 'rgba(255,150,60,0)');
    vctx.fillStyle = pl;
    vctx.beginPath(); vctx.moveTo(-4, 8); vctx.lineTo(4, 8); vctx.lineTo(0, 42); vctx.closePath(); vctx.fill();
    // vehicle
    vctx.fillStyle = '#e6ecf3';
    vctx.beginPath();
    vctx.moveTo(0, -14); vctx.lineTo(5, -2); vctx.lineTo(5, 9); vctx.lineTo(-5, 9); vctx.lineTo(-5, -2);
    vctx.closePath(); vctx.fill();
    vctx.fillStyle = '#5a6472'; vctx.fillRect(-5, 0, 10, 3);
    vctx.fillStyle = key;      vctx.fillRect(-5, -5, 10, 2);
    vctx.fillStyle = '#2c333d';
    vctx.beginPath(); vctx.moveTo(-5, 9); vctx.lineTo(-9, 15); vctx.lineTo(-5, 15); vctx.closePath(); vctx.fill();
    vctx.beginPath(); vctx.moveTo(5, 9); vctx.lineTo(9, 15); vctx.lineTo(5, 15); vctx.closePath(); vctx.fill();
    vctx.restore();
  }
}

/* ------------------------------------------------------------------ drones */
function drawDrone(d, isPlayer) {
  if (!d.alive) return;
  const a = Math.atan2(d.vy, d.vx);
  const mine = d.col === PLAYER;
  const accent = mine ? '#ffc857' : '#ff5a5a';
  const hull = d.hurt > 0 ? '#ffffff' : mine ? '#d8e0ea' : '#e6c3c0';

  vctx.save();
  vctx.translate(d.x, d.y); vctx.rotate(a);

  if (isPlayer) {
    vctx.strokeStyle = 'rgba(255,200,87,.5)'; vctx.lineWidth = 1;
    vctx.beginPath(); vctx.arc(0, 0, 12 + Math.sin(frame * 0.11) * 1.4, 0, 6.2832); vctx.stroke();
  }

  if (d.caste === 'guard') {
    // survey/security drone: heavier chassis, twin booms
    vctx.fillStyle = '#4b5563';
    vctx.fillRect(-5, -6, 4, 12);
    vctx.fillStyle = hull;
    vctx.beginPath();
    vctx.moveTo(9, 0); vctx.lineTo(1, 5.5); vctx.lineTo(-5, 4); vctx.lineTo(-5, -4); vctx.lineTo(1, -5.5);
    vctx.closePath(); vctx.fill();
    vctx.fillStyle = accent; vctx.fillRect(-3, -1.2, 7, 2.4);
  } else {
    // mining drone: bore head forward, solar spine aft
    vctx.fillStyle = '#4b5563';
    vctx.fillRect(-6, -1.5, 5, 3);
    vctx.fillStyle = hull;
    vctx.beginPath();
    vctx.moveTo(8, 0); vctx.lineTo(2, 4.5); vctx.lineTo(-4, 3); vctx.lineTo(-4, -3); vctx.lineTo(2, -4.5);
    vctx.closePath(); vctx.fill();
    vctx.fillStyle = '#2f5f96';                       // panel
    vctx.fillRect(-3, -3.4, 4, 6.8);
    vctx.fillStyle = accent; vctx.fillRect(4, -1, 3, 2);
  }
  // headlamp
  vctx.fillStyle = 'rgba(220,245,255,.95)'; vctx.fillRect(7, -1, 2.5, 2);
  vctx.restore();

  // cargo pips
  const load = d.ore + d.ice;
  for (let k = 0; k < load; k++) {
    vctx.fillStyle = k < d.ore ? '#d9a441' : '#6fd6e8';
    vctx.fillRect(d.x - 5 + k * 4, d.y - 13, 3, 3);
  }
  // hull bar when damaged
  if (d.hp < d.max * 0.7) {
    vctx.fillStyle = 'rgba(0,0,0,.6)'; vctx.fillRect(d.x - 7, d.y + 10, 14, 2);
    vctx.fillStyle = d.hp < d.max * 0.3 ? '#ff5a5a' : '#6fd6e8';
    vctx.fillRect(d.x - 7, d.y + 10, 14 * (d.hp / d.max), 2);
  }
  if (isPlayer) {
    vctx.fillStyle = 'rgba(255,200,87,.95)';
    vctx.font = '700 9px ui-monospace,monospace';
    vctx.textAlign = 'center';
    vctx.fillText('DRONE-01', d.x, d.y + 24);
    vctx.textAlign = 'left';
  }
}

function drawCrawler(c) {
  vctx.save();
  vctx.translate(c.x, c.y);
  const a = Math.atan2(c.vy, c.vx);
  vctx.fillStyle = '#b06be0';
  vctx.beginPath(); vctx.ellipse(0, 0, 9, 6, a, 0, 6.2832); vctx.fill();
  vctx.strokeStyle = 'rgba(176,107,224,.75)'; vctx.lineWidth = 1.6;
  for (let k = -1; k <= 1; k += 2) {
    vctx.beginPath(); vctx.moveTo(0, 0);
    vctx.lineTo(k * 11, Math.sin(frame * 0.2 + k) * 8); vctx.stroke();
  }
  vctx.fillStyle = '#ffd0ff'; vctx.fillRect(-1.5, -1.5, 3, 3);
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
  $('hud-shipped').textContent = Math.round(c.shipped);
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

/* ==========================================================================
   CONTROLS SCREEN — tutorial + rebindable keys
   ========================================================================== */
let controlsReturn = 'screen-title';

const BIND_GROUPS = [
  ['Piloting',     'move'],
  ['The swarm',    'swarm'],
  ['View & speed', 'view'],
  ['Audio',        'audio'],
];

function renderControls() {
  $('binds').innerHTML = BIND_GROUPS.map(([title, cat]) => {
    const rows = Object.keys(ACTION_INFO)
      .filter(a => ACTION_INFO[a][1] === cat)
      .map(a => {
        const keysFor = binds[a] || [];
        const unbound = !keysFor.length || keysFor[0] === '—';
        const label = unbound ? 'unbound' : keysFor.map(keyLabel).join(' / ');
        const cls = 'keycap' + (capturing === a ? ' cap' : unbound ? ' none' : '');
        return '<div class="bindrow"><span class="nm">' + ACTION_INFO[a][0] + '</span>' +
               '<button class="' + cls + '" data-bind="' + a + '">' +
               (capturing === a ? 'press…' : label) + '</button></div>';
      }).join('');
    return '<div class="bindgroup"><h4>' + title + '</h4><div class="bindlist">' + rows + '</div></div>';
  }).join('');

  $('binds').querySelectorAll('[data-bind]').forEach(b => {
    b.onclick = () => { capturing = b.dataset.bind; renderControls(); };
  });
}

function openControls(from) {
  controlsReturn = from;
  capturing = null;
  renderControls();
  show('screen-controls');
}

$('btn-controls-title').onclick = () => openControls('screen-title');
$('btn-controls-hud').onclick = () => { if (running && !paused && !over) togglePause(); openControls('screen-game'); };
$('btn-controls-back').onclick = () => { capturing = null; show(controlsReturn); };
$('btn-binds-reset').onclick = () => {
  binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
  saveBinds(); capturing = null; renderControls();
};

/* ------------------------------------------------------------ touch pad */
$('btn-touch').onclick = () => setTouchMode(!touchMode);
$('btn-recentre').onclick = () => followPlayer();

document.querySelectorAll('#touchpad .tbtn').forEach(b => {
  if (b.dataset.hold) {                                    // BORE: hold to drill
    const on  = e => { e.preventDefault(); touchBore = true;  b.classList.add('down'); if (auto.on) setAuto(false); };
    const off = e => { e.preventDefault(); touchBore = false; b.classList.remove('down'); };
    b.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => b.addEventListener(t, off));
  } else {
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!running || over) return;
      const a = b.dataset.act;
      if (a === 'recentre')    { followPlayer(); return; }
      if (a === 'oreBeacon')   dropBeacon(trail[PLAYER], 2.4, '#ffc857', 'Ore beacon dropped. Miners will sweep here.');
      if (a === 'rallyBeacon') dropBeacon(alarm[PLAYER], 2.6, '#ff9d5a', 'Rally beacon dropped. Guards converging.');
      if (a === 'printMiner')  order('miner');
      if (a === 'printGuard')  order('guard');
    });
  }
});

/* ---------------------------------------------------------- league table */
$('btn-league-title').onclick = () => { renderLeague(); show('screen-league'); };
$('btn-league-back').onclick = () => show('screen-title');
$('btn-league-open').onclick = () => {
  running = false;
  $('banner').classList.remove('on');
  renderLeague(lastRun ? lastRun.ts : 0);
  show('screen-league');
};
$('btn-league-clear').onclick = () => {
  if (!confirm('Clear the entire contract record? This cannot be undone.')) return;
  try { localStorage.removeItem(LEAGUE_KEY); } catch (e) {}
  lastRun = null;
  renderLeague();
};
$('btn-quit').onclick = quitToTitle;
$('btn-banner').onclick = () => { if (over) startGame(); else togglePause(); };
$('btn-auto').onclick = () => setAuto(!auto.on);
$('speed-dial').onchange = e => setSpeed(+e.target.value);

/* ------------------------------------------------------------ audio controls */
function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

function syncAudioUI() {
  $('btn-mute').textContent = 'SOUND: ' + (muted ? 'OFF' : 'ON');
  $('btn-music').textContent = 'MUSIC: ' + (musicOn ? 'ON' : 'OFF');
  const mh = $('btn-mute-hud'), vh = $('btn-music-hud');
  mh.textContent = muted ? 'SFX OFF' : 'SFX';
  mh.classList.toggle('on', !muted);
  vh.classList.toggle('on', musicOn && !muted);
  vh.title = 'Adaptive score ' + (musicOn ? 'on' : 'off') + ' (V)';
  $('pack-dial').value = pack;
  document.querySelectorAll('#pack-opts .opt')
    .forEach(o => o.classList.toggle('sel', o.dataset.pack === pack));
}

function setMuted(v) {
  muted = v; save('bmg_mute', v ? '1' : '0'); syncAudioUI();
  if (!v) { audioInit(); audioResume(); }
  if (running) log(v ? 'Audio <b>muted</b>.' : 'Audio <b>on</b> — ' + PACKS[pack].label + ' pack.');
}
function setMusic(v) {
  musicOn = v; save('bmg_music', v ? '1' : '0'); syncAudioUI();
  if (v) { audioInit(); audioResume(); }
  if (running) log(v ? 'Adaptive score <b>on</b>.' : 'Adaptive score <b>off</b>.');
}
function setPack(id, demo) {
  if (!PACKS[id]) return;
  pack = id; save('bmg_pack', id); syncAudioUI();
  if (!muted) { audioInit(); audioResume(); if (demo) play('deposit'); }
  if (running) log('Audio pack: <b>' + PACKS[id].label + '</b> — ' + PACKS[id].blurb);
}

$('btn-mute').onclick = () => setMuted(!muted);
$('btn-music').onclick = () => setMusic(!musicOn);
$('btn-mute-hud').onclick = () => setMuted(!muted);
$('btn-music-hud').onclick = () => setMusic(!musicOn);
$('pack-dial').onchange = e => setPack(e.target.value, true);
document.querySelectorAll('#pack-opts .opt').forEach(o => {
  o.onclick = () => setPack(o.dataset.pack, true);
});

// Browsers only allow audio after a gesture — wake the context on the first one.
['pointerdown', 'keydown'].forEach(ev =>
  addEventListener(ev, () => { if (!muted) { audioInit(); audioResume(); } }, { once: true }));

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
  musicOn = localStorage.getItem('bmg_music') !== '0';
  const sp2 = localStorage.getItem('bmg_pack');
  if (sp2 && PACKS[sp2]) pack = sp2;
  if (localStorage.getItem('bmg_touch') === '1') setTouchMode(true);
  const d = +localStorage.getItem('bmg_diff');
  if (d >= 0 && d <= 2) {
    diff = d;
    document.querySelectorAll('#diff-opts .opt').forEach(x => x.classList.toggle('sel', +x.dataset.diff === d));
  }
} catch (e) {}
syncAudioUI();

requestAnimationFrame(loop);
