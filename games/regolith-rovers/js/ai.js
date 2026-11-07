/* ==========================================================================
   REGOLITH ROVERS — CPU gunner (DOM-free)
   Brute force, honestly: fly hundreds of candidate shots through the same
   physics step the game uses, under a few gravity settings, and keep the one
   whose blast does the most harm to the other teams and the least to its own.
   It runs as a generator so the game can spread the work across frames.
   ========================================================================== */
'use strict';
var RR = globalThis.RR || (globalThis.RR = {});

(function () {
  const P = RR.physics;

  const LEVELS = {
    cadet:      { name: 'Cadet',      step: 15, angNoise: 6,   powNoise: 0.12, planets: 'current', dirs: 'current', ball: false },
    specialist: { name: 'Specialist', step: 10, angNoise: 2.5, powNoise: 0.05, planets: 'all',     dirs: 'current', ball: true },
    commander:  { name: 'Commander',  step: 10, angNoise: 0.5, powNoise: 0.01, planets: 'all',     dirs: 'some',    ball: true },
  };

  // Convert a world direction (degrees, screen coords) into the dog's own
  // facing and aim angle; null if the direction points into the ground.
  function toLocal(dog, phiDeg) {
    const a = phiDeg * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    const ux = dog.grounded ? dog.nx : dog.ux, uy = dog.grounded ? dog.ny : dog.uy;
    const tx = -uy, ty = ux;
    const c = dx * tx + dy * ty, s = dx * ux + dy * uy;
    const fs = c >= 0 ? 1 : -1;
    const ang = Math.atan2(s, Math.abs(c)) * 180 / Math.PI;
    if (ang < -85 || ang > 90) return null;
    return { fs, angle: ang };
  }

  function evaluate(G, dog, cfg, wid, phi, pw) {
    const loc = toLocal(dog, phi);
    if (!loc) return null;
    const W = RR.WEAPON[wid];
    const saveFs = dog.fs;
    dog.fs = loc.fs;
    const dir = P.aimDir(dog, loc.angle);
    dog.fs = saveFs;
    const ox = dog.x + dir.x * (dog.r + 5), oy = dog.y + dir.y * (dog.r + 5);
    if (P.solid(G.world, ox, oy)) return null;
    const v = pw * P.V_MAX;
    const g = P.gravityVec(cfg.planet, cfg.gdir);
    const p = { x: ox, y: oy, vx: dir.x * v, vy: dir.y * v, r: W.proj.r, age: 0, owner: dog,
      bounce: !!W.proj.bounce, restitution: W.proj.restitution || 0, fuse: W.fuse ? 3 : null };
    const live = G.dogs.filter(d => d.alive);
    const res = P.simulateShot(G.world, p, g.x, g.y, live, { tMax: 14 });
    if (res.kind === 'lost' || res.kind === 'timeout') return null;
    let enemy = 0, friendly = 0, self = 0, nearest = Infinity;
    for (const d of live) {
      const dmg = P.blastDamage(d, res.x, res.y, W.blast.R, W.blast.dmg);
      if (d.team !== dog.team) {
        enemy += dmg + (dmg >= d.hp ? 25 : 0);
        nearest = Math.min(nearest, Math.hypot(d.x - res.x, d.y - res.y));
      } else if (d === dog) self += dmg;
      else friendly += dmg;
    }
    let score = enemy > 0 ? enemy - 1.6 * friendly - 2.5 * self : -nearest / P.PPM - 2.5 * self - 1.6 * friendly;
    if (cfg.planet !== G.planet || cfg.gdir !== G.gdir) score -= 0.5;
    score -= res.t * 0.05;
    return { score, enemy, cfg, wid, phi, pw, fs: loc.fs, angle: loc.angle, t: res.t, x: res.x, y: res.y };
  }

  function configs(G, L) {
    const planets = L.planets === 'all' ? [0, 1, 2] : [G.planet];
    let dirs = [G.gdir];
    if (L.dirs === 'some') dirs = [...new Set([G.gdir, 180, 135, 225])];
    const out = [];
    for (const planet of planets) for (const gdir of dirs) out.push({ planet, gdir });
    return out;
  }

  function planner(G, dog, levelName) {
    const L = LEVELS[levelName] || LEVELS.specialist;
    const cfgs = configs(G, L);
    let best = null;
    const results = [];
    const consider = r => { if (!r) return; results.push(r); if (!best || r.score > best.score) best = r; };

    function* run() {
      for (const cfg of cfgs) {
        for (let phi = 0; phi < 360; phi += L.step) {
          for (let pw = 0.1; pw <= 1.0001; pw += 0.1) {
            consider(evaluate(G, dog, cfg, 'bone', phi, pw));
            yield;
          }
        }
      }
      if (L.ball) {
        const ballCfgs = [{ planet: G.planet, gdir: G.gdir }];
        if (G.gdir !== 180) ballCfgs.push({ planet: G.planet, gdir: 180 });
        for (const cfg of ballCfgs)
          for (let phi = 0; phi < 360; phi += L.step)
            for (let pw = 0.1; pw <= 1.0001; pw += 0.1) { consider(evaluate(G, dog, cfg, 'ball', phi, pw)); yield; }
      }
      // refine around the best few
      results.sort((a, b) => b.score - a.score);
      const seeds = [];
      for (const r of results) {
        if (seeds.length >= 6) break;
        if (seeds.some(s => s.wid === r.wid && s.cfg === r.cfg && Math.abs(s.phi - r.phi) < 1 && Math.abs(s.pw - r.pw) < 0.01)) continue;
        seeds.push(r);
      }
      const fine = L.step >= 15 ? [-5, 0, 5] : [-4, -2, 0, 2, 4];
      for (const s of seeds) {
        for (const dp of fine) for (const dw of [-0.04, -0.02, 0, 0.02, 0.04]) {
          const pw = s.pw + dw;
          if (pw < 0.03 || pw > 1) continue;
          consider(evaluate(G, dog, s.cfg, s.wid, s.phi + dp, pw));
          yield;
        }
      }
    }

    const it = run();
    let done = false;
    return {
      level: L,
      step(n) {
        for (let i = 0; i < n && !done; i++) if (it.next().done) done = true;
        return done;
      },
      result(rng) {
        if (!best) return null;
        const r = Object.assign({}, best);
        r.angle = Math.max(-85, Math.min(90, r.angle + (rng() * 2 - 1) * L.angNoise));
        r.pw = Math.max(0.03, Math.min(1, r.pw + (rng() * 2 - 1) * L.powNoise));
        return r;
      },
    };
  }

  RR.AI = { planner, LEVELS, toLocal, evaluate };
})();
