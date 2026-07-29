/* Lunar Habitat — the daily simulation tick. */

(function (LH) {
  'use strict';

  var C = LH.C;

  LH.log = function (s, kind, msg) {
    s.log.unshift({ day: s.day, kind: kind, msg: msg });
    if (s.log.length > 120) s.log.pop();
    s.logDirty = true;
  };

  function rnd(s) {                       // deterministic-ish per-day noise
    s.rseed = (s.rseed || 12345) * 1103515245 + 12345 & 0x7fffffff;
    return (s.rseed % 10000) / 10000;
  }

  /* Shedding priority — lowest sheds first when the grid browns out. */
  var SHED_ORDER = { amen: 0, work: 1, mine: 2, hab: 3, infra: 4, life: 5, power: 6 };

  LH.tick = function (s) {
    var iid, inst, m, i;

    LH.solveTransit(s);

    var sun = LH.sunFactor(s.day);
    var pop = s.pop, tour = s.tourists;

    /* ---- 1. which modules are even candidates -------------------------- */
    var live = [];
    for (iid in s.inst) {
      inst = s.inst[iid];
      m = LH.MOD[inst.mid];
      inst.on = inst.dist < Infinity && inst.dmg < 0.85;
      if (inst.on) live.push(inst);
    }

    /* ---- 2. power ------------------------------------------------------ */
    var gen = 0, cap = 0, use = pop * C.POWER_PER_POP + tour * 0.15;
    for (i = 0; i < live.length; i++) {
      inst = live[i]; m = LH.MOD[inst.mid];
      if (m.store) cap += m.store * (1 - inst.dmg);
      if (!m.power) continue;
      if (m.power > 0) {
        var out = m.power * (1 - inst.dmg);
        if (m.id === 'solar') out *= sun * (1 - inst.dust);
        gen += out;
      }
    }
    s.stats.powerCap = cap;

    // demand from consumers, then shed low-priority modules until it balances
    function demandOf(x) { var mm = LH.MOD[x.mid]; return mm.power < 0 ? -mm.power : 0; }
    live.sort(function (a, b) {
      return (SHED_ORDER[LH.MOD[a.mid].cat] || 0) - (SHED_ORDER[LH.MOD[b.mid].cat] || 0);
    });
    var totalDemand = use;
    for (i = 0; i < live.length; i++) totalDemand += demandOf(live[i]);

    var avail = gen + Math.min(s.res.power, cap);
    var shed = 0;
    if (totalDemand > avail) {
      for (i = 0; i < live.length && totalDemand > avail; i++) {
        var d = demandOf(live[i]);
        if (d <= 0) continue;
        live[i].on = false; totalDemand -= d; shed++;
      }
    }
    var used = use;
    for (i = 0; i < live.length; i++) if (live[i].on) used += demandOf(live[i]);

    var net = gen - used;
    s.res.power = Math.max(0, Math.min(cap, s.res.power + net));
    s.stats.powerGen = gen;
    s.stats.powerUse = used;
    s.stats.shed = shed;

    var blackout = used > gen && s.res.power <= 0.5 && cap < 1;
    if (blackout && !s.alerts.power) {
      LH.log(s, 'bad', 'Power deficit — modules are dropping offline. Build reactors or bank more batteries.');
      s.alerts.power = true;
    } else if (!blackout) s.alerts.power = false;

    /* ---- 3. staffing --------------------------------------------------- */
    var jobs = 0;
    var on = live.filter(function (x) { return x.on; });
    for (i = 0; i < on.length; i++) jobs += LH.MOD[on[i].mid].jobs || 0;
    var workforce = Math.floor(pop * 0.62);
    var staffing = jobs > 0 ? Math.min(1, workforce / jobs) : 1;
    s.stats.jobs = jobs;
    s.stats.workers = workforce;
    s.stats.staffing = staffing;

    /* effectiveness of a production module */
    function eff(x) {
      var mm = LH.MOD[x.mid];
      var e = (1 - x.dmg);
      if (mm.jobs) e *= staffing;
      return e;
    }

    /* ---- 4. life support ----------------------------------------------- */
    var o2 = 0, water = 0, food = 0, ore = 0, he3 = 0, oreIn = 0;
    for (i = 0; i < on.length; i++) {
      inst = on[i]; m = LH.MOD[inst.mid];
      var e = eff(inst);
      if (m.o2) o2 += m.o2 * (m.o2 > 0 ? e : 1);
      if (m.water) water += m.water * (m.water > 0 ? e : 1);
      if (m.food) food += m.food * e;
      if (m.ore) ore += m.ore * e;
      if (m.he3) he3 += m.he3 * e;
      if (m.ore_in) oreIn += m.ore_in;
    }
    o2 -= pop * C.O2_PER_POP + tour * C.O2_PER_POP * 0.6;
    water -= pop * C.WATER_PER_POP + tour * C.WATER_PER_POP * 0.6;
    food -= pop * C.FOOD_PER_POP + tour * C.FOOD_PER_POP * 0.6;

    var stockCap = 200 + pop * 5;
    var crisis = [];
    ['o2', 'water', 'food'].forEach(function (r) {
      var bal = r === 'o2' ? o2 : r === 'water' ? water : food;
      s.res[r] = Math.max(0, Math.min(stockCap, s.res[r] + bal));
      s.stats[r + 'Bal'] = bal;
      if (s.res[r] <= 0 && bal < 0) crisis.push(r);
    });

    // ore economy: mines feed fabricators and refineries, surplus is exported
    s.res.ore = Math.max(0, s.res.ore + ore);
    var oreUsed = Math.min(s.res.ore, oreIn);
    s.res.ore -= oreUsed;
    var industryRatio = oreIn > 0 ? oreUsed / oreIn : 1;
    var oreSold = Math.max(0, s.res.ore - 60);
    s.res.ore -= oreSold;
    s.res.he3 += he3;
    var he3Sold = s.res.he3;
    s.res.he3 = 0;
    s.stats.oreRate = ore;
    s.stats.he3Rate = he3;
    s.stats.industryRatio = industryRatio;

    /* Amenity coverage must be solved BEFORE morale reads it. This ran at the
       very end of the tick, so every morale figure was computed against the
       previous day's coverage — and on the first tick s.amenList was undefined,
       so coverage read zero. Shedding is settled by now, which is what
       solveAmenity needs to know which amenities are actually running. */
    LH.solveAmenity(s);

    /* ---- 5. housing, occupancy and morale ------------------------------ */
    var housing = 0, tourCap = 0, draw = 0, darkHabs = 0;
    var moraleSum = 0, moraleWeight = 0, radSum = 0;
    /* Housing is counted over every *connected* habitat, not only the powered
       ones — a brownout should make people miserable, not teleport them home. */
    for (i = 0; i < live.length; i++) {
      inst = live[i]; m = LH.MOD[inst.mid];
      if (m.draw && inst.on) draw += m.draw * eff(inst);
      if (m.pop) {
        if (!inst.on) darkHabs++;
        // a habitat only fills if morale clears its bar
        var bar = m.id === 'suite' ? 68 : m.id === 'block' ? 42 : 25;
        var fill = s.morale >= bar ? 1 : Math.max(0, s.morale / bar);
        var seats = m.pop * fill * (1 - inst.dmg);
        housing += seats;
        inst.occCap = seats;

        var amen = LH.amenityAt(s, inst.x + inst.w / 2, inst.l);
        var commute = inst.dist <= C.COMMUTE_GOOD ? 0 :
          Math.min(24, (inst.dist - C.COMMUTE_GOOD) / (C.COMMUTE_BAD - C.COMMUTE_GOOD) * 24);
        var rad = LH.shielded(s, inst) ? 0 : LH.radiationAt(inst.l) * 22;
        radSum += rad * seats;
        moraleSum += (62 + Math.min(32, amen) - commute - rad - (inst.on ? 0 : 14)) * seats;
        moraleWeight += seats;
      }
      if (m.tour && inst.on) tourCap += m.tour * (1 - inst.dmg);
    }
    s.stats.housing = housing;
    s.stats.draw = draw;
    s.stats.darkHabs = darkHabs;

    // sustained brownouts, not single bad nights, are what kill a colony
    s.brownDays = darkHabs > 0 ? (s.brownDays || 0) + 1 : 0;

    var target = moraleWeight > 0 ? moraleSum / moraleWeight : 62;
    if (crisis.length) target -= 22 * crisis.length;
    if (shed > 0) target -= Math.min(16, shed * 2.5);
    if (s.health < 80) target -= Math.min(18, (80 - s.health) * 0.28);
    if (pop >= 20 && jobs > 0 && workforce > jobs * 1.6)
      target -= Math.min(10, (workforce / jobs - 1.6) * 8);       // unemployment
    target = Math.max(0, Math.min(100, target));
    if (pop === 0) target = Math.max(target, 48);   // a new crew arrives with fresh optimism
    s.morale += (target - s.morale) * 0.25;
    s.stats.moraleTarget = target;

    /* ---- 6. population ------------------------------------------------- */
    var hasPad = false, hasLock = false;
    for (i = 0; i < on.length; i++) {
      if (on[i].mid === 'pad') hasPad = true;
      if (on[i].mid === 'airlock') hasLock = true;
    }
    s.stats.hasPad = hasPad; s.stats.hasLock = hasLock;

    var vacancy = Math.floor(housing) - pop;
    if (crisis.length) {
      var lost = Math.ceil(pop * 0.06 * crisis.length);
      s.pop = Math.max(0, pop - lost);
      s.health = Math.max(0, s.health - 6 * crisis.length);
      if (lost > 0) LH.log(s, 'bad', crisis.join(' and ') + ' exhausted — ' + lost + ' colonists evacuated.');
    } else if (s.brownDays >= 3 && pop > 0) {
      var frozen = Math.ceil(pop * 0.04);
      s.pop = Math.max(0, pop - frozen);
      if (!s.alerts.brown) {
        LH.log(s, 'bad', 'Crew quarters have been unpowered for three days. People are being shipped home.');
        s.alerts.brown = true;
      }
    } else if (s.morale < 32 && pop > 0) {
      var quit = Math.ceil(pop * 0.03);
      s.pop = Math.max(0, pop - quit);
      if (!s.alerts.morale) { LH.log(s, 'warn', 'Morale is bottoming out. Colonists are requesting transfers home.'); s.alerts.morale = true; }
    } else {
      s.alerts.morale = false; s.alerts.brown = false;
      // an empty colony always attracts a fresh crew — no death spirals
      if (vacancy > 0 && hasPad && hasLock && (s.morale > 40 || pop === 0)) {
        var arrive = Math.min(vacancy, Math.max(3, Math.ceil(housing * 0.14)));
        s.pop += arrive;
      } else if (vacancy < 0) {
        s.pop = Math.max(0, pop + Math.max(vacancy, -Math.ceil(pop * 0.05)));
      }
    }
    if (s.brownDays === 0) s.alerts.brown = false;

    // visitors
    var tourTarget = hasPad ? Math.min(tourCap, tourCap * Math.min(1, draw / 12) * (s.morale / 70)) : 0;
    s.tourists += (tourTarget - s.tourists) * 0.3;
    if (s.tourists < 0.5) s.tourists = 0;

    // health drifts back up when there's medical cover
    var medCover = 0;
    for (i = 0; i < on.length; i++) if (LH.MOD[on[i].mid].health) medCover++;
    /* Recovery has to outpace misfortune. At +1.6/day against -6 per
       life-support crisis and -20 per solar flare, a single bad month left a
       permanent ~30 morale penalty that no amount of good play could lift —
       which is what turned every setback into a death spiral. */
    s.health = Math.min(100, s.health + (medCover > 0 ? 2.2 + medCover * 0.6 : 0.8));

    /* ---- 7. money ------------------------------------------------------ */
    var income = 0, upkeep = 0;
    for (iid in s.inst) {
      inst = s.inst[iid]; m = LH.MOD[inst.mid];
      upkeep += (m.vertical ? m.up * inst.cells.length : m.up) || 0;
      if (!inst.on) continue;
      var e = eff(inst);
      if (m.pop) {
        // rent is only collected on berths that actually have someone in them
        var fillRatio = housing > 0 ? Math.min(1, s.pop / housing) : 0;
        income += (m.income || 0) * ((inst.occCap || 0) / m.pop) * fillRatio;
      } else if (m.tour) {
        var tOcc = tourCap > 0 ? s.tourists / tourCap : 0;
        income += m.tour * tOcc * (26 + draw * 5);
      } else if (m.income) {
        var mult = m.ore_in ? industryRatio : 1;
        if (m.id === 'lab') mult *= 1 + Math.max(0, -inst.l) * 0.03;   // deep science pays
        income += m.income * e * mult;
      }
    }
    income += oreSold * C.ORE_PRICE + he3Sold * C.HE3_PRICE;
    s.stats.income = income;
    s.stats.upkeep = upkeep;
    s.stats.exports = oreSold * C.ORE_PRICE + he3Sold * C.HE3_PRICE;
    s.credits += income - upkeep;

    if (s.credits < 0 && !s.alerts.broke) {
      LH.log(s, 'bad', 'The colony is running a deficit. Bulldoze what you cannot afford to keep pressurised.');
      s.alerts.broke = true;
    } else if (s.credits >= 0) s.alerts.broke = false;

    /* ---- 8. wear, dust and repair -------------------------------------- */
    for (iid in s.inst) {
      inst = s.inst[iid]; m = LH.MOD[inst.mid];
      if (m.id === 'solar') inst.dust = Math.min(0.5, inst.dust + 0.0035);
      if (inst.dmg > 0 || inst.dust > 0) {
        var bay = LH.hasNearby(s, inst.x + inst.w / 2, inst.l, 'repair');
        if (bay) {
          inst.dmg = Math.max(0, inst.dmg - 0.07);
          inst.dust = Math.max(0, inst.dust - 0.09);
        }
      }
    }

    // cumulative run statistics — the league table scores on these
    if (s.pop > (s.peakPop || 0)) s.peakPop = s.pop;
    s.totalExports = (s.totalExports || 0) + s.stats.exports;
    s.totalIncome = (s.totalIncome || 0) + income;
    if (crisis.length) s.crisisDays = (s.crisisDays || 0) + 1;

    events(s, on);
    checkTier(s);

    s.day++;
    s.ticks++;
    if (s.day % 2 === 0) {
      s.history.push({ d: s.day, pop: s.pop, cr: s.credits, mo: s.morale });
      if (s.history.length > 400) s.history.shift();
    }
    s.dirty = true;
  };

  /* ------------------------------------------------------------- events */

  function pick(s, list) {
    if (!list.length) return null;
    return list[Math.floor(rnd(s) * list.length)];
  }

  function events(s, on) {
    var r = rnd(s), i, victim;

    // a scheduled solar particle event finally arrives
    if (s.flare > 0) {
      s.flare--;
      if (s.flare === 0) {
        var exposed = on.filter(function (x) {
          return LH.MOD[x.mid].pop && !LH.shielded(s, x);
        });
        var hit = 0;
        exposed.forEach(function (x) { hit += x.occCap || 0; });
        if (hit > 0) {
          var hasMed = on.some(function (x) { return LH.MOD[x.mid].health; });
          var med = hasMed ? 0.45 : 1;
          var casualties = Math.round(Math.min(s.pop, hit * 0.06 * med));
          s.pop = Math.max(0, s.pop - casualties);
          s.deaths += casualties;
          s.health = Math.max(10, s.health - 20 * med);
          LH.log(s, 'bad', 'Solar particle event: ' + Math.round(hit) + ' colonists were in unshielded quarters. ' +
            (casualties ? casualties + ' lost.' : 'No fatalities, but everyone took a dose.'));
        } else {
          LH.log(s, 'good', 'Solar particle event passed. Every habitat was shielded — nobody took a dose.');
        }
        // arrays always take a beating
        on.forEach(function (x) { if (x.mid === 'solar') x.dmg = Math.min(0.7, x.dmg + 0.15); });
      }
      return;
    }

    if (s.day < 12) return;

    if (r < 0.014) {
      s.flare = 2;
      LH.log(s, 'warn', 'Flare watch: a solar particle event will hit in 2 days. Get people under rock or under shield caps.');
      return;
    }

    r = rnd(s);
    if (r < 0.022) {                                  // micrometeorite strike
      victim = pick(s, on.filter(function (x) { return x.l >= 0 && !LH.MOD[x.mid].vertical; }));
      if (victim) {
        var guarded = LH.hasNearby(s, victim.x, victim.l, 'guard') ? 0.5 : 1;
        victim.dmg = Math.min(1, victim.dmg + (0.35 + rnd(s) * 0.4) * guarded);
        LH.log(s, 'bad', 'Micrometeorite breach in ' + LH.MOD[victim.mid].name + ' at level ' + fmtL(victim.l) + '.');
      }
    } else if (r < 0.038) {                           // moonquake
      var deep = on.filter(function (x) { return x.l <= -4; });
      var n = 0;
      for (i = 0; i < 3; i++) {
        victim = pick(s, deep);
        if (victim) { victim.dmg = Math.min(1, victim.dmg + 0.25 + rnd(s) * 0.25); n++; }
      }
      if (n) LH.log(s, 'bad', 'Moonquake. ' + n + ' subsurface modules cracked their seals.');
    } else if (r < 0.055) {                           // dust
      var arrays = on.filter(function (x) { return x.mid === 'solar'; });
      if (arrays.length) {
        arrays.forEach(function (x) { x.dust = Math.min(0.75, x.dust + 0.18); });
        LH.log(s, 'warn', 'Landing plume coated the solar arrays in dust. Output is down until maintenance clears them.');
      }
    } else if (r < 0.075 && s.stats.hasPad) {         // supply windfall
      var bonus = 4000 + Math.round(rnd(s) * 12000);
      s.credits += bonus;
      LH.log(s, 'good', 'Supply run delivered surplus cargo — sold on for ' + LH.money(bonus) + '.');
    }
  }

  function fmtL(l) { return l === 0 ? 'Surface' : (l > 0 ? '+' + l : String(l)); }
  LH.fmtL = fmtL;

  /* -------------------------------------------------------- charter tier */

  LH.tierProgress = function (s) {
    var next = LH.TIERS[s.tier];      // TIERS is 0-indexed, tier n is index n-1
    if (!next) return null;
    var req = next.req, out = [];
    if (req.pop) out.push({ label: 'Population ' + s.pop + ' / ' + req.pop, ok: s.pop >= req.pop });
    if (req.morale) out.push({ label: 'Morale ' + Math.round(s.morale) + ' / ' + req.morale, ok: s.morale >= req.morale });
    (req.need || []).forEach(function (mid) {
      out.push({ label: LH.MOD[mid].name, ok: LH.countOf(s, mid) > 0 });
    });
    return { name: next.name, items: out };
  };

  function checkTier(s) {
    var p = LH.tierProgress(s);
    if (!p) return;
    var all = p.items.every(function (i) { return i.ok; });
    if (all) {
      s.tier++;
      LH.log(s, 'good', 'CHARTER UPGRADED — the colony is now rated ' + p.name + '. New modules unlocked.');
      s.tierJustUp = p.name;
    }
  }

})(window.LH);
