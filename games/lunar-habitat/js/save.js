/* Lunar Habitat — persistence.

   Split out of main.js so it can be tested without a canvas: serializeState and
   deserializeState are pure, and saveGame/loadGame are thin localStorage
   wrappers around them. tools/harness.html exercises the pure pair directly.

   The rule that matters here: anything NOT in PERSIST silently reverts to its
   newState() default on load. Six fields were missing, and each omission was a
   real bug rather than a cosmetic one — see the notes on the list below. */

(function (LH) {
  'use strict';

  var SAVE_KEY = 'lunarhabitat.save.v1';
  var LOG_KEEP = 120;          // match sim.js's own cap; truncating to 40 threw away two thirds

  LH.SAVE_KEY = SAVE_KEY;

  var PERSIST = [
    'credits', 'day', 'cells', 'inst', 'dug', 'nextId', 'res', 'pop', 'tourists',
    'morale', 'health', 'tier', 'deaths', 'flare', 'auto', 'sandbox',
    'autoEverUsed', 'sandboxEverUsed', 'peakPop', 'totalExports', 'totalIncome',
    'crisisDays', 'ended', 'autoShaftX', 'autoShaftBot',

    /* Added because each of these was losing real state on reload:
       rseed      — the event RNG. Restarting it at the hardcoded seed replayed
                    an identical solar-flare sequence, making reload a working
                    save-scum exploit against the game's only real hazard.
       history    — the sparkline series. Losing it also made report.js's
                    assess() read an empty history, where its growth term
                    defaults to positive, so every reloaded colony was told
                    "population trending up" even in freefall.
       brownDays  — the three-day unpowered-quarters death clock.
       zeroDays   — the twelve-day colony-collapse countdown.
                    Both were reset free of charge by saving and reloading.
       stats      — every readout. Without it the first frame after a load shows
                    zero income, zero power and zero berths.
       alerts     — the one-shot warning latches, which otherwise re-fire. */
    'rseed', 'history', 'brownDays', 'zeroDays', 'stats', 'alerts'
  ];

  LH.serializeState = function (s) {
    var out = {};
    for (var i = 0; i < PERSIST.length; i++) {
      var k = PERSIST[i];
      if (s[k] !== undefined) out[k] = s[k];
    }
    out.log = s.log.slice(0, LOG_KEEP);
    return out;
  };

  LH.deserializeState = function (d) {
    var s = LH.newState();
    Object.keys(d).forEach(function (k) { s[k] = d[k]; });

    // a save written by an older build may lack newer stats keys
    var protoStats = LH.newState().stats;
    if (!s.stats) s.stats = protoStats;
    else for (var sk in protoStats) if (s.stats[sk] === undefined) s.stats[sk] = protoStats[sk];
    if (!s.alerts) s.alerts = {};
    if (!s.history) s.history = [];

    Object.keys(s.inst).forEach(function (k) {
      var inst = s.inst[k];
      // deterministic, and identical to the formula LH.place uses, so a
      // reloaded colony animates exactly as it did before the reload
      if (inst.seed === undefined) inst.seed = ((+k * 2654435761) % 1000) / 1000;
      inst.dist = Infinity;
    });

    LH.solveTransit(s);
    LH.solveAmenity(s);
    return s;
  };

  /* ------------------------------------------------------ localStorage */

  LH.hasSave = function () {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  };

  /* quiet=true for the 90-second autosave, which otherwise announced itself
     forever — including long after the run had ended. */
  LH.saveGame = function (quiet) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(LH.serializeState(LH.S)));
      if (!quiet && LH.toast) LH.toast('Colony saved to this browser.', 'good');
      return true;
    } catch (err) {
      if (LH.toast) LH.toast('Could not save: ' + err.message, 'bad');
      return false;
    }
  };

  LH.loadGame = function () {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      LH.S = LH.deserializeState(JSON.parse(raw));
      return true;
    } catch (e) { return false; }
  };

})(window.LH);
