/* ==========================================================================
   REGOLITH ROVERS — physics core
   DOM-free on purpose: the browser game, the CPU's aim search and the node
   tests all run exactly this code, so what the CPU predicts is what happens.

   Units: positions in pixels (PPM pixels = 1 metre), velocities in m/s,
   accelerations in m/s². y grows downward, as on the canvas.
   ========================================================================== */
'use strict';
var RR = globalThis.RR || (globalThis.RR = {});

(function () {
  const PPM = 20;          // pixels per metre
  const DT = 1 / 120;      // fixed physics step, seconds

  /* Surface gravity. Moon and Mars from the NASA NSSDCA fact sheets (Moon
     "surface gravity" 1.62; Mars "surface gravity (mean)" 3.73). Earth uses
     standard gravity, 9.80665 m/s² exactly (CODATA 2018), rounded. */
  const PLANETS = [
    { id: 'moon',  name: 'Moon',  icon: '🌕', g: 1.62 },
    { id: 'mars',  name: 'Mars',  icon: '🔴', g: 3.73 },
    { id: 'earth', name: 'Earth', icon: '🌍', g: 9.81 },
  ];

  // Material codes stored in the mask. Anything non-zero is solid.
  const MAT = { AIR: 0, REG: 1, ROCK: 2, STRUCT: 3, SLAB: 4, BED: 255 };

  const V_MAX = 34;        // m/s, full-power launch speed
  const DOG_R = 9;         // px, a robot dog is ~0.9 m long
  const WALK = 1.4;        // m/s
  const JUMP_V = 3.0;      // m/s
  const JUMP_ANG = 60;     // degrees above the surface
  const FALL_SAFE = 6;     // m/s impact speed that does no harm
  const FALL_DMG = 8;      // HP per m/s above FALL_SAFE
  const FALL_CAP = 40;

  /* Gravity direction is a compass bearing for the way gravity *points*:
     0 = up the screen (N), 90 = right (E), 180 = down (S), 270 = left (W). */
  function gravityVec(planet, bearing) {
    const g = PLANETS[planet].g, a = bearing * Math.PI / 180;
    return { x: Math.sin(a) * g, y: -Math.cos(a) * g, g };
  }

  function createWorld(W, H) {
    return { W, H, mask: new Uint8Array(W * H), paint: new Uint8Array(W * H), dirty: [] };
  }

  function solid(w, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w.W || y >= w.H) return false;
    return w.mask[y * w.W + x] !== 0;
  }

  function matAt(w, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w.W || y >= w.H) return 0;
    return w.mask[y * w.W + x];
  }

  /* ------------------------------------------------------- sample offsets */
  const RING = [];
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    RING.push([Math.cos(a), Math.sin(a)]);
  }

  const DISKS = {};
  function disk(R) {
    if (DISKS[R]) return DISKS[R];
    const out = [];
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++)
        if (dx * dx + dy * dy <= R * R && (dx || dy)) out.push(dx, dy);
    return (DISKS[R] = out);
  }

  function circleHits(w, x, y, r) {
    if (solid(w, x, y)) return true;
    for (let i = 0; i < 24; i++) if (solid(w, x + RING[i][0] * r, y + RING[i][1] * r)) return true;
    const r2 = r * 0.6;
    for (let i = 0; i < 24; i += 2) if (solid(w, x + RING[i][0] * r2, y + RING[i][1] * r2)) return true;
    return false;
  }

  function touching(w, x, y, r) {
    for (let i = 0; i < 24; i++) if (solid(w, x + RING[i][0] * r, y + RING[i][1] * r)) return true;
    return false;
  }

  /* Surface normal: the direction away from the solid mass inside a disk. */
  function normalAt(w, x, y, R) {
    const d = disk(R);
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < d.length; i += 2) {
      if (solid(w, x + d[i], y + d[i + 1])) { sx += d[i]; sy += d[i + 1]; n++; }
    }
    if (!n) return null;
    const len = Math.hypot(sx, sy);
    if (len < 1e-6) return null;
    return { x: -sx / len, y: -sy / len };
  }

  /* --------------------------------------------------------------- terrain */
  // Carve a disk out of everything except bedrock; scorch a thin ring round it.
  function carve(w, cx, cy, R) {
    const x0 = Math.max(0, Math.floor(cx - R - 4)), x1 = Math.min(w.W - 1, Math.ceil(cx + R + 4));
    const y0 = Math.max(0, Math.floor(cy - R - 4)), y1 = Math.min(w.H - 1, Math.ceil(cy + R + 4));
    let removed = 0;
    const R2 = R * R, S2 = (R + 3) * (R + 3);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d2 = dx * dx + dy * dy;
        if (d2 > S2) continue;
        const i = y * w.W + x, m = w.mask[i];
        if (!m || m === MAT.BED) continue;
        if (d2 <= R2) { w.mask[i] = 0; w.paint[i] = 0; removed++; }
        else if (m === MAT.REG || m === MAT.ROCK) w.paint[i] = 6;   // scorched regolith
      }
    }
    if (x1 >= x0 && y1 >= y0) w.dirty.push([x0, y0, x1, y1]);
    return removed;
  }

  // Fill a rotated rectangle with material where it is currently empty.
  function fillSlab(w, cx, cy, len, thick, ang, mat, paint, avoid) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const ext = Math.ceil(len / 2 + thick);
    const x0 = Math.max(0, Math.floor(cx - ext)), x1 = Math.min(w.W - 1, Math.ceil(cx + ext));
    const y0 = Math.max(0, Math.floor(cy - ext)), y1 = Math.min(w.H - 1, Math.ceil(cy + ext));
    let placed = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const u = dx * c + dy * s, v = -dx * s + dy * c;
        if (Math.abs(u) > len / 2 || Math.abs(v) > thick / 2) continue;
        const i = y * w.W + x;
        if (w.mask[i]) continue;
        if (avoid && avoid(x + 0.5, y + 0.5)) continue;
        w.mask[i] = mat; w.paint[i] = paint; placed++;
      }
    }
    if (x1 >= x0 && y1 >= y0) w.dirty.push([x0, y0, x1, y1]);
    return placed;
  }

  /* ---------------------------------------------------------- projectiles */
  /* One fixed step for a projectile. Constant acceleration over the step is
     integrated exactly (x += v·dt + ½·g·dt²), so a flight on flat ground
     reproduces v²·sin2θ/g to within one step. The path is swept a pixel at a
     time so fast shots cannot tunnel through thin terrain or dogs.

     Returns null while flying, or { kind: 'solid' | 'dog' | 'bounce', ... }. */
  function stepProjectile(w, p, gx, gy, dt, dogs) {
    p.age += dt;
    const dx = (p.vx * dt + 0.5 * gx * dt * dt) * PPM;
    const dy = (p.vy * dt + 0.5 * gy * dt * dt) * PPM;
    p.vx += gx * dt; p.vy += gy * dt;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len));
    let lx = p.x, ly = p.y;
    for (let i = 1; i <= n; i++) {
      const x = p.x + dx * i / n, y = p.y + dy * i / n;
      if (solid(w, x, y)) {
        if (p.bounce) return bounceOff(w, p, lx, ly, null);
        p.x = lx; p.y = ly;
        return { kind: 'solid' };
      }
      if (dogs) {
        for (let k = 0; k < dogs.length; k++) {
          const d = dogs[k];
          if (!d.alive) continue;
          if (d === p.owner && p.age < 0.12) continue;
          const ex = x - d.x, ey = y - d.y, rr = d.r + p.r;
          if (ex * ex + ey * ey < rr * rr) {
            if (p.bounce) return bounceOff(w, p, lx, ly, d);
            p.x = x; p.y = y;
            return { kind: 'dog', dog: d };
          }
        }
      }
      lx = x; ly = y;
    }
    p.x = lx; p.y = ly;
    return null;
  }

  function bounceOff(w, p, lx, ly, dog) {
    p.x = lx; p.y = ly;
    let nrm;
    if (dog) {
      const ex = lx - dog.x, ey = ly - dog.y, l = Math.hypot(ex, ey) || 1;
      nrm = { x: ex / l, y: ey / l };
    } else {
      nrm = normalAt(w, lx, ly, 5) || { x: -Math.sign(p.vx) || 0, y: -Math.sign(p.vy) || -1 };
    }
    const vn = p.vx * nrm.x + p.vy * nrm.y;
    if (vn < 0) {
      const e = p.restitution;
      p.vx -= (1 + e) * vn * nrm.x; p.vy -= (1 + e) * vn * nrm.y;
      // friction on the tangential part
      const tn = p.vx * nrm.x + p.vy * nrm.y;
      const tx = p.vx - tn * nrm.x, ty = p.vy - tn * nrm.y;
      p.vx = tn * nrm.x + tx * 0.8; p.vy = tn * nrm.y + ty * 0.8;
    }
    return { kind: 'bounce', speed: Math.abs(vn), dog: dog || null };
  }

  /* Fly a projectile with no dogs moving and nothing carved: what the CPU
     uses to look ahead, and what the training arc draws. */
  function simulateShot(w, p, gx, gy, dogs, opts) {
    const tMax = (opts && opts.tMax) || 16;
    const pts = opts && opts.trace ? [] : null;
    const every = (opts && opts.every) || 6;
    let steps = 0;
    const W = w.W, H = w.H;
    while (p.age < tMax) {
      const ev = stepProjectile(w, p, gx, gy, DT, dogs);
      if (pts && (++steps % every === 0)) pts.push(p.x, p.y);
      if (p.fuse != null && p.age >= p.fuse) return { kind: 'fuse', x: p.x, y: p.y, t: p.age, pts };
      if (ev && ev.kind !== 'bounce') return { kind: ev.kind, dog: ev.dog || null, x: p.x, y: p.y, t: p.age, pts };
      if (outOfPlay(p.x, p.y, W, H, gx, gy, 2000)) return { kind: 'lost', x: p.x, y: p.y, t: p.age, pts };
    }
    return { kind: 'timeout', x: p.x, y: p.y, t: p.age, pts };
  }

  /* A body outside the arena is gone for good once gravity pulls it further
     out across the edge it crossed, or once it is very far away. */
  function outOfPlay(x, y, W, H, gx, gy, far) {
    const m = 30;
    let out = false, pull = false;
    if (x < -m) { out = true; if (-gx > 0.05) pull = true; }
    if (x > W + m) { out = true; if (gx > 0.05) pull = true; }
    if (y < -m) { out = true; if (-gy > 0.05) pull = true; }
    if (y > H + m) { out = true; if (gy > 0.05) pull = true; }
    if (!out) return false;
    if (pull) return true;
    return x < -far || x > W + far || y < -far || y > H + far;
  }

  /* ----------------------------------------------------------------- dogs */
  function makeDog(x, y) {
    return {
      x, y, vx: 0, vy: 0, r: DOG_R, hp: 100, alive: true,
      grounded: false, nx: 0, ny: -1, fs: 1,
      fx: 1, fy: 0, ux: 0, uy: -1,      // facing and "up" while airborne
      walkAcc: 0, walkPhase: 0, airTime: 0,
    };
  }

  function fallDamage(vin) {
    if (vin <= FALL_SAFE) return 0;
    return Math.min(FALL_CAP, Math.round((vin - FALL_SAFE) * FALL_DMG));
  }

  // The dog's local frame: up is the contact normal on the ground, and the
  // opposite of gravity in the air.
  function frame(d, g) {
    let ux, uy;
    if (d.grounded) { ux = d.nx; uy = d.ny; }
    else { ux = d.ux; uy = d.uy; }
    // forward = fs × tangent, tangent = (-uy, ux)
    const fx = -uy * d.fs, fy = ux * d.fs;
    return { ux, uy, fx, fy };
  }

  function aimDir(d, angleDeg) {
    const f = frame(d);
    const a = angleDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { x: c * f.fx + s * f.ux, y: c * f.fy + s * f.uy };
  }

  /* Mag-paws: a grounded dog ignores gravity entirely. It only leaves the
     ground by jumping, thrusting, being blasted, or losing its footing. */
  function land(w, d, g) {
    const n = normalAt(w, d.x, d.y, d.r + 4) || { x: -g.x / g.g, y: -g.y / g.g };
    const vin = -(d.vx * n.x + d.vy * n.y);
    // keep facing: pick the tangent sign closest to the facing we flew with
    const tx = -n.y, ty = n.x;
    d.fs = (tx * d.fx + ty * d.fy) >= 0 ? 1 : -1;
    d.nx = n.x; d.ny = n.y;
    d.vx = 0; d.vy = 0;
    d.grounded = true;
    d.airTime = 0;
    return { kind: 'land', vin: Math.max(0, vin) };
  }

  function launch(d, vx, vy) {
    if (d.grounded) {
      const f = frame(d);
      d.fx = f.fx; d.fy = f.fy;
      d.ux = d.nx; d.uy = d.ny;
    }
    d.grounded = false;
    d.vx = vx; d.vy = vy;
  }

  function stepAirborne(w, d, g, dt, ax, ay) {
    const axT = g.x + (ax || 0), ayT = g.y + (ay || 0);
    const dx = (d.vx * dt + 0.5 * axT * dt * dt) * PPM;
    const dy = (d.vy * dt + 0.5 * ayT * dt * dt) * PPM;
    d.vx += axT * dt; d.vy += ayT * dt;
    d.airTime += dt;
    // ease the airborne "up" toward the opposite of gravity
    const tux = -g.x / g.g, tuy = -g.y / g.g;
    d.ux += (tux - d.ux) * Math.min(1, dt * 3);
    d.uy += (tuy - d.uy) * Math.min(1, dt * 3);
    const ul = Math.hypot(d.ux, d.uy) || 1; d.ux /= ul; d.uy /= ul;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len / 1.5));
    for (let i = 1; i <= n; i++) {
      const x = d.x + dx / n, y = d.y + dy / n;
      if (circleHits(w, x, y, d.r)) return land(w, d, g);
      d.x = x; d.y = y;
    }
    return null;
  }

  /* Walk one pixel along the surface. s = ±1 picks the tangent direction.
     Returns 'ok', 'blocked' or 'fall'. */
  function walkStep(w, d, s) {
    const nx = d.nx, ny = d.ny;
    const tx = -ny * s, ty = nx * s;
    let cx = d.x + tx, cy = d.y + ty;
    let k = 0;
    while (circleHits(w, cx, cy, d.r) && k < 6) { cx += nx; cy += ny; k++; }
    if (circleHits(w, cx, cy, d.r)) return 'blocked';
    let m = 0;
    while (m < 7 && !circleHits(w, cx - nx, cy - ny, d.r)) { cx -= nx; cy -= ny; m++; }
    if (m >= 7 && !touching(w, cx, cy, d.r + 2)) {
      // walked off a ledge: step out and let go
      d.x += tx; d.y += ty;
      launch(d, tx * WALK * 0.6, ty * WALK * 0.6);
      return 'fall';
    }
    const n2 = normalAt(w, cx, cy, d.r + 4);
    if (!n2) return 'blocked';
    if (nx * n2.x + ny * n2.y < Math.cos(70 * Math.PI / 180)) return 'blocked';
    d.x = cx; d.y = cy;
    const sx = nx + n2.x, sy = ny + n2.y, sl = Math.hypot(sx, sy) || 1;
    d.nx = sx / sl; d.ny = sy / sl;
    return 'ok';
  }

  // Is a grounded dog still standing on something?
  function supported(w, d) {
    return touching(w, d.x, d.y, d.r + 2);
  }

  /* Thruster: fixed thrust acceleration (m/s²) along (tx, ty). A dog on the
     ground lifts off only if the thrust pulls away from the surface and the
     thrust plus gravity still points away from it — so on Earth, where the
     thrust is weaker than gravity, a dog on level ground cannot take off. */
  function thrustWouldLift(d, g, ax, ay) {
    if (!d.grounded) return true;
    const tn = ax * d.nx + ay * d.ny;
    const net = (ax + g.x) * d.nx + (ay + g.y) * d.ny;
    return tn > 0 && net > 0;
  }

  /* ------------------------------------------------------------ explosion */
  /* Damage and knockback fall off linearly to zero at 1.2 R from the edge of
     each dog. Returns the hits; the caller applies them. */
  function blastHits(dogs, cx, cy, R, dmg, push) {
    const out = [];
    for (const d of dogs) {
      if (!d.alive) continue;
      const ex = d.x - cx, ey = d.y - cy, dist = Math.hypot(ex, ey);
      const edge = Math.max(0, dist - d.r);
      const f = 1 - edge / (R * 1.2);
      if (f <= 0) continue;
      let ux, uy;
      if (dist > 1) { ux = ex / dist; uy = ey / dist; }
      else { ux = d.grounded ? d.nx : 0; uy = d.grounded ? d.ny : -1; }
      out.push({ dog: d, dmg: Math.max(1, Math.round(dmg * f)), vx: ux * push * f, vy: uy * push * f });
    }
    return out;
  }

  // Predicted damage only (for the CPU's scoring).
  function blastDamage(d, cx, cy, R, dmg) {
    const edge = Math.max(0, Math.hypot(d.x - cx, d.y - cy) - d.r);
    const f = 1 - edge / (R * 1.2);
    return f > 0 ? Math.max(1, Math.round(dmg * f)) : 0;
  }

  RR.physics = {
    PPM, DT, PLANETS, MAT, V_MAX, DOG_R, WALK, JUMP_V, JUMP_ANG, FALL_SAFE, FALL_DMG,
    gravityVec, createWorld, solid, matAt, circleHits, touching, normalAt, carve, fillSlab,
    stepProjectile, simulateShot, outOfPlay, makeDog, fallDamage, frame, aimDir, land, launch,
    stepAirborne, walkStep, supported, thrustWouldLift, blastHits, blastDamage,
  };
})();
