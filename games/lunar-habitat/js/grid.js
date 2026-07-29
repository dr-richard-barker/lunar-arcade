/* Lunar Habitat — world state, placement rules, and the transit solver. */

(function (LH) {
  'use strict';

  var C = LH.C;

  function key(x, l) { return x + ',' + l; }
  LH.key = key;

  LH.newState = function () {
    return {
      credits: C.START_CREDITS,
      day: 1,
      speed: 1,
      cells: {},         // "x,l" -> instance id
      inst: {},          // iid -> instance
      dug: {},           // "x,l" -> true, subsurface cells already excavated
      nextId: 1,
      res: { power: 120, o2: 200, water: 200, food: 200, ore: 0, he3: 0 },
      pop: 0, tourists: 0,
      morale: 62, health: 100,
      tier: 1,
      stats: { income: 0, upkeep: 0, powerGen: 0, powerUse: 0, powerCap: 0,
               o2Bal: 0, waterBal: 0, foodBal: 0, jobs: 0, workers: 0,
               housing: 0, connected: 0, orphans: 0 },
      log: [],
      alerts: {},
      flare: 0,          // days until a solar particle event lands (0 = none)
      history: [],
      deaths: 0,
      ticks: 0,
      peakPop: 0,
      totalExports: 0,
      totalIncome: 0,
      crisisDays: 0,
      ended: null
    };
  };

  LH.sunFactor = function (day) {
    var phase = ((day - 1) % C.LUNAR_CYCLE) / C.LUNAR_CYCLE;   // 0..1
    // 0.0-0.5 lit, 0.5-1.0 dark, with soft terminator crossings
    var s = Math.cos(phase * Math.PI * 2);
    return Math.max(0, Math.min(1, s * 1.6 + 0.5));
  };

  LH.isNight = function (day) { return LH.sunFactor(day) < 0.05; };

  /* ---------------------------------------------------------------- queries */

  LH.at = function (s, x, l) {
    var iid = s.cells[key(x, l)];
    return iid ? s.inst[iid] : null;
  };

  LH.occupied = function (s, x, l) { return !!s.cells[key(x, l)]; };

  LH.inBounds = function (x, l) {
    return x >= 0 && x < C.GRID_W && l <= C.MAX_UP && l >= -C.MAX_DOWN;
  };

  LH.countOf = function (s, mid) {
    var n = 0;
    for (var k in s.inst) if (s.inst[k].mid === mid) n++;
    return n;
  };

  /* Cells a placement would occupy. Horizontal: w cells on one level.
     Vertical shaft: 1 cell per level from l0..l1. */
  function footprint(m, x, l, l2) {
    var out = [], i;
    if (m.vertical) {
      var a = Math.min(l, l2), b = Math.max(l, l2);
      for (i = a; i <= b; i++) out.push([x, i]);
    } else {
      for (i = 0; i < m.w; i++) out.push([x + i, l]);
    }
    return out;
  }
  LH.footprint = footprint;

  /* Structural support: above-surface needs something under it, subsurface
     needs something over it. Level 0 and level -1 always rest on the ground. */
  function supported(s, m, cells) {
    var i, x, l, ok = false;
    for (i = 0; i < cells.length; i++) {
      x = cells[i][0]; l = cells[i][1];
      if (l === 0 || l === -1) return true;
      if (l > 0 && LH.occupied(s, x, l - 1)) ok = true;
      if (l < -1 && LH.occupied(s, x, l + 1)) ok = true;
    }
    return ok;
  }

  /* Can this be built here? -> { ok, cost, reason, cells } */
  LH.checkPlace = function (s, mid, x, l, l2) {
    var m = LH.MOD[mid];
    if (!m) return { ok: false, reason: 'Unknown module' };
    if (!s.sandbox && m.tier > s.tier) return { ok: false, reason: 'Locked until charter tier ' + m.tier };

    var cells = footprint(m, x, l, l2), i, cx, cl;
    if (m.vertical && cells.length > m.span)
      return { ok: false, reason: m.name + ' spans at most ' + m.span + ' levels' };

    var cost = 0, excav = 0;
    for (i = 0; i < cells.length; i++) {
      cx = cells[i][0]; cl = cells[i][1];
      if (!LH.inBounds(cx, cl)) return { ok: false, reason: 'Outside the survey area' };
      if (!LH.levelOk(m, cl)) return { ok: false, reason: LH.levelRule(m) };
      if (LH.occupied(s, cx, cl)) return { ok: false, reason: 'Something is already there' };
      if (cl < 0 && !s.dug[key(cx, cl)]) excav += LH.excavCost(cl);
    }
    if (!supported(s, m, cells))
      return { ok: false, reason: l > 0 ? 'Nothing underneath to build on' : 'Must connect to the level above' };

    cost = s.sandbox ? 0 : (m.vertical ? m.cost * cells.length : m.cost) + excav;
    if (cost > s.credits) return { ok: false, reason: 'Not enough credits (' + LH.money(cost) + ')', cost: cost, cells: cells };
    return { ok: true, cost: cost, excav: excav, cells: cells };
  };

  LH.place = function (s, mid, x, l, l2) {
    var chk = LH.checkPlace(s, mid, x, l, l2);
    if (!chk.ok) return chk;
    var m = LH.MOD[mid];
    var iid = s.nextId++;
    var inst = {
      iid: iid, mid: mid, x: x, l: l,
      cells: chk.cells,
      w: m.vertical ? 1 : m.w,
      l0: m.vertical ? Math.min(l, l2) : l,
      l1: m.vertical ? Math.max(l, l2) : l,
      dmg: 0, dust: 0, dist: Infinity, on: true,
      occ: 0, staff: 0, seed: (iid * 2654435761) % 1000 / 1000
    };
    chk.cells.forEach(function (c) {
      s.cells[key(c[0], c[1])] = iid;
      if (c[1] < 0) s.dug[key(c[0], c[1])] = true;
    });
    s.inst[iid] = inst;
    s.credits -= chk.cost;
    s.dirty = true;
    return { ok: true, inst: inst, cost: chk.cost };
  };

  LH.remove = function (s, iid) {
    var inst = s.inst[iid];
    if (!inst) return 0;
    var m = LH.MOD[inst.mid];
    var refund = Math.round((m.vertical ? m.cost * inst.cells.length : m.cost) * 0.35);
    inst.cells.forEach(function (c) { delete s.cells[key(c[0], c[1])]; });
    delete s.inst[iid];
    s.credits += refund;
    s.dirty = true;
    return refund;
  };

  /* ------------------------------------------------------- transit solver */

  function Heap() { this.a = []; }
  Heap.prototype.push = function (d, v) {
    var a = this.a, i = a.length;
    a.push([d, v]);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      var t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };

  /* Dijkstra from every airlock cell. Writes inst.dist (transit steps).
     Horizontal steps cost 1; vertical steps cost the shaft's speed factor. */
  LH.solveTransit = function (s) {
    var dist = {}, h = new Heap(), iid, inst, i;

    for (iid in s.inst) {
      inst = s.inst[iid];
      inst.dist = Infinity;
      if (inst.mid === 'airlock') {
        for (i = 0; i < inst.cells.length; i++) {
          var k = key(inst.cells[i][0], inst.cells[i][1]);
          dist[k] = 0; h.push(0, inst.cells[i]);
        }
      }
    }

    while (h.a.length) {
      var top = h.pop(), d = top[0], cell = top[1];
      var ck = key(cell[0], cell[1]);
      if (d > (dist[ck] === undefined ? Infinity : dist[ck])) continue;
      var x = cell[0], l = cell[1];

      // horizontal neighbours on the same level
      [[x - 1, l], [x + 1, l]].forEach(function (n) {
        if (!LH.occupied(s, n[0], n[1])) return;
        relax(n, d + 1);
      });

      // vertical neighbours, only within one shaft instance
      var here = LH.at(s, x, l);
      if (here && LH.MOD[here.mid].vertical) {
        var sp = LH.MOD[here.mid].speed;
        [[x, l - 1], [x, l + 1]].forEach(function (n) {
          if (s.cells[key(n[0], n[1])] !== here.iid) return;
          relax(n, d + sp);
        });
      }

      function relax(n, nd) {
        var nk = key(n[0], n[1]);
        if (nd < (dist[nk] === undefined ? Infinity : dist[nk])) {
          dist[nk] = nd; h.push(nd, n);
        }
      }
    }

    var orphans = 0, connected = 0;
    for (iid in s.inst) {
      inst = s.inst[iid];
      var best = Infinity;
      for (i = 0; i < inst.cells.length; i++) {
        var v = dist[key(inst.cells[i][0], inst.cells[i][1])];
        if (v !== undefined && v < best) best = v;
      }
      // shield caps are inert regolith slabs — no crew access required
      if (inst.mid === 'shield' && best === Infinity) best = 0;
      inst.dist = best;
      if (best === Infinity) orphans++; else connected++;
    }
    s.stats.orphans = orphans;
    s.stats.connected = connected;
    s.distMap = dist;
  };

  /* Amenity coverage: morale value reaching each cell, by straight-line
     grid distance from amenity modules (levels count double — stairs are work). */
  LH.solveAmenity = function (s) {
    var list = [];
    for (var iid in s.inst) {
      var inst = s.inst[iid], m = LH.MOD[inst.mid];
      if (m.amen && inst.on && inst.dist < Infinity) list.push(inst);
    }
    s.amenList = list;
  };

  LH.amenityAt = function (s, x, l) {
    var v = 0, i, list = s.amenList || [];
    for (i = 0; i < list.length; i++) {
      var a = list[i], m = LH.MOD[a.mid];
      var dx = Math.abs(a.x + a.w / 2 - x), dl = Math.abs(a.l - l) * 3;
      var d = dx + dl;
      if (d <= m.amen.r) v += m.amen.v * (1 - d / m.amen.r) * (1 - a.dmg);
    }
    return v;
  };

  /* Nearest module with a given flag, in cells (levels weighted). */
  LH.hasNearby = function (s, x, l, flag) {
    for (var iid in s.inst) {
      var inst = s.inst[iid], m = LH.MOD[inst.mid];
      if (!m[flag] || !inst.on || inst.dist === Infinity) continue;
      var d = Math.abs(inst.x + inst.w / 2 - x) + Math.abs(inst.l - l) * 3;
      if (d <= (m.amen ? m.amen.r : 20)) return inst;
    }
    return null;
  };

  /* Is this module shielded from radiation? Three levels of rock overhead is
     enough on its own; otherwise every cell needs mass directly above it —
     which is what a regolith shield cap is for. */
  LH.shielded = function (s, inst) {
    if (inst.l <= -3) return true;
    for (var i = 0; i < inst.cells.length; i++) {
      var c = inst.cells[i];
      if (!LH.occupied(s, c[0], c[1] + 1)) return false;
    }
    return true;
  };

  LH.money = function (n) {
    var neg = n < 0; n = Math.abs(Math.round(n));
    var s = n.toLocaleString('en-US');
    return (neg ? '-₵' : '₵') + s;
  };

})(window.LH);
