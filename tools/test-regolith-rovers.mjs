// Regolith Rovers — headless tests for the DOM-free game core.
// Run from the repository root:  node tools/test-regolith-rovers.mjs
// Loads the same script files the browser loads, in this context (a separate
// vm context makes every global lookup slow), and checks the physics against
// the textbook formulas plus the engine's rules end to end.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = path.join(root, 'games', 'regolith-rovers', 'js');
for (const f of ['physics.js', 'terrain.js', 'weapons.js', 'ai.js', 'game.js'])
  vm.runInThisContext(fs.readFileSync(path.join(js, f), 'utf8'), { filename: f });
const RR = globalThis.RR, P = RR.physics, PPM = P.PPM, DT = P.DT;

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const pct = (a, b) => Math.abs(a - b) / Math.abs(b) * 100;

function floorWorld(W, H, floorY) {
  const w = P.createWorld(W, H);
  for (let y = floorY; y < H; y++) for (let x = 0; x < W; x++) w.mask[y * W + x] = P.MAT.REG;
  return w;
}

/* ------------------------------------------------------------ ballistics */
console.log('Ballistics on flat ground (vacuum)');
const speeds = [10, 15, 20];
for (let i = 0; i < 3; i++) {
  const pl = P.PLANETS[i], v = speeds[i], th = Math.PI / 4;
  const w = floorWorld(1800, 800, 700);
  const g = P.gravityVec(i, 180);
  const p = { x: 100, y: 699.5, vx: v * Math.cos(th), vy: -v * Math.sin(th), r: 3, age: 0 };
  const res = P.simulateShot(w, p, g.x, g.y, null, { tMax: 30 });
  const range = (res.x - 100) / PPM, Rexp = v * v * Math.sin(2 * th) / pl.g;
  const Texp = 2 * v * Math.sin(th) / pl.g;
  check(`${pl.name} range at ${v} m/s, 45°`, pct(range, Rexp) < 1, `${range.toFixed(2)} m vs v²sin2θ/g = ${Rexp.toFixed(2)} m (${pct(range, Rexp).toFixed(2)} %)`);
  check(`${pl.name} flight time`, pct(res.t, Texp) < 1, `${res.t.toFixed(3)} s vs 2v·sinθ/g = ${Texp.toFixed(3)} s`);
}
{
  // same launch speed and angle: the Moon shot goes g_earth/g_moon farther
  const ranges = [0, 2].map(i => {
    const w = floorWorld(4200, 900, 850), g = P.gravityVec(i, 180);
    const p = { x: 50, y: 849.5, vx: 8 * Math.SQRT1_2, vy: -8 * Math.SQRT1_2, r: 3, age: 0 };
    return (P.simulateShot(w, p, g.x, g.y, null, { tMax: 40 }).x - 50) / PPM;
  });
  const ratio = ranges[0] / ranges[1], exp = P.PLANETS[2].g / P.PLANETS[0].g;
  check('Moon/Earth range ratio at equal speed', pct(ratio, exp) < 2, `${ratio.toFixed(2)} vs ${exp.toFixed(2)}`);
}

console.log('Rotated gravity');
{
  // gravity pointing right (bearing 90) against a wall: the 45° shot is the
  // flat-ground shot turned a quarter turn, so it lands R metres up the wall.
  const W = 900, H = 1800, wallX = 800, v = 15, a = v * Math.SQRT1_2;
  const w = P.createWorld(W, H);
  for (let y = 0; y < H; y++) for (let x = wallX; x < W; x++) w.mask[y * W + x] = P.MAT.REG;
  const g = P.gravityVec(1, 90);
  const x0 = wallX - 0.5, y0 = 1600;
  const p = { x: x0, y: y0, vx: -a, vy: -a, r: 3, age: 0 };
  const res = P.simulateShot(w, p, g.x, g.y, null, { tMax: 30 });
  const up = (y0 - res.y) / PPM, Rexp = v * v / P.PLANETS[1].g;
  check('landing point rotates with g', pct(up, Rexp) < 1 && Math.abs(res.x - x0) < 2,
    `${up.toFixed(2)} m up the wall vs ${Rexp.toFixed(2)} m, x off by ${(res.x - x0).toFixed(2)} px`);
  const gv = P.gravityVec(0, 270);
  check('bearing 270 points left', gv.x < 0 && Math.abs(gv.y) < 1e-9, `(${gv.x.toFixed(2)}, ${gv.y.toFixed(2)})`);
}

