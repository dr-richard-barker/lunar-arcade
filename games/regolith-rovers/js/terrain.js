/* ==========================================================================
   REGOLITH ROVERS — arena generator (DOM-free, seeded)
   Two arena types:
     surface — open sky over a cratered mare with a small surface base;
               the ground drops away at both ends of the survey zone.
     tube    — a lava tube under a thin crust, opened to space by skylights,
               inside an indestructible bedrock frame.
   ========================================================================== */
'use strict';
var RR = globalThis.RR || (globalThis.RR = {});

(function () {
  const P = RR.physics, MAT = P.MAT;

  // Paint indices (colours live in render.js).
  const PAINT = {
    REG1: 1, REG2: 2, REG3: 3, BASALT: 4, BED: 5, SCORCH: 6, HULL: 7, GREY: 8,
    SOLAR: 9, GOLD: 10, WINDOW: 11, RED: 12, TEAL: 13, NAVY: 14, SLAB: 15,
    METAL: 16, MINT: 17, LEAF: 18,
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Smooth value noise in 1D and 2D, seeded.
  function noise1(rng) {
    const v = new Float32Array(1024);
    for (let i = 0; i < v.length; i++) v[i] = rng();
    return function (x) {
      const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
      const a = v[((i % 1024) + 1024) % 1024], b = v[(((i + 1) % 1024) + 1024) % 1024];
      return a + (b - a) * u;
    };
  }
  function noise2(rng) {
    const S = 256, v = new Float32Array(S * S);
    for (let i = 0; i < v.length; i++) v[i] = rng();
    const at = (x, y) => v[(((y % S) + S) % S) * S + (((x % S) + S) % S)];
    return function (x, y) {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
  }
  const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  /* ------------------------------------------------------------- painter */
  function painter(w) {
    const W = w.W, H = w.H;
    function set(x, y, mat, paint) {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = y * W + x;
      if (w.mask[i] === MAT.BED) return;
      w.mask[i] = mat; w.paint[i] = paint;
    }
    function clear(x, y) {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = y * W + x;
      if (w.mask[i] === MAT.BED) return;
      w.mask[i] = 0; w.paint[i] = 0;
    }
    return {
      set, clear,
      rect(x, y, ww, hh, paint, mat) {
        for (let yy = Math.floor(y); yy < y + hh; yy++)
          for (let xx = Math.floor(x); xx < x + ww; xx++) set(xx, yy, mat || MAT.STRUCT, paint);
      },
      circle(cx, cy, r, paint, mat, filter) {
        for (let yy = Math.floor(cy - r); yy <= cy + r; yy++)
          for (let xx = Math.floor(cx - r); xx <= cx + r; xx++) {
            const dx = xx + 0.5 - cx, dy = yy + 0.5 - cy;
            if (dx * dx + dy * dy <= r * r && (!filter || filter(xx, yy, dx, dy))) set(xx, yy, mat || MAT.STRUCT, paint);
          }
      },
      ellipse(cx, cy, rx, ry, paint, mat, filter) {
        for (let yy = Math.floor(cy - ry); yy <= cy + ry; yy++)
          for (let xx = Math.floor(cx - rx); xx <= cx + rx; xx++) {
            const dx = (xx + 0.5 - cx) / rx, dy = (yy + 0.5 - cy) / ry;
            if (dx * dx + dy * dy <= 1 && (!filter || filter(xx, yy, dx, dy))) set(xx, yy, mat || MAT.STRUCT, paint);
          }
      },
      carveEllipse(cx, cy, rx, ry) {
        for (let yy = Math.floor(cy - ry); yy <= cy + ry; yy++)
          for (let xx = Math.floor(cx - rx); xx <= cx + rx; xx++) {
            const dx = (xx + 0.5 - cx) / rx, dy = (yy + 0.5 - cy) / ry;
            if (dx * dx + dy * dy <= 1) clear(xx, yy);
          }
      },
      line(x0, y0, x1, y1, th, paint, mat) {
        const len = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(len);
        for (let i = 0; i <= steps; i++) {
          const t = i / Math.max(1, steps), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
          for (let yy = Math.floor(y - th / 2); yy <= y + th / 2; yy++)
            for (let xx = Math.floor(x - th / 2); xx <= x + th / 2; xx++) set(xx, yy, mat || MAT.STRUCT, paint);
        }
      },
      rot(cx, cy, len, th, ang, paint, mat) {
        const c = Math.cos(ang), s = Math.sin(ang), e = len / 2 + th;
        for (let yy = Math.floor(cy - e); yy <= cy + e; yy++)
          for (let xx = Math.floor(cx - e); xx <= cx + e; xx++) {
            const dx = xx + 0.5 - cx, dy = yy + 0.5 - cy;
            if (Math.abs(dx * c + dy * s) <= len / 2 && Math.abs(-dx * s + dy * c) <= th / 2) set(xx, yy, mat || MAT.STRUCT, paint);
          }
      },
    };
  }

  /* --------------------------------------------------------------- props */
  // Each prop sits with its base on y = by and grows upward.
  const PROPS = {
    dome(p, x, by) {
      const r = 54;
      p.rect(x - r - 4, by - 10, 2 * r + 8, 10, PAINT.GREY);
      p.circle(x, by - 10, r, PAINT.HULL, MAT.STRUCT, (xx, yy, dx, dy) => dy <= 0);
      p.circle(x, by - 10, r, PAINT.GREY, MAT.STRUCT, (xx, yy, dx, dy) => {
        const d = Math.hypot(dx, dy); return dy <= 0 && ((d > r * 0.62 && d < r * 0.68) || (d > r * 0.92));
      });
      for (const a of [-2.6, -2.1, -1.57, -1.05, -0.55]) p.circle(x + Math.cos(a) * r * 0.8, by - 10 + Math.sin(a) * r * 0.8, 4, PAINT.WINDOW);
      p.rect(x + r - 4, by - 32, 22, 22, PAINT.GREY);
      p.rect(x + r + 4, by - 26, 7, 10, PAINT.WINDOW);
    },
    lander(p, x, by) {
      p.line(x - 26, by - 32, x - 42, by, 3, PAINT.METAL);
      p.line(x + 26, by - 32, x + 42, by, 3, PAINT.METAL);
      p.rect(x - 47, by - 3, 11, 3, PAINT.METAL);
      p.rect(x + 36, by - 3, 11, 3, PAINT.METAL);
      p.rect(x - 9, by - 26, 18, 10, PAINT.METAL);
      p.rect(x - 30, by - 48, 60, 22, PAINT.GOLD);
      p.rect(x - 22, by - 84, 44, 36, PAINT.HULL);
      p.rect(x - 22, by - 62, 44, 3, PAINT.RED);
      p.rect(x - 7, by - 78, 14, 10, PAINT.WINDOW);
      p.rect(x - 1, by - 98, 2, 14, PAINT.METAL);
      p.circle(x, by - 100, 3, PAINT.GREY);
    },
    solar(p, x, by) {
      p.rect(x - 2, by - 56, 4, 56, PAINT.METAL);
      p.rect(x - 8, by - 4, 16, 4, PAINT.GREY);
      p.rot(x, by - 60, 74, 7, -0.33, PAINT.SOLAR);
      p.rot(x, by - 60, 74, 1.4, -0.33, PAINT.GREY);
    },
    dish(p, x, by) {
      p.rect(x - 3, by - 38, 6, 38, PAINT.METAL);
      p.rect(x - 10, by - 4, 20, 4, PAINT.GREY);
      const a = -0.5, c = Math.cos(a), s = Math.sin(a), cx = x + 2, cy = by - 46;
      p.ellipse(cx, cy, 28, 28, PAINT.HULL, MAT.STRUCT, (xx, yy) => {
        const dx = xx + 0.5 - cx, dy = yy + 0.5 - cy;
        const u = dx * c + dy * s, v = -dx * s + dy * c;
        return (u * u) / (28 * 28) + (v * v) / (11 * 11) <= 1 && v >= -1;
      });
      p.line(cx, cy, cx + Math.sin(-a) * 20, cy - Math.cos(-a) * 20, 2, PAINT.METAL);
    },
    rover(p, x, by) {
      p.circle(x - 17, by - 8, 8, PAINT.METAL);
      p.circle(x + 17, by - 8, 8, PAINT.METAL);
      p.rect(x - 26, by - 22, 52, 8, PAINT.GREY);
      p.rect(x - 14, by - 28, 20, 6, PAINT.GOLD);
      p.rect(x + 15, by - 44, 3, 22, PAINT.METAL);
      p.circle(x + 16, by - 46, 6, PAINT.HULL);
    },
    greenhouse(p, x, by) {
      p.circle(x - 58, by - 24, 24, PAINT.GREY, MAT.STRUCT, (xx, yy, dx) => dx <= 0);
      p.circle(x + 58, by - 24, 24, PAINT.GREY, MAT.STRUCT, (xx, yy, dx) => dx >= 0);
      p.rect(x - 58, by - 48, 116, 48, PAINT.HULL);
      p.rect(x - 58, by - 48, 116, 5, PAINT.NAVY);
      p.rect(x - 50, by - 36, 100, 18, PAINT.WINDOW);
      for (let i = 0; i < 12; i++) {
        const px = x - 46 + i * 8.2;
        p.rect(px, by - 26, 4, 8, PAINT.LEAF);
        p.circle(px + 2, by - 28, 3, i % 3 ? PAINT.LEAF : PAINT.MINT);
      }
      p.rect(x - 58, by - 12, 116, 4, PAINT.TEAL);
    },
    hab(p, x, by) {
      p.circle(x - 46, by - 22, 22, PAINT.HULL, MAT.STRUCT, (xx, yy, dx) => dx <= 0);
      p.circle(x + 46, by - 22, 22, PAINT.HULL, MAT.STRUCT, (xx, yy, dx) => dx >= 0);
      p.rect(x - 46, by - 44, 92, 44, PAINT.HULL);
      p.rect(x - 60, by - 30, 120, 3, PAINT.RED);
      for (let i = -2; i <= 2; i++) p.circle(x + i * 18, by - 20, 4, PAINT.WINDOW);
      p.rect(x - 64, by - 4, 128, 4, PAINT.GREY);
    },
    crate(p, x, by) {
      p.rect(x - 11, by - 22, 22, 22, PAINT.GOLD);
      p.rect(x - 11, by - 12, 22, 2, PAINT.GREY);
      p.rect(x + 13, by - 14, 14, 14, PAINT.GREY);
    },
  };
  const PROP_W = { dome: 140, lander: 100, solar: 80, dish: 70, rover: 60, greenhouse: 170, hab: 140, crate: 50 };

  /* ------------------------------------------------------------ helpers */
  function paintRock(w, x, y, depth, n2, rng) {
    const i = y * w.W + x;
    const v = n2(x / 38, y / 38);
    if (depth < 5) { w.mask[i] = MAT.REG; w.paint[i] = PAINT.REG1; return; }
    if (depth > 70 && n2(x / 70 + 50, y / 70 + 50) > 0.7) { w.mask[i] = MAT.ROCK; w.paint[i] = PAINT.BASALT; return; }
    w.mask[i] = MAT.REG;
    if (depth < 40) w.paint[i] = v > 0.45 ? PAINT.REG1 : PAINT.REG2;
    else w.paint[i] = v > 0.55 ? PAINT.REG2 : PAINT.REG3;
  }

  function placePads(rng, W, names, lo, hi) {
    const pads = [];
    for (const name of names) {
      const wd = PROP_W[name];
      for (let t = 0; t < 60; t++) {
        const x = lo + rng() * (hi - lo);
        if (pads.every(p => Math.abs(p.x - x) > (p.w + wd) / 2 + 40)) { pads.push({ name, x, w: wd }); break; }
      }
    }
    return pads;
  }

  /* ------------------------------------------------------------- surface */
  function genSurface(w, rng) {
    const W = w.W, H = w.H, n1 = noise1(rng), n2 = noise2(rng);
    const h = new Float32Array(W);
    const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
    for (let x = 0; x < W; x++) {
      h[x] = H * 0.6 + 52 * Math.sin(x * 0.0021 + ph[0]) + 26 * Math.sin(x * 0.0057 + ph[1])
        + 9 * Math.sin(x * 0.017 + ph[2]) + 46 * (n1(x / 110) - 0.5);
    }
    const craters = [];
    const nCr = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < nCr; k++) {
      const cx = 260 + rng() * (W - 520), cr = 70 + rng() * 150;
      const depth = cr * (0.25 + rng() * 0.22), rim = cr * (0.08 + rng() * 0.08);
      craters.push({ cx, cr });
      for (let x = Math.max(0, Math.floor(cx - cr * 1.6)); x < Math.min(W, cx + cr * 1.6); x++) {
        const ax = Math.abs((x - cx) / cr);
        if (ax < 1) h[x] += depth * (1 - ax * ax);
        h[x] -= rim * Math.exp(-(((ax - 1) / 0.25) ** 2));
      }
    }
    for (let x = 0; x < W; x++) h[x] = Math.max(H * 0.3, Math.min(H - 70, h[x]));

    // surface base: flatten a pad under each prop
    const names = ['greenhouse', 'lander', 'dome', 'solar', 'dish', 'rover', 'solar'];
    const pads = placePads(rng, W, names.slice(0, 5 + Math.floor(rng() * 3)), 260, W - 260);
    for (const p of pads) {
      const x0 = Math.floor(p.x - p.w / 2), x1 = Math.ceil(p.x + p.w / 2);
      let sum = 0; for (let x = x0; x <= x1; x++) sum += h[x];
      p.y = Math.round(sum / (x1 - x0 + 1));
      for (let x = x0 - 40; x <= x1 + 40; x++) {
        if (x < 0 || x >= W) continue;
        const wgt = x < x0 ? smooth((x - x0 + 40) / 40) : x > x1 ? smooth((x1 + 40 - x) / 40) : 1;
        h[x] = h[x] + (p.y - h[x]) * wgt;
      }
    }

    // the survey zone ends in cliffs at both sides
    for (let x = 0; x < W; x++) {
      const e = Math.min(x, W - 1 - x);
      if (e < 150) h[x] = h[x] + (H + 80 - h[x]) * (1 - smooth((e - 20) / 130));
    }

    for (let x = 0; x < W; x++) {
      const top = Math.max(0, Math.ceil(h[x]));
      for (let y = top; y < H; y++) paintRock(w, x, y, y - h[x], n2, rng);
    }

    // caves and overhangs, kept away from the base pads
    const nCave = 2 + Math.floor(rng() * 3);
    const pt = painter(w);
    for (let k = 0; k < nCave; k++) {
      const cx = 300 + rng() * (W - 600);
      if (pads.some(p => Math.abs(p.x - cx) < p.w / 2 + 150)) continue;
      const depth = 60 + rng() * 200, rx = 50 + rng() * 90, ry = 24 + rng() * 34;
      pt.carveEllipse(cx, h[Math.floor(cx)] + depth, rx, ry);
    }
    // boulders
    const nB = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < nB; k++) {
      const cx = 200 + rng() * (W - 400);
      if (pads.some(p => Math.abs(p.x - cx) < p.w / 2 + 40)) continue;
      const r = 10 + rng() * 22;
      pt.circle(cx, h[Math.floor(cx)] - r * 0.55, r, PAINT.BASALT, MAT.ROCK);
    }
    // bedrock floor
    for (let y = H - 28; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (w.mask[i]) { w.mask[i] = MAT.BED; w.paint[i] = PAINT.BED; }
      }
    for (const p of pads) PROPS[p.name](pt, p.x, p.y);

    return { arena: 'surface', skyline: null, ground: h, craters, pads, lights: [], skylights: [] };
  }

  /* ----------------------------------------------------------- lava tube */
  function genTube(w, rng) {
    const W = w.W, H = w.H, n1 = noise1(rng), n2 = noise2(rng), pt = painter(w);
    const s = new Float32Array(W), c = new Float32Array(W), hh = new Float32Array(W);
    const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
    for (let x = 0; x < W; x++) {
      s[x] = 150 + 26 * Math.sin(x * 0.003 + ph[0]) + 24 * (n1(x / 90) - 0.5);
      c[x] = H * 0.6 + 80 * Math.sin(x * 0.0024 + ph[1]) + 50 * (n1(x / 140 + 300) - 0.5);
      hh[x] = 165 + 60 * (n1(x / 160 + 600) - 0.5) + 20 * Math.sin(x * 0.009 + ph[2]);
    }
    // crust and basalt
    for (let x = 0; x < W; x++) {
      for (let y = Math.max(0, Math.ceil(s[x])); y < H; y++) {
        const d = y - s[x];
        if (d < 60) paintRock(w, x, y, d, n2, rng);
        else {
          const i = y * W + x, v = n2(x / 40, y / 40);
          w.mask[i] = MAT.ROCK; w.paint[i] = v > 0.62 ? PAINT.REG3 : PAINT.BASALT;
        }
      }
    }
    // the tube
    const x0 = 80, x1 = W - 80;
    for (let x = x0; x <= x1; x++) {
      const e = Math.min(x - x0, x1 - x), k = smooth(e / 120) * 0.85 + 0.15;
      const top = c[x] - hh[x] * k, bot = c[x] + hh[x] * 0.8 * k;
      for (let y = Math.floor(top); y <= bot; y++) pt.clear(x, y);
    }
    // side chambers
    const nCh = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < nCh; k++) {
      const x = 300 + rng() * (W - 600), up = rng() < 0.5;
      const r = 70 + rng() * 60;
      pt.carveEllipse(x, c[Math.floor(x)] + (up ? -hh[Math.floor(x)] * 0.75 : hh[Math.floor(x)] * 0.55), r * 1.3, r);
    }
    // rubble mounds on the floor
    const nM = 4 + Math.floor(rng() * 4);
    for (let k = 0; k < nM; k++) {
      const x = 200 + rng() * (W - 400), xi = Math.floor(x);
      const r = 26 + rng() * 40;
      pt.ellipse(x, c[xi] + hh[xi] * 0.8 + r * 0.2, r * 1.5, r * 0.6, PAINT.REG3, MAT.REG);
    }
    // partial columns: a stalagmite and a stalactite that leave a gap
    const nCol = 1 + Math.floor(rng() * 2);
    for (let k = 0; k < nCol; k++) {
      const x = 500 + rng() * (W - 1000), xi = Math.floor(x);
      const top = c[xi] - hh[xi], bot = c[xi] + hh[xi] * 0.8;
      const gapC = c[xi] - 20 + rng() * 40, gap = 70 + rng() * 40;
      const wd = 28 + rng() * 22;
      for (let y = Math.floor(top - 10); y <= bot + 10; y++) {
        if (Math.abs(y - gapC) < gap / 2) continue;
        const taper = Math.min(1, Math.abs(y - gapC) / 60 + 0.25);
        const half = wd * taper * (0.85 + 0.3 * n1(y / 20 + k * 77));
        for (let xx = Math.floor(x - half); xx <= x + half; xx++) pt.set(xx, y, MAT.ROCK, PAINT.BASALT);
      }
    }
    // skylights to space
    const skylights = [];
    const nSky = 1 + (rng() < 0.6 ? 1 : 0);
    for (let k = 0; k < nSky; k++) {
      let x;
      for (let t = 0; t < 40; t++) {
        x = 420 + rng() * (W - 840);
        if (skylights.every(sk => Math.abs(sk.x - x) > 700)) break;
      }
      const half = 70 + rng() * 40, xi = Math.floor(x);
      const bottom = c[xi] - hh[xi] + 30;
      for (let y = 0; y <= bottom; y++) {
        const wob = 14 * (n1(y / 30 + k * 40) - 0.5);
        const widen = y < s[xi] + 30 ? 1.25 : 1;
        for (let xx = Math.floor(x - half * widen + wob); xx <= x + half * widen + wob; xx++) pt.clear(xx, y);
      }
      skylights.push({ x, half });
    }
    // indestructible frame (below the surface only; the sky stays open)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (y < s[x]) continue;
        if (x < 26 || x >= W - 26 || y >= H - 26) {
          const i = y * W + x; w.mask[i] = MAT.BED; w.paint[i] = PAINT.BED;
        }
      }
    // base hardware on the tube floor
    const pads = placePads(rng, W, ['hab', 'greenhouse', 'rover', 'crate', 'hab'].slice(0, 3 + Math.floor(rng() * 3)), 260, W - 260)
      .filter(p => skylights.every(sk => Math.abs(sk.x - p.x) > sk.half + p.w / 2 + 10));
    for (const p of pads) {
      const xi = Math.floor(p.x);
      let fy = Math.floor(c[xi]);
      while (fy < H - 30 && !P.solid(w, xi, fy)) fy++;
      p.y = fy;
      const xa = Math.floor(p.x - p.w / 2), xb = Math.ceil(p.x + p.w / 2);
      for (let x = xa; x <= xb; x++) {
        for (let y = fy - 70; y < fy; y++) if (y > c[x] - hh[x] * 0.5) pt.clear(x, y);
        for (let y = fy; y < fy + 30; y++) if (!P.solid(w, x, y)) pt.set(x, y, MAT.REG, PAINT.REG3);
      }
      PROPS[p.name](pt, p.x, fy);
    }
    // surface hardware beside the first skylight
    const sk = skylights[0];
    for (const [name, off] of [['lander', -sk.half - 120], ['solar', sk.half + 90]]) {
      const x = Math.floor(sk.x + off);
      if (x < 120 || x > W - 120) continue;
      let y = Math.floor(s[x]);
      while (y < H && !P.solid(w, x, y)) y++;
      PROPS[name](pt, x, y);
      pads.push({ name, x, y, w: PROP_W[name] });
    }
    const lights = [];
    for (let x = 140; x < W - 140; x += 150) {
      const xi = Math.floor(x);
      let y = Math.floor(c[xi]);
      while (y > 0 && !P.solid(w, xi, y)) y--;
      if (y > s[xi] + 20 && !skylights.some(k => Math.abs(k.x - x) < k.half + 20)) lights.push({ x, y: y + 4 });
    }
    return { arena: 'tube', skyline: s, center: c, half: hh, skylights, pads, lights };
  }

  /* --------------------------------------------------------------- spawns */
  function findSpawns(w, info, n, rng) {
    const W = w.W, H = w.H, r = P.DOG_R;
    const out = [];
    let minDist = 260;
    for (let pass = 0; pass < 4 && out.length < n; pass++, minDist *= 0.7) {
      for (let t = 0; t < 3000 && out.length < n; t++) {
        const x = 180 + rng() * (W - 360);
        let y;
        if (info.arena === 'tube') {
          const xi = Math.floor(x);
          y = info.center[xi] - info.half[xi] * 0.6 + rng() * info.half[xi] * 0.8;
        } else {
          y = 40 + rng() * (H * 0.5);
        }
        if (P.circleHits(w, x, y, r)) continue;
        while (y < H && !P.circleHits(w, x, y + 1, r)) y++;
        if (y >= H - 40) continue;
        if (info.arena === 'tube' && y < info.skyline[Math.floor(x)] + 40) continue;
        const nrm = P.normalAt(w, x, y, r + 4);
        if (!nrm || nrm.y > -0.72) continue;
        if (P.circleHits(w, x, y - 2 * r, r)) continue;
        if (out.some(s => Math.hypot(s.x - x, s.y - y) < minDist)) continue;
        out.push({ x, y, nx: nrm.x, ny: nrm.y });
      }
    }
    return out;
  }

  function generate(opts) {
    const W = opts.W || 2400, H = opts.H || 1200;
    const rng = mulberry32(opts.seed >>> 0);
    const w = P.createWorld(W, H);
    const arena = opts.arena === 'tube' ? 'tube' : 'surface';
    const info = arena === 'tube' ? genTube(w, rng) : genSurface(w, rng);
    w.dirty.length = 0;
    info.seed = opts.seed >>> 0;
    info.stars = [];
    for (let i = 0; i < 420; i++) info.stars.push(rng() * W, rng() * H, rng());
    info.earth = { x: W * (0.2 + rng() * 0.6), y: H * 0.12 + rng() * 60, r: 46 };
    return { world: w, info, rng };
  }

  RR.terrain = { generate, findSpawns, mulberry32, PAINT };
})();
