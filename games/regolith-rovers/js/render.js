/* ==========================================================================
   REGOLITH ROVERS — canvas renderer
   Everything is drawn procedurally: the terrain texture is built pixel by
   pixel from the mask and paint arrays, and repainted only where a blast,
   drill or printer changed it. Dust particles fly under the same gravity
   as everything else, because in vacuum they have nothing else to obey.
   ========================================================================== */
'use strict';
var RR = globalThis.RR || (globalThis.RR = {});

(function () {
  const P = RR.physics, PPM = P.PPM;
  const PAL = [null,
    [150, 146, 138], [126, 122, 115], [110, 106, 100], [88, 87, 93], [42, 41, 46], [64, 58, 53],
    [230, 233, 236], [162, 168, 176], [46, 82, 146], [208, 166, 62], [122, 208, 232], [204, 74, 62],
    [63, 182, 168], [47, 89, 133], [178, 114, 74], [94, 101, 111], [84, 201, 186], [98, 192, 92]];
  const NATURAL = [false, true, true, true, true, true, true, false, false, false, false, false, false, false, false, true, false, false, false];
  const DUST = ['#9a968e', '#7c7871', '#a8a49b', '#6a675f'];

  function hash(x, y) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    const R = {
      cam: { x: 1200, y: 600, zoom: 1 }, vw: 1, vh: 1, dpr: 1,
      particles: [], flashes: [], texts: [], beams: [], gravFlash: 0,
      stars: [], G: null, terr: null, tctx: null, time: 0,
    };
    for (let i = 0; i < 260; i++) R.stars.push([Math.random(), Math.random(), Math.random()]);

    R.resize = function () {
      R.dpr = Math.min(2, window.devicePixelRatio || 1);
      R.vw = canvas.clientWidth || window.innerWidth;
      R.vh = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(R.vw * R.dpr);
      canvas.height = Math.round(R.vh * R.dpr);
    };

    R.attach = function (G) {
      R.G = G;
      const w = G.world;
      R.terr = document.createElement('canvas');
      R.terr.width = w.W; R.terr.height = w.H;
      R.tctx = R.terr.getContext('2d');
      paintRect(0, 0, w.W - 1, w.H - 1);
      w.dirty.length = 0;
      R.particles = []; R.flashes = []; R.texts = []; R.beams = [];
    };

    function paintRect(x0, y0, x1, y1) {
      const w = R.G.world, W = w.W, H = w.H, mask = w.mask, paint = w.paint;
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
      if (x1 < x0 || y1 < y0) return;
      const ww = x1 - x0 + 1, hh = y1 - y0 + 1;
      const img = R.tctx.createImageData(ww, hh), d = img.data;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x, o = ((y - y0) * ww + (x - x0)) * 4;
          if (!mask[i]) { d[o + 3] = 0; continue; }
          const pi = paint[i], c = PAL[pi] || PAL[2];
          let f = NATURAL[pi] ? 0.9 + 0.17 * hash(x, y) : 0.97 + 0.05 * hash(x, y);
          if (y > 0 && !mask[i - W]) f *= 1.18;
          else if (y < H - 1 && !mask[i + W]) f *= 0.8;
          else if ((x > 0 && !mask[i - 1]) || (x < W - 1 && !mask[i + 1])) f *= 0.9;
          d[o] = Math.min(255, c[0] * f); d[o + 1] = Math.min(255, c[1] * f); d[o + 2] = Math.min(255, c[2] * f); d[o + 3] = 255;
        }
      }
      R.tctx.putImageData(img, x0, y0);
    }

    R.refresh = function () {
      const dl = R.G.world.dirty;
      for (const r of dl) paintRect(r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1);
      dl.length = 0;
    };

    R.worldToScreen = (x, y) => ({ x: (x - R.cam.x) * R.cam.zoom + R.vw / 2, y: (y - R.cam.y) * R.cam.zoom + R.vh / 2 });
    R.screenToWorld = (x, y) => ({ x: (x - R.vw / 2) / R.cam.zoom + R.cam.x, y: (y - R.vh / 2) / R.cam.zoom + R.cam.y });

    /* --------------------------------------------------------- events */
    R.onEvent = function (e) {
      const G = R.G;
      if (e.type === 'explode') {
        R.flashes.push({ x: e.x, y: e.y, r: e.R * 1.3, t: 0, life: 0.35 });
        const n = P.normalAt(G.world, e.x, e.y, Math.min(30, e.R + 6));
        const count = Math.min(70, Math.round(e.R * 1.1));
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          let dx = Math.cos(a), dy = Math.sin(a);
          if (n) { dx += n.x * 0.9; dy += n.y * 0.9; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
          const sp = 1.5 + Math.random() * 6.5;
          addParticle(e.x + dx * 4, e.y + dy * 4, dx * sp, dy * sp, DUST[i % 4], 1.5 + Math.random() * 1.8, 2 + Math.random() * 4);
        }
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 7;
          addParticle(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, i % 2 ? '#ffd27a' : '#ff9a4a', 1.4, 0.45);
        }
      } else if (e.type === 'laser') {
        R.beams.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, t: 0, life: 0.4 });
      } else if (e.type === 'damage') {
        R.texts.push({ x: e.dog.x, y: e.dog.y - 18, text: '−' + e.amount, color: e.cause === 'fall' ? '#ffc857' : '#ff6b6b', t: 0, life: 1.5 });
      } else if (e.type === 'lost') {
        R.texts.push({ x: Math.max(40, Math.min(G.world.W - 40, e.dog.x)), y: Math.max(40, Math.min(G.world.H - 40, e.dog.y)), text: 'SIGNAL LOST', color: '#a993ff', t: 0, life: 2.2 });
      } else if (e.type === 'down') {
        R.texts.push({ x: e.dog.x, y: e.dog.y - 24, text: 'POWERED DOWN', color: '#c8d1de', t: 0, life: 2 });
      } else if (e.type === 'bounce') {
        for (let i = 0; i < 4; i++) addParticle(e.x, e.y, (Math.random() - 0.5) * 2, -Math.random() * 1.5, DUST[i], 1.2, 1.2);
      } else if (e.type === 'land' && e.vin > 2.5) {
        for (let i = 0; i < 8; i++) addParticle(e.dog.x, e.dog.y + 6, (Math.random() - 0.5) * 3, (Math.random() - 0.8) * 2, DUST[i % 4], 1.3, 1.5);
      } else if (e.type === 'print') {
        R.flashes.push({ x: G.active.x, y: G.active.y, r: 30, t: 0, life: 0.2, color: '178,114,74' });
      } else if (e.type === 'gravity') {
        R.gravFlash = 1.4;
      }
    };

    function addParticle(x, y, vx, vy, color, size, life) {
      if (R.particles.length > 900) R.particles.shift();
      R.particles.push({ x, y, vx, vy, color, size, life, t: 0 });
    }

    R.step = function (dt) {
      const G = R.G; if (!G) return;
      R.time += dt;
      const g = G.g();
      for (let i = R.particles.length - 1; i >= 0; i--) {
        const p = R.particles[i];
        p.t += dt;
        p.vx += g.x * dt; p.vy += g.y * dt;
        p.x += p.vx * dt * PPM; p.y += p.vy * dt * PPM;
        if (p.t > p.life || P.solid(G.world, p.x, p.y)) R.particles.splice(i, 1);
      }
      for (const arr of [R.flashes, R.texts, R.beams]) {
        for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t > arr[i].life) arr.splice(i, 1); }
      }
      if (R.gravFlash > 0) R.gravFlash = Math.max(0, R.gravFlash - dt);
      for (const p of G.projectiles) {
        p._trail = p._trail || [];
        p._trail.push(p.x, p.y);
        if (p._trail.length > 40) p._trail.splice(0, 2);
      }
    };

    /* ----------------------------------------------------- background */
    function background(G) {
      const { vw, vh, cam } = R;
      ctx.fillStyle = '#02040a';
      ctx.fillRect(0, 0, vw, vh);
      for (const s of R.stars) {
        const sx = ((s[0] * vw * 1.5 - cam.x * cam.zoom * 0.05) % vw + vw) % vw;
        const sy = ((s[1] * vh * 1.5 - cam.y * cam.zoom * 0.05) % vh + vh) % vh;
        ctx.fillStyle = `rgba(230,236,255,${0.25 + s[2] * 0.6})`;
        ctx.fillRect(sx, sy, s[2] > 0.85 ? 2 : 1, s[2] > 0.85 ? 2 : 1);
      }
      if (G.info.arena === 'surface') {
        const e = G.info.earth;
        const ex = vw / 2 + (e.x - cam.x) * cam.zoom * 0.12, ey = vh * 0.2 + (e.y - cam.y) * cam.zoom * 0.08;
        drawEarth(ex, ey, Math.max(18, 30 * Math.min(1.4, cam.zoom)));
        // distant ridge
        ctx.fillStyle = '#16171c';
        ctx.beginPath();
        ctx.moveTo(0, vh);
        const base = G.world.H * 0.5;
        for (let sx = 0; sx <= vw + 8; sx += 8) {
          const wx = cam.x + (sx - vw / 2) / (cam.zoom * 0.5);
          const wy = base - 70 - 60 * Math.sin(wx * 0.0011 + 1.3) - 35 * Math.sin(wx * 0.0033 + 0.4) - 14 * Math.sin(wx * 0.011);
          ctx.lineTo(sx, vh / 2 + (wy - cam.y) * cam.zoom * 0.5);
        }
        ctx.lineTo(vw, vh);
        ctx.closePath(); ctx.fill();
      }
    }

    function drawEarth(x, y, r) {
      const gr = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      gr.addColorStop(0, '#6fb6ff'); gr.addColorStop(0.7, '#2c6fc0'); gr.addColorStop(1, '#173f7a');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = 'rgba(80,150,80,.75)';
      ctx.beginPath(); ctx.ellipse(x - r * 0.25, y + r * 0.1, r * 0.35, r * 0.22, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1.5, r * 0.08);
      for (const [dx, dy, rr, a0] of [[-0.3, -0.35, 0.5, 0.2], [0.25, 0.3, 0.45, 2.4], [0.1, -0.1, 0.7, 4]]) {
        ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, rr * r, a0, a0 + 1.4); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(2,4,10,.62)';
      ctx.beginPath(); ctx.arc(x + r * 0.55, y + r * 0.1, r * 1.05, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(120,180,255,.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, Math.PI * 2); ctx.stroke();
    }

    function tubeBackdrop(G) {
      const s = G.info.skyline, W = G.world.W, H = G.world.H;
      ctx.fillStyle = '#121216';
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x < W; x += 8) ctx.lineTo(x, s[x] + 40);
      ctx.lineTo(W, s[W - 1] + 40); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      for (const sk of G.info.skylights) {
        const xi = Math.floor(sk.x), top = s[xi];
        const bot = G.info.center[xi] + G.info.half[xi] * 0.8;
        const gr = ctx.createLinearGradient(0, top, 0, bot);
        gr.addColorStop(0, 'rgba(200,215,255,.10)'); gr.addColorStop(1, 'rgba(200,215,255,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(sk.x - sk.half, top); ctx.lineTo(sk.x + sk.half, top);
        ctx.lineTo(sk.x + sk.half * 2.2, bot); ctx.lineTo(sk.x - sk.half * 1.4, bot); ctx.closePath(); ctx.fill();
      }
      for (const l of G.info.lights) {
        const gr = ctx.createRadialGradient(l.x, l.y, 1, l.x, l.y, 70);
        gr.addColorStop(0, 'rgba(255,205,140,.22)'); gr.addColorStop(1, 'rgba(255,205,140,0)');
        ctx.fillStyle = gr; ctx.fillRect(l.x - 70, l.y - 70, 140, 140);
      }
    }

    /* ------------------------------------------------------------ dogs */
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }

    function drawDog(d, G) {
      const team = G.teams[d.team], col = team.color;
      const ux = d.grounded ? d.nx : d.ux, uy = d.grounded ? d.ny : d.uy;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(Math.atan2(ux, -uy));
      ctx.scale(d.fs, 1);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const ph = d.walkPhase;
      const legs = [[-6, true, 0], [5, true, Math.PI], [-5, false, Math.PI], [6, false, 0]];
      for (const [hx, far, off] of legs) {
        ctx.strokeStyle = far ? '#7c8796' : '#d3d9e1';
        ctx.lineWidth = far ? 2 : 2.4;
        ctx.beginPath(); ctx.moveTo(hx, 1);
        if (d.grounded) {
          const sw = Math.sin(ph + off), lift = Math.max(0, Math.cos(ph + off)) * 1.6;
          ctx.lineTo(hx + 1.5 + sw * 1.2, 5); ctx.lineTo(hx + sw * 2.6, 9 - lift);
        } else {
          ctx.lineTo(hx + 2.5, 4); ctx.lineTo(hx - 0.5, 6.5);
        }
        ctx.stroke();
      }
      // tail antenna
      ctx.strokeStyle = '#9aa5b3'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-9.5, -4); ctx.quadraticCurveTo(-13, -6, -13.5, -10 + Math.sin(R.time * 6) * 0.8); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(-13.5, -10.3 + Math.sin(R.time * 6) * 0.8, 1.2, 0, 7); ctx.fill();
      // body
      roundRect(-10, -6.5, 18, 8.5, 3.5);
      ctx.fillStyle = '#eef1f4'; ctx.fill(); ctx.strokeStyle = '#66717f'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.fillStyle = col; ctx.fillRect(-8.5, -3.4, 13, 2);
      ctx.fillStyle = '#a7b1bd'; ctx.fillRect(-6.5, -8.2, 7, 1.8);
      // collar
      ctx.fillStyle = col; ctx.fillRect(4.2, -7, 1.9, 7.5);
      // head
      roundRect(5, -13.5, 10, 8.5, 2.6);
      ctx.fillStyle = '#eef1f4'; ctx.fill(); ctx.stroke();
      roundRect(12.5, -9.5, 4.5, 4, 1.6); ctx.fillStyle = '#dfe4ea'; ctx.fill(); ctx.stroke();
      roundRect(7.5, -12, 6.2, 3.6, 1.4); ctx.fillStyle = '#0f1f2b'; ctx.fill();
      const blink = (Math.sin(R.time * 1.7 + d.id * 1.9) > 0.97) ? 0.3 : 1;
      ctx.fillStyle = col; ctx.globalAlpha = blink;
      ctx.beginPath(); ctx.arc(11.8, -10.2, 1, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      // ear and antenna
      ctx.fillStyle = '#c8cfd9';
      ctx.beginPath(); ctx.moveTo(6.2, -13.4); ctx.lineTo(7.4, -18); ctx.lineTo(9.3, -13.4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8a95a3'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(10.5, -13.4); ctx.lineTo(11.5, -19.5); ctx.stroke();
      ctx.fillStyle = (Math.floor(R.time * 2 + d.id) % 2) ? col : '#ffffff';
      ctx.beginPath(); ctx.arc(11.5, -19.8, 1.3, 0, 7); ctx.fill();
      ctx.restore();
    }

    function drawThruster(G) {
      const d = G.active;
      if (!G.thrusting || !d || !d.alive) return;
      const dir = P.aimDir(d, G.aim.angle);
      ctx.fillStyle = '#7f8a98';
      ctx.fillRect(d.x - dir.x * 6 - 3, d.y - dir.y * 6 - 3, 6, 6);
      if (!G.thrustVec) return;
      const len = 14 + Math.random() * 8;
      const bx = d.x - dir.x * 9, by = d.y - dir.y * 9, px = -dir.y, py = dir.x;
      const gr = ctx.createLinearGradient(bx, by, bx - dir.x * len, by - dir.y * len);
      gr.addColorStop(0, 'rgba(255,255,230,.95)'); gr.addColorStop(0.4, 'rgba(255,170,60,.8)'); gr.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(bx + px * 3.5, by + py * 3.5); ctx.lineTo(bx - dir.x * len, by - dir.y * len); ctx.lineTo(bx - px * 3.5, by - py * 3.5); ctx.closePath(); ctx.fill();
    }

    function drawDrill(G) {
      const d = G.active;
      if (!(G.drilling > 0) || !d) return;
      const dir = G.drillDir, px = -dir.y, py = dir.x, bx = d.x + dir.x * 10, by = d.y + dir.y * 10;
      ctx.fillStyle = (Math.floor(R.time * 30) % 2) ? '#c9ced6' : '#8d96a3';
      ctx.beginPath(); ctx.moveTo(bx + px * 4, by + py * 4); ctx.lineTo(bx + dir.x * 10, by + dir.y * 10); ctx.lineTo(bx - px * 4, by - py * 4); ctx.closePath(); ctx.fill();
    }

    /* ----------------------------------------------------- projectiles */
    function drawProjectile(p) {
      if (p._trail && p._trail.length > 4) {
        ctx.strokeStyle = 'rgba(220,230,255,.18)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(p._trail[0], p._trail[1]);
        for (let i = 2; i < p._trail.length; i += 2) ctx.lineTo(p._trail[i], p._trail[i + 1]);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      const a = Math.atan2(p.vy, p.vx);
      if (p.weapon === 'bone') {
        ctx.rotate(a);
        ctx.fillStyle = '#f2e8d2'; ctx.strokeStyle = '#8c7e66'; ctx.lineWidth = 0.6;
        ctx.fillRect(-5, -1.3, 10, 2.6);
        for (const sx of [-5.2, 5.2]) for (const sy of [-1.6, 1.6]) { ctx.beginPath(); ctx.arc(sx, sy, 1.8, 0, 7); ctx.fill(); ctx.stroke(); }
      } else if (p.weapon === 'ball') {
        ctx.rotate(p.age * 8);
        ctx.fillStyle = '#cde64a'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 7); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.arc(-p.r * 0.9, 0, p.r * 0.75, -1.1, 1.1); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.r * 0.9, 0, p.r * 0.75, Math.PI - 1.1, Math.PI + 1.1); ctx.stroke();
      } else if (p.weapon === 'scatter') {
        ctx.rotate(a);
        if (p.main) { roundRect(-4.5, -2.6, 9, 5.2, 1.6); ctx.fillStyle = '#d9dde2'; ctx.fill(); ctx.fillStyle = '#3FB6A8'; ctx.fillRect(-1, -2.6, 2, 5.2); }
        else { ctx.fillStyle = '#d9dde2'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, 7); ctx.fill(); }
      } else if (p.weapon === 'drop') {
        ctx.rotate(a - Math.PI / 2);
        ctx.fillStyle = '#d0a63e'; ctx.fillRect(-4.5, -5, 9, 10);
        ctx.fillStyle = '#7f8a98'; ctx.fillRect(-4.5, -1, 9, 2);
      }
      ctx.restore();
    }

    /* ------------------------------------------------------ aim helpers */
    function drawAim(G) {
      const d = G.active;
      if (G.phase !== 'aim' || !d || !d.alive) return;
      const W = RR.WEAPON[G.aim.weapon];
      if (W.kind === 'target') {
        const t = G.aim.target; if (!t) return;
        const g = G.g(), gx = g.x / g.g, gy = g.y / g.g;
        ctx.strokeStyle = 'rgba(255,200,87,.45)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x - gx * 600, t.y - gy * 600); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(t.x, t.y, 12, 0, 7); ctx.moveTo(t.x - 18, t.y); ctx.lineTo(t.x + 18, t.y); ctx.moveTo(t.x, t.y - 18); ctx.lineTo(t.x, t.y + 18); ctx.stroke();
        return;
      }
      if (W.kind === 'skip') return;
      const dir = P.aimDir(d, G.aim.angle);
      const cx = d.x + dir.x * 46, cy = d.y + dir.y * 46;
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7);
      ctx.moveTo(cx - 8, cy); ctx.lineTo(cx - 3, cy); ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy - 3); ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 8);
      ctx.stroke();
      if (W.kind === 'charge' && G.aim.charging) {
        const pw = G.aim.power;
        ctx.strokeStyle = `hsl(${120 - 120 * pw},85%,55%)`; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(d.x + dir.x * 13, d.y + dir.y * 13); ctx.lineTo(d.x + dir.x * (13 + 44 * pw), d.y + dir.y * (13 + 44 * pw)); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      if (W.kind === 'charge' && G.cfg.training) {
        const pw = G.aim.charging ? Math.max(0.03, G.aim.power) : G.aim.lastPower;
        const v = pw * P.V_MAX, g = G.g();
        const p = { x: d.x + dir.x * (d.r + 5), y: d.y + dir.y * (d.r + 5), vx: dir.x * v, vy: dir.y * v,
          r: W.proj.r, age: 0, owner: d, bounce: !!W.proj.bounce, restitution: W.proj.restitution || 0, fuse: null };
        const res = P.simulateShot(G.world, p, g.x, g.y, G.dogs, { tMax: 2.6, trace: true, every: 6 });
        const pts = res.pts;
        for (let i = 0; i < pts.length; i += 2) {
          ctx.fillStyle = `rgba(84,201,186,${0.85 * (1 - i / pts.length)})`;
          ctx.beginPath(); ctx.arc(pts[i], pts[i + 1], 1.8, 0, 7); ctx.fill();
        }
      }
    }

    /* -------------------------------------------------------- overlays */
    function drawLabels(G) {
      ctx.font = '600 11px ui-monospace,Menlo,Consolas,monospace';
      ctx.textAlign = 'center';
      for (const d of G.dogs) {
        if (!d.alive) continue;
        const ux = d.grounded ? d.nx : d.ux, uy = d.grounded ? d.ny : d.uy;
        const s = R.worldToScreen(d.x + ux * 22, d.y + uy * 22);
        if (s.x < -60 || s.x > R.vw + 60 || s.y < -40 || s.y > R.vh + 40) continue;
        const team = G.teams[d.team];
        const bw = 30;
        ctx.fillStyle = 'rgba(5,8,14,.7)'; ctx.fillRect(s.x - bw / 2 - 1, s.y - 1, bw + 2, 5);
        ctx.fillStyle = team.color; ctx.fillRect(s.x - bw / 2, s.y, bw * d.hp / 100, 3);
        ctx.fillStyle = team.color;
        ctx.fillText(`${d.name} ${d.hp}`, s.x, s.y - 4);
        if (d === G.active && (G.phase === 'aim' || G.phase === 'retreat')) {
          const bob = Math.sin(R.time * 5) * 3;
          ctx.beginPath(); ctx.moveTo(s.x - 6, s.y - 26 + bob); ctx.lineTo(s.x + 6, s.y - 26 + bob); ctx.lineTo(s.x, s.y - 18 + bob); ctx.closePath(); ctx.fill();
        }
      }
      const d = G.active;
      if (d && d.alive) {
        const s = R.worldToScreen(d.x, d.y), m = 24;
        if (s.x < 0 || s.x > R.vw || s.y < 0 || s.y > R.vh) {
          const cx = Math.max(m, Math.min(R.vw - m, s.x)), cy = Math.max(m, Math.min(R.vh - m, s.y));
          const a = Math.atan2(s.y - cy, s.x - cx);
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
          ctx.fillStyle = G.teams[d.team].color;
          ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -8); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
      for (const t of R.texts) {
        const s = R.worldToScreen(t.x, t.y);
        ctx.globalAlpha = Math.max(0, 1 - t.t / t.life);
        ctx.font = '700 14px ui-monospace,Menlo,Consolas,monospace';
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, s.x, s.y - t.t * 22);
      }
      ctx.globalAlpha = 1;
    }

    function drawGravityFlash(G) {
      if (R.gravFlash <= 0) return;
      const a = Math.min(1, R.gravFlash / 0.5) * 0.55;
      const g = G.g(), pl = P.PLANETS[G.planet];
      const len = 50 + 90 * Math.sqrt(g.g / 9.81);
      const cx = R.vw / 2, cy = Math.max(len / 2 + 60, R.vh * 0.3), ux = g.x / g.g, uy = g.y / g.g;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx - ux * len / 2, cy - uy * len / 2); ctx.lineTo(cx + ux * len / 2, cy + uy * len / 2); ctx.stroke();
      const hx = cx + ux * len / 2, hy = cy + uy * len / 2, px = -uy, py = ux;
      ctx.beginPath(); ctx.moveTo(hx + ux * 16, hy + uy * 16); ctx.lineTo(hx + px * 12, hy + py * 12); ctx.lineTo(hx - px * 12, hy - py * 12); ctx.closePath(); ctx.fill();
      ctx.font = '700 16px ui-monospace,Menlo,Consolas,monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${pl.name.toUpperCase()} ${pl.g.toFixed(2)} m/s²`, cx, cy - len / 2 - 26);
      ctx.restore();
    }

    /* ------------------------------------------------------------ draw */
    R.draw = function () {
      const G = R.G; if (!G) return;
      R.refresh();
      const { cam, dpr } = R;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      background(G);
      ctx.setTransform(cam.zoom * dpr, 0, 0, cam.zoom * dpr, (R.vw / 2 - cam.x * cam.zoom) * dpr, (R.vh / 2 - cam.y * cam.zoom) * dpr);
      if (G.info.arena === 'tube') tubeBackdrop(G);
      ctx.imageSmoothingEnabled = cam.zoom < 1;
      ctx.drawImage(R.terr, 0, 0);
      if (G.info.arena === 'tube') {
        for (const l of G.info.lights) { ctx.fillStyle = '#ffe2b0'; ctx.fillRect(l.x - 2, l.y - 1, 4, 3); }
      }
      for (const p of G.projectiles) drawProjectile(p);
      drawThruster(G);
      for (const d of G.dogs) if (d.alive) drawDog(d, G);
      drawDrill(G);
      drawAim(G);
      for (const p of R.particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, Math.min(1, (p.life - p.t) / 0.4));
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      for (const f of R.flashes) {
        const k = f.t / f.life;
        const gr = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
        const c = f.color || '255,220,150';
        gr.addColorStop(0, `rgba(255,255,240,${0.9 * (1 - k)})`); gr.addColorStop(0.5, `rgba(${c},${0.5 * (1 - k)})`); gr.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
      }
      for (const b of R.beams) {
        const k = 1 - b.t / b.life;
        ctx.strokeStyle = `rgba(255,60,60,${k})`; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
        ctx.strokeStyle = `rgba(255,220,220,${k})`; ctx.lineWidth = 0.8; ctx.stroke();
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLabels(G);
      drawGravityFlash(G);
    };

    return R;
  }

  RR.createRenderer = createRenderer;
})();
