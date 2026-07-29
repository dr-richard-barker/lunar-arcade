/* Lunar Habitat — canvas renderer, v2.
   Everything is drawn procedurally at cell resolution 22×34 with per-module
   interior detail, animated machinery, parallax terrain and a live sky. */

(function (LH) {
  'use strict';

  var C = LH.C;

  var R = LH.R = {
    cam: { x: 0, y: 0, z: 1 },
    walkers: [],
    t: 0,
    dpr: 1
  };

  function hash(n) {
    n = (n << 13) ^ n;
    return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff;
  }

  function shade(hex, f) {
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    r = Math.max(0, Math.min(255, r * f)) | 0;
    g = Math.max(0, Math.min(255, g * f)) | 0;
    b = Math.max(0, Math.min(255, b * f)) | 0;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* world <-> grid ------------------------------------------------------- */
  R.cellX = function (x) { return x * C.CELL_W; };
  R.cellY = function (l) { return -(l + 1) * C.CELL_H; };

  R.screenToGrid = function (sx, sy, cv) {
    var wx = (sx - cv.width / 2) / R.cam.z + R.cam.x;
    var wy = (sy - cv.height / 2) / R.cam.z + R.cam.y;
    return { x: Math.floor(wx / C.CELL_W), l: Math.floor(-wy / C.CELL_H), wx: wx, wy: wy };
  };

  R.centreOn = function (x, l) {
    R.cam.x = x * C.CELL_W;
    R.cam.y = R.cellY(l) + C.CELL_H / 2;
  };

  R.clampCam = function (cv) {
    var halfW = cv.width / 2 / R.cam.z, halfH = cv.height / 2 / R.cam.z;
    var minX = -halfW * 0.3, maxX = C.GRID_W * C.CELL_W + halfW * 0.3;
    R.cam.x = Math.max(minX, Math.min(maxX, R.cam.x));
    var top = R.cellY(C.MAX_UP) - 260, bot = R.cellY(-C.MAX_DOWN - 1) + 260;
    R.cam.y = Math.max(top + halfH * 0.2, Math.min(bot - halfH * 0.2, R.cam.y));
  };

  /* ================================================================ DRAW */

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
      x0: Math.max(-4, Math.floor((R.cam.x - cv.width / 2 / z) / C.CELL_W) - 2),
      x1: Math.min(C.GRID_W + 4, Math.ceil((R.cam.x + cv.width / 2 / z) / C.CELL_W) + 2),
      l1: Math.min(C.MAX_UP + 2, Math.ceil(-(R.cam.y - cv.height / 2 / z) / C.CELL_H) + 2),
      l0: Math.max(-C.MAX_DOWN - 2, Math.floor(-(R.cam.y + cv.height / 2 / z) / C.CELL_H) - 2)
    };

    mountains(ctx, cv, sun, z);
    regolith(ctx, s, view, sun);
    if (ui.tool) grid(ctx, view);
    modules(ctx, s, view, sun, z);
    walkers(ctx, s, dt, view);
    ghost(ctx, s, ui);

    ctx.restore();

    ruler(ctx, cv, s);
    minimap(ctx, cv, s, ui);
    if (s.flare > 0) flareWarning(ctx, cv);
  };

  /* ================================================================= SKY */

  function sky(ctx, cv, s, sun) {
    var g = ctx.createLinearGradient(0, 0, 0, cv.height);
    g.addColorStop(0, '#03050c');
    g.addColorStop(0.55, sun > 0.2 ? '#0a1024' : '#05081a');
    g.addColorStop(1, sun > 0.2 ? '#18203a' : '#080c1c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);

    // faint galactic band
    ctx.save();
    ctx.globalAlpha = 0.05 * (1 - sun * 0.6);
    ctx.translate(cv.width * 0.5, cv.height * 0.3);
    ctx.rotate(-0.4);
    var mg = ctx.createLinearGradient(0, -70, 0, 70);
    mg.addColorStop(0, 'rgba(180,200,255,0)');
    mg.addColorStop(0.5, 'rgba(220,230,255,1)');
    mg.addColorStop(1, 'rgba(180,200,255,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(-cv.width, -70, cv.width * 2, 140);
    ctx.restore();

    // twinkling stars, two parallax layers
    var layers = [[0.04, 300, 1], [0.09, 140, 1.6]];
    ctx.save();
    for (var L = 0; L < 2; L++) {
      var par = layers[L][0], n = layers[L][1], sz = layers[L][2];
      var px = R.cam.x * par, py = R.cam.y * par;
      for (var i = 0; i < n; i++) {
        var seed = i * 7 + L * 971;
        var sx = (hash(seed + 1) * 4000 - px) % 4000; if (sx < 0) sx += 4000;
        var sy = (hash(seed + 2) * 2200 - py) % 2200; if (sy < 0) sy += 2200;
        if (sx > cv.width || sy > cv.height) continue;
        var tw = 0.55 + 0.45 * Math.sin(R.t * (0.5 + hash(seed + 4) * 2) + hash(seed + 5) * 9);
        ctx.globalAlpha = (0.2 + hash(seed + 3) * 0.8) * tw * (1 - sun * 0.35);
        ctx.fillStyle = hash(seed + 6) > 0.85 ? '#ffe9c8' : '#dfe8ff';
        ctx.fillRect(sx, sy, sz, sz);
      }
    }
    ctx.restore();

    earth(ctx, cv, s, sun);
    sunDisc(ctx, cv, s, sun);
  }

  function earth(ctx, cv, s, sun) {
    var ex = cv.width * 0.8 - R.cam.x * 0.015, ey = cv.height * 0.16 - R.cam.y * 0.015;
    var er = Math.min(46, cv.width * 0.045);
    var phase = ((s.day - 1) % C.LUNAR_CYCLE) / C.LUNAR_CYCLE;

    var halo = ctx.createRadialGradient(ex, ey, er * 0.8, ex, ey, er * 1.6);
    halo.addColorStop(0, 'rgba(90,150,255,0.22)');
    halo.addColorStop(1, 'rgba(90,150,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(ex - er * 2, ey - er * 2, er * 4, er * 4);

    ctx.save();
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.clip();
    var og = ctx.createRadialGradient(ex - er * 0.4, ey - er * 0.4, er * 0.2, ex, ey, er * 1.4);
    og.addColorStop(0, '#3d7ec4'); og.addColorStop(0.6, '#16406f'); og.addColorStop(1, '#0a1e3c');
    ctx.fillStyle = og; ctx.fillRect(ex - er, ey - er, er * 2, er * 2);
    ctx.fillStyle = '#3e7a4b';
    for (var c = 0; c < 9; c++) {
      var cx = ex - er + hash(c * 7 + 11) * er * 2;
      var cy = ey - er + hash(c * 7 + 13) * er * 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 4 + hash(c * 7 + 17) * er * 0.4, 3 + hash(c * 7 + 19) * er * 0.25, hash(c) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (var w = 0; w < 10; w++) {
      var wx = ex - er + ((hash(w * 5 + 31) * er * 2) + R.t * 0.8 + w) % (er * 2);
      var wy = ey - er + hash(w * 5 + 37) * er * 2;
      ctx.beginPath();
      ctx.ellipse(wx, wy, 3 + hash(w * 5 + 41) * er * 0.28, 1.5 + hash(w * 5 + 43) * er * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // terminator — Earth's phase opposes the Moon's
    var edge = 1 - phase;
    var sh = ctx.createLinearGradient(ex - er, 0, ex + er, 0);
    sh.addColorStop(0, 'rgba(2,4,12,0)');
    sh.addColorStop(Math.max(0.01, Math.min(0.98, edge - 0.15)), 'rgba(2,4,12,0)');
    sh.addColorStop(Math.max(0.02, Math.min(0.99, edge + 0.1)), 'rgba(2,4,12,0.92)');
    sh.addColorStop(1, 'rgba(2,4,12,0.92)');
    ctx.fillStyle = sh; ctx.fillRect(ex - er, ey - er, er * 2, er * 2);
    ctx.restore();
  }

  function sunDisc(ctx, cv, s, sun) {
    if (sun <= 0.02) return;
    var phase = ((s.day - 1) % C.LUNAR_CYCLE) / C.LUNAR_CYCLE;
    var sx = cv.width * (0.06 + phase * 1.75);
    var sy = cv.height * (0.36 - Math.sin(phase * Math.PI * 2) * 0.22);
    var core = ctx.createRadialGradient(sx, sy, 1, sx, sy, 120);
    core.addColorStop(0, 'rgba(255,252,235,' + sun + ')');
    core.addColorStop(0.08, 'rgba(255,246,200,' + 0.9 * sun + ')');
    core.addColorStop(0.25, 'rgba(255,225,160,' + 0.32 * sun + ')');
    core.addColorStop(1, 'rgba(255,215,150,0)');
    ctx.fillStyle = core;
    ctx.fillRect(sx - 130, sy - 130, 260, 260);
    // no atmosphere: hard diffraction spikes
    ctx.save();
    ctx.strokeStyle = 'rgba(255,248,220,' + 0.5 * sun + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 60, sy); ctx.lineTo(sx + 60, sy);
    ctx.moveTo(sx, sy - 44); ctx.lineTo(sx, sy + 44);
    ctx.stroke();
    ctx.restore();
  }

  /* distant crater rim, two parallax silhouettes (world space) */
  function mountains(ctx, cv, sun, z) {
    var layers = [[0.25, -150, '#1b1712', 46], [0.5, -70, '#25201a', 30]];
    for (var L = 0; L < 2; L++) {
      var par = layers[L][0], base = layers[L][1], col = layers[L][2], amp = layers[L][3];
      var off = R.cam.x * (1 - par);
      ctx.fillStyle = shade(col, 0.5 + sun * 0.9);
      ctx.beginPath();
      var x0 = R.cam.x - cv.width / 2 / z - 50, x1 = R.cam.x + cv.width / 2 / z + 50;
      ctx.moveTo(x0, 0);
      for (var x = x0; x <= x1; x += 26) {
        var n = (x - off) * 0.011;
        var h = base - (Math.sin(n) * 0.5 + Math.sin(n * 2.7 + 1.7) * 0.3 + Math.sin(n * 6.1) * 0.2) * amp;
        ctx.lineTo(x, h);
      }
      ctx.lineTo(x1, 0);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ============================================================ REGOLITH */

  function regolith(ctx, s, view, sun) {
    var x0 = R.cellX(view.x0) - 500, x1 = R.cellX(view.x1) + 500;
    var bot = R.cellY(-C.MAX_DOWN - 1) + 300;
    var tone = 0.45 + sun * 0.55;

    var g = ctx.createLinearGradient(0, 0, 0, bot);
    g.addColorStop(0, shade('#6d6356', tone));
    g.addColorStop(0.2, shade('#574e44', tone * 0.94));
    g.addColorStop(0.55, shade('#443c34', tone * 0.88));
    g.addColorStop(1, shade('#2a251f', tone * 0.82));
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, x1 - x0, bot);

    // strata bands
    ctx.save();
    for (var l = -2; l >= -C.MAX_DOWN - 1; l -= 2) {
      var y = R.cellY(l);
      ctx.globalAlpha = 0.05 + hash(l * 17) * 0.06;
      ctx.fillStyle = hash(l * 31) > 0.5 ? '#000' : '#fff';
      ctx.fillRect(x0, y, x1 - x0, C.CELL_H * (1 + Math.floor(hash(l * 7) * 2)));
    }
    ctx.restore();

    // buried clasts
    ctx.save();
    for (var i = 0; i < 500; i++) {
      var px = hash(i * 5 + 1) * C.GRID_W * C.CELL_W;
      var py = hash(i * 5 + 2) * (bot - 8) + 4;
      if (px < R.cellX(view.x0) - 60 || px > R.cellX(view.x1) + 60) continue;
      ctx.globalAlpha = 0.16;
      var r = 1.5 + hash(i * 5 + 4) * 5;
      ctx.fillStyle = hash(i * 5 + 3) > 0.5 ? '#93877a' : '#221d18';
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      if (hash(i * 5 + 3) > 0.5) {
        ctx.globalAlpha = 0.1 * tone;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(px - r * 0.25, py - r * 0.3, r * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    // excavated voids: rough-hewn chambers
    for (var k in s.dug) {
      var p = k.split(','), cx = +p[0], cl = +p[1];
      if (cx < view.x0 || cx > view.x1 || cl < view.l0 || cl > view.l1) continue;
      var vx = R.cellX(cx), vy = R.cellY(cl);
      ctx.fillStyle = '#161210';
      ctx.fillRect(vx, vy, C.CELL_W, C.CELL_H);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#2c251f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var m2 = 0; m2 < 3; m2++) {
        var mx = vx + hash(cx * 91 + cl * 57 + m2) * C.CELL_W;
        ctx.moveTo(mx, vy + 2);
        ctx.lineTo(mx - 3, vy + C.CELL_H - 3);
      }
      ctx.stroke();
      ctx.restore();
    }

    // the surface: bright rim, dust drifts, craters
    ctx.strokeStyle = shade('#a89a89', tone);
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x0, -1); ctx.lineTo(x1, -1); ctx.stroke();

    ctx.save();
    for (var cI = 0; cI < 70; cI++) {
      var ccx = hash(cI * 11 + 3) * C.GRID_W * C.CELL_W;
      if (ccx < R.cellX(view.x0) - 120 || ccx > R.cellX(view.x1) + 120) continue;
      var cr = 8 + hash(cI * 11 + 5) * 34;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = shade('#8d8172', tone);
      ctx.beginPath(); ctx.ellipse(ccx, -1, cr, cr * 0.2, 0, Math.PI, 0); ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = shade('#3d362e', tone);
      ctx.beginPath(); ctx.ellipse(ccx, 0, cr * 0.7, cr * 0.13, 0, 0, Math.PI); ctx.fill();
    }
    ctx.restore();
  }

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

  /* ============================================================= MODULES */

  function modules(ctx, s, view, sun, z) {
    for (var iid in s.inst) {
      var inst = s.inst[iid], m = LH.MOD[inst.mid];
      if (inst.x + inst.w < view.x0 || inst.x > view.x1) continue;
      if (inst.l1 < view.l0 || inst.l0 > view.l1) continue;
      drawModule(ctx, s, inst, m, sun, z);
    }
  }

  function paintHull(ctx, x, y, w, h, base, lit, sun) {
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(base, (0.72 + sun * 0.18) * lit));
    g.addColorStop(0.5, shade(base, (0.56 + sun * 0.16) * lit));
    g.addColorStop(1, shade(base, (0.4 + sun * 0.12) * lit));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,' + 0.2 * lit + ')';
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y, 2, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillRect(x + w - 2, y, 2, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var sx = x + C.CELL_W; sx < x + w - 2; sx += C.CELL_W) {
      ctx.moveTo(sx + 0.5, y + 2); ctx.lineTo(sx + 0.5, y + h - 2);
    }
    ctx.stroke();
  }

  function floorAndCeil(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 2, y + h - 5, w - 4, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 2, y + 2, w - 4, 2);
  }

  function person(ctx, px, py, tint, t, moving) {
    var bob = moving ? Math.sin(t * 9 + px) * 0.7 : 0;
    ctx.fillStyle = tint;
    ctx.fillRect(px, py - 5 + bob, 2, 5);
    ctx.fillStyle = '#f2d9b8';
    ctx.fillRect(px, py - 7 + bob, 2, 2);
  }

  function led(ctx, x, y, col, on) {
    ctx.fillStyle = on ? col : '#333';
    ctx.fillRect(x, y, 2, 2);
    if (on) {
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = col;
      ctx.fillRect(x - 1, y - 1, 4, 4); ctx.restore();
    }
  }

  /* ---- per-module interiors -------------------------------------------- */

  var PAINTERS = {

    corridor: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = on ? 'rgba(255,244,214,0.5)' : 'rgba(120,120,120,0.15)';
      ctx.fillRect(x + w * 0.25, y + 4, w * 0.5, 2);
      if (hash(i.x * 13) > 0.6) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.moveTo(x + 2, y + 9); ctx.lineTo(x + w - 2, y + 9); ctx.stroke();
      }
    },

    ladder: function (ctx, i, x, y, w, h) {
      ctx.strokeStyle = 'rgba(20,24,30,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.35, y); ctx.lineTo(x + w * 0.35, y + h);
      ctx.moveTo(x + w * 0.65, y); ctx.lineTo(x + w * 0.65, y + h);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var ry = y + 4; ry < y + h - 2; ry += 6) {
        ctx.moveTo(x + w * 0.35, ry); ctx.lineTo(x + w * 0.65, ry);
      }
      ctx.stroke();
    },

    lift: function (ctx, i, x, y, w, h, on, t, m) {
      var express = m.id === 'express';
      ctx.strokeStyle = express ? 'rgba(150,220,255,0.5)' : 'rgba(10,14,20,0.5)';
      ctx.lineWidth = express ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 4.5, y); ctx.lineTo(x + 4.5, y + h);
      ctx.moveTo(x + w - 4.5, y); ctx.lineTo(x + w - 4.5, y + h);
      ctx.stroke();
      if (on && h > C.CELL_H) {
        var span = h - C.CELL_H;
        var ph = (t * (express ? 0.38 : 0.15) + i.seed * 10) % 2;
        var f = ph > 1 ? 2 - ph : ph;
        var cy = y + f * span;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, cy + 3); ctx.stroke();
        ctx.fillStyle = express ? '#2a3648' : '#333d4c';
        ctx.fillRect(x + 3, cy + 3, w - 6, C.CELL_H - 8);
        ctx.fillStyle = express ? 'rgba(255,233,168,0.9)' : 'rgba(207,230,255,0.85)';
        ctx.fillRect(x + 5, cy + 6, w - 10, C.CELL_H * 0.4);
        person(ctx, x + w / 2 - 1, cy + C.CELL_H - 7, '#8fa8c8', t, false);
      }
    },

    airlock: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = '#39434f';
      ctx.fillRect(x + 4, y + 6, 7, h - 11);
      ctx.fillRect(x + w - 11, y + 6, 7, h - 11);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.strokeRect(x + 4.5, y + 6.5, 6, h - 12);
      ctx.strokeRect(x + w - 10.5, y + 6.5, 6, h - 12);
      ctx.fillStyle = 'rgba(255,200,80,0.2)';
      ctx.fillRect(x + 13, y + 6, w - 26, h - 11);
      person(ctx, x + w / 2 - 4, y + h - 6, '#e8ecf2', 0, false);
      led(ctx, x + w / 2, y + 4, '#7fe6c0', on && (t % 1.2) < 0.6);
    },

    pad: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x + 2, y + h - 8, w - 4, 6);
      ctx.strokeStyle = 'rgba(255,214,120,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h - 9, Math.min(w, h) * 0.2, 0, Math.PI * 2);
      ctx.stroke();
      for (var b = 0; b < 6; b++) {
        var bx = x + 4 + b * (w - 10) / 5;
        led(ctx, bx, y + h - 5, '#ffca5a', on && ((t * 3 + b) % 6 < 1));
      }
      // lander cycle: descend → sit → ascend
      if (on) {
        var cyc = (t * 0.07 + i.seed) % 1;
        var ly = null, flame = false;
        if (cyc < 0.22) { ly = (0.22 - cyc) / 0.22; flame = true; }
        else if (cyc < 0.5) { ly = 0; }
        else if (cyc < 0.72) { ly = (cyc - 0.5) / 0.22; flame = true; }
        if (ly !== null) {
          var lx = x + w / 2, lyy = y + h - 12 - ly * (h + 90);
          ctx.fillStyle = '#c8cfd8';
          ctx.beginPath();
          ctx.moveTo(lx - 6, lyy); ctx.lineTo(lx + 6, lyy);
          ctx.lineTo(lx + 4, lyy - 9); ctx.lineTo(lx - 4, lyy - 9);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#2c3440';
          ctx.fillRect(lx - 2, lyy - 7, 4, 3);
          ctx.strokeStyle = '#98a2ae';
          ctx.beginPath();
          ctx.moveTo(lx - 6, lyy); ctx.lineTo(lx - 8, lyy + 4);
          ctx.moveTo(lx + 6, lyy); ctx.lineTo(lx + 8, lyy + 4);
          ctx.stroke();
          if (flame) {
            ctx.fillStyle = 'rgba(180,220,255,' + (0.5 + 0.4 * Math.sin(t * 30)) + ')';
            ctx.beginPath();
            ctx.moveTo(lx - 3, lyy + 1); ctx.lineTo(lx + 3, lyy + 1); ctx.lineTo(lx, lyy + 8 + Math.sin(t * 21) * 2);
            ctx.closePath(); ctx.fill();
          }
        }
      }
    },

    shield: function (ctx, i, x, y, w, h) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      for (var r = 0; r < 3; r++) {
        ctx.fillRect(x + 2, y + 4 + r * (h - 8) / 3, w - 4, 1.5);
      }
      for (var bx = 0; bx < w - 6; bx += 8) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x + 3 + bx + (Math.floor(bx / 8) % 2) * 3, y + 5, 5, 2);
      }
    },

    solar: function (ctx, i, x, y, w, h, on, t, m, s, sun) {
      ctx.fillStyle = '#1c2740';
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 8); ctx.lineTo(x + w - 3, y + 4);
      ctx.lineTo(x + w - 3, y + h * 0.6); ctx.lineTo(x + 3, y + h * 0.64);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,170,255,0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (var gx = x + 8; gx < x + w - 4; gx += 7) {
        ctx.moveTo(gx, y + 7 - (gx - x) * 0.02); ctx.lineTo(gx, y + h * 0.62);
      }
      ctx.moveTo(x + 3, y + h * 0.3); ctx.lineTo(x + w - 3, y + h * 0.26);
      ctx.stroke();
      if (sun > 0.05 && on) {
        ctx.save();
        ctx.globalAlpha = 0.25 * sun;
        var ph2 = (t * 0.05 + i.seed) % 1;
        var sg = ctx.createLinearGradient(x, y, x + w, y);
        sg.addColorStop(Math.max(0, ph2 - 0.08), 'rgba(255,255,255,0)');
        sg.addColorStop(ph2, 'rgba(255,255,255,0.9)');
        sg.addColorStop(Math.min(1, ph2 + 0.08), 'rgba(255,255,255,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(x + 3, y + 4, w - 6, h * 0.6);
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.25, y + h * 0.63); ctx.lineTo(x + w * 0.25, y + h - 3);
      ctx.moveTo(x + w * 0.75, y + h * 0.6); ctx.lineTo(x + w * 0.75, y + h - 3);
      ctx.stroke();
      if (i.dust > 0.05) {
        ctx.fillStyle = 'rgba(150,132,105,' + i.dust * 0.9 + ')';
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 8); ctx.lineTo(x + w - 3, y + 4);
        ctx.lineTo(x + w - 3, y + h * 0.6); ctx.lineTo(x + 3, y + h * 0.64);
        ctx.closePath(); ctx.fill();
      }
    },

    battery: function (ctx, i, x, y, w, h, on, t, m, s) {
      var fill = s.stats.powerCap > 0 ? s.res.power / s.stats.powerCap : 0;
      for (var c = 0; c < 3; c++) {
        var bx = x + 4 + c * (w - 8) / 3;
        var bw = (w - 8) / 3 - 3;
        ctx.fillStyle = '#20262e';
        ctx.fillRect(bx, y + 6, bw, h - 12);
        var fh = (h - 16) * Math.max(0, Math.min(1, fill * 3 - c));
        ctx.fillStyle = fill > 0.35 ? '#5fd48a' : '#ffb648';
        ctx.fillRect(bx + 2, y + h - 8 - fh, bw - 4, fh);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(bx + bw / 2 - 2, y + 4, 4, 2);
      }
    },

    rtg: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = '#3a3128';
      ctx.fillRect(x + w * 0.3, y + 6, w * 0.4, h - 12);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      for (var f = 0; f < 5; f++) {
        var fy = y + 8 + f * (h - 16) / 4;
        ctx.moveTo(x + 3, fy); ctx.lineTo(x + w - 3, fy);
      }
      ctx.stroke();
      var pulse = 0.4 + 0.25 * Math.sin(t * 1.2);
      ctx.fillStyle = 'rgba(255,140,50,' + pulse + ')';
      ctx.fillRect(x + w * 0.42, y + h * 0.35, w * 0.16, h * 0.3);
    },

    fission: function (ctx, i, x, y, w, h, on, t) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,210,60,0.5)';
      for (var cx2 = x + 3; cx2 < x + w - 8; cx2 += 12) {
        ctx.beginPath();
        ctx.moveTo(cx2, y + h - 4); ctx.lineTo(cx2 + 5, y + h - 4);
        ctx.lineTo(cx2 + 9, y + h - 9); ctx.lineTo(cx2 + 4, y + h - 9);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = '#2a2f38';
      ctx.beginPath(); ctx.arc(x + w / 2, y + h * 0.42, h * 0.28, 0, Math.PI * 2); ctx.fill();
      var pulse2 = on ? 0.45 + 0.35 * Math.sin(t * 2.4 + i.seed * 6) : 0.08;
      ctx.fillStyle = 'rgba(140,240,255,' + pulse2 + ')';
      ctx.beginPath(); ctx.arc(x + w / 2, y + h * 0.42, h * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(200,230,255,0.35)';
      ctx.beginPath(); ctx.arc(x + w / 2, y + h * 0.42, h * 0.28, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#454e5a';
      for (var rr = 0; rr < 3; rr++) {
        var rx = x + w / 2 - 8 + rr * 8;
        ctx.fillRect(rx, y + 4 + Math.sin(t * 0.7 + rr) * 1.5, 3, 8);
      }
    },

    scrubber: function (ctx, i, x, y, w, h, on, t) {
      for (var tk = 0; tk < 2; tk++) {
        var tx = x + w * (0.22 + tk * 0.36);
        ctx.fillStyle = '#1f3a34';
        ctx.fillRect(tx, y + 8, w * 0.22, h - 15);
        if (on) {
          for (var b = 0; b < 3; b++) {
            var by = y + h - 10 - ((t * 9 + b * 9 + tk * 5 + i.seed * 20) % (h - 22));
            ctx.fillStyle = 'rgba(150,255,220,0.5)';
            ctx.fillRect(tx + 3 + b * 4, by, 2, 2);
          }
        }
      }
      ctx.strokeStyle = 'rgba(90,200,170,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 3, y + 7); ctx.lineTo(x + w - 3, y + 7); ctx.stroke();
      led(ctx, x + w - 7, y + 11, '#49c1a0', on && (t % 1.6) < 1.1);
    },

    recycler: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = '#152b38';
      ctx.fillRect(x + 5, y + 9, w - 10, h * 0.45);
      if (on) {
        ctx.fillStyle = 'rgba(80,190,230,0.55)';
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 9 + h * 0.2 + Math.sin(t * 2) * 1.5);
        for (var sx = 0; sx <= w - 10; sx += 5) {
          ctx.lineTo(x + 5 + sx, y + 9 + h * 0.2 + Math.sin(t * 2 + sx * 0.3) * 1.5);
        }
        ctx.lineTo(x + w - 5, y + 9 + h * 0.45); ctx.lineTo(x + 5, y + 9 + h * 0.45);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(80,190,230,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + 9 + h * 0.45); ctx.lineTo(x + w * 0.3, y + h - 5);
      ctx.moveTo(x + w * 0.7, y + 9 + h * 0.45); ctx.lineTo(x + w * 0.7, y + h - 5);
      ctx.stroke();
      led(ctx, x + 7, y + 5, '#3fa8c4', on);
    },

    hydro: function (ctx, i, x, y, w, h, on, t) {
      if (on) {
        ctx.fillStyle = 'rgba(255,110,220,0.22)';
        ctx.fillRect(x + 3, y + 4, w - 6, h - 9);
        ctx.fillStyle = 'rgba(255,140,235,0.85)';
        ctx.fillRect(x + 5, y + 4, w - 10, 2);
      }
      for (var shelf = 0; shelf < 2; shelf++) {
        var sy = y + h * (0.5 + shelf * 0.3);
        ctx.fillStyle = '#2c2c34';
        ctx.fillRect(x + 4, sy, w - 8, 2);
        for (var p2 = x + 8; p2 < x + w - 6; p2 += 7) {
          var sway = Math.sin(t * 1.3 + p2 * 0.5) * 1;
          ctx.strokeStyle = '#3f9950';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p2, sy); ctx.quadraticCurveTo(p2 + sway, sy - 4, p2 + sway, sy - 7);
          ctx.stroke();
          ctx.fillStyle = on ? '#6fd97f' : '#3d6b45';
          ctx.fillRect(p2 + sway - 1.5, sy - 9, 4, 3);
        }
      }
    },

    pod: function (ctx, i, x, y, w, h, on, t) {
      for (var tier = 0; tier < 2; tier++) {
        var by = y + h * (0.42 + tier * 0.26);
        ctx.fillStyle = '#2e3d52';
        ctx.fillRect(x + 5, by, w * 0.4, 3);
        ctx.fillStyle = '#c9d4e2';
        ctx.fillRect(x + 6, by - 2, 6, 2);
      }
      var glow = on ? 0.35 + 0.3 * (hash(i.iid * 7) > 0.5 ? 1 : Math.sin(t * 0.4 + i.seed * 9) * 0.5 + 0.5) : 0.05;
      ctx.fillStyle = 'rgba(255,236,190,' + glow + ')';
      ctx.beginPath(); ctx.arc(x + w * 0.75, y + h * 0.4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(x + w * 0.75, y + h * 0.4, 5, 0, Math.PI * 2); ctx.stroke();
      if (on && i.occCap > 3) person(ctx, x + w * 0.68, y + h - 5, '#cfe4ff', t, false);
    },

    block: function (ctx, i, x, y, w, h, on, t) {
      var cols = Math.floor((w - 8) / 9);
      for (var c = 0; c < cols; c++) {
        for (var r = 0; r < 2; r++) {
          var wx = x + 5 + c * 9, wy = y + 5 + r * (h - 14) / 2;
          var lit2 = on && hash(i.iid * 31 + c * 7 + r * 3) > 0.35;
          var warm = hash(i.iid * 13 + c * 5 + r) > 0.5;
          ctx.fillStyle = lit2 ? (warm ? 'rgba(255,224,170,0.8)' : 'rgba(190,225,255,0.7)') : 'rgba(20,26,36,0.8)';
          ctx.fillRect(wx, wy, 6, (h - 16) / 2 - 2);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 3, y + h / 2 - 1, w - 6, 1.5);
    },

    hotel: function (ctx, i, x, y, w, h, on, t) {
      PAINTERS.block(ctx, i, x, y, w, h, on, t);
      ctx.fillStyle = on ? '#ffd579' : '#665533';
      ctx.font = 'bold 8px ui-monospace, monospace';
      ctx.fillText('H', x + 4, y + 10);
    },

    suite: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = on ? 'rgba(255,240,205,0.3)' : 'rgba(120,140,170,0.12)';
      ctx.fillRect(x + 4, y + 5, w - 8, h - 12);
      ctx.strokeStyle = 'rgba(200,225,255,0.35)';
      ctx.strokeRect(x + 4.5, y + 5.5, w - 9, h - 13);
      led(ctx, x + w / 2, y + 7, '#ffe9b0', on);
      ctx.fillStyle = '#3f9950';
      ctx.fillRect(x + 7, y + h - 12, 3, 6);
      ctx.fillStyle = '#57406b';
      ctx.fillRect(x + w - 22, y + h - 9, 14, 4);
      if (on) person(ctx, x + w - 16, y + h - 9, '#ffd9a0', t, false);
    },

    admin: function (ctx, i, x, y, w, h, on, t) {
      for (var d = 0; d < Math.floor(w / 22); d++) {
        var dx = x + 6 + d * 22;
        ctx.fillStyle = '#3a3430';
        ctx.fillRect(dx, y + h - 11, 13, 2);
        ctx.fillStyle = on && (Math.sin(t * 3 + d * 2) > -0.7) ? 'rgba(140,220,255,0.85)' : '#1c2026';
        ctx.fillRect(dx + 2, y + h - 17, 6, 5);
        if (on) person(ctx, dx + 10, y + h - 11, '#c8a0a0', t, false);
      }
    },

    lab: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = '#3a3430';
      ctx.fillRect(x + 5, y + h - 10, w - 10, 2);
      var cols2 = ['#7fd9a0', '#d97fd0', '#7fb0d9'];
      for (var f2 = 0; f2 < 3; f2++) {
        var fx = x + 8 + f2 * 10;
        ctx.fillStyle = cols2[f2];
        ctx.globalAlpha = on ? 0.85 : 0.3;
        ctx.fillRect(fx, y + h - 16, 3, 6);
        ctx.globalAlpha = 1;
      }
      if (on) {
        ctx.fillStyle = '#101c14';
        ctx.fillRect(x + w - 22, y + h - 20, 15, 9);
        ctx.strokeStyle = '#5fd48a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var ox = 0; ox < 13; ox++) {
          var oy = Math.sin(t * 6 + ox * 0.9) * 2.5;
          ctx[ox ? 'lineTo' : 'moveTo'](x + w - 21 + ox, y + h - 15 + oy);
        }
        ctx.stroke();
        person(ctx, x + w * 0.5, y + h - 10, '#e8e8f2', t, false);
      }
    },

    fab: function (ctx, i, x, y, w, h, on, t) {
      var ax = x + w * 0.3, ay = y + h - 8;
      var a1 = on ? Math.sin(t * 1.6 + i.seed * 5) * 0.6 - 0.9 : -0.9;
      var ex2 = ax + Math.cos(a1) * 12, ey2 = ay + Math.sin(a1) * 12;
      ctx.strokeStyle = '#8a94a2';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex2, ey2); ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(ex2, ey2); ctx.lineTo(ex2 + 6, ey2 + 3); ctx.stroke();
      if (on && Math.sin(t * 11) > 0.8) {
        ctx.fillStyle = '#fff3c8';
        ctx.fillRect(ex2 + 5, ey2 + 2, 2, 2);
      }
      ctx.fillStyle = '#23282f';
      ctx.fillRect(x + w * 0.5, y + h - 9, w * 0.42, 3);
      if (on) {
        for (var cvx = 0; cvx < 3; cvx++) {
          var px2 = x + w * 0.5 + ((t * 8 + cvx * 12) % (w * 0.42));
          ctx.fillStyle = '#b3603f';
          ctx.fillRect(px2, y + h - 12, 4, 3);
        }
      }
    },

    refinery: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = '#33302c';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.22, y + h * 0.35);
      ctx.lineTo(x + w * 0.42, y + h * 0.35);
      ctx.lineTo(x + w * 0.38, y + h * 0.7);
      ctx.lineTo(x + w * 0.26, y + h * 0.7);
      ctx.closePath(); ctx.fill();
      if (on) {
        var mg2 = 0.55 + 0.3 * Math.sin(t * 3.1);
        ctx.fillStyle = 'rgba(255,150,50,' + mg2 + ')';
        ctx.fillRect(x + w * 0.26, y + h * 0.38, w * 0.13, 4);
        ctx.fillStyle = 'rgba(255,190,80,0.75)';
        ctx.fillRect(x + w * 0.31, y + h * 0.7, 2.5, h * 0.2);
      }
      var gx2 = x + w * 0.72, gy = y + h * 0.5, gr = h * 0.2;
      ctx.strokeStyle = '#6d6258';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx2, gy, gr, 0, Math.PI * 2); ctx.stroke();
      var rot = on ? t * 0.9 : 0;
      ctx.beginPath();
      for (var sp = 0; sp < 4; sp++) {
        var an = rot + sp * Math.PI / 2;
        ctx.moveTo(gx2, gy);
        ctx.lineTo(gx2 + Math.cos(an) * gr, gy + Math.sin(an) * gr);
      }
      ctx.stroke();
    },

    comms: function (ctx, i, x, y, w, h, on, t) {
      var dx2 = x + w / 2, dy = y + 2;
      var nod = on ? Math.sin(t * 0.5) * 0.15 : 0;
      ctx.save();
      ctx.translate(dx2, dy);
      ctx.rotate(-0.5 + nod);
      ctx.strokeStyle = '#cfd9e6';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 9, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -7); ctx.stroke();
      ctx.restore();
      led(ctx, dx2, dy - 8, '#ff6b6b', on && (t % 0.9) < 0.45);
      for (var sc = 0; sc < Math.floor(w / 12); sc++) {
        ctx.fillStyle = on && hash(sc * 5 + Math.floor(t)) > 0.3 ? 'rgba(120,220,190,0.7)' : '#1a2026';
        ctx.fillRect(x + 5 + sc * 12, y + h - 14, 8, 6);
      }
    },

    mine: function (ctx, i, x, y, w, h, on, t, m) {
      var ice = m.id === 'icemine';
      ctx.fillStyle = ice ? 'rgba(70,100,120,0.35)' : 'rgba(40,30,22,0.45)';
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      ctx.strokeStyle = '#6d5c48';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var bm = 0; bm < Math.floor(w / 24) + 1; bm++) {
        var bx2 = x + 8 + bm * 24;
        ctx.moveTo(bx2, y + 3); ctx.lineTo(bx2, y + h - 3);
        ctx.moveTo(bx2 - 4, y + 5); ctx.lineTo(bx2 + 4, y + 5);
      }
      ctx.stroke();
      for (var g2 = 0; g2 < 5; g2++) {
        var gx3 = x + 6 + hash(i.iid * 17 + g2) * (w - 12);
        var gy2 = y + 8 + hash(i.iid * 29 + g2) * (h - 16);
        ctx.fillStyle = ice ? 'rgba(170,220,255,0.8)' : 'rgba(212,175,55,0.75)';
        ctx.fillRect(gx3, gy2, 3, 3);
      }
      ctx.fillStyle = '#1d2126';
      ctx.fillRect(x + 4, y + h - 8, w - 8, 3);
      if (on) {
        for (var lump = 0; lump < 4; lump++) {
          var lx2 = x + 4 + ((t * 10 + lump * 15 + i.seed * 30) % (w - 10));
          ctx.fillStyle = ice ? '#b8dcf0' : '#a2795f';
          ctx.fillRect(lx2, y + h - 11, 4, 3);
        }
        var drx = x + w - 9, dry = y + h * 0.4;
        ctx.fillStyle = '#8a94a2';
        ctx.fillRect(drx - 6, dry - 2, 8, 4);
        ctx.fillStyle = '#c8ccd4';
        var spin = Math.floor(t * 12) % 2;
        ctx.beginPath();
        ctx.moveTo(drx + 2, dry - 3 + spin);
        ctx.lineTo(drx + 7, dry);
        ctx.lineTo(drx + 2, dry + 3 - spin);
        ctx.closePath(); ctx.fill();
      }
    },

    he3: function (ctx, i, x, y, w, h, on, t) {
      var dx3 = x + w * 0.25, dy2 = y + h - 9;
      ctx.fillStyle = '#4a423a';
      ctx.beginPath(); ctx.arc(dx3, dy2, 6, 0, Math.PI * 2); ctx.fill();
      if (on) {
        ctx.strokeStyle = '#c8b06a';
        var rot2 = t * 3;
        ctx.beginPath();
        for (var v = 0; v < 3; v++) {
          var an2 = rot2 + v * Math.PI * 2 / 3;
          ctx.moveTo(dx3, dy2);
          ctx.lineTo(dx3 + Math.cos(an2) * 6, dy2 + Math.sin(an2) * 6);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(220,190,110,0.35)';
        for (var pd = 0; pd < 4; pd++) {
          var pxx = dx3 + 8 + ((t * 6 + pd * 5) % 16);
          ctx.fillRect(pxx, dy2 - 4 - pd * 2, 2, 2);
        }
      }
      ctx.fillStyle = '#5a5248';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.55, y + 8); ctx.lineTo(x + w * 0.85, y + 8);
      ctx.lineTo(x + w * 0.78, y + h - 6); ctx.lineTo(x + w * 0.62, y + h - 6);
      ctx.closePath(); ctx.fill();
    },

    core: function (ctx, i, x, y, w, h, on, t) {
      PAINTERS.mine(ctx, i, x, y, w, h, on, t, { id: 'mine' });
      var bx3 = x + w * 0.5, by2 = y + h * 0.45, br = h * 0.26;
      ctx.strokeStyle = '#a8946c';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(bx3, by2, br, 0, Math.PI * 2); ctx.stroke();
      var rot3 = on ? t * 0.7 : 0;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var sp2 = 0; sp2 < 6; sp2++) {
        var an3 = rot3 + sp2 * Math.PI / 3;
        ctx.moveTo(bx3, by2);
        ctx.lineTo(bx3 + Math.cos(an3) * br, by2 + Math.sin(an3) * br);
      }
      ctx.stroke();
    },

    mess: function (ctx, i, x, y, w, h, on, t) {
      for (var tb = 0; tb < Math.floor(w / 24); tb++) {
        var tx2 = x + 8 + tb * 24;
        ctx.fillStyle = '#4a4038';
        ctx.fillRect(tx2, y + h - 10, 14, 2);
        ctx.fillRect(tx2 + 6, y + h - 8, 2, 4);
        if (on) {
          person(ctx, tx2 + 2, y + h - 10, '#cfe4ff', t, false);
          person(ctx, tx2 + 11, y + h - 10, '#ffd9a0', t, false);
        }
        led(ctx, tx2 + 7, y + 5, '#ffdf9e', on);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.moveTo(tx2 + 8, y + 2); ctx.lineTo(tx2 + 8, y + 5); ctx.stroke();
      }
    },

    med: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      ctx.fillStyle = '#e05a5a';
      ctx.fillRect(x + w - 13, y + 4, 8, 3);
      ctx.fillRect(x + w - 10.5, y + 1.5, 3, 8);
      ctx.fillStyle = '#d8dde4';
      ctx.fillRect(x + 5, y + h - 10, 15, 3);
      ctx.fillStyle = '#8fb8d8';
      ctx.fillRect(x + 7, y + h - 12, 9, 2);
      if (on) {
        ctx.fillStyle = '#101c14';
        ctx.fillRect(x + 23, y + h - 18, 12, 8);
        ctx.strokeStyle = '#6fd98a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        var beat = (t * 2) % 1;
        for (var ox2 = 0; ox2 < 10; ox2++) {
          var f3 = ox2 / 10;
          var spike = Math.abs(f3 - beat) < 0.08 ? -3 : 0;
          ctx[ox2 ? 'lineTo' : 'moveTo'](x + 24 + ox2, y + h - 14 + spike);
        }
        ctx.stroke();
      }
    },

    gym: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = '#2a2f36';
      ctx.fillRect(x + 6, y + h - 8, 16, 2.5);
      if (on) person(ctx, x + 12, y + h - 8, '#ffb8a0', t * 2.2, true);
      ctx.strokeStyle = '#8a94a2';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + w - 18, y + h - 6); ctx.lineTo(x + w - 6, y + h - 6);
      ctx.stroke();
      ctx.fillStyle = '#3a4048';
      ctx.fillRect(x + w - 19, y + h - 9, 3, 6);
      ctx.fillRect(x + w - 8, y + h - 9, 3, 6);
    },

    school: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = '#1e3028';
      ctx.fillRect(x + 5, y + 6, 14, 8);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 7, y + 9); ctx.lineTo(x + 16, y + 9);
      ctx.moveTo(x + 7, y + 11.5); ctx.lineTo(x + 13, y + 11.5);
      ctx.stroke();
      for (var dk = 0; dk < Math.floor((w - 26) / 12); dk++) {
        var dx4 = x + 24 + dk * 12;
        ctx.fillStyle = '#4a4038';
        ctx.fillRect(dx4, y + h - 9, 8, 2);
        if (on) person(ctx, dx4 + 3, y + h - 9, '#a0c8ff', t, false);
      }
    },

    rec: function (ctx, i, x, y, w, h, on, t) {
      if (on) {
        var hue = (t * 40) % 360;
        ctx.fillStyle = 'hsla(' + hue + ',80%,65%,0.7)';
        ctx.fillRect(x + 4, y + 4, w - 8, 2);
      }
      ctx.fillStyle = '#57406b';
      ctx.fillRect(x + 6, y + h - 9, 16, 4);
      ctx.fillStyle = on ? 'rgba(140,200,255,' + (0.5 + 0.3 * Math.sin(t * 7)) + ')' : '#1a2026';
      ctx.fillRect(x + w - 24, y + h - 18, 16, 10);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(x + w * 0.55, y + 12, 4, 0, Math.PI * 2); ctx.stroke();
      if (on) person(ctx, x + 10, y + h - 9, '#ffd9a0', t, false);
    },

    obs: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = 'rgba(20,26,40,0.8)';
      ctx.beginPath();
      ctx.moveTo(x + 2, y + h); ctx.quadraticCurveTo(x + w / 2, y - h * 0.5, x + w - 2, y + h);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(200,225,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + h); ctx.quadraticCurveTo(x + w / 2, y - h * 0.5, x + w - 2, y + h);
      ctx.stroke();
      ctx.fillStyle = '#05070d';
      ctx.fillRect(x + w * 0.44, y - 2, w * 0.12, h * 0.5);
      ctx.save();
      ctx.translate(x + w / 2, y + h * 0.75);
      ctx.rotate(-0.7 + (on ? Math.sin(t * 0.2) * 0.1 : 0));
      ctx.fillStyle = '#8f9fc0';
      ctx.fillRect(-2.5, -h * 0.55, 5, h * 0.55);
      ctx.restore();
      if (on) led(ctx, x + w * 0.5, y + h * 0.3, '#a8c0ff', (t % 2) < 1);
    },

    garden: function (ctx, i, x, y, w, h, on, t) {
      ctx.fillStyle = 'rgba(120,220,150,0.1)';
      ctx.beginPath();
      ctx.moveTo(x + 2, y + h); ctx.quadraticCurveTo(x + w / 2, y - h * 0.6, x + w - 2, y + h);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(200,240,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      for (var tr = 0; tr < 3; tr++) {
        var tx3 = x + w * (0.25 + tr * 0.25);
        ctx.fillStyle = '#5c4632';
        ctx.fillRect(tx3 - 1, y + h - 12, 2.5, 9);
        ctx.fillStyle = on ? '#4fb868' : '#33684a';
        ctx.beginPath(); ctx.arc(tx3, y + h - 15, 5 + hash(tr * 7 + i.iid) * 3, 0, Math.PI * 2); ctx.fill();
      }
      if (on) person(ctx, x + w * 0.4, y + h - 4, '#ffd9a0', t, true);
    },

    security: function (ctx, i, x, y, w, h, on, t) {
      for (var mc = 0; mc < 4; mc++) {
        var mx2 = x + 5 + (mc % 2) * 9, my = y + 5 + Math.floor(mc / 2) * 8;
        ctx.fillStyle = on && hash(mc * 3 + Math.floor(t * 2)) > 0.25 ? 'rgba(120,190,255,0.6)' : '#141a22';
        ctx.fillRect(mx2, my, 7, 5);
      }
      if (on) person(ctx, x + w - 8, y + h - 5, '#8090a8', t, false);
    },

    maint: function (ctx, i, x, y, w, h, on, t) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,210,60,0.4)';
      for (var hz = x + 3; hz < x + w - 6; hz += 10) {
        ctx.fillRect(hz, y + h - 4, 5, 2);
      }
      ctx.restore();
      ctx.fillStyle = '#3a3430';
      ctx.fillRect(x + 5, y + h - 10, w * 0.4, 2.5);
      ctx.strokeStyle = '#98a2ae';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 8); ctx.lineTo(x + 8, y + 13);
      ctx.moveTo(x + 12, y + 8); ctx.lineTo(x + 14, y + 13);
      ctx.stroke();
      var hx = x + w * 0.75 + (on ? Math.sin(t * 0.8) * 3 : 0);
      ctx.beginPath();
      ctx.moveTo(hx, y + 3); ctx.lineTo(hx, y + 12);
      ctx.stroke();
      ctx.strokeStyle = '#c8ccd4';
      ctx.beginPath(); ctx.arc(hx, y + 14, 2.5, -0.5, Math.PI + 0.5); ctx.stroke();
      if (on) person(ctx, x + 16, y + h - 10, '#d0c890', t, false);
    }
  };
  PAINTERS.icemine = PAINTERS.mine;
  PAINTERS.express = PAINTERS.lift;

  function drawModule(ctx, s, inst, m, sun, z) {
    var x = R.cellX(inst.x), w = inst.w * C.CELL_W;
    var y = R.cellY(inst.l1), h = (inst.l1 - inst.l0 + 1) * C.CELL_H;
    var on = inst.on && inst.dmg < 0.85;
    var lit = on ? 1 : 0.45;

    if (m.vertical) {
      ctx.fillStyle = shade(m.color, (0.4 + sun * 0.12) * lit);
      ctx.fillRect(x + 1, y, w - 2, h);
      if (z > 0.4 && PAINTERS[m.id]) PAINTERS[m.id](ctx, inst, x, y, w, h, on, R.t, m, s, sun);
      ctx.strokeStyle = on ? 'rgba(10,14,20,0.8)' : 'rgba(255,90,90,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1.5, y + 0.5, w - 3, h - 1);
      if (inst.dmg > 0.05) damage(ctx, x, y, w, h, inst.dmg);
      return;
    }

    paintHull(ctx, x, y, w, h, m.color, lit, sun);
    if (z > 0.45) floorAndCeil(ctx, x, y, w, h);
    if (z > 0.5 && PAINTERS[m.id]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 1, y - (m.id === 'comms' ? 14 : 0), w - 2, h + 14);
      ctx.clip();
      PAINTERS[m.id](ctx, inst, x, y, w, h, on, R.t, m, s, sun);
      ctx.restore();
    }

    ctx.strokeStyle = on ? 'rgba(8,12,18,0.85)' : 'rgba(255,90,90,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    if (inst.dist === Infinity && inst.mid !== 'shield') badge(ctx, x + w / 2, y - 7, '#ff6b6b', '!');
    else if (!inst.on && inst.dmg < 0.85) badge(ctx, x + w / 2, y - 7, '#ffc14d', '⚡');
    if (inst.dmg > 0.05) damage(ctx, x, y, w, h, inst.dmg);

    if (z > 0.85 && w > 60) {
      ctx.font = '8px ui-monospace, monospace';
      var tl = m.name.toUpperCase();
      var tw = ctx.measureText(tl).width;
      if (tw < w - 8) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x + w / 2 - tw / 2 - 3, y + h - 13, tw + 6, 10);
        ctx.fillStyle = 'rgba(240,246,255,0.9)';
        ctx.fillText(tl, x + w / 2 - tw / 2, y + h - 5);
      }
    }
  }

  function damage(ctx, x, y, w, h, d) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, 0.25 + d * 0.6);
    ctx.strokeStyle = '#ff5c4d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < Math.ceil(w / 24); i++) {
      var fx = x + (i + 0.5) * 24;
      ctx.moveTo(fx - 5, y + 3);
      ctx.lineTo(fx + 3, y + h * 0.45);
      ctx.lineTo(fx - 4, y + h - 4);
    }
    ctx.stroke();
    ctx.restore();
  }

  function badge(ctx, cx, cy, col, ch) {
    ctx.save();
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(R.t * 5);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10131a';
    ctx.font = 'bold 8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ch, cx, cy + 3);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /* ============================================================= WALKERS */

  function walkers(ctx, s, dt, view) {
    var want = Math.min(160, Math.floor(s.pop / 2) + Math.floor(s.tourists / 2));
    var W = R.walkers;
    while (W.length > want) W.pop();
    while (W.length < want) {
      var spot = randomOccupied(s);
      if (!spot) break;
      W.push({ x: spot.x + Math.random(), l: spot.l, dir: Math.random() < 0.5 ? -1 : 1,
               sp: 1 + Math.random() * 1.4, ride: 0, tint: Math.random() });
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
        if (!LH.occupied(s, Math.floor(nx), w.l)) w.dir *= -1;
        else w.x = nx;
        var here = LH.at(s, Math.floor(w.x), w.l);
        if (here && LH.MOD[here.mid].vertical && Math.random() < dt * 0.9) {
          var tl = here.l0 + Math.floor(Math.random() * (here.l1 - here.l0 + 1));
          if (tl !== w.l) { w.targetL = tl; w.ly = w.l; w.ride = 0.4 + Math.abs(tl - w.l) * 0.12; }
        }
        if (Math.random() < dt * 0.1) w.dir *= -1;
      }
      var lvl = w.ly !== undefined ? w.ly : w.l;
      if (Math.floor(w.x) < view.x0 || Math.floor(w.x) > view.x1) continue;
      if (lvl < view.l0 || lvl > view.l1) continue;
      var px = w.x * C.CELL_W, py = R.cellY(lvl) + C.CELL_H - 5;
      var col = w.tint > 0.75 ? '#ffd9a0' : (w.tint > 0.4 ? '#cfe4ff' : '#e8eef7');
      person(ctx, px, py, col, R.t + w.x, w.ride <= 0);
    }
    ctx.restore();
  }

  function randomOccupied(s) {
    var keys = Object.keys(s.cells);
    if (!keys.length) return null;
    var k = keys[Math.floor(Math.random() * keys.length)].split(',');
    return { x: +k[0], l: +k[1] };
  }

  /* =============================================================== GHOST */

  function ghost(ctx, s, ui) {
    if (!ui.tool || !ui.hover) return;
    var m = LH.MOD[ui.tool];
    if (ui.tool === 'bulldoze') {
      var r0 = ui.raw || ui.hover;
      var t = LH.at(s, r0.x, r0.l);
      if (t) {
        ctx.save();
        ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
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
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = chk.ok ? m.color : '#ff5555';
    cells.forEach(function (c) {
      ctx.fillRect(R.cellX(c[0]), R.cellY(c[1]), C.CELL_W, C.CELL_H);
    });
    ctx.globalAlpha = 1;
    var minX = Math.min.apply(null, cells.map(function (c) { return c[0]; }));
    var maxX = Math.max.apply(null, cells.map(function (c) { return c[0]; }));
    var minL = Math.min.apply(null, cells.map(function (c) { return c[1]; }));
    var maxL = Math.max.apply(null, cells.map(function (c) { return c[1]; }));
    ctx.strokeStyle = chk.ok ? '#ffffff' : '#ff5555';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(R.cellX(minX), R.cellY(maxL),
      (maxX - minX + 1) * C.CELL_W, (maxL - minL + 1) * C.CELL_H);
    if (chk.cost) {
      var tag = LH.money(chk.cost);
      ctx.font = '9px ui-monospace, monospace';
      var tw2 = ctx.measureText(tag).width;
      var ty = R.cellY(maxL) - 8;
      ctx.fillStyle = 'rgba(8,12,20,0.85)';
      ctx.fillRect(R.cellX(minX), ty - 9, tw2 + 8, 12);
      ctx.fillStyle = chk.ok ? '#ffd479' : '#ff8080';
      ctx.fillText(tag, R.cellX(minX) + 4, ty);
    }
    ctx.restore();
  }

  /* ========================================================== HUD LAYERS */

  function ruler(ctx, cv, s) {
    ctx.save();
    ctx.font = '9px ui-monospace, monospace';
    var z = R.cam.z;
    var l0 = Math.floor(-(R.cam.y + cv.height / 2 / z) / C.CELL_H) - 1;
    var l1 = Math.ceil(-(R.cam.y - cv.height / 2 / z) / C.CELL_H) + 1;
    ctx.fillStyle = 'rgba(8,11,18,0.72)';
    ctx.fillRect(0, 0, 36, cv.height);
    for (var l = Math.max(-C.MAX_DOWN, l0); l <= Math.min(C.MAX_UP, l1); l++) {
      var wy = R.cellY(l) + C.CELL_H / 2;
      var sy = (wy - R.cam.y) * z + cv.height / 2;
      if (sy < 8 || sy > cv.height - 4) continue;
      if (l % 2 !== 0 && z < 0.65) continue;
      ctx.fillStyle = l === 0 ? '#ffd479' : (l < 0 ? 'rgba(190,160,130,0.75)' : 'rgba(160,195,235,0.75)');
      ctx.fillText(l === 0 ? 'SURF' : (l > 0 ? '+' + l : String(l)), 4, sy + 3);
    }
    ctx.restore();
  }

  function minimap(ctx, cv, s, ui) {
    if (cv.width < 620) { ui.minimapRect = null; return; }
    var mw = 190, mh = 104, mx = cv.width - mw - 12, my = cv.height - mh - 12;
    ctx.save();
    ctx.fillStyle = 'rgba(8,11,18,0.85)';
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
      ctx.fillStyle = inst.dist === Infinity && inst.mid !== 'shield' ? '#ff5555' : m.color;
      var py = my + (C.MAX_UP - inst.l1) * sy;
      ctx.fillRect(mx + inst.x * sx, py, Math.max(1.2, inst.w * sx), Math.max(1.2, (inst.l1 - inst.l0 + 1) * sy));
    }

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

  function flareWarning(ctx, cv) {
    var a = 0.25 + 0.25 * Math.sin(R.t * 4);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,120,60,' + a + ')';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, cv.width - 6, cv.height - 6);
    ctx.restore();
  }

})(window.LH);
