/* Lunar Habitat — autopilot. A colony director that plays the game itself.
   Runs once per simulated day; performs at most two build actions per day,
   always keeping a cash reserve. Toggle with the AUTO button or the B key. */

(function (LH) {
  'use strict';

  var C = LH.C;

  /* -------------------------------------------------------------- helpers */

  function count(s, mid) { return LH.countOf(s, mid); }

  function reserve(s) {
    return Math.max(8000, (s.stats.upkeep || 0) * 8);
  }

  function afford(s, cost, floor) {
    return s.credits - cost >= (floor !== undefined ? floor : reserve(s));
  }

  /* Occupied extent of a level: [left, right] x or null. */
  function rowEnds(s, l) {
    var left = null, right = null;
    for (var x = 0; x < C.GRID_W; x++) {
      if (LH.occupied(s, x, l)) {
        if (left === null) left = x;
        right = x;
      }
    }
    return left === null ? null : [left, right];
  }

  /* Try to place module `mid` on level `l`, growing the row outward from the
     existing structures. Below -1 the row may only grow under the row above
     (structural support), which the bounds check respects implicitly via
     checkPlace. Alternates sides for a balanced pyramid. */
  function growOnLevel(s, mid, l, floor) {
    var m = LH.MOD[mid];
    var row = rowEnds(s, l);
    var cands = [];
    if (row) {
      cands.push(row[1] + 1);          // rightward
      cands.push(row[0] - m.w);        // leftward
    } else {
      // empty level: start beside the main shaft column if it passes through
      var sh = s.autoShaftX;
      if (sh !== undefined) { cands.push(sh + 1); cands.push(sh - m.w); }
    }
    var broke = false;
    for (var i = 0; i < cands.length; i++) {
      var x = cands[i];
      if (x === null || x < 2 || x + m.w > C.GRID_W - 2) continue;
      var chk = LH.checkPlace(s, mid, x, l, l);
      if (chk.ok && afford(s, chk.cost, floor)) {
        var r = LH.place(s, mid, x, l, l);
        if (r.ok) return r;
      }
      // space exists but the treasury can't cover it: save, don't improvise
      if (chk.ok || (chk.reason && chk.reason.indexOf('Not enough credits') === 0)) broke = true;
    }
    return broke ? 'broke' : null;
  }

  /* Place on whichever of the given levels first accepts it. */
  function growAny(s, mid, levels, floor) {
    var broke = false;
    for (var i = 0; i < levels.length; i++) {
      var r = growOnLevel(s, mid, levels[i], floor);
      if (r === 'broke') { broke = true; continue; }
      if (r) return r;
    }
    return broke ? 'broke' : null;
  }

  /* Which sub-surface levels the base can currently build on: every level
     from -1 down to one past the deepest occupied row, capped by the shaft. */
  function activeLevels(s, deepFirst) {
    var deepest = -1;
    for (var l = -1; l >= -C.MAX_DOWN; l--) {
      if (rowEnds(s, l)) deepest = l; else break;
    }
    var reach = Math.max(s.autoShaftBot || -8, -C.MAX_DOWN);
    var lo = Math.max(deepest - 1, reach);
    var out = [];
    if (deepFirst) { for (var a = lo; a <= -1; a++) out.push(a); }
    else { for (var b = -1; b >= lo; b--) out.push(b); }
    return out;
  }

  function act(s, msg, r) {
    if (!r || r === 'broke') return false;
    LH.log(s, 'auto', 'Autopilot: ' + msg + '.');
    return true;
  }

  /* --------------------------------------------------------- the director */

  /* Returns true if it did something. Called up to twice per day. */
  function step(s) {
    var st = s.stats, i;

    /* 0 - demolish anything orphaned (except inert shields) */
    for (var iid in s.inst) {
      var inst = s.inst[iid];
      if (inst.dist === Infinity && inst.mid !== 'shield') {
        LH.remove(s, inst.iid);
        return act(s, 'demolished an unreachable ' + LH.MOD[inst.mid].name, true);
      }
    }

    /* 0.5 - insolvency rescue: a colony in the red sells the gym first */
    var balNow = (st.income || 0) - (st.upkeep || 0);
    if (s.credits < -5000 && balNow < 0) {
      var cut = null, cutUp = 0;
      for (var ci in s.inst) {
        var cinst = s.inst[ci], cm = LH.MOD[cinst.mid];
        if (cm.cat !== 'amen' && cm.cat !== 'work') continue;
        if (cm.id === 'maint' || cm.id === 'admin') continue;    // keep the essentials
        if (cm.up > cutUp) { cut = cinst; cutUp = cm.up; }
      }
      if (cut) {
        var cName = LH.MOD[cut.mid].name;
        LH.remove(s, cut.iid);
        return act(s, 'sold off the ' + cName + ' to stop the bleeding', true);
      }
    }

    /* 1 - foundation: airlock, main shaft, first power */
    if (count(s, 'airlock') === 0) {
      var cx = Math.floor(C.GRID_W / 2) - 2;
      var chk = LH.checkPlace(s, 'airlock', cx, 0, 0);
      if (chk.ok && s.credits >= chk.cost) {
        LH.place(s, 'airlock', cx, 0, 0);
        s.autoShaftX = cx + LH.MOD.airlock.w;   // shaft column just right of the lock
        return act(s, 'sited the surface airlock', true);
      }
      return false;
    }
    if (s.autoShaftX === undefined) {
      // adopted a hand-built colony: use the column right of the first airlock
      for (var k in s.inst) if (s.inst[k].mid === 'airlock') { s.autoShaftX = s.inst[k].x + LH.MOD.airlock.w; break; }
    }
    if (count(s, 'lift') === 0 && count(s, 'express') === 0) {
      var c2 = LH.checkPlace(s, 'lift', s.autoShaftX, 0, -8);
      if (c2.ok && s.credits >= c2.cost) {
        LH.place(s, 'lift', s.autoShaftX, 0, -8);
        s.autoShaftBot = -8;
        return act(s, 'sank the main transit shaft to level -8', true);
      }
      return false;
    }
    if (s.autoShaftBot === undefined) s.autoShaftBot = -8;

    if (count(s, 'solar') === 0)
      return act(s, 'raised a solar array', growOnLevel(s, 'solar', 0, 3000));
    if (count(s, 'battery') === 0)
      return act(s, 'installed a battery bank', growOnLevel(s, 'battery', 0, 3000));

    /* 2 - minimum viable colony, in strict order */
    var subs = activeLevels(s, false);
    if (count(s, 'scrubber') === 0)
      return act(s, 'installed an O2 scrubber', growAny(s, 'scrubber', subs, 3000));
    if (count(s, 'recycler') === 0)
      return act(s, 'installed a water recycler', growAny(s, 'recycler', subs, 3000));
    if ((st.housing || 0) < 6)
      return act(s, 'fitted out a crew pod', growAny(s, 'pod', subs, 3000));
    if (count(s, 'hydro') === 0)
      return act(s, 'planted a hydroponics bay', growAny(s, 'hydro', subs, 3000));
    if (count(s, 'pad') === 0)
      return act(s, 'poured the landing pad', growOnLevel(s, 'pad', 0, 3000));
    if (count(s, 'admin') === 0)
      return act(s, 'opened the admin centre', growAny(s, 'admin', subs, 3000));
    if (count(s, 'maint') === 0)
      return act(s, 'opened a maintenance bay', growAny(s, 'maint', subs, 3000));
    if (count(s, 'rtg') === 0)
      return act(s, 'buried an RTG cluster', growOnLevel(s, 'rtg', 0, 4000));

    /* -- shared bookkeeping ------------------------------------------- */
    var gen = 0, demand = (st.powerUse || 0);
    var dustTotal = 0, solarN = 0;
    for (var pk in s.inst) {
      var pi = s.inst[pk], pm = LH.MOD[pi.mid];
      if (pi.dist === Infinity) continue;
      if (pm.power > 0) gen += pm.power * (1 - pi.dmg) * (pm.id === 'solar' ? (1 - pi.dust) : 1);
      if (pm.id === 'solar') { dustTotal += pi.dust; solarN++; }
    }
    var headroom = gen - demand;                        // at full sun
    var bal = (st.income || 0) - (st.upkeep || 0);

    /* 3 - POWER before everything else: a browned-out colony earns nothing.
       Power builds may spend almost to the floor - they are survival. */
    if ((st.shed || 0) > 0 || headroom < 12)
      return act(s, 'raised another solar array', growOnLevel(s, 'solar', 0, 3000));
    if ((st.powerCap || 0) < (demand + 8) * (C.LUNAR_CYCLE / 2) * 0.9)
      return act(s, 'banked more batteries for the long night', growOnLevel(s, 'battery', 0, 3000));
    if (solarN > 0 && dustTotal / solarN > 0.2 && count(s, 'maint') < Math.ceil(solarN / 4))
      return act(s, 'added a maintenance bay to keep the arrays clean', growOnLevel(s, 'maint', 0, 4000));

    /* 4 - life support: real daily balances first (they include staffing) */
    if ((st.o2Bal || 0) < 1.5)
      return act(s, 'expanded oxygen production', growAny(s, 'scrubber', subs, 3000));
    if ((st.waterBal || 0) < 1.5)
      return act(s, 'expanded water recycling', growAny(s, 'recycler', subs, 3000));
    if ((st.foodBal || 0) < 1.5)
      return act(s, 'expanded hydroponics', growAny(s, 'hydro', subs, 3000));
    /* then theoretical headroom for the next wave of arrivals */
    var need = s.pop + 6;
    var o2Net = 0, h2oNet = 0, foodNet = 0;
    for (var kk in s.inst) {
      var ii = s.inst[kk], mm = LH.MOD[ii.mid];
      if (ii.dist === Infinity) continue;
      if (mm.o2) o2Net += mm.o2;
      if (mm.water) h2oNet += mm.water;
      if (mm.food > 0) foodNet += mm.food;
    }
    if (o2Net < need * C.O2_PER_POP)
      return act(s, 'expanded oxygen production', growAny(s, 'scrubber', subs, 3000));
    if (h2oNet < need * C.WATER_PER_POP) {
      if (s.tier >= 2 && (s.autoShaftBot || 0) <= -10 && count(s, 'icemine') === 0) {
        var rIce = growAny(s, 'icemine', [-10, -11, -12].filter(function (l) { return subs.indexOf(l) >= 0; }));
        if (rIce) return act(s, 'tapped buried ice', rIce);
      }
      return act(s, 'expanded water recycling', growAny(s, 'recycler', subs, 3000));
    }
    if (foodNet < need * C.FOOD_PER_POP)
      return act(s, 'expanded hydroponics', growAny(s, 'hydro', subs, 3000));

    /* 5 - grow the settlement: housing fills itself, people pay rent.
       Housing is the engine of the whole economy - build it eagerly. */
    var vacancy = Math.floor(st.housing || 0) - Math.round(s.pop);
    var deepSubs = subs.filter(function (l) { return l <= -2; });
    if (vacancy < 4 && s.morale > 40) {
      var hm = s.tier >= 2 ? 'block' : 'pod';
      var rH = growAny(s, hm, deepSubs, 5000);
      if (rH === null) rH = growAny(s, 'pod', deepSubs, 5000);
      if (rH === null) rH = growAny(s, hm, subs, 5000);
      if (rH === null) rH = growAny(s, 'pod', subs, 5000);
      if (rH && rH !== 'broke') return act(s, 'expanded housing', rH);
      if (rH === null) {                       // truly out of room: dig, don't spend the pod fund
        var rD = digFrontier(s, 12000);
        if (rD) return rD;
      }
      // broke: hold the line and let rent accumulate
    }

    /* 5.5 - commutes: satellite airlocks with their own shafts, capped */
    var worstDist = 0;
    for (var wd in s.inst) {
      var wi = s.inst[wd];
      if (LH.MOD[wi.mid].pop && wi.dist < Infinity && wi.dist > worstDist) worstDist = wi.dist;
    }
    var maxLocks = 1 + Math.floor(Math.max(s.pop, 1) / 35);
    if (worstDist > C.COMMUTE_GOOD + 6 && count(s, 'airlock') < maxLocks) {
      var rAL = growOnLevel(s, 'airlock', 0, 6000);
      if (rAL && rAL !== 'broke') {
        var al = rAL.inst;
        var shaftCol = al.x > s.autoShaftX ? al.x + LH.MOD.airlock.w : al.x - 1;
        var cS = LH.checkPlace(s, 'lift', shaftCol, 0, s.autoShaftBot || -8);
        if (cS.ok && s.credits - cS.cost > 2000) LH.place(s, 'lift', shaftCol, 0, s.autoShaftBot || -8);
        return act(s, 'opened a satellite airlock and shaft to shorten commutes', rAL);
      }
    }

    /* 5.6 - depth. The original shaft stops at level -8, but ice sits at -10
       and the charter's Deep Core Complex at -18, so without extending the
       spine those tiers are physically unreachable no matter how rich the
       colony gets. Sink a deeper shaft as the dig approaches the bottom. */
    var floorL = s.autoShaftBot || -8;
    var deepestRow = 0;
    for (var dl = -1; dl >= floorL; dl--) { if (rowEnds(s, dl)) deepestRow = dl; else break; }
    var wantDepth = deepestRow <= floorL + 2 ||
                    (s.tier >= 3 && s.credits > 80000) ||   // rich enough to plan ahead
                    (s.tier >= 2 && count(s, 'icemine') === 0 && s.credits > 120000);
    if (wantDepth && floorL > -22) {
      var dKind = s.tier >= 3 ? 'express' : 'lift';
      var dTarget = Math.max(-22, -(LH.MOD[dKind].span - 1), -C.MAX_DOWN);
      var dr = rowEnds(s, -1);
      var dCands = dr ? [dr[1] + 1, dr[0] - 1] : [];
      for (var di = 0; di < dCands.length; di++) {
        var dc = dCands[di];
        if (dc < 3 || dc > C.GRID_W - 6) continue;
        var dChk = LH.checkPlace(s, dKind, dc, 0, dTarget);
        if (dChk.ok && s.credits - dChk.cost > 15000) {
          LH.place(s, dKind, dc, 0, dTarget);
          s.autoShaftBot = dTarget;
          s.autoShaftX = dc;               // new deep levels anchor on this column
          return act(s, 'sank a deep shaft to level ' + LH.fmtL(dTarget), true);
        }
      }
      /* A mature colony has usually sprawled to both map edges, so there is no
         free frontier column left to drop a shaft into. Cut one through the
         colony's own corridors instead — that is what a player would do. */
      if (s.credits > 60000) {
        for (var cc = 6; cc < C.GRID_W - 6; cc++) {
          var clear = true, corr = [];
          for (var cl = 0; cl >= floorL; cl--) {
            var cOcc = LH.at(s, cc, cl);
            if (!cOcc) continue;
            if (cOcc.mid !== 'corridor') { clear = false; break; }
            corr.push(cOcc);
          }
          if (!clear || !corr.length) continue;
          corr.forEach(function (v) { LH.remove(s, v.iid); });
          var cChk = LH.checkPlace(s, dKind, cc, 0, dTarget);
          if (cChk.ok && s.credits - cChk.cost > 15000) {
            LH.place(s, dKind, cc, 0, dTarget);
            s.autoShaftBot = dTarget;
            s.autoShaftX = cc;
            return act(s, 'cut a deep shaft down to level ' + LH.fmtL(dTarget), true);
          }
          corr.forEach(function (v) { LH.place(s, 'corridor', v.x, v.l, v.l); });
          break;
        }
      }
    }

    /* 6 - jobs, only when there are idle hands AND power to run the site */
    var workers = st.workers || 0, jobs = st.jobs || 0;
    if (workers > jobs + 4 && headroom > 10) {
      if (s.tier >= 2 && count(s, 'mine') < 2 && workers > jobs + 8) {
        var rM = deepBuild(s, 'mine', 6000);
        if (rM && rM !== 'broke' && !rM.redirected) return act(s, 'opened a regolith mine', rM);
        if (rM && rM !== 'broke') return true;
      }
      var jm = s.tier >= 2 ? 'lab' : 'admin';
      var rJ = growAny(s, jm, subs, 6000);
      if (rJ === null) rJ = growAny(s, 'admin', subs, 6000);
      if (rJ && rJ !== 'broke') return act(s, 'created jobs', rJ);
      if (rJ === null) {
        var rD2 = digFrontier(s, 12000);
        if (rD2) return rD2;
      }
    }

    /* 7 - morale: amenities, scaled to the population they serve */
    if (s.morale < 60 || s.pop > 10) {
      var popN = Math.round(s.pop);
      if (count(s, 'mess') < Math.max(1, Math.ceil(popN / 26)))
        return act(s, 'opened a mess hall', growAny(s, 'mess', subs, 6000) || makeRoom(s, 'mess', subs, 6000));
      if (popN > 14 && count(s, 'med') < Math.max(1, Math.ceil(popN / 70)))
        return act(s, 'staffed a medical bay', growAny(s, 'med', subs, 6000) || makeRoom(s, 'med', subs, 6000));
      if (popN > 24 && count(s, 'gym') < Math.max(1, Math.ceil(popN / 55)))
        return act(s, 'fitted an exercise deck', growAny(s, 'gym', subs, 6000) || makeRoom(s, 'gym', subs, 6000));
      if (s.tier >= 3 && count(s, 'rec') < Math.ceil(popN / 90))
        if (act(s, 'inflated a rec dome', growAny(s, 'rec', subs) || makeRoom(s, 'rec', subs, 8000))) return true;
      if (s.tier >= 3 && popN > 30 && count(s, 'school') === 0)
        if (act(s, 'opened the school', growAny(s, 'school', subs) || makeRoom(s, 'school', subs, 8000))) return true;
    }

    /* 8 - charter progress: build whatever the next tier explicitly needs */
    var prog = LH.tierProgress(s);
    if (prog) {
      for (i = 0; i < prog.items.length; i++) {
        var item = prog.items[i];
        if (item.ok) continue;
        for (var mid2 in LH.MOD) {
          if (LH.MOD[mid2].name === item.label && count(s, mid2) === 0) {
            var mDef = LH.MOD[mid2], rT = null;
            if (mDef.where === 'surface' || mDef.where === 'aboveOr0') {
              rT = growOnLevel(s, mid2, 0);
              if (rT === null) rT = makeRoom(s, mid2, [0], 8000);
            } else if (mDef.where === 'above') rT = buildTower(s, mid2, 8000);
            else if (mDef.maxL !== undefined && mDef.maxL < -1) {
              rT = deepBuild(s, mid2);
              if (rT === null) {
                var deepLv = [];
                for (var dz = mDef.maxL; dz >= (s.autoShaftBot || -8); dz--) deepLv.push(dz);
                rT = makeRoom(s, mid2, deepLv, 8000);
              }
            } else {
              rT = growAny(s, mid2, subs);
              if (rT === null) rT = makeRoom(s, mid2, subs, 8000);
            }
            if (rT && rT !== 'broke') return act(s, 'built ' + mDef.name + ' for the charter', rT);
          }
        }
      }
    }

    /* 9 - premium exports and prestige, from a position of strength */
    if (bal < 60 && count(s, 'he3') === 0 && s.tier >= 2 && workers > jobs + 8)
      return act(s, 'commissioned a He-3 extractor', growOnLevel(s, 'he3', 0));
    if (s.credits > 90000) {
      if (s.tier >= 2 && count(s, 'fab') === 0 && count(s, 'mine') > 0 && workers > jobs + 6)
        return act(s, 'stood up a fabricator', growAny(s, 'fab', subs));
      if (s.tier >= 3 && count(s, 'refinery') === 0 && count(s, 'mine') > 0 && workers > jobs + 10)
        return act(s, 'commissioned the refinery', growAny(s, 'refinery', subs) || makeRoom(s, 'refinery', subs, 10000));
      if (count(s, 'comms') === 0 && workers > jobs + 2) {
        var rC = buildTower(s, 'comms', 12000);
        if (rC) return act(s, 'raised a comms array', rC);
      }
      if (s.tier >= 3 && count(s, 'obs') === 0) {
        var rO = buildTower(s, 'obs', 12000);
        if (rO) return act(s, 'built the observatory', rO);
      }
      if (s.tier >= 4 && count(s, 'garden') === 0) {
        var rG = buildTower(s, 'garden', 12000);
        if (rG) return act(s, 'grew a garden dome', rG);
      }
      var rD3 = digFrontier(s);
      if (rD3) return rD3;
    }

    return false;
  }

  /* Dig: extend the deepest corridor row, or push corridors along the
     shallowest row that still has room under the row above. */
  function digFrontier(s, floor) {
    var levels = activeLevels(s, true);   // deepest first
    for (var i = 0; i < levels.length; i++) {
      var r = growOnLevel(s, 'corridor', levels[i], floor);
      if (r) return act(s, 'excavated new frontage on level ' + LH.fmtL(levels[i]), r);
    }
    return null;
  }

  /* Deep industry (mines etc): needs rows dug down to its depth first. */
  function deepBuild(s, mid, floor) {
    var m = LH.MOD[mid];
    var top = m.maxL !== undefined ? m.maxL : -3;
    var levels = [];
    for (var l = top; l >= Math.max(s.autoShaftBot || -8, -C.MAX_DOWN); l--) levels.push(l);
    var r = growAny(s, mid, levels, floor);
    if (r === 'broke') return 'broke';
    if (r) return r;
    return digFrontier(s, floor) ? { redirected: true } : null;
  }

  /* Above-surface modules (comms, observatory, garden dome). The old version
     probed by placing a module and immediately removing it, which never built
     anything and leaked credits. This runs a ladder up the outside of the
     colony and stacks corridor decks on the surface roof to stand on. */
  function buildTower(s, mid, floor) {
    var m = LH.MOD[mid], target = Math.max(1, m.minL || 1);
    floor = floor === undefined ? 8000 : floor;

    var ladder = null;
    for (var k in s.inst) {
      var i = s.inst[k];
      if (i.mid === 'ladder' && i.l0 <= 0 && i.l1 >= 5) { ladder = i; break; }
    }
    if (!ladder) {
      var r0 = rowEnds(s, 0);
      if (!r0) return null;
      var cs = [r0[1] + 1, r0[0] - 1];
      for (var ci = 0; ci < cs.length; ci++) {
        var chk = LH.checkPlace(s, 'ladder', cs[ci], 0, 5);
        if (chk.ok && s.credits - chk.cost > floor) {
          LH.place(s, 'ladder', cs[ci], 0, 5);
          return { tower: true };
        }
      }
      return null;
    }

    var dir = ladder.x > C.GRID_W / 2 ? -1 : 1;
    for (var L = 1; L < target; L++) {                   // decks below the target
      for (var n = 1; n <= m.w + 2; n++) {
        var px = ladder.x + dir * n;
        if (LH.occupied(s, px, L)) continue;
        var pc = LH.checkPlace(s, 'corridor', px, L, L);
        if (pc.ok && s.credits - pc.cost > floor) {
          LH.place(s, 'corridor', px, L, L);
          return { tower: true };
        }
      }
    }
    for (var n2 = 1; n2 <= m.w + 3; n2++) {              // and the module itself
      var mx = dir > 0 ? ladder.x + n2 : ladder.x - n2 - m.w + 1;
      var mc = LH.checkPlace(s, mid, mx, target, target);
      if (mc.ok && s.credits - mc.cost > floor) {
        var r = LH.place(s, mid, mx, target, target);
        if (r.ok) return r;
      }
    }
    return null;
  }

  /* Clear a run of corridors so a wide module can fit. A mature colony can
     have plenty of free cells and still no seven-cell gap for a Rec Dome.
     Surveys first and only demolishes once the placement is certain. */
  function makeRoom(s, mid, levels, floor) {
    var m = LH.MOD[mid];
    if (m.w < 2) return null;
    for (var li = 0; li < levels.length; li++) {
      var l = levels[li];
      if (!LH.levelOk(m, l)) continue;
      for (var x = 2; x + m.w <= C.GRID_W - 2; x++) {
        if (!LH.occupied(s, x - 1, l) && !LH.occupied(s, x + m.w, l)) continue;
        var ok = true, victims = [], seen = {}, supported = (l === 0 || l === -1);
        for (var k2 = 0; k2 < m.w; k2++) {
          var cx = x + k2, occ = LH.at(s, cx, l);
          if (occ) {
            if (occ.mid !== 'corridor') { ok = false; break; }
            if (!seen[occ.iid]) { seen[occ.iid] = true; victims.push(occ); }
          }
          if (!supported) {
            if (l > 0 && LH.occupied(s, cx, l - 1)) supported = true;
            if (l < -1 && LH.occupied(s, cx, l + 1)) supported = true;
          }
        }
        if (!ok || !supported || !victims.length) continue;
        if (s.credits - m.cost < (floor === undefined ? 8000 : floor)) return null;
        victims.forEach(function (v) { LH.remove(s, v.iid); });
        var chk = LH.checkPlace(s, mid, x, l, l);
        if (chk.ok) {
          var r = LH.place(s, mid, x, l, l);
          if (r.ok) return r;
        }
        victims.forEach(function (v) { LH.place(s, 'corridor', v.x, v.l, v.l); });
        return null;                                     // one attempt, never thrash
      }
    }
    return null;
  }

  LH.autopilot = function (s) {
    if (!s.auto) return;
    LH.solveTransit(s);                    // never judge reachability on stale data
    var acted = step(s);
    if (acted) {
      LH.solveTransit(s);
      if (s.credits > reserve(s) * 2) {    // rich colonies build faster
        if (step(s)) LH.solveTransit(s);
      }
    }
  };

  LH.toggleAuto = function () {
    var s = LH.S;
    s.auto = !s.auto;
    if (s.auto) s.autoEverUsed = true;
    var b = document.getElementById('btn-auto');
    if (b) b.classList.toggle('on', !!s.auto);
    LH.toast(s.auto ? 'Autopilot engaged — the colony will manage itself.' :
      'Autopilot disengaged. You have the controls.', s.auto ? 'good' : 'warn');
    if (s.auto) LH.log(s, 'auto', 'Autopilot engaged.');
  };

})(window.LH);