/* ---------------------------------------------------------------- dogs */
console.log('Mag-paws, falls and thrust');
{
  const w = floorWorld(400, 400, 300);
  const d = P.makeDog(200, 100);
  let y = 100; while (!P.circleHits(w, 200, y + 1, d.r)) y++;
  d.y = y; d.grounded = true; const n = P.normalAt(w, d.x, d.y, d.r + 4); d.nx = n.x; d.ny = n.y;
  const before = [d.x, d.y];
  const g = P.gravityVec(2, 0);   // Earth gravity pointing UP
  for (let i = 0; i < 120; i++) { if (!d.grounded) P.stepAirborne(w, d, g, DT); else if (!P.supported(w, d)) P.launch(d, 0, 0); }
  check('grounded dog holds when gravity flips', d.grounded && d.x === before[0] && d.y === before[1]);
  const e = P.makeDog(200, 100); e.grounded = false;
  const gm = P.gravityVec(0, 180);
  for (let i = 0; i < 120; i++) P.stepAirborne(P.createWorld(400, 400), e, gm, DT);
  check('airborne dog accelerates at g', Math.abs(e.vy - 1.62) < 1e-9 && Math.abs((e.y - 100) / PPM - 0.81) < 1e-6,
    `v = ${e.vy.toFixed(4)} m/s after 1 s, fell ${((e.y - 100) / PPM).toFixed(4)} m`);
}
{
  check('no fall damage at or below 6 m/s', P.fallDamage(5.9) === 0 && P.fallDamage(6) === 0);
  check('fall damage rises above 6 m/s', P.fallDamage(7) > 0 && P.fallDamage(10) > P.fallDamage(7), `7 m/s → ${P.fallDamage(7)}, 10 m/s → ${P.fallDamage(10)}`);
  const drop = planet => {
    const w = floorWorld(300, 600, 500), d = P.makeDog(150, 500 - 9 - 5 * PPM);
    const y0 = d.y; let ev = null;
    for (let i = 0; i < 2400 && !ev; i++) ev = P.stepAirborne(w, d, P.gravityVec(planet, 180), DT);
    const h = (d.y - y0) / PPM;
    return { vin: ev.vin, exp: Math.sqrt(2 * P.PLANETS[planet].g * h) };
  };
  const ea = drop(2), mo = drop(0);
  check('5 m drop: impact speed = √(2gh)', pct(ea.vin, ea.exp) < 3 && pct(mo.vin, mo.exp) < 3,
    `Earth ${ea.vin.toFixed(2)} vs ${ea.exp.toFixed(2)}, Moon ${mo.vin.toFixed(2)} vs ${mo.exp.toFixed(2)} m/s`);
  check('5 m drop hurts on Earth, not on the Moon', P.fallDamage(ea.vin) > 0 && P.fallDamage(mo.vin) === 0,
    `Earth ${P.fallDamage(ea.vin)} HP, Moon ${P.fallDamage(mo.vin)} HP`);
}
for (const [planet, shouldLift] of [[0, true], [1, true], [2, false]]) {
  const G = RR.createGame({ arena: 'surface', seed: 11, teams: [{ ctrl: 'human' }, { ctrl: 'human' }], dogsPerTeam: 2, turnTime: 0 });
  G.start(); G.setPlanet(planet); G.setGravityDir(180);
  G.selectWeapon('thrust'); G.aim.angle = 90; G.input.fire = true;
  const dog = G.active, y0 = dog.y; let lifted = false;
  for (let i = 0; i < 60; i++) { G.update(DT); if (!dog.grounded) lifted = true; }
  const name = P.PLANETS[planet].name, twr = 6 / P.PLANETS[planet].g;
  check(`Thruster on ${name} (thrust/weight ${twr.toFixed(2)})`, lifted === shouldLift,
    shouldLift ? `rose ${((y0 - dog.y) / PPM).toFixed(2)} m in 0.5 s` : 'stayed on the ground');
}

/* ----------------------------------------------------------- explosions */
console.log('Explosions');
{
  const w = P.createWorld(400, 400); w.mask.fill(P.MAT.REG);
  const removed = P.carve(w, 200, 200, 40), exp = Math.PI * 40 * 40;
  check('carve removes πR²', pct(removed, exp) < 3, `${removed} px vs ${exp.toFixed(0)}`);
  w.mask.fill(P.MAT.BED);
  check('bedrock does not carve', P.carve(w, 200, 200, 40) === 0);
  const dogs = [10, 40, 60, 90].map(dx => Object.assign(P.makeDog(200 + dx, 200), {}));
  const hits = P.blastHits(dogs, 200, 200, 44, 48, 7);
  const dmg = dogs.map(d => (hits.find(h => h.dog === d) || { dmg: 0 }).dmg);
  check('damage falls off with distance', dmg[0] > dmg[1] && dmg[1] > dmg[2] && dmg[3] === 0, dmg.join(' > '));
}

