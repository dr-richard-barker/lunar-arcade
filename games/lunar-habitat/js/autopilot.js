/* Lunar Habitat — autopilot. A colony director that plays the game itself.
   Runs once per simulated day; performs at most two build actions per day,
   always keeping a cash reserve. Toggle with the AUTO button or the B key. */

(function (LH) {
  'use strict';

  var C = LH.C;

  var SPINE_SPACING = 20;   // columns of colony per transit shaft

  /* -------------------------------------------------------------- helpers */

  function count(s, mid) { return LH.countOf(s, mid); }

  function reserve(s) {
    return Math.max(8000, (s.stats.upkeep || 0) * 8);
  }

  function afford(s, cost, floor) {
    return s.credits - cost >= (floor !== undefined ? floor : reserve(s));
  }

  /* Shaft columns are reserved on the first day and never built over, so a
     transit shaft can always be dropped in as the colony widens. Without this
     every column inside a mature colony is occupied on *some* level, no shaft
     can ever be inserted, and the whole settlement ends up walking to a single
     lift — which is what held morale below the tier-4 gate. */
  function planCols(s) {
    if (s.autoPlan) return s.autoPlan;
    var base = s.autoShaftX !== undefined ? s.autoShaftX : Math.floor(C.GRID_W / 2) + 2;
    var out = [];
    for (var k = -8; k <= 8; k++) {
      var c = base + k * SPINE_SPACING;
      if (c >= 10 && c <= C.GRID_W - 8) out.push(c);
    }
    out.sort(function (p, q) { return Math.abs(p - base) - Math.abs(q - base); });
    s.autoPlan = out;
    return out;
  }

  /* Reserved columns that do not yet carry a shaft.

     Cached per step. hitsReserved() is consulted once per candidate column, and
     growOnLevel scans the full width across every active level, so an uncached
     full-instance scan here cost on the order of 10^8 operations a day in a
     mature colony — enough to stall the game at 8x speed. The set can only
     change when a shaft is placed, and a step returns immediately after doing
     so, so one computation per step is exact rather than merely close. */
  var _resCache = null;
  function invalidateReserved() { _resCache = null; }

  function reservedFree(s) {
    if (_resCache) return _resCache;
    var plan = planCols(s), taken = {}, out = [];
    for (var k in s.inst) {
      var i = s.inst[k];
      if (i.mid === 'lift' || i.mid === 'express') taken[i.x] = true;
    }
    for (var j = 0; j < plan.length; j++) if (!taken[plan[j]]) out.push(plan[j]);
    _resCache = out;
    return out;
  }

  /* Would a module here actually reach an airlock? Reserved columns split a
     level into segments, so "next to something occupied" is not enough — the
     neighbour itself has to be connected. Placing blind meant building a mess
     hall into a stranded pocket and demolishing it again next step. */
  function joinsColony(s, x, w, l) {
    var sides = [LH.at(s, x - 1, l), LH.at(s, x + w, l)];
    for (var i = 0; i < sides.length; i++) {
      if (sides[i] && sides[i].dist < Infinity) return true;
    }
    return false;
  }

  function hitsReserved(s, x, w) {
    var res = reservedFree(s);
    for (var i = 0; i < res.length; i++) if (res[i] >= x && res[i] < x + w) return true;
    return false;
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
      // empty level: start beside any shaft that reaches it
      for (var sk in s.inst) {
        var si = s.inst[sk];
        if ((si.mid !== 'lift' && si.mid !== 'express') || l > si.l1 || l < si.l0) continue;
        cands.push(si.x + 1); cands.push(si.x - m.w);
      }
    }
    var broke = false;
    for (var i = 0; i < cands.length; i++) {
      var x = cands[i];
      if (x === null || x < 2 || x + m.w > C.GRID_W - 2) continue;
      if (!m.vertical && hitsReserved(s, x, m.w)) continue;      // keep the spine clear
      if (!m.vertical && !joinsColony(s, x, m.w, l)) continue;
      var chk = LH.checkPlace(s, mid, x, l, l);
      if (chk.ok && afford(s, chk.cost, floor)) {
        var r = LH.place(s, mid, x, l, l);
        if (r.ok) return r;
      }
      // space exists but the treasury can't cover it: save, don't improvise
      if (chk.ok || (chk.reason && chk.reason.indexOf('Not enough credits') === 0)) broke = true;
    }

    /* Row ends only works until the rows reach the edge of the survey area.
       After that a colony can be three levels deep with a hundred usable
       interior gaps and still refuse to grow, which is exactly what capped it
       at 210 people. Fall back to any gap that touches existing structure —
       the adjacency test is what stops it stranding modules. */
    for (var gx = 2; gx + m.w <= C.GRID_W - 2; gx++) {
      if (LH.occupied(s, gx, l)) continue;
      if (!m.vertical && hitsReserved(s, gx, m.w)) continue;     // keep the spine clear
      if (!joinsColony(s, gx, m.w, l)) continue;
      var gchk = LH.checkPlace(s, mid, gx, l, l);
      if (!gchk.ok) {
        if (gchk.reason && gchk.reason.indexOf('Not enough credits') === 0) broke = true;
        continue;
      }
      if (!afford(s, gchk.cost, floor)) { broke = true; continue; }
      var gr = LH.place(s, mid, gx, l, l);
      if (gr.ok) return gr;
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

  /* Solar is 'aboveOr0', so once the surface deck fills there is still an
     entire 26-level sky to build in — and at scale that is the difference
     between a colony that recharges its batteries during the lunar day and one
     that browns out every night. The director only ever asked for level 0, so a
     full surface deck capped generation permanently: population stalled at 246
     not for want of space (683 cells were free) but because night shedding
     zeroed its income and it could never afford anything again.

     Level +1 is deliberately left as a corridor deck rather than solar: it is
     the only level a garden dome can occupy, and 1-wide corridors can be
     cleared to make room for one whereas a spread solar farm cannot. */
  function raiseSolar(s, floor) {
    var r = growOnLevel(s, 'solar', 0, floor);
    if (r && r !== 'broke') return r;
    var broke = (r === 'broke');

    for (var l = 2; l <= 5; l++) {
      var up = growOnLevel(s, 'solar', l, floor);
      if (up && up !== 'broke') return up;
      if (up === 'broke') broke = true;
    }
    // nothing to attach to up there yet: a ladder for access, then a deck
    if (!count(s, 'ladder')) {
      var r0 = rowEnds(s, 0);
      if (r0) {
        var lc = [r0[1] + 1, r0[0] - 1, C.GRID_W - 4, 3];
        for (var li = 0; li < lc.length; li++) {
          var lchk = LH.checkPlace(s, 'ladder', lc[li], 0, 5);
          if (lchk.ok && afford(s, lchk.cost, floor)) {
            LH.place(s, 'ladder', lc[li], 0, 5);
            return { deck: true };
          }
        }
      }
    }
    for (var l2 = 1; l2 <= 3; l2++) {
      var deck = growOnLevel(s, 'corridor', l2, floor);
      if (deck && deck !== 'broke') return deck;
      if (deck === 'broke') broke = true;
    }
    return broke ? 'broke' : null;
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
    invalidateReserved();

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
    /* Income legitimately falls to nothing during the fourteen-day night, so one
       day in the red means nothing. Selling on it destroyed the colony's own
       medical bays and schools every lunar cycle — 22 distress sales per 3,000
       days — and morale never recovered in between. */
    s.autoDeficitDays = balNow < 0 ? (s.autoDeficitDays || 0) + 1 : 0;
    if (s.credits < -5000 && balNow < 0 && s.autoDeficitDays >= 16) {
      var cut = null, cutUp = 0;
      for (var ci in s.inst) {
        var cinst = s.inst[ci], cm = LH.MOD[cinst.mid];
        if (cm.cat !== 'amen' && cm.cat !== 'work') continue;
        if (cm.id === 'maint' || cm.id === 'admin') continue;    // keep the essentials
        if (cm.up > cutUp) { cut = cinst; cutUp = cm.up; }
      }
      /* Selling a module out of the middle of a level cuts the corridor run
         and strands everything beyond it, which the orphan sweep then
         demolishes — one sale used to cascade into the whole colony. Only
         sell something the colony can lose without severing itself. */
      if (cut) {
        var cName = LH.MOD[cut.mid].name;
        var cMid = cut.mid, cX = cut.x, cL = cut.l;
        var before = s.stats.orphans || 0;
        LH.remove(s, cut.iid);
        LH.solveTransit(s);
        var after = 0;
        for (var ok2 in s.inst) if (s.inst[ok2].dist === Infinity && s.inst[ok2].mid !== 'shield') after++;
        if (after > before) {
          LH.place(s, cMid, cX, cL, cL);          // load-bearing: put it back
          LH.solveTransit(s);
        } else {
          return act(s, 'sold off the ' + cName + ' to stop the bleeding', true);
        }
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
      return act(s, 'raised a solar array', raiseSolar(s, 3000));
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

    /* 2.9 - the finish line. Once population and morale already satisfy the
       next charter tier and only buildings are missing, stop pouring every
       credit into more housing and actually buy the things the charter asks
       for — otherwise the colony grows forever one requirement short. */
    /* Only active load shedding is a real emergency. Demanding a perfectly
       serene colony meant the saving window never opened, because a colony
       this size always has some balance wobbling near zero. */
    var stable = (st.shed || 0) === 0 && s.credits > -2000;
    var progNow = LH.tierProgress(s);
    if (progNow && stable) {
      var missing = progNow.items.filter(function (it) { return !it.ok; });
      var onlyBuildings = missing.length > 0 && missing.every(function (it) {
        return /^(Population|Morale)/.test(it.label) === false;
      });
      if (onlyBuildings) {
        for (var fi = 0; fi < missing.length; fi++) {
          for (var fm in LH.MOD) {
            if (LH.MOD[fm].name !== missing[fi].label || count(s, fm) > 0) continue;
            var fd = LH.MOD[fm], rF = null;
            if (fd.where === 'above') rF = buildTower(s, fm, 4000);
            else if (fd.where === 'surface' || fd.where === 'aboveOr0') {
              rF = growOnLevel(s, fm, 0, 4000);
              if (rF === null) rF = makeRoom(s, fm, [0], 4000);
            } else if (fd.maxL !== undefined && fd.maxL < -1) {
              rF = deepBuild(s, fm, 4000);
              if (rF === null || rF === 'broke') {
                var dLv = [];
                for (var dz = fd.maxL; dz >= (s.autoShaftBot || -8); dz--) dLv.push(dz);
                rF = makeRoom(s, fm, dLv, 4000);
              }
            } else {
              rF = growAny(s, fm, subs, 4000);
              if (rF === null) rF = makeRoom(s, fm, subs, 4000);
            }
            if (rF && rF !== 'broke' && !rF.redirected) {
              return act(s, 'built ' + fd.name + ' to complete the charter', rF);
            }
            /* There is room but not yet the money: stop shopping for the day
               so the surplus actually accumulates. At a healthy margin the
               charter is a fortnight of saving, not an impossibility. */
            if (rF === 'broke') return false;
          }
        }
      }
    }

    /* -- shared bookkeeping ------------------------------------------- */
    /* Size power off full potential draw, never st.powerUse — that figure is
       measured *after* load shedding, so during the very brownout the colony
       needs to fix it reads low and the director concludes all is well. */
    var gen = 0, demand = 0, solarGen = 0, steadyGen = 0;
    var dustTotal = 0, solarN = 0;
    for (var pk in s.inst) {
      var pi = s.inst[pk], pm = LH.MOD[pi.mid];
      if (pi.dist === Infinity) continue;
      if (pm.power > 0) {
        var out = pm.power * (1 - pi.dmg) * (pm.id === 'solar' ? (1 - pi.dust) : 1);
        gen += out;
        if (pm.id === 'solar') { solarGen += out; dustTotal += pi.dust; solarN++; }
        else steadyGen += out;
      } else if (pm.power < 0) demand -= pm.power;
    }
    /* Size for the berths that exist, not the people already in them. Empty
       berths fill fast, so chasing current population means the grid is always
       one wave of arrivals behind — which showed up as a 35-module brownout
       every lunar night once morale (and therefore immigration) improved. */
    var soonPop = Math.max(s.pop, st.housing || 0);
    demand += soonPop * C.POWER_PER_POP + s.tourists * 0.15;
    var headroom = gen - demand;                        // at full sun
    /* Generation must also bank enough surplus during the fourteen-day day to
       carry the fourteen-day night, which means covering roughly twice the
       demand the reactors do not already handle. */
    var rechargeNeed = 2 * Math.max(0, demand - steadyGen);
    var bal = (st.income || 0) - (st.upkeep || 0);

    /* 3 - POWER before everything else: a browned-out colony earns nothing.
       Power builds may spend almost to the floor - they are survival. */
    if (headroom < 12 || solarGen < rechargeNeed * 0.95) {
      if (s.tier >= 3 && act(s, 'commissioned a buried fission plant', deepBuild(s, 'fission', 3000)))
        return true;
      if (act(s, 'raised another solar array', raiseSolar(s, 3000))) return true;
    }
    if ((st.powerCap || 0) < Math.max(0, demand - steadyGen) * (C.LUNAR_CYCLE / 2) * 1.0) {
      var rBat = growOnLevel(s, 'battery', 0, 3000);
      if (rBat === null) rBat = growAny(s, 'battery', subs, 3000);   // batteries fit anywhere
      if (act(s, 'banked more batteries for the long night', rBat)) return true;
    }
    if (solarN > 0 && dustTotal / solarN > 0.2 && count(s, 'maint') < Math.ceil(solarN / 4)) {
      var rMb = growOnLevel(s, 'maint', 0, 4000);
      if (rMb === null) rMb = growAny(s, 'maint', subs, 4000);
      if (act(s, 'added a maintenance bay to keep the arrays clean', rMb)) return true;
    }

    /* 4 - life support, built to a margin rather than to the brink. A balance
       of +1 is one lander of arrivals away from a crisis, and a crisis costs
       22 morale a day plus crew health that takes weeks to win back. */
    var lsMargin = 8 + Math.max(s.pop, st.housing || 0) * 0.05;
    if ((st.o2Bal || 0) < lsMargin)
      { if (act(s, 'expanded oxygen production', growAny(s, 'scrubber', subs, 3000))) return true; }
    if ((st.waterBal || 0) < lsMargin)
      { if (act(s, 'expanded water recycling', growAny(s, 'recycler', subs, 3000))) return true; }
    if ((st.foodBal || 0) < lsMargin)
      { if (act(s, 'expanded hydroponics', growAny(s, 'hydro', subs, 3000))) return true; }
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
      { if (act(s, 'expanded oxygen production', growAny(s, 'scrubber', subs, 3000))) return true; }
    if (h2oNet < need * C.WATER_PER_POP) {
      if (s.tier >= 2 && (s.autoShaftBot || 0) <= -10 && count(s, 'icemine') === 0) {
        var rIce = growAny(s, 'icemine', [-10, -11, -12].filter(function (l) { return subs.indexOf(l) >= 0; }));
        if (rIce) return act(s, 'tapped buried ice', rIce);
      }
      { if (act(s, 'expanded water recycling', growAny(s, 'recycler', subs, 3000))) return true; }
    }
    if (foodNet < need * C.FOOD_PER_POP)
      { if (act(s, 'expanded hydroponics', growAny(s, 'hydro', subs, 3000))) return true; }

    /* 4.5 - the charter's two towers, claimed EARLY. The observatory and garden
       dome gate tier 5, cost ₵42k and ₵48k against a colony that ends with
       millions, and need clear sky. Left in the prestige branch they were never
       built at all: a rich colony always finds housing or amenities to do first,
       so the late branches simply never run. */
    if (s.credits > 120000) {
      /* By the time the colony is this rich the solar farm has paved the sky, so
         the towers can never find a gap. Two arrays out of a hundred buys a
         whole charter tier — but only once losing them is genuinely incidental. */
      var mayClearSky = s.credits > 500000 && count(s, 'solar') > 20
        ? ['corridor', 'solar'] : ['corridor'];
      if (s.tier >= LH.MOD.obs.tier && count(s, 'obs') === 0) {
        var rObsE = buildTower(s, 'obs', 60000, mayClearSky);
        if (rObsE) return act(s, 'built the observatory', rObsE);
      }
      if (s.tier >= LH.MOD.garden.tier && count(s, 'garden') === 0) {
        var rGarE = buildTower(s, 'garden', 60000, mayClearSky);
        if (rGarE) return act(s, 'grew a garden dome', rGarE);
      }
    }

    /* 4.8 - amenities BEFORE housing. Housing used to win every priority
       contest, so at scale the colony added berths faster than it added reasons
       to live in them: it hit tier 5 at population 540 and then fell apart with
       morale at 27. Coverage first, then people. */
    /* Amenity coverage is the other half of morale, and these are cheap now.
       Each want falls through when it cannot be met rather than aborting the
       director — an unaffordable mess hall used to stop the medical bay, the
       exercise deck and everything below it from ever being considered, which
       is why a colony with a perfect transit spine still had zero coverage. */
    if (s.morale < 78 || s.pop > 10) {
      var popN = Math.round(s.pop);
      var wants = [
        ['mess',   Math.max(1, Math.ceil(popN / 26)),            'opened a mess hall'],
        ['gym',    popN > 14 ? Math.max(1, Math.ceil(popN / 55)) : 0, 'fitted an exercise deck'],
        ['med',    popN > 14 ? Math.max(1, Math.ceil(popN / 70)) : 0, 'staffed a medical bay'],
        ['rec',    s.tier >= 3 ? Math.ceil(popN / 90) : 0,        'inflated a rec dome'],
        ['school', s.tier >= 3 && popN > 30 ? 1 : 0,              'opened the school']
      ];
      for (var wi = 0; wi < wants.length; wi++) {
        if (count(s, wants[wi][0]) >= wants[wi][1]) continue;
        var rW = growAny(s, wants[wi][0], subs, 3000);
        if (rW === null) rW = makeRoom(s, wants[wi][0], subs, 3000);
        if (act(s, wants[wi][2], rW)) return true;
      }
    }

    /* 5 - grow the settlement: housing fills itself, people pay rent.
       Housing is the engine of the whole economy - build it eagerly. */
    var vacancy = Math.floor(st.housing || 0) - Math.round(s.pop);
    /* Three levels of rock is full radiation shielding; -1 and -2 are not,
       and a colony housed there loses people to every solar flare. Put crew
       under the rock first and only spread shallower if there is no room. */
    var deepSubs = subs.filter(function (l) { return l <= -3; });
    var canAbsorb = (st.o2Bal || 0) > 6 && (st.waterBal || 0) > 5.5 && (st.foodBal || 0) > 5 &&
                    (st.shed || 0) === 0;
    /* Adding berths when morale is already sinking just spreads the same
       amenities over more people. Let it recover first. */
    var moraleHeadroom = s.pop < 120 || (s.morale > 52 && (st.moraleTarget || 0) > 56);
    if (vacancy < 4 && s.morale > 40 && canAbsorb && moraleHeadroom) {
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

    /* 5.5 - the spine. Drop a transit shaft into the next reserved column the
       colony has actually reached, with its own airlock beside it. The airlock
       is what shortens transit (every airlock is a zero-distance source for
       the solver); the shaft is what carries that benefit down to the levels
       where people live. One lift for a hundred-and-thirty-column colony is
       what pinned morale in the forties. */
    var freeCols = reservedFree(s), spineCol = null;
    for (var fc = 0; fc < freeCols.length; fc++) {
      var cand = freeCols[fc], reached = false;
      for (var rl = 0; rl >= (s.autoShaftBot || -8) && !reached; rl--) {
        if (LH.occupied(s, cand - 1, rl) || LH.occupied(s, cand + 1, rl)) reached = true;
      }
      if (reached) { spineCol = cand; break; }
    }
    if (spineCol !== null) {
      var spKind = s.tier >= 3 ? 'express' : 'lift';
      /* A reserved column is clear at every level, so a new shaft may as well go
         as deep as the treasury allows. Pinning it to the existing floor meant
         every shaft stopped at -8 and nothing could ever be built below. */
      var spBot = Math.max(-22, -(LH.MOD[spKind].span - 1), -C.MAX_DOWN);
      var spTry = LH.checkPlace(s, spKind, spineCol, 0, spBot);
      while (spBot < -6 && (!spTry.ok || !afford(s, spTry.cost, 3000))) {
        spBot += 2;
        spTry = LH.checkPlace(s, spKind, spineCol, 0, spBot);
      }
      var spChk = LH.checkPlace(s, spKind, spineCol, 0, spBot);
      if (spChk.ok && afford(s, spChk.cost, 3000)) {
        LH.place(s, spKind, spineCol, 0, spBot);
        if (spBot < (s.autoShaftBot || -8)) s.autoShaftBot = spBot;
        // a front door beside it, wherever there is room on the surface deck
        for (var ao = 1; ao <= 6; ao++) {
          var aOpts = [spineCol + ao, spineCol - LH.MOD.airlock.w - ao + 1];
          var placed = false;
          for (var ai = 0; ai < aOpts.length && !placed; ai++) {
            var aChk = LH.checkPlace(s, 'airlock', aOpts[ai], 0, 0);
            if (aChk.ok && afford(s, aChk.cost, 2000)) {
              LH.place(s, 'airlock', aOpts[ai], 0, 0); placed = true;
            }
          }
          if (placed) break;
        }
        return act(s, 'sank a transit shaft and airlock at column ' + spineCol, true);
      }
    }

    /* 5.55 - every shaft deserves a door. The airlock used to be a one-shot
       attempt made in the same breath as the shaft, so whenever the shaft had
       just drained the treasury the colony ended up with shafts and no new
       front doors — and an airlock is the thing that actually shortens
       transit, because the solver measures distance from one. */
    var shaftN = count(s, 'lift') + count(s, 'express');
    if (count(s, 'airlock') < shaftN) {
      for (var dk in s.inst) {
        var dsh = s.inst[dk];
        if (dsh.mid !== 'lift' && dsh.mid !== 'express') continue;
        var near = false;
        for (var nx = dsh.x - 7; nx <= dsh.x + 7 && !near; nx++) {
          var no = LH.at(s, nx, 0);
          if (no && no.mid === 'airlock') near = true;
        }
        if (near) continue;
        for (var eo = 1; eo <= 6; eo++) {
          var eOpts = [dsh.x + eo, dsh.x - LH.MOD.airlock.w - eo + 1];
          for (var ei = 0; ei < eOpts.length; ei++) {
            var eChk = LH.checkPlace(s, 'airlock', eOpts[ei], 0, 0);
            if (eChk.ok && afford(s, eChk.cost, 3000)) {
              LH.place(s, 'airlock', eOpts[ei], 0, 0);
              return act(s, 'opened a front door at the column-' + dsh.x + ' shaft', true);
            }
          }
        }
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
  function buildTower(s, mid, floor, clearAlso) {
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
    /* The deck is continuous by the time the colony is rich, so a nine-wide
       dome will not find a gap beside the ladder. Clear one. */
    var cleared = makeRoom(s, mid, [target], floor, clearAlso);
    if (cleared && cleared !== 'broke') return cleared;
    return null;
  }

  /* Clear a run of corridors so a wide module can fit. A mature colony can
     have plenty of free cells and still no seven-cell gap for a Rec Dome.
     Surveys first and only demolishes once the placement is certain. */
  /* `clearable` says what may be demolished to make space, corridors only by
     default. Sacrificing a solar array is safe for a rich colony with a hundred
     of them and ruinous for a poor one with four, so the caller decides. */
  function makeRoom(s, mid, levels, floor, clearable) {
    var m = LH.MOD[mid];
    if (m.w < 2) return null;
    clearable = clearable || ['corridor'];
    for (var li = 0; li < levels.length; li++) {
      var l = levels[li];
      if (!LH.levelOk(m, l)) continue;
      for (var x = 2; x + m.w <= C.GRID_W - 2; x++) {
        if (!LH.occupied(s, x - 1, l) && !LH.occupied(s, x + m.w, l)) continue;
        var ok = true, victims = [], seen = {}, supported = (l === 0 || l === -1);
        for (var k2 = 0; k2 < m.w; k2++) {
          var cx = x + k2, occ = LH.at(s, cx, l);
          if (occ) {
            if (clearable.indexOf(occ.mid) < 0) { ok = false; break; }
            if (!seen[occ.iid]) { seen[occ.iid] = true; victims.push(occ); }
          }
          if (!supported) {
            if (l > 0 && LH.occupied(s, cx, l - 1)) supported = true;
            if (l < -1 && LH.occupied(s, cx, l + 1)) supported = true;
          }
        }
        if (!ok || !supported || !victims.length) continue;
        if (s.credits - m.cost < (floor === undefined ? 8000 : floor)) return null;
        /* Record the exact cells being freed: the replacement is rarely the same
           width as what it displaces, and any cell left empty severs the run and
           strands everything beyond it. */
        var freed = [];
        victims.forEach(function (v) {
          v.cells.forEach(function (c) { freed.push([c[0], c[1]]); });
          LH.remove(s, v.iid);
        });
        var chk = LH.checkPlace(s, mid, x, l, l);
        if (chk.ok) {
          var r = LH.place(s, mid, x, l, l);
          if (r.ok) {
            // backfill the offcuts so the level stays continuous
            freed.forEach(function (c) {
              if (!LH.occupied(s, c[0], c[1])) LH.place(s, 'corridor', c[0], c[1], c[1]);
            });
            return r;
          }
        }
        victims.forEach(function (v) { LH.place(s, v.mid, v.x, v.l, v.l); });
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
