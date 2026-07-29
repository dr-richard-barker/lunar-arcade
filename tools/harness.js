/* Lunar Habitat — headless balance harness.

   Runs scenarios against the real simulation and asserts on the outcome. It
   loads config/grid/sim/autopilot/league only — never render, ui, report or
   main — so there is no canvas, no input, no autosave and no localStorage
   write. Nothing here re-implements game logic: every number is either read
   from LH.C / LH.MOD / LH.TIERS or measured by running LH.tick.

   Why this exists: the balance work was done by hand in the browser console,
   which meant the early game was repeatedly regressed and re-fixed without
   anyone noticing. And the single most expensive mistake in the project — days
   spent making an AI reach a charter tier that was mathematically unreachable
   for any player — would have been caught in minutes by SCENARIO 1. */

(function (LH) {
  'use strict';

  var C = LH.C, MOD = LH.MOD;
  var H = LH.Harness = {};

  /* Headless stubs. league.js guards every DOM lookup except showEndScreen,
     so this one no-op is all that is needed to let checkEnd/endRun run. */
  LH.showEndScreen = function () {};
  LH.toast = LH.toast || function () {};

  /* Sandbox bypasses the tier gate in checkPlace, so it is how the harness
     unlocks the catalogue. Pre-setting s.tier would instead trip the "capital"
     end condition on tick one and stop the run dead. */
  function unlocked(s, mid) { return s.sandbox || MOD[mid].tier <= s.tier; }
  H.unlocked = unlocked;

  /* ------------------------------------------------------------ reporting */

  function fmt(n, dp) {
    if (n === Infinity) return '∞';
    return (dp ? n.toFixed(dp) : Math.round(n)).toLocaleString('en-US');
  }

  function Report(name, subtitle) {
    // NB: the descriptive text is `subtitle`, not `note` — an instance field
    // named `note` would shadow the note() method below and throw on first use.
    this.name = name; this.subtitle = subtitle || '';
    this.checks = []; this.metrics = {}; this.notes = [];
  }
  Report.prototype.check = function (label, ok, actual, expected, opts) {
    this.checks.push({ label: label, ok: !!ok, actual: actual, expected: expected,
                       todo: !!(opts && opts.todo) });
    return ok;
  };
  /* A known-debt check still reports its real result, but does not fail the
     suite — otherwise the harness stays permanently red and people stop reading
     it, which defeats the point of having it. */
  Report.prototype.debt = function (label, ok, actual, expected) {
    return this.check(label, ok, actual, expected, { todo: true });
  };
  Report.prototype.metric = function (k, v) { this.metrics[k] = v; return v; };
  Report.prototype.note = function (t) { this.notes.push(t); };
  Report.prototype.passed = function () {
    var real = this.checks.filter(function (c) { return !c.todo; });
    return real.length > 0 && real.every(function (c) { return c.ok; });
  };
  Report.prototype.debts = function () {
    return this.checks.filter(function (c) { return c.todo && !c.ok; }).length;
  };

  /* --------------------------------------------------------- colony plans */

  /* Size a self-sufficient colony for a target population, deriving every
     count from the module catalogue and the per-head constants. Because it
     reads MOD/C rather than hardcoding, a config change reshapes the plan
     instead of silently invalidating the test. */
  H.planFor = function (targetPop) {
    var hydroN = Math.ceil(targetPop * C.FOOD_PER_POP / MOD.hydro.food);
    var o2Need = targetPop * C.O2_PER_POP - hydroN * (MOD.hydro.o2 || 0);
    var scrubN = Math.max(1, Math.ceil(o2Need / MOD.scrubber.o2));
    var waterNeed = targetPop * C.WATER_PER_POP + hydroN * -(MOD.hydro.water || 0);
    var recyN = Math.max(1, Math.ceil(waterNeed / MOD.recycler.water));
    var blockN = Math.ceil(targetPop / MOD.block.pop);

    // amenity clusters, sized so coverage clears the top charter's morale bar
    var clusters = Math.max(1, Math.round(targetPop / 90));

    var plan = {
      targetPop: targetPop,
      hab: { block: blockN },
      life: { hydro: hydroN, scrubber: scrubN, recycler: recyN },
      amen: { mess: clusters * 2, gym: clusters, med: clusters,
              school: clusters, rec: clusters, maint: Math.max(1, clusters) },
      work: { admin: Math.max(1, Math.round(targetPop / 120)), refinery: 1 },
      mine: { mine: Math.ceil(MOD.refinery.ore_in / MOD.mine.ore) }
    };

    /* Power last, because it depends on everything above. Fission is steady,
       so a colony carried by reactors has no lunar-night problem at all and
       needs no battery bank — which is the whole reason to prefer it at scale. */
    var draw = targetPop * C.POWER_PER_POP;
    ['hab', 'life', 'amen', 'work', 'mine'].forEach(function (grp) {
      for (var mid in plan[grp]) {
        var m = MOD[mid];
        if (m.power < 0) draw += -m.power * plan[grp][mid];
      }
    });
    var fissionN = Math.ceil(draw * 1.35 / MOD.fission.power);
    draw += fissionN * 0; // reactors draw nothing themselves
    plan.power = { fission: fissionN };
    plan.estDraw = draw;

    // jobs must not exceed the workforce or every output is throttled
    var jobs = 0;
    ['hab', 'life', 'amen', 'work', 'power', 'mine'].forEach(function (grp) {
      for (var mid in plan[grp]) jobs += (MOD[mid].jobs || 0) * plan[grp][mid];
    });
    plan.jobs = jobs;
    plan.workforce = Math.floor(targetPop * 0.62);
    return plan;
  };

  /* --------------------------------------------------------------- layout */

  function freeRun(s, l, x, w) {
    for (var i = 0; i < w; i++) if (LH.occupied(s, x + i, l)) return false;
    return true;
  }

  /* Lay a colony out: a spine of shafts with airlocks, a surface deck, then
     each subsurface level filled left to right (which satisfies the
     support rule, since the level above is always complete first). */
  H.build = function (s, plan, opts) {
    opts = opts || {};
    var depth = opts.depth || 20;
    var spacing = opts.spacing || 20;
    var x0 = 6, x1 = C.GRID_W - 6;
    var shafts = [];

    var kind = unlocked(s, 'express') ? 'express' : 'lift';
    var span = MOD[kind].span;
    var bottom = Math.max(-depth, -(span - 1), -C.MAX_DOWN);

    for (var c = x0 + 4; c < x1 - 4; c += spacing) {
      if (LH.place(s, kind, c, 0, bottom).ok) shafts.push(c);
    }
    shafts.forEach(function (c) { LH.place(s, 'airlock', c + 1, 0, 0); });

    // surface deck: power is subsurface, so the surface earns its keep
    var surface = ['pad', 'he3', 'solar', 'solar'];
    var si = 0;
    for (var sx = x0; sx < x1; ) {
      if (LH.occupied(s, sx, 0)) { sx++; continue; }
      var mid = surface[si % surface.length];
      if (freeRun(s, 0, sx, MOD[mid].w) && LH.place(s, mid, sx, 0, 0).ok) {
        sx += MOD[mid].w; si++;
      } else if (LH.place(s, 'corridor', sx, 0, 0).ok) { sx++; }
      else sx++;
    }

    // one flat queue of everything the plan calls for
    var queue = [];
    ['power', 'life', 'hab', 'amen', 'work', 'mine'].forEach(function (grp) {
      for (var mid in plan[grp]) {
        for (var n = 0; n < plan[grp][mid]; n++) queue.push(mid);
      }
    });

    var placed = {}, qi = 0;
    for (var l = -1; l >= bottom; l--) {
      /* Site depth-limited modules first: by the time a row is filled there is
         no six-cell gap left for a Deep Core Complex. */
      if (opts.core && l === MOD.core.maxL && unlocked(s, 'core')) {
        for (var kx = x0 + 2; kx < x1 - MOD.core.w; kx++) {
          if (freeRun(s, l, kx, MOD.core.w) && LH.place(s, 'core', kx, l, l).ok) {
            placed.core = (placed.core || 0) + 1;
            break;
          }
        }
      }
      for (var x = x0; x < x1; ) {
        if (LH.occupied(s, x, l)) { x++; continue; }
        var put = null;
        // find the next queued module that fits here and is legal at this level
        for (var probe = qi; probe < queue.length; probe++) {
          var cand = queue[probe];
          if (!LH.levelOk(MOD[cand], l)) continue;
          if (!freeRun(s, l, x, MOD[cand].w)) continue;
          if (!LH.place(s, cand, x, l, l).ok) continue;
          queue.splice(probe, 1);
          put = cand;
          break;
        }
        if (put) {
          placed[put] = (placed[put] || 0) + 1;
          x += MOD[put].w;
        } else {
          if (!LH.place(s, 'corridor', x, l, l).ok) { x++; }
          else x++;
        }
      }
    }

    if (opts.towers) H.buildTowers(s, placed);

    return { shafts: shafts, placed: placed, unplaced: queue.length, bottom: bottom };
  };

  /* Above-surface modules need a ladder up the outside and corridor decks to
     stand on — the same construction the autopilot uses. */
  H.buildTowers = function (s, placed) {
    var want = [];
    if (unlocked(s, 'obs')) want.push('obs');
    if (unlocked(s, 'garden')) want.push('garden');
    if (!want.length) return;

    /* The ladder needs a column that is FREE at level 0, and the surface deck
       is filled solid from x0 to x1 — so look just outside that band first.
       Searching inward from x1-2 (as this did originally) only ever found
       occupied cells, silently skipped every tower, and left the colony stuck
       two tiers short with no explanation. */
    var lad = null;
    var tryCols = [];
    for (var e = C.GRID_W - 6; e <= C.GRID_W - 3; e++) tryCols.push(e);   // outside the deck
    for (var e2 = 5; e2 >= 2; e2--) tryCols.push(e2);                      // other edge
    for (var li = 0; li < tryCols.length; li++) {
      if (LH.place(s, 'ladder', tryCols[li], 0, 5).ok) { lad = tryCols[li]; break; }
    }
    if (lad === null) return;

    var dir = lad > C.GRID_W / 2 ? -1 : 1;      // build inward from the ladder
    want.forEach(function (mid) {
      var target = Math.max(1, MOD[mid].minL || 1), w = MOD[mid].w;
      for (var L = 1; L < target; L++) {
        for (var n = 1; n <= w + 3; n++) LH.place(s, 'corridor', lad + dir * n, L, L);
      }
      for (var n2 = 1; n2 <= w + 3; n2++) {
        var mx = dir > 0 ? lad + n2 : lad - n2 - w + 1;
        if (LH.place(s, mid, mx, target, target).ok) {
          placed[mid] = (placed[mid] || 0) + 1;
          return;
        }
      }
    });
  };

  /* ---------------------------------------------------------- diagnostics */

  /* The morale breakdown I had to hand-write in the console over and over.
     Mirrors sim.js's own terms so a discrepancy here means sim.js changed. */
  H.moraleBreakdown = function (s) {
    var out = { habitats: 0, seats: 0, avgCommute: 0, worstCommute: 0,
                avgAmenity: 0, unshielded: 0, offline: 0 };
    var dsum = 0, asum = 0, n = 0;
    for (var k in s.inst) {
      var i = s.inst[k], m = MOD[i.mid];
      if (!m.pop || i.dist === Infinity) continue;
      n++;
      dsum += i.dist;
      if (i.dist > out.worstCommute) out.worstCommute = i.dist;
      asum += LH.amenityAt(s, i.x + i.w / 2, i.l);
      if (!LH.shielded(s, i)) out.unshielded++;
      if (!i.on) out.offline++;
      out.seats += i.occCap || 0;
    }
    out.habitats = n;
    out.avgCommute = n ? dsum / n : 0;
    out.avgAmenity = n ? asum / n : 0;
    out.amenityCap = 32;              // the cap sim.js applies
    out.commuteFree = C.COMMUTE_GOOD;
    out.health = s.health;
    out.healthPenalty = s.health < 80 ? Math.min(18, (80 - s.health) * 0.28) : 0;
    out.moraleTarget = s.stats.moraleTarget;
    out.morale = s.morale;
    return out;
  };

  H.powerBreakdown = function (s) {
    var solar = 0, steady = 0, draw = 0, cap = 0;
    for (var k in s.inst) {
      var i = s.inst[k], m = MOD[i.mid];
      if (i.dist === Infinity) continue;
      if (m.store) cap += m.store * (1 - i.dmg);
      if (m.power > 0) {
        var o = m.power * (1 - i.dmg);
        if (m.id === 'solar') solar += o * (1 - i.dust); else steady += o;
      } else if (m.power < 0) draw += -m.power;
    }
    draw += s.pop * C.POWER_PER_POP + s.tourists * 0.15;
    var nightGap = Math.max(0, draw - steady);
    return {
      solar: solar, steady: steady, draw: draw, storage: cap,
      dayHeadroom: solar + steady - draw,
      rechargeNeed: 2 * nightGap,                       // solar must cover the night too
      rechargeOk: solar >= 2 * nightGap - 0.001,
      nightStorageNeed: nightGap * (C.LUNAR_CYCLE / 2),
      nightStorageOk: cap >= nightGap * (C.LUNAR_CYCLE / 2) - 0.001,
      shed: s.stats.shed || 0
    };
  };

  /* --------------------------------------------------------------- runner */

  function run(s, days, opts) {
    opts = opts || {};
    for (var d = 0; d < days; d++) {
      LH.tick(s);
      if (opts.auto) LH.autopilot(s);
      LH.checkEnd(s);
      if (s.ended && s.ended !== 'continued') break;
    }
    return s;
  }
  H.run = run;

  function fresh(seed) {
    var s = LH.newState();
    s.rseed = seed === undefined ? 12345 : seed;   // deterministic event stream
    return s;
  }
  H.fresh = fresh;

  /* ------------------------------------------------------------ scenarios */

  H.scenarios = {};

  /* SCENARIO 1 — the assertion whose absence cost the most.
     Is the FINAL charter tier reachable by anybody at all? Builds a colony
     proportioned for the top tier's population and checks every requirement
     the game itself asks for, read straight from LH.TIERS. */
  H.scenarios.reachable = function () {
    var top = LH.TIERS[LH.TIERS.length - 1];
    var r = new Report('Final charter is reachable',
      'Ideal colony sized for ' + top.name + ' — proves the win condition exists at all');

    var s = fresh();
    /* Sandbox only, and deliberately NOT s.tier — sandbox unlocks the catalogue
       for placement while leaving the game to promote its own tiers, so this
       asserts the real progression rather than a hand-set number. */
    s.sandbox = true;

    var plan = H.planFor(top.req.pop);
    var built = H.build(s, plan, { depth: 20, spacing: 20, core: true, towers: true });

    // run until the game itself declares the charter complete, or we give up
    var days = 0;
    while (days < 600 && !s.ended) { LH.tick(s); LH.checkEnd(s); days++; }

    r.metric('days to charter', days);
    r.metric('outcome', s.ended || 'never ended');
    r.metric('charter tier', s.tier + ' of ' + LH.TIERS.length +
      ' (' + (LH.TIERS[s.tier - 1] || {}).name + ')');
    r.metric('population', fmt(s.pop) + ' / ' + fmt(Math.round(s.stats.housing)) + ' berths');
    r.metric('morale', +s.morale.toFixed(1));
    r.metric('health', Math.round(s.health));
    r.metric('modules built', fmt(Object.keys(s.inst).length));
    r.metric('plan shortfall', built.unplaced + ' modules did not fit');
    r.metric('jobs / workforce', plan.jobs + ' / ' + plan.workforce);

    var mb = H.moraleBreakdown(s);
    r.metric('avg commute', +mb.avgCommute.toFixed(1) + ' (free ≤ ' + mb.commuteFree + ')');
    r.metric('avg amenity', +mb.avgAmenity.toFixed(1) + ' (capped at ' + mb.amenityCap + ')');
    r.metric('unshielded habitats', mb.unshielded);

    var pb = H.powerBreakdown(s);
    r.metric('power draw / steady', fmt(pb.draw) + ' / ' + fmt(pb.steady));
    r.metric('modules shed', pb.shed);

    /* The headline assertion: the game's own promotion logic got to the top. */
    r.check('reached ' + top.name + ' (tier ' + LH.TIERS.length + ')',
      s.tier >= LH.TIERS.length, 'tier ' + s.tier, 'tier ' + LH.TIERS.length);
    r.check('run ended as a win', s.ended === 'capital', s.ended || 'never ended', 'capital');

    // and each individual requirement, read from the game's own table
    r.check('population ≥ ' + top.req.pop, s.pop >= top.req.pop, fmt(s.pop), top.req.pop);
    if (top.req.morale) {
      r.check('morale ≥ ' + top.req.morale, s.morale >= top.req.morale,
        +s.morale.toFixed(1), top.req.morale);
    }
    (top.req.need || []).forEach(function (mid) {
      r.check('sited ' + MOD[mid].name, LH.countOf(s, mid) > 0, LH.countOf(s, mid), '≥ 1');
    });
    r.check('life support positive',
      s.stats.o2Bal > 0 && s.stats.waterBal > 0 && s.stats.foodBal > 0,
      'O₂ ' + fmt(s.stats.o2Bal) + ' / H₂O ' + fmt(s.stats.waterBal) +
      ' / food ' + fmt(s.stats.foodBal), 'all > 0');
    r.check('grid not shedding', pb.shed === 0, pb.shed, 0);
    r.check('no orphaned modules', (s.stats.orphans || 0) === 0, s.stats.orphans || 0, 0);
    r.check('every planned module fitted', built.unplaced === 0, built.unplaced, 0);

    if (built.unplaced > 0) {
      r.note(built.unplaced + ' planned modules did not fit in the survey area. That is a design ' +
             'finding in itself: the map may be too small for the population the charter demands.');
    }
    if (plan.jobs > plan.workforce) {
      r.note('The plan needs ' + plan.jobs + ' workers but ' + top.req.pop + ' people supply only ' +
             plan.workforce + ', so every output would be throttled by staffing.');
    }
    return r;
  };

  /* SCENARIO 2 — the early game, on the real starting budget. This is the
     regression test for the opening that was broken and re-fixed repeatedly. */
  H.scenarios.starter = function () {
    var r = new Report('Starter colony survives 400 days',
      'A competently-built opening on the real ₵' + fmt(C.START_CREDITS) + ' budget');

    var s = fresh();
    var misses = [];
    function put(mid, x, l, l2) {
      var res = LH.place(s, mid, x, l, l2 === undefined ? l : l2);
      if (!res.ok) misses.push(mid + '@' + x + ',' + l + ' (' + res.reason + ')');
      return res.ok;
    }

    /* Laid out contiguously left to right, because a gap in a level orphans
       everything beyond it. Power is sized by the rule from the invariants:
       storage bridges (demand - steady) across the 14-day night, and solar
       covers roughly twice that so it can recharge during the day.

       Kept deliberately lean. The first version of this opening bought an admin
       centre, a mess hall and a third battery bank and then could not afford a
       single crew pod — ₵195,943 spent for zero berths. Housing is the entire
       early economy, so everything optional waits behind it. */
    put('battery', 60, 0); put('battery', 62, 0);
    put('solar', 64, 0);
    put('airlock', 68, 0);
    put('lift', 72, 0, -4);
    put('solar', 73, 0); put('solar', 77, 0);
    put('rtg', 81, 0);
    put('pad', 82, 0);

    put('hydro', 66, -1);
    put('scrubber', 73, -1); put('recycler', 76, -1); put('maint', 79, -1);

    /* Pods must chain off the shaft column, which occupies x=72 all the way
       down. Placing them at 66 and 74 left both islanded and one colliding with
       the shaft — the harness's connectivity assertion is what caught it. */
    put('pod', 68, -2); put('pod', 73, -2); put('pod', 64, -2);

    var spent = C.START_CREDITS - s.credits;
    LH.solveTransit(s);
    var orphans = 0;
    for (var k in s.inst) if (s.inst[k].dist === Infinity) orphans++;

    r.metric('spent on opening', '₵' + fmt(spent));
    r.metric('credits remaining', '₵' + fmt(s.credits));
    r.metric('berths built', LH.countOf(s, 'pod') * MOD.pod.pop);

    /* Assert the layout itself before drawing any conclusion from the run — a
       silently-failed placement would otherwise look exactly like a balance
       problem, which is what happened the first time this scenario ran. */
    r.check('every module placed', misses.length === 0,
      misses.length ? misses.join('; ') : 'all placed', 'no failures');
    r.check('opening is fully connected', orphans === 0, orphans, 0);
    r.check('opening within budget', spent <= C.START_CREDITS,
      '₵' + fmt(spent), '≤ ₵' + fmt(C.START_CREDITS));

    var pb0 = H.powerBreakdown(s);
    r.metric('solar / steady / draw', fmt(pb0.solar) + ' / ' + fmt(pb0.steady) + ' / ' + fmt(pb0.draw));
    r.check('solar can recharge the night', pb0.rechargeOk,
      fmt(pb0.solar) + ' vs ' + fmt(pb0.rechargeNeed) + ' needed', 'solar ≥ 2×(demand−steady)');
    r.check('storage bridges the night', pb0.nightStorageOk,
      fmt(pb0.storage) + ' vs ' + fmt(pb0.nightStorageNeed) + ' needed', 'storage ≥ gap × 14');

    run(s, 400);

    r.metric('day reached', s.day);
    r.metric('population', Math.round(s.pop));
    r.metric('morale', +s.morale.toFixed(1));
    r.metric('credits', '₵' + fmt(s.credits));
    r.metric('daily balance', '₵' + fmt(s.stats.income - s.stats.upkeep) + '/day');
    r.metric('charter tier', s.tier);
    r.metric('deaths', s.deaths);

    r.check('run did not end', !s.ended, s.ended || 'still running', 'null');
    r.check('colony still populated', s.pop > 0, Math.round(s.pop), '> 0');
    r.check('solvent', s.credits > 0, '₵' + fmt(s.credits), '> 0');
    r.check('operating at a surplus', s.stats.income - s.stats.upkeep > 0,
      '₵' + fmt(s.stats.income - s.stats.upkeep), '> 0');
    r.check('no load shedding', (s.stats.shed || 0) === 0, s.stats.shed || 0, 0);
    return r;
  };

  /* SCENARIO 3 — the autopilot, unattended and long. Guards against the
     bankruptcy spirals and build/sell loops that plagued the director. */
  H.scenarios.autopilot = function (days) {
    days = days || 3000;
    var r = new Report('Autopilot survives ' + fmt(days) + ' days',
      'Director unattended from an empty survey site');

    var s = fresh();
    s.auto = true;
    run(s, days, { auto: true });

    var mb = H.moraleBreakdown(s);
    var shafts = LH.countOf(s, 'lift') + LH.countOf(s, 'express');
    var orphanLogs = s.log.filter(function (e) { return /unreachable/.test(e.msg); }).length;
    var soldLogs = s.log.filter(function (e) { return /sold off/.test(e.msg); }).length;

    r.metric('day reached', s.day);
    r.metric('population', Math.round(s.pop));
    r.metric('peak population', Math.round(s.peakPop));
    r.metric('charter tier', s.tier + ' (' + (LH.TIERS[s.tier - 1] || {}).name + ')');
    r.metric('morale', +s.morale.toFixed(1));
    r.metric('credits', '₵' + fmt(s.credits));
    r.metric('shafts / airlocks', shafts + ' / ' + LH.countOf(s, 'airlock'));
    r.metric('avg commute', +mb.avgCommute.toFixed(1));
    r.metric('deaths', s.deaths);
    r.metric('orphan demolitions logged', orphanLogs);
    r.metric('distress sales logged', soldLogs);

    r.check('run did not end', !s.ended, s.ended || 'still running', 'null');
    r.check('colony still populated', s.pop > 0, Math.round(s.pop), '> 0');
    r.check('never went bankrupt', s.credits > -1000, '₵' + fmt(s.credits), '> -1,000');
    r.check('built a multi-shaft spine', shafts >= 3, shafts, '≥ 3');
    r.check('commute within tolerance', mb.avgCommute <= C.COMMUTE_GOOD,
      +mb.avgCommute.toFixed(1), '≤ ' + C.COMMUTE_GOOD);
    // Known debt, tracked for Phase 3 rather than failing the suite: the
    // director still occasionally sites something it cannot reach, and still
    // makes distress sales. Both are inefficiencies, not deaths.
    r.debt('no build/sell thrash', soldLogs < 5, soldLogs + ' distress sales', '< 5');
    r.debt('no orphan cascade', orphanLogs < 5, orphanLogs + ' orphan demolitions', '< 5');

    var prog = LH.tierProgress(s);
    if (prog) {
      r.note('Blocking ' + prog.name + ': ' + prog.items.filter(function (i) { return !i.ok; })
        .map(function (i) { return i.label; }).join('; '));
    }
    return r;
  };

  /* SCENARIO 4 — persistence. Six state fields were missing from the save, and
     the most serious consequence was not cosmetic: with the event RNG unsaved,
     reloading replayed an identical solar-flare sequence, so a reload was a
     working save-scum exploit. The decisive assertion here is that continuing a
     run and continuing a *reloaded* run produce byte-identical futures. */
  H.scenarios.saveload = function () {
    var r = new Report('Save/load round-trip preserves the run',
      'Pure serializeState/deserializeState — no localStorage, no canvas');

    var s = fresh();
    s.auto = true;
    run(s, 240, { auto: true });          // long enough for history, alerts and events

    r.metric('day at save', s.day);
    r.metric('population', Math.round(s.pop));
    r.metric('history points', s.history.length);
    r.metric('log entries', s.log.length);

    var blob = JSON.stringify(LH.serializeState(s));
    r.metric('save size', fmt(Math.round(blob.length / 1024)) + ' kB');

    var back = LH.deserializeState(JSON.parse(blob));

    // the fields that were being lost
    r.check('history preserved', back.history.length === s.history.length && s.history.length > 0,
      back.history.length + ' of ' + s.history.length, 'all, and non-empty');
    r.check('event RNG seed preserved', back.rseed === s.rseed && s.rseed !== 12345,
      String(back.rseed), 'equal, and advanced past the initial seed');
    r.check('stats preserved', Math.round(back.stats.upkeep) === Math.round(s.stats.upkeep) &&
      Math.round(back.stats.powerCap) === Math.round(s.stats.powerCap),
      'upkeep ' + fmt(back.stats.upkeep) + ', powerCap ' + fmt(back.stats.powerCap), 'equal');
    r.check('brownout clock preserved', (back.brownDays || 0) === (s.brownDays || 0),
      back.brownDays || 0, s.brownDays || 0);
    r.check('collapse clock preserved', (back.zeroDays || 0) === (s.zeroDays || 0),
      back.zeroDays || 0, s.zeroDays || 0);
    r.check('one-shot alert latches preserved',
      JSON.stringify(back.alerts) === JSON.stringify(s.alerts),
      JSON.stringify(back.alerts), 'equal');
    r.check('log not truncated', back.log.length === s.log.length,
      back.log.length + ' of ' + s.log.length, 'all');
    r.check('colony intact', Object.keys(back.inst).length === Object.keys(s.inst).length &&
      (back.stats.orphans || 0) === 0,
      Object.keys(back.inst).length + ' modules, ' + (back.stats.orphans || 0) + ' orphaned',
      'same count, none orphaned');

    /* The exploit test: the future must not change just because you reloaded. */
    function future(st, days) {
      for (var d = 0; d < days; d++) { LH.tick(st); LH.autopilot(st); LH.checkEnd(st); if (st.ended) break; }
      return [st.day, Math.round(st.pop), Math.round(st.credits), st.tier, st.deaths,
              st.flare, +st.morale.toFixed(3), st.log.length].join('|');
    }
    var liveFuture = future(s, 120);
    var reloadedFuture = future(back, 120);
    r.check('reloading does not change the future', liveFuture === reloadedFuture,
      reloadedFuture === liveFuture ? 'identical' : reloadedFuture + ' vs ' + liveFuture,
      'identical');

    /* And a finished run must be recognisable as finished after a reload. */
    var done = fresh();
    done.peakPop = 40; done.pop = 0;
    for (var z = 0; z < 14; z++) LH.checkEnd(done);
    var doneBack = LH.deserializeState(JSON.parse(JSON.stringify(LH.serializeState(done))));
    r.check('a finished run reloads as finished', doneBack.ended === done.ended && !!done.ended,
      doneBack.ended || 'not ended', done.ended || '(expected an outcome)');

    return r;
  };

  H.order = ['reachable', 'starter', 'autopilot', 'saveload'];

  H.runAll = function (onProgress) {
    var results = [];
    return H.order.reduce(function (p, key) {
      return p.then(function () {
        if (onProgress) onProgress(key);
        return new Promise(function (res) {
          setTimeout(function () {                 // yield so the page can paint
            var t0 = performance.now();
            var rep = H.scenarios[key]();
            rep.ms = Math.round(performance.now() - t0);
            results.push(rep);
            res();
          }, 0);
        });
      });
    }, Promise.resolve()).then(function () { return results; });
  };

})(window.LH);