/* ------------------------------------------------------------ generator */
console.log('Arena generator');
{
  const hash = a => { let h = 2166136261; for (let i = 0; i < a.length; i += 7) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
  for (const arena of ['surface', 'tube']) {
    const a = RR.terrain.generate({ arena, seed: 42 }), b = RR.terrain.generate({ arena, seed: 42 }), c = RR.terrain.generate({ arena, seed: 43 });
    check(`${arena}: deterministic per seed`, hash(a.world.mask) === hash(b.world.mask) && hash(a.world.paint) === hash(b.world.paint) && hash(a.world.mask) !== hash(c.world.mask));
    let bad = 0, missing = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const G = RR.createGame({ arena, seed, teams: [{}, {}, {}, {}], dogsPerTeam: 4 });
      missing += 16 - G.dogs.length;
      for (const d of G.dogs) if (P.circleHits(G.world, d.x, d.y, d.r) || !P.touching(G.world, d.x, d.y, d.r + 2)) bad++;
    }
    check(`${arena}: 16 dogs placed on solid ground, 20 seeds`, bad === 0 && missing === 0, `${missing} missing, ${bad} badly placed`);
  }
}

/* ------------------------------------------------------- engine helpers */
function stepUntil(G, cond, maxSeconds) {
  for (let i = 0; i < maxSeconds / DT; i++) { if (cond()) return true; G.update(DT); }
  return cond();
}
function pressFire(G, seconds) {
  G.input.fire = true; stepUntil(G, () => false, seconds); G.input.fire = false; G.update(DT);
}
function skipTurn(G) { G.selectWeapon('skip'); G.input.fire = true; G.update(DT); G.input.fire = false; G.update(DT); }
function waitForTeam(G, idx) {
  return stepUntil(G, () => {
    if (G.phase === 'aim' && G.teamIdx !== idx && !G.isAI()) skipTurn(G);
    return G.phase === 'aim' && G.teamIdx === idx;
  }, 120);
}

/* ------------------------------------------------------------ ∞ Ammo */
console.log('∞ Ammo and Auto AI toggles');
{
  const G = RR.createGame({ arena: 'surface', seed: 5, teams: [{ ctrl: 'human' }, { ctrl: 'human' }], dogsPerTeam: 4, turnTime: 0 });
  G.start(); G.setInfiniteAmmo(true);
  const t0 = G.teams[0];
  for (let k = 0; k < 2; k++) {
    waitForTeam(G, 0); G.aim.angle = 60; G.selectWeapon('scatter'); pressFire(G, 0.3);
  }
  check('∞ Ammo: two Sample Scatters, count stays 2', t0.ammo.scatter === 2 && t0.shots === 2, `count ${t0.ammo.scatter}, shots ${t0.shots}`);
  G.setInfiniteAmmo(false);
  for (let k = 0; k < 2; k++) { waitForTeam(G, 0); G.aim.angle = 60; G.selectWeapon('scatter'); pressFire(G, 0.3); }
  check('ammo decrements with ∞ Ammo off', t0.ammo.scatter === 0, `count ${t0.ammo.scatter}`);
  waitForTeam(G, 0); G.selectWeapon('scatter'); G.drain(); pressFire(G, 0.3);
  const ev = G.drain();
  check('empty weapon will not fire', ev.some(e => e.type === 'noammo') && G.phase === 'aim' && t0.shots === 4);
  check('match records ∞ Ammo use', G.usedInfinite === true);
}
{
  const G = RR.createGame({ arena: 'tube', seed: 9, teams: [{ ctrl: 'human' }, { ctrl: 'human' }], dogsPerTeam: 3, turnTime: 0, aiBudget: 200 });
  G.start();
  const t0 = G.teams[0];
  G.toggleAuto();
  const fired = stepUntil(G, () => G.phase !== 'aim' || G.teamIdx !== 0, 30);
  check('Auto AI plays the turn for the human team', fired && t0.auto && t0.usedAuto && t0.shots + (G.events.some(e => e.type === 'skip') ? 1 : 0) >= 1, `shots ${t0.shots}`);
  waitForTeam(G, 0);
  check('Auto AI stays on for that team', G.ai !== null || G.phase !== 'aim');
  G.toggleAuto();
  check('Auto AI off hands control back', !t0.auto && G.ai === null && G.humanTurn());
}

