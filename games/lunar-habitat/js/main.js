/* Lunar Habitat — bootstrap, input handling and the main loop. */

(function (LH) {
  'use strict';

  var C = LH.C, R = LH.R, ui = LH.ui;
  var cv, ctx, last = 0, acc = 0, lastLogLen = 0;

  /* ------------------------------------------------------------- canvas */

  function resize() {
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    var r = cv.getBoundingClientRect();
    cv.width = Math.max(320, Math.floor(r.width * dpr));
    cv.height = Math.max(240, Math.floor(r.height * dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    R.dpr = dpr;
  }

  function pt(e) {
    var r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * R.dpr, y: (e.clientY - r.top) * R.dpr };
  }

  /* --------------------------------------------------------------- input */

  var panning = false, panFrom = null, spaceDown = false;

  function wire() {
    cv.addEventListener('mousemove', function (e) {
      var p = pt(e);
      if (panning && panFrom) {
        R.cam.x -= (p.x - panFrom.x) / R.cam.z;
        R.cam.y -= (p.y - panFrom.y) / R.cam.z;
        panFrom = p;
        R.clampCam(cv);
        return;
      }
      var g = R.screenToGrid(p.x, p.y, cv);
      ui.raw = { x: g.x, l: g.l };
      var m = ui.tool && LH.MOD[ui.tool];
      var ox = (m && !m.vertical) ? g.x - Math.floor(m.w / 2) : g.x;
      ui.hover = { x: ox, l: g.l };
    });

    cv.addEventListener('mousedown', function (e) {
      var p = pt(e);
      if (ui.minimapRect && hitMinimap(p)) { jumpMinimap(p); return; }

      if (e.button === 2 || e.button === 1 || spaceDown) {
        panning = true; panFrom = p; cv.classList.add('panning');
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;

      var g = R.screenToGrid(p.x, p.y, cv);

      if (!ui.tool) { select(g); return; }

      if (ui.tool === 'bulldoze') {
        var t = LH.at(LH.S, g.x, g.l);
        if (t) {
          var refund = LH.remove(LH.S, t.iid);
          LH.toast(LH.MOD[t.mid].name + ' demolished — ' + LH.money(refund) + ' recovered.', 'warn');
          if (ui.sel === t.iid) ui.sel = null;
        }
        return;
      }

      var m = LH.MOD[ui.tool];
      if (m.vertical) { ui.drag = { x: g.x, l: g.l }; return; }
      tryPlace(ui.hover.x, g.l, g.l);
    });

    window.addEventListener('mouseup', function (e) {
      if (panning) { panning = false; panFrom = null; cv.classList.remove('panning'); return; }
      if (ui.drag && ui.tool && LH.MOD[ui.tool] && LH.MOD[ui.tool].vertical) {
        var l2 = ui.hover ? ui.hover.l : ui.drag.l;
        tryPlace(ui.drag.x, ui.drag.l, l2);
        ui.drag = null;
      }
    });

    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = pt(e);
      var before = R.screenToGrid(p.x, p.y, cv);
      var f = e.deltaY < 0 ? 1.16 : 1 / 1.16;
      R.cam.z = Math.max(0.22, Math.min(2.6, R.cam.z * f));
      var after = R.screenToGrid(p.x, p.y, cv);
      R.cam.x += before.wx - after.wx;
      R.cam.y += before.wy - after.wy;
      R.clampCam(cv);
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space') { spaceDown = true; e.preventDefault(); }
      if (e.key === 'Escape') { LH.setTool(null); ui.tool = null; LH.buildPalette(LH.S); LH.setHint(null); hideModal(); LH.hideReport(); LH.hideLeague(); }
      if (e.key === 'x' || e.key === 'X') LH.setTool('bulldoze');
      if (e.key === 'b' || e.key === 'B') LH.toggleAuto();
      if (e.key === 's' || e.key === 'S') LH.toggleSandbox();
      if (e.key === 'l' || e.key === 'L') { if (LH.leagueOpen()) LH.hideLeague(); else LH.showLeague(); }
      if (e.key === 'r' || e.key === 'R') { if (LH.reportOpen()) LH.hideReport(); else LH.showReport(); }
      if (e.key === '?' || e.key === '/') showModal();
      if (e.key >= '1' && e.key <= '4') setSpeed([0, 1, 3, 8][+e.key - 1]);
      var pan = 90 / R.cam.z;
      if (e.key === 'ArrowLeft') R.cam.x -= pan;
      if (e.key === 'ArrowRight') R.cam.x += pan;
      if (e.key === 'ArrowUp') R.cam.y -= pan;
      if (e.key === 'ArrowDown') R.cam.y += pan;
      R.clampCam(cv);
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space') spaceDown = false;
    });

    window.addEventListener('resize', resize);

    Array.prototype.forEach.call(document.querySelectorAll('#speed button[data-sp]'), function (b) {
      b.onclick = function () { setSpeed(+b.dataset.sp); };
    });
    document.getElementById('btn-auto').onclick = LH.toggleAuto;
    document.getElementById('btn-report').onclick = function () { LH.showReport(); };
    document.getElementById('btn-sandbox').onclick = LH.toggleSandbox;
    document.getElementById('btn-league').onclick = function () { LH.showLeague(); };
  }

  function hitMinimap(p) {
    var r = ui.minimapRect;
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }
  function jumpMinimap(p) {
    var r = ui.minimapRect;
    var x = (p.x - r.x) / r.sx;
    var l = C.MAX_UP - (p.y - r.y) / r.sy;
    R.centreOn(x, Math.round(l));
    R.clampCam(cv);
  }

  function select(g) {
    var t = LH.at(LH.S, g.x, g.l);
    ui.sel = t ? t.iid : null;
    if (t) { ui.tab = 'status'; LH.refreshPanel(LH.S); }
    else LH.refreshPanel(LH.S);
  }

  function tryPlace(x, l, l2) {
    var res = LH.place(LH.S, ui.tool, x, l, l2);
    if (!res.ok) {
      LH.setHint('<span class="err">✕ ' + res.reason + '</span>');
      flash();
      return;
    }
    LH.refreshTop(LH.S);
    LH.refreshPanel(LH.S);
    LH.previewModule(LH.MOD[ui.tool]);
  }

  var flashT = 0;
  function flash() { flashT = 0.25; }

  function setSpeed(sp) {
    LH.S.speed = sp;
    Array.prototype.forEach.call(document.querySelectorAll('#speed button[data-sp]'), function (b) {
      b.classList.toggle('on', +b.dataset.sp === sp);
    });
  }

  /* ---------------------------------------------------------------- loop */

  function frame(t) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, (t - last) / 1000) || 0;
    last = t;

    var s = LH.S;
    if (s.speed > 0) {
      acc += dt * 1000 * s.speed;
      var guard = 0;
      while (acc >= C.DAY_MS && guard++ < 12) {
        acc -= C.DAY_MS;
        LH.tick(s);
        LH.autopilot(s);
        LH.checkEnd(s);
        if (s.ended && s.ended !== 'continued') break;
      }
      if (guard > 0) {
        LH.refreshTop(s);
        LH.refreshPanel(s);
        LH.buildPaletteIfTier(s);
        drainLog(s);
        /* A charter promotion is the game's main reward moment; sim.js has always
           recorded it here and nothing ever read it. */
        if (s.tierJustUp) {
          LH.showCharterBanner(s.tierJustUp, s.tier);
          s.tierJustUp = null;
        }
      }
    }

    LH.R.draw(ctx, cv, s, ui, dt);
    if (flashT > 0) {
      flashT -= dt;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(255,80,80,' + (flashT * 0.35) + ')';
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
  }

  var lastTier = 1;
  LH.buildPaletteIfTier = function (s) {
    if (s.tier !== lastTier) { lastTier = s.tier; LH.buildPalette(s); }
  };

  function drainLog(s) {
    if (s.log.length === lastLogLen) return;
    var fresh = s.log.slice(0, Math.min(3, s.log.length - lastLogLen));
    fresh.reverse().forEach(function (e) { LH.toast(e.msg, e.kind); });
    lastLogLen = s.log.length;
  }

  /* ---------------------------------------------------------- save/load */
  /* Lives in js/save.js so it can be unit-tested without a canvas. */

  LH.confirmNew = function (skipConfirm) {
    if (!skipConfirm &&
        !window.confirm('Abandon this colony and start a new one? The saved game will be overwritten when you next save.')) return;
    LH.S = LH.newState();
    ui.sel = null; ui.tool = null; lastTier = 1; lastLogLen = 0;
    R.cam = { x: C.GRID_W * C.CELL_W / 2, y: 0, z: 0.8 };
    var sbBtn = document.getElementById('btn-sandbox');
    if (sbBtn) sbBtn.classList.remove('on');
    LH.buildPalette(LH.S); LH.refreshTop(LH.S); LH.refreshPanel(LH.S);
    LH.toast('New survey site. Good luck.', 'good');
  };

  /* --------------------------------------------------------------- modal */

  function showModal() { document.getElementById('modal').classList.remove('hide'); }
  function hideModal() { document.getElementById('modal').classList.add('hide'); }

  /* ----------------------------------------------------------------- go */

  function start(loaded) {
    hideModal();
    if (!loaded) {
      R.cam = { x: C.GRID_W * C.CELL_W / 2, y: -C.CELL_H * 2, z: 0.8 };
      LH.log(LH.S, 'good', 'Survey complete. Charter granted. Build an airlock, then dig.');
    } else {
      R.cam = { x: C.GRID_W * C.CELL_W / 2, y: 0, z: 0.75 };
      LH.toast('Colony restored — day ' + LH.S.day + '.', 'good');
    }
    R.clampCam(cv);
    lastTier = LH.S.tier;
    lastLogLen = LH.S.log.length;
    LH.buildPalette(LH.S);
    LH.refreshTop(LH.S);
    LH.refreshPanel(LH.S);
    setSpeed(1);
    LH.lockHint('Pick a module on the left, then click to build. <b>Right-drag</b> or <b>Space</b> to pan, ' +
      '<b>scroll</b> to zoom, <b>X</b> to bulldoze, <b>◈ AUTO</b> to let the colony run itself, <b>?</b> for help.');
    var ab = document.getElementById('btn-auto');
    if (ab) ab.classList.toggle('on', !!LH.S.auto);
    var sb = document.getElementById('btn-sandbox');
    if (sb) sb.classList.toggle('on', !!LH.S.sandbox);
    LH.setHint(null);

    /* checkEnd early-returns on s.ended, so a finished run used to resume at 1x
       with no end screen and no way to score it — present its outcome instead.
       Must come after the setSpeed(1) above, which would otherwise restart the
       clock on a colony that is already over. */
    if (loaded && LH.S.ended && LH.S.ended !== 'continued') {
      setSpeed(0);
      LH.showEndScreen(LH.S, LH.S.ended);
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    cv = document.getElementById('cv');
    ctx = cv.getContext('2d');
    LH.S = LH.newState();
    resize();
    wire();
    LH.initTabs();

    var btnLoad = document.getElementById('btn-load');
    if (!LH.hasSave()) btnLoad.style.display = 'none';
    btnLoad.onclick = function () { start(LH.loadGame()); };
    document.getElementById('btn-start').onclick = function () { start(false); };

    // autosave every 90 seconds
    // quiet, and not once the run is over — this used to toast "Colony saved"
    // every 90 seconds forever, including after a collapse
    setInterval(function () {
      if (LH.S && LH.S.day > 1 && !LH.S.ended) LH.saveGame(true);
    }, 90000);

    requestAnimationFrame(function (t) { last = t; requestAnimationFrame(frame); });
  });

})(window.LH);
