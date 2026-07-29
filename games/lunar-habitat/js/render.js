/* Lunar Habitat — canvas renderer. Everything is drawn procedurally;
   there are no image assets to load. */

(function (LH) {
  'use strict';

  var C = LH.C;

  var R = LH.R = {
    cam: { x: 0, y: 0, z: 1 },
    walkers: [],
    t: 0
  };

  function hash(n) {
    n = (n << 13) ^ n;
    return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff;
  }

  /* world <-> grid ------------------------------------------------------- */
  R.cellX = function (x) { return x * C.CELL_W; };
  R.cellY = function (l) { return -(l + 1) * C.CELL_H; };

  /* screen px -> grid cell */
  R.screenToGrid = function (sx, sy, cv) {
    var wx = (sx - cv.width / 2) / R.cam.z + R.cam.x;
    var wy = (sy - cv.height / 2) / R.cam.z + R.cam.y;
    var x = Math.floor(wx / C.CELL_W);
    var l = Math.floor(-wy / C.CELL_H);
    return { x: x, l: l, wx: wx, wy: wy };
  };

  R.centreOn = function (x, l) {
    R.cam.x = x * C.CELL_W;
    R.cam.y = R.cellY(l) + C.CELL_H / 2;
  };

  R.clampCam = function (cv) {
    var halfW = cv.width / 2 / R.cam.z, halfH = cv.height / 2 / R.cam.z;
    var minX = -halfW * 0.3, maxX = C.GRID_W * C.CELL_W + halfW * 0.3;
    R.cam.x = Math.max(minX, Math.min(maxX, R.cam.x));
    var top = R.cellY(C.MAX_UP) - 200, bot = R.cellY(-C.MAX_DOWN - 1) + 200;
    R.cam.y = Math.max(top + halfH * 0.2, Math.min(bot - halfH * 0.2, R.cam.y));
  };

  /* ------------------------------------------------------------- drawing */

  R.draw = function (ctx, cv, s, ui, dt) {
    R.t += dt;
    var z = R.cam.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);

    var sun = LH.sunFactor(s.day);
    sky(ctx, cv, s, sun);

    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.scale(z, z);
    ctx.translate(-R.cam.x, -R.cam.y);

    var view = {
      x0: Math.floor((R.cam.x - cv.width / 2 / z) / C.CELL_W) - 2,
      x1: Math.ceil((R.cam.x + cv.width / 2 / z) / C.CELL_W) + 2,
      l1: Math.ceil(-(R.cam.y - cv.height / 2 / z) / C.CELL_H) + 2,
      l0: Math.floor(-(R.cam.y + cv.height / 2 / z) / C.CELL_H) - 2
    };
    view.x0 = Math.max(-4, view.x0); view.x1 = Math.min(C.GRID_W + 4, view.x1);
    view.l0 = Math.max(-C.MAX_DOWN - 2, view.l0); view.l1 = Math.min(C.MAX_UP + 2, view.l1);

    regolith(ctx, s, view, sun);
    if (ui.tool) grid(ctx, view);
    modules(ctx, s, view, sun, ui);
    walkers(ctx, s, dt, view);
    ghost(ctx, s, ui);

    ctx.restore();

    ruler(ctx, cv, s);
    minimap(ctx, cv, s, ui);
    if (s.flare > 0) flareWarning(ctx, cv, s);
  };

  /* ------------------------------------------------------------------ sky */

  function sky(ctx, cv, s, sun) {
    var g = ctx.createLinearGradient(0, 0, 0, cv.height);
    var lit = sun;
    g.addColorStop(0, '#04060e');
    g.addColorStop(0.6, lit > 0.2 ? '#0a1022' : '#050813');
    g.addColorStop(1, lit > 0.2 ? '#141c30' : '#070a15');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);

    // starfield, parallaxed against the camera
    var px = R.cam.x * 0.06, py = R.cam.y * 0.06;
    ctx.save();
    for (var i = 0; i < 220; i++) {
      var sx = (hash(i * 3 + 1) * 3000 - px) % 3000; if (sx < 0) sx += 3000;
      var sy = (hash(i * 3 + 2) * 1600 - py) % 1600; if (sy < 0) sy += 1600;
      if (sx > cv.width || sy > cv.height) continue;
      var b = 0.25 + hash(i * 3 + 3) * 0.75;
      ctx.globalAlpha = b * (1 - sun * 0.35);
      ctx.fillStyle = '#dfe8ff';
      ctx.fillRect(sx, sy, b > 0.85 ? 2 : 1, b > 0.85 ? 2 : 1);
    }
    ctx.restore();

    // Earth — tidally locked, so it never moves in the lunar sky
    var ex = cv.width * 0.82 - R.cam.x * 0.02, ey = cv.height * 0.16 - R.cam.y * 0.02;
    var er = 34;
    var phase = ((s.day - 1) % C.LUNAR_CYCLE) / C.LUNAR_CYCLE;
    ctx.save();
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#12305c'; ctx.fillRect(ex - er, ey - er, er * 2, er * 2);
    ctx.fillStyle = '#2f6b45';
    for (var c = 0; c < 8; c++) {
      var cx = ex - er + hash(c * 7 + 11) * er * 2;
      var cy = ey - er + hash(c * 7 + 13) * er * 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 4 + hash(c * 7 + 17) * 11, 3 + hash(c * 7 + 19) * 7, hash(c) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Earth's phase is the opposite of the Moon's
    var shade = ctx.createLinearGradient(ex - er, 0, ex + er, 0);
    var edge = 1 - phase;
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(Math.max(0.01, Math.min(0.99, edge - 0.12)), 'rgba(0,0,0,0)');
    shade.addColorStop(Math.max(0.02, Math.min(1, edge + 0.12)), 'rgba(0,0,4,0.9)');
    shade.addColorStop(1, 'rgba(0,0,4,0.9)');
    ctx.fillStyle = shade; ctx.fillRect(ex - er, ey - er, er * 2, er * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(120,170,255,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ex, ey, er + 1, 0, Math.PI * 2); ctx.stroke();

    // the sun tracks slowly across the sky over the 28-day cycle
    if (sun > 0.02) {
      var sxp = cv.width * (0.08 + phase * 1.7);
      var syp = cv.height * (0.34 - Math.sin(phase * Math.PI * 2) * 0.2);
      var rg = ctx.createRadialGradient(sxp, syp, 2, sxp, syp, 90);
      rg.addColorStop(0, 'rgba(255,250,225,' + (0.95 * sun) + ')');
      rg.addColorStop(0.2, 'rgba(255,230,170,' + (0.4 * sun) + ')');
      rg.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(sxp - 100, syp - 100, 200, 200);
    }
  }

  /* ------------------------------------------------------------- regolith */

  function regolith(ctx, s, view, sun) {
    var x0 = R.cellX(view.x0), x1 = R.cellX(view.x1);
    var top = 0, bot = R.cellY(-C.MAX_DOWN - 1);

    var g = ctx.createLinearGradient(0, top, 0, bot);
    var tone = 0.45 + sun * 0.55;
    g.addColorStop(0, shade('#6a6055', tone));
    g.addColorStop(0.25, shade('#544b42', tone * 0.92));
    g.addColorStop(0.65, shade('#413a34', tone * 0.85));
    g.addColorStop(1, shade('#2c2723', tone * 0.8));
    ctx.fillStyle = g;
    ctx.fillRect(x0 - 400, top, (x1 - x0) + 800, bot - top + 400);

    // strata
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (var l = -1; l >= -C.MAX_DOWN - 1; l -= 2) {
      var y = R.cellY(l);
      ctx.fillStyle = hash(l * 31) > 0.5 ? '#000' : '#fff';
      ctx.globalAlpha = 0.05 + hash(l * 17) * 0.07;
      ctx.fillRect(x0 - 400, y, (x1 - x0) + 800, C.CELL_H * (1 + Math.floor(hash(l * 7) * 2)));
    }
    ctx.restore();

    // scattered clasts
    ctx.save();
    for (var i = 0; i < 400; i++) {
      var px = (hash(i * 5 + 1) * C.GRID_W * C.CELL_W);
      var py = hash(i * 5 + 2) * (bot - top) + top;
      if (px < x0 - 60 || px > x1 + 60) continue;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = hash(i * 5 + 3) > 0.5 ? '#8b8074' : '#241f1b';
      var r = 1 + hash(i * 5 + 4) * 3.5;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // excavated voids
    ctx.fillStyle = '#14100e';
    for (var k in s.dug) {
      var p = k.split(','), cx = +p[0], cl = +p[1];
      if (cx < view.x0 || cx > view.x1 || cl < view.l0 || cl > view.l1) continue;
      ctx.fillRect(R.cellX(cx), R.cellY(cl), C.CELL_W, C.CELL_H);
    }

    // the surface line itself
    ctx.strokeStyle = shade('#9d9184', tone);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 - 400, 0); ctx.lineTo(x1 + 400, 0);
    ctx.stroke();

    // undulating surface dust and a few craters
    ctx.save();
    ctx.fillStyle = shade('#877b6d', tone);
    for (var cI = 0; cI < 60; cI++) {
      var ccx = hash(cI * 11 + 3) * C.GRID_W * C.CELL_W;
      if (ccx < x0 - 80 || ccx > x1 + 80) continue;
      var cr = 6 + hash(cI * 11 + 5) * 22;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.ellipse(ccx, -1, cr, cr * 0.22, 0, Math.PI, 0);
      ctx.fill();
    }
    ctx.restore();
  }

  function shade(hex, f) {
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    r = Math.min(255, r * f) | 0; g = Math.min(255, g * f) | 0; b = Math.min(255, b * f) | 0;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ----------------------------------------------------------------- grid */

  function grid(ctx, view) {
    ctx.save();
    ctx.strokeStyle = 'rgba(150,190,230,0.10)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (var x = view.x0; x <= view.x1; x++) {
      ctx.moveTo(R.cellX(x), R.cellY(view.l1));
      ctx.lineTo(R.cellX(x), R.cellY(view.l0 - 1));
    }
    for (var l = view.l0; l <= view.l1; l++) {
      ctx.moveTo(R.cellX(view.x0), R.cellY(l));
      ctx.lineTo(R.cellX(view.x1), R.cellY(l));
    }
    ctx.stroke();
    ctx.restore();
  }

  /* -------------------------------------------------------------- modules */

  function modules(ctx, s, view, sun, ui) {
    var z = R.cam.z;
    for (var iid in s.inst) {
      var inst = s.inst[iid], m = LH.MOD[inst.mid];
      if (inst.x + inst.w < view.x0 || inst.x > view.x1) continue;
      if (inst.l1 < view.l0 || inst.l0 > view.l1) continue;
      drawModule(ctx, s, inst, m, sun, z, ui);
    }
  }

  function drawModule(ctx, s, inst, m, sun, z, ui) {
    var x = R.cellX(inst.x), w = inst.w * C.CELL_W;
    var y = R.cellY(inst.l1), h = (inst.l1 - inst.l0 + 1) * C.CELL_H;
    var on = inst.on && inst.dmg < 0.85;
    var lit = on ? 1 : 0.45;

    // hull
    ctx.fillStyle = shade(m.color, (0.55 + sun * 0.2) * lit);
    ctx.fillRect(x, y, w, h);

    // top highlight / bottom shadow
    ctx.fillStyle = 'rgba(255,255,255,' + (0.14 * lit) + ')';
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, y + h - 2, w, 2);

    if (m.vertical) {
      // shaft rails plus a car sliding up and down
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 3.5, y); ctx.lineTo(x + 3.5, y + h);
      ctx.moveTo(x + w - 3.5, y); ctx.lineTo(x + w - 3.5, y + h);
      ctx.stroke();
      if (on && h > C.CELL_H) {
        var span = h - C.CELL_H;
        var ph = (R.t * (m.id === 'express' ? 0.35 : 0.16) + inst.seed * 10) % 2;
        var f = ph > 1 ? 2 - ph : ph;
        var cy = y + f * span;
        ctx.fillStyle = m.id === 'express' ? '#ffe9a8' : '#cfe6ff';
        ctx.fillRect(x + 2, cy + 3, w - 4, C.CELL_H - 6);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(x + 4, cy + 6, w - 8, 4);
      }
      outline(ctx, x, y, w, h, on);
      if (inst.dmg > 0.05) damage(ctx, x, y, w, h, inst.dmg);
      return;
    }

    // windows / interior detail
    if (z > 0.55) {
      var cols = Math.max(1, Math.floor(w / 9));
      for (var i = 0; i < cols; i++) {
        var wx = x + 4 + i * (w - 6) / cols;
        var ww = Math.max(2, (w - 6) / cols - 3);
        if (m.cat === 'power' && m.id === 'solar') {
          ctx.fillStyle = on ? shade('#2a3f6b', 0.6 + sun * 0.9) : '#1d2436';
          ctx.fillRect(wx, y + 4, ww, h - 12);
        } else if (m.cat === 'hab' || m.cat === 'amen' || m.cat === 'work') {
          var glow = on ? (0.55 + 0.45 * Math.sin(R.t * 0.6 + i + inst.seed * 9)) : 0.12;
          ctx.fillStyle = 'rgba(255,236,190,' + (0.16 + glow * 0.55) + ')';
          ctx.fillRect(wx, y + 5, ww, Math.max(3, h * 0.34));
        } else {
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(wx, y + 5, ww, Math.max(3, h * 0.3));
        }
      }
    }

    // per-type flourishes
    if (m.id === 'solar' && on) {
      ctx.strokeStyle = 'rgba(255,225,150,' + (0.25 + sun * 0.5) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + w - 2, y + 2); ctx.stroke();
      if (inst.dust > 0.05) {
        ctx.fillStyle = 'rgba(150,135,110,' + inst.dust + ')';
        ctx.fillRect(x, y, w, h);
      }
    }
    if (m.id === 'pad') {
      ctx.strokeStyle = 'rgba(255,210,120,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, Math.min(h, w) * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      var blink = (R.t % 1.4) < 0.7;
      ctx.fillStyle = blink ? '#ffca5a' : '#5a4520';
      ctx.fillRect(x + 2, y + h - 5, 3, 3);
      ctx.fillRect(x + w - 5, y + h - 5, 3, 3);
    }
    if (m.id === 'airlock') {
      ctx.fillStyle = on ? '#7fe6c0' : '#3c5850';
      ctx.fillRect(x + w / 2 - 3, y + h - 9, 6, 7);
    }
    if (m.id === 'fission' && on) {
      var pulse = 0.5 + 0.5 * Math.sin(R.t * 2 + inst.seed * 6);
      ctx.fillStyle = 'rgba(255,240,150,' + (0.2 + pulse * 0.4) + ')';
      ctx.fillRect(x + w * 0.3, y + 4, w * 0.4, h - 10);
    }
    if (m.cat === 'mine' && on) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + h - 3); ctx.lineTo(x + w - 3, y + h - 3);
      ctx.stroke();
    }
    if (m.id === 'garden' || m.id === 'obs') {
      ctx.strokeStyle = 'rgba(200,240,255,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 1, y + h); ctx.quadraticCurveTo(x + w / 2, y - h * 0.55, x + w - 1, y + h);
      ctx.stroke();
      ctx.fillStyle = m.id === 'garden' ? 'rgba(120,220,150,0.16)' : 'rgba(160,190,255,0.14)';
      ctx.fill();
    }

    outline(ctx, x, y, w, h, on);

    // status badges
    if (inst.dist === Infinity) {
      badge(ctx, x + w / 2, y - 6, '#ff6b6b', '!');
    } else if (!inst.on && inst.dmg < 0.85) {
      badge(ctx, x + w / 2, y - 6, '#ffc14d', '⚡');
    }
    if (inst.dmg > 0.05) damage(ctx, x, y, w, h, inst.dmg);

    // label
    if (z > 1.15 && w > 44) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.font = '8px ui-monospace, monospace';
      var t = m.name.toUpperCase();
      var tw = ctx.measureText(t).width;
      if (tw < w - 6) {
        ctx.fillRect(x + w / 2 - tw / 2 - 2, y + h - 12, tw + 4, 10);
        ctx.fillStyle = 'rgba(240,246,255,0.85)';
        ctx.fillText(t, x + w / 2 - tw / 2, y + h - 4);
      }
    }
  }

  function outline(ctx, x, y, w, h, on) {
    ctx.strokeStyle = on ? 'rgba(10,14,20,0.85)' : 'rgba(255,90,90,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function damage(ctx, x, y, w, h, d) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.8, 0.25 + d * 0.6);
    ctx.strokeStyle = '#ff5c4d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var fx = x + (i + 0.5) * w / 4;
      ctx.moveTo(fx - 4, y + 3);
      ctx.lineTo(fx + 2, y + h * 0.5);
      ctx.lineTo(fx - 3, y + h - 3);
    }
    ctx.stroke();
    ctx.restore();
  }

  function badge(ctx, cx, cy, col, ch) {
    ctx.save();
    var pulse = 0.6 + 0.4 * Math.sin(R.t * 5);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10131a';
    ctx.font = 'bold 7px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ch, cx, cy + 2.5);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /* -------------------------------------------------------------- walkers */

  function walkers(ctx, s, dt, view) {
    var want = Math.min(150, Math.floor(s.pop / 3) + Math.floor(s.tourists / 2));
    var W = R.walkers;
    while (W.length > want) W.pop();
    while (W.length < want) {
      var spot = randomOccupied(s);
      if (!spot) break;
      W.push({ x: spot.x + Math.random(), l: spot.l, dir: Math.random() < 0.5 ? -1 : 1,
               sp: 1.2 + Math.random() * 1.6, ride: 0, tint: Math.random() });
    }

    ctx.save();
    for (var i = 0; i < W.length; i++) {
      var w = W[i];
      if (w.ride > 0) {
        w.ride -= dt;
        w.ly += (w.targetL - w.ly) * Math.min(1, dt * 2.2);
        if (w.ride <= 0) { w.l = w.targetL; w.ly = undefined; }
      } else {
        var nx = w.x + w.dir * w.sp * dt;
        if (!LH.occupied(s, Math.floor(nx), w.l)) { w.dir *= -1; }
        else w.x = nx;
        // occasionally hop into a shaft
        var here = LH.at(s, Math.floor(w.x), w.l);
        if (here && LH.MOD[here.mid].vertical && Math.random() < dt * 0.9) {
          var tl = here.l0 + Math.floor(Math.random() * (here.l1 - here.l0 + 1));
          if (tl !== w.l) { w.targetL = tl; w.ly = w.l; w.ride = 0.4 + Math.abs(tl - w.l) * 0.12; }
        }
        if (Math.random() < dt * 0.12) w.dir *= -1;
      }
      var lvl = w.ly !== undefined ? w.ly : w.l;
      if (Math.floor(w.x) < view.x0 || Math.floor(w.x) > view.x1) continue;
      if (lvl < view.l0 || lvl > view.l1) continue;
      var px = w.x * C.CELL_W, py = R.cellY(lvl) + C.CELL_H - 4;
      ctx.fillStyle = w.tint > 0.75 ? '#ffd9a0' : (w.tint > 0.4 ? '#cfe4ff' : '#e8eef7');
      ctx.fillRect(px, py - 4, 1.6, 4.5);
    }
    ctx.restore();
  }

  function randomOccupied(s) {
    var keys = Object.keys(s.cells);
    if (!keys.length) return null;
    var k = keys[Math.floor(Math.random() * keys.length)].split(',');
    return { x: +k[0], l: +k[1] };
  }

  /* ---------------------------------------------------------------- ghost */

  function ghost(ctx, s, ui) {
    if (!ui.tool || !ui.hover) return;
    var m = LH.MOD[ui.tool];
    if (ui.tool === 'bulldoze') {
      var r = ui.raw || ui.hover;
      var t = LH.at(s, r.x, r.l);
      if (t) {
        ctx.save();
        ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(R.cellX(t.x), R.cellY(t.l1),
          t.w * C.CELL_W, (t.l1 - t.l0 + 1) * C.CELL_H);
        ctx.restore();
      }
      return;
    }
    if (!m) return;

    var gx = ui.hover.x, gl = ui.hover.l, gl2 = gl;
    if (m.vertical && ui.drag) { gx = ui.drag.x; gl = ui.drag.l; gl2 = ui.hover.l; }
    var chk = LH.checkPlace(s, ui.tool, gx, gl, gl2);
    var cells = chk.cells || LH.footprint(m, gx, gl, gl2);

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = chk.ok ? m.color : '#ff5555';
    cells.forEach(function (c) {
      ctx.fillRect(R.cellX(c[0]), R.cellY(c[1]), C.CELL_W, C.CELL_H);
    });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = chk.ok ? '#ffffff' : '#ff5555';
    ctx.lineWidth = 1.5;
    var minX = Math.min.apply(null, cells.map(function (c) { return c[0]; }));
    var maxX = Math.max.apply(null, cells.map(function (c) { return c[0]; }));
    var minL = Math.min.apply(null, cells.map(function (c) { return c[1]; }));
    var maxL = Math.max.apply(null, cells.map(function (c) { return c[1]; }));
    ctx.strokeRect(R.cellX(minX), R.cellY(maxL),
      (maxX - minX + 1) * C.CELL_W, (maxL - minL + 1) * C.CELL_H);
    ctx.restore();
  }

  /* ---------------------------------------------------------------- ruler */

  function ruler(ctx, cv, s) {
    ctx.save();
    ctx.font = '9px ui-monospace, monospace';
    var z = R.cam.z;
    var l0 = Math.floor(-(R.cam.y + cv.height / 2 / z) / C.CELL_H) - 1;
    var l1 = Math.ceil(-(R.cam.y - cv.height / 2 / z) / C.CELL_H) + 1;
    ctx.fillStyle = 'rgba(8,11,18,0.72)';
    ctx.fillRect(0, 0, 34, cv.height);
    for (var l = Math.max(-C.MAX_DOWN, l0); l <= Math.min(C.MAX_UP, l1); l++) {
      var wy = R.cellY(l) + C.CELL_H / 2;
      var sy = (wy - R.cam.y) * z + cv.height / 2;
      if (sy < 8 || sy > cv.height - 4) continue;
      if (l % 2 !== 0 && z < 0.9) continue;
      ctx.fillStyle = l === 0 ? '#ffd479' : (l < 0 ? 'rgba(190,160,130,0.75)' : 'rgba(160,195,235,0.75)');
      ctx.fillText(l === 0 ? 'SURF' : (l > 0 ? '+' + l : String(l)), 3, sy + 3);
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------- minimap */

  function minimap(ctx, cv, s, ui) {
    var mw = 168, mh = 96, mx = cv.width - mw - 12, my = cv.height - mh - 12;
    if (cv.width < 620) return;
    ctx.save();
    ctx.fillStyle = 'rgba(8,11,18,0.82)';
    ctx.strokeStyle = 'rgba(120,150,190,0.35)';
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeRect(mx + 0.5, my + 0.5, mw, mh);

    var sx = mw / C.GRID_W;
    var levels = C.MAX_UP + C.MAX_DOWN + 1;
    var sy = mh / levels;
    var surfaceY = my + C.MAX_UP * sy;

    ctx.fillStyle = 'rgba(90,78,64,0.55)';
    ctx.fillRect(mx, surfaceY, mw, mh - (surfaceY - my));
    ctx.strokeStyle = 'rgba(230,200,150,0.5)';
    ctx.beginPath(); ctx.moveTo(mx, surfaceY); ctx.lineTo(mx + mw, surfaceY); ctx.stroke();

    for (var iid in s.inst) {
      var inst = s.inst[iid], m = LH.MOD[inst.mid];
      ctx.fillStyle = inst.dist === Infinity ? '#ff5555' : m.color;
      var py = my + (C.MAX_UP - inst.l1) * sy;
      ctx.fillRect(mx + inst.x * sx, py, Math.max(1, inst.w * sx), Math.max(1, (inst.l1 - inst.l0 + 1) * sy));
    }

    // viewport box
    var z = R.cam.z;
    var vx0 = (R.cam.x - cv.width / 2 / z) / C.CELL_W;
    var vx1 = (R.cam.x + cv.width / 2 / z) / C.CELL_W;
    var vl1 = -(R.cam.y - cv.height / 2 / z) / C.CELL_H;
    var vl0 = -(R.cam.y + cv.height / 2 / z) / C.CELL_H;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + vx0 * sx, my + (C.MAX_UP - vl1) * sy,
      (vx1 - vx0) * sx, (vl1 - vl0) * sy);
    ctx.restore();
    ui.minimapRect = { x: mx, y: my, w: mw, h: mh, sx: sx, sy: sy };
  }

  function flareWarning(ctx, cv, s) {
    var a = 0.25 + 0.25 * Math.sin(R.t * 4);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,120,60,' + a + ')';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, cv.width - 6, cv.height - 6);
    ctx.restore();
  }

})(window.LH);