/* ------------------------------------------------- field manual numbers */
// Every worked number on the field manual is recomputed here from the
// game's own constants, so the page cannot drift from the physics.
console.log('Field manual numbers');
{
  const html = fs.readFileSync(path.join(root, 'games', 'regolith-rovers', 'index.html'), 'utf8').replace(/\s+/g, ' ');
  const [moon, mars, earth] = P.PLANETS.map(p => p.g);
  const thr = RR.WEAPON.thrust.accel;
  const fmt = (x, d) => x.toFixed(d);
  const want = [];
  const need = (label, text) => want.push([label, text]);
  need('Moon g', `<td>${fmt(moon, 2)}</td>`); need('Mars g', `<td>${fmt(mars, 2)}</td>`); need('Earth g', `<td>${fmt(earth, 2)}</td>`);
  need('Moon vs Earth', `${fmt(moon / earth, 2)}×`); need('Mars vs Earth', `${fmt(mars / earth, 2)}×`);
  const v = 20, s2 = Math.sin(Math.PI / 2), s1 = Math.sin(Math.PI / 4);
  need('Earth range', `${fmt(v * v * s2 / earth, 1)} m`); need('Mars range', `${fmt(v * v * s2 / mars, 0)} m`); need('Moon range', `${fmt(v * v * s2 / moon, 0)} m`);
  need('Earth time', `${fmt(2 * v * s1 / earth, 1)} s`); need('Mars time', `${fmt(2 * v * s1 / mars, 1)} s`); need('Moon time', `${fmt(2 * v * s1 / moon, 1)} s`);
  need('speed fraction', `≈ ${fmt(100 * Math.sqrt(moon / earth), 0)} %`);
  need('hang time', `about ${fmt(Math.sqrt(earth / moon), 1)} times longer`);
  const ratio = earth / moon;
  check('"about six times farther" holds', ratio > 5.5 && ratio < 6.5, ratio.toFixed(2));
  need('jump speed', `fixed ${P.JUMP_V} m/s`);
  const vn = P.JUMP_V * Math.sin(P.JUMP_ANG * Math.PI / 180);
  need('Earth jump', `${fmt(vn * vn / (2 * earth), 2)} m on Earth`); need('Mars jump', `${fmt(vn * vn / (2 * mars), 1)} m on Mars`); need('Moon jump', `${fmt(vn * vn / (2 * moon), 1)} m on the`);
  need('safe impact', `over ${P.FALL_SAFE} m/s`);
  const hsafe = g => P.FALL_SAFE ** 2 / (2 * g);
  need('Earth safe fall', `${fmt(hsafe(earth), 1)} m drop on Earth`); need('Mars safe fall', `${fmt(hsafe(mars), 1)} m on Mars`); need('Moon safe fall', `${fmt(hsafe(moon), 0)} m on the Moon`);
  need('thrust', `${thr} m/s²`);
  need('TWR Moon', `${fmt(thr / moon, 1)} on the Moon`); need('TWR Mars', `${fmt(thr / mars, 1)} on Mars`); need('TWR Earth', `${fmt(thr / earth, 2)} on Earth`);
  const missing = want.filter(([, t]) => !html.includes(t));
  check(`field manual states ${want.length} computed values`, missing.length === 0, missing.map(([l, t]) => `${l}: "${t}"`).join('; '));
}

/* ------------------------------------------------------------ CPU aim */
console.log('Commander CPU');
for (const arena of ['surface', 'tube']) {
  let hits = 0, n = 20, lines = [];
  for (let seed = 1; seed <= n; seed++) {
    const G = RR.createGame({ arena, seed: seed * 7919, teams: [{ ctrl: 'commander' }, { ctrl: 'commander' }], dogsPerTeam: 3, turnTime: 0, aiBudget: 400 });
    G.start();
    const me = G.teamIdx;
    const enemyHp = () => G.dogs.filter(d => d.team !== me).reduce((s, d) => s + d.hp, 0);
    const hp0 = enemyHp();
    stepUntil(G, () => G.turn >= 2 || G.over, 120);
    const dealt = hp0 - enemyHp();
    if (dealt > 0) hits++;
    lines.push(dealt);
  }
  check(`${arena}: Commander damages an enemy on its first turn in ≥ 80 % of 20 maps`, hits / n >= 0.8, `${hits}/${n} (damage per map: ${lines.join(' ')})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
