/* Lunar Habitat — end-of-run scoring and the persistent league table.
   A run ends when the charter reaches Lunar Capital, when the colony is
   abandoned or the programme is cancelled, or when the commander files a
   final report by choice. Scores persist in localStorage. */

(function (LH) {
  'use strict';

  var KEY = 'lunarhabitat.league.v1';
  var NAME_KEY = 'lunarhabitat.commander';
  var $ = function (id) { return document.getElementById(id); };

  var OUTCOMES = {
    capital:  { label: 'LUNAR CAPITAL',      cls: 'win',  mult: 1.5,
                blurb: 'The charter is complete. Mare Tranquillitatis Station is a capital city.' },
    retired:  { label: 'COMMAND RELINQUISHED', cls: 'ok', mult: 1.0,
                blurb: 'You filed your final report and handed the colony to your successor.' },
    collapse: { label: 'COLONY ABANDONED',   cls: 'bad',  mult: 0.4,
                blurb: 'The last colonist left on the last lander. The lights are still on down there.' },
    bankrupt: { label: 'PROGRAMME CANCELLED', cls: 'bad', mult: 0.4,
                blurb: 'Earth stopped answering the funding requests. The station was mothballed.' }
  };

  /* ------------------------------------------------------------- scoring */

  /* Every factor is transparent: label, the raw value it came from, and the
     points it contributed. The end screen and the league both show these. */
  LH.scoreRun = function (s, outcome) {
    var st = s.stats, f = [];
    var depth = 0, height = 0, modules = 0;
    for (var k in s.inst) {
      var i = s.inst[k];
      if (i.l0 < -depth) depth = -i.l0;
      if (i.l1 > height) height = i.l1;
      modules++;
    }

    function add(label, detail, pts) {
      f.push({ label: label, detail: detail, pts: Math.round(pts) });
    }

    var peak = Math.round(s.peakPop || 0);
    add('Peak population', peak + ' colonists', peak * 45);
    add('Final population', Math.round(s.pop) + ' in residence', Math.round(s.pop) * 25);

    var tier = LH.TIERS[s.tier - 1];
    add('Charter tier', 'Tier ' + s.tier + ' · ' + (tier ? tier.name : '—'), (s.tier - 1) * 1800);

    add('Crew morale', Math.round(s.morale) + ' / 100', Math.round(s.morale) * 22);
    add('Treasury', LH.money(s.credits), Math.max(-8000, s.credits / 45));
    add('Lifetime exports', LH.money(s.totalExports || 0), (s.totalExports || 0) / 260);

    add('Excavation depth', depth + ' levels below surface', depth * 150);
    add('Tower height', height + ' levels above surface', height * 110);
    add('Colony scale', modules + ' modules', modules * 12);

    add('Days survived', s.day + ' sol days', Math.min(6000, s.day * 4));

    if (s.deaths) add('Fatalities', s.deaths + ' lost', -s.deaths * 500);
    if (s.crisisDays) add('Life-support failures', (s.crisisDays) + ' days in crisis', -s.crisisDays * 120);
    if (st.orphans) add('Unreachable modules', st.orphans + ' stranded', -st.orphans * 200);

    // finishing fast is worth more than grinding it out
    if (outcome === 'capital') {
      add('Charter speed bonus', 'completed on day ' + s.day, Math.max(0, 45000 - s.day * 18));
    }
    if (s.deaths === 0 && peak >= 25) {
      add('Perfect safety record', 'no fatalities at ' + peak + ' population', 4000);
    }

    /* Penalties bite hard but can never wipe a run out completely — a colony
       that reached 44 people and then died still achieved 44 people. */
    var pos = 0, neg = 0;
    f.forEach(function (x) { if (x.pts >= 0) pos += x.pts; else neg += x.pts; });
    var subtotal = pos + Math.max(neg, -pos * 0.65);

    var oc = OUTCOMES[outcome] || OUTCOMES.retired;
    var total = Math.round(Math.max(0, subtotal) * oc.mult);

    return {
      factors: f, subtotal: Math.round(subtotal), multiplier: oc.mult,
      total: total, depth: depth, height: height, modules: modules, peak: peak
    };
  };

  function modeOf(s) {
    if (s.sandbox || s.sandboxEverUsed) return 'SANDBOX';
    if (s.auto || s.autoEverUsed) return 'AUTO';
    return 'MANUAL';
  }

  /* --------------------------------------------------------- persistence */

  LH.loadLeague = function () {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  };

  LH.saveLeague = function (rows) {
    try {
      rows.sort(function (a, b) { return b.score - a.score; });
      localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 60)));
      return true;
    } catch (e) { return false; }
  };

  LH.clearLeague = function () {
    if (!window.confirm('Erase the entire league table? This cannot be undone.')) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    LH.showLeague();
  };

  /* ------------------------------------------------- end-of-run detection */

  LH.checkEnd = function (s) {
    if (s.ended) return;
    if (s.tier >= LH.TIERS.length) return LH.endRun(s, 'capital');
    if ((s.peakPop || 0) >= 5 && s.pop <= 0) {
      s.zeroDays = (s.zeroDays || 0) + 1;
      if (s.zeroDays >= 12) return LH.endRun(s, 'collapse');
    } else s.zeroDays = 0;
    if (s.credits < -60000) return LH.endRun(s, 'bankrupt');
  };

  LH.endRun = function (s, outcome) {
    if (s.ended) return;
    s.ended = outcome;
    s.speed = 0;
    var sp = document.querySelector('#speed button[data-sp="0"]');
    if (sp) {
      Array.prototype.forEach.call(document.querySelectorAll('#speed button[data-sp]'), function (b) {
        b.classList.toggle('on', b.dataset.sp === '0');
      });
    }
    s.auto = false;
    var ab = $('btn-auto');
    if (ab) ab.classList.remove('on');
    LH.showEndScreen(s, outcome);
  };

  /* --------------------------------------------------------- end screen */

  LH.showEndScreen = function (s, outcome) {
    var oc = OUTCOMES[outcome] || OUTCOMES.retired;
    var sc = LH.scoreRun(s, outcome);
    s.finalScore = sc;

    var m = $('endscreen');
    if (!m) {
      m = document.createElement('div');
      m.id = 'endscreen';
      document.body.appendChild(m);
    }
    m.className = 'show';

    var lastName = '';
    try { lastName = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}

    var rows = sc.factors.map(function (x) {
      return '<div class="fx' + (x.pts < 0 ? ' neg' : '') + '">' +
        '<span class="l">' + x.label + '</span>' +
        '<span class="d">' + x.detail + '</span>' +
        '<span class="p">' + (x.pts >= 0 ? '+' : '') + x.pts.toLocaleString('en-US') + '</span></div>';
    }).join('');

    var mode = modeOf(s);
    var modeNote = mode === 'SANDBOX'
      ? '<div class="es-note">Sandbox was used this run — the entry is filed <b>unranked</b>.</div>'
      : mode === 'AUTO'
        ? '<div class="es-note">Autopilot was in command for part of this run — the entry is badged <b>AUTO</b>.</div>'
        : '';

    m.innerHTML =
      '<div class="es-card">' +
        '<div class="es-banner ' + oc.cls + '">' + oc.label + '</div>' +
        '<p class="es-blurb">' + oc.blurb + '</p>' +

        '<div class="es-score">' +
          '<div class="n">' + sc.total.toLocaleString('en-US') + '</div>' +
          '<div class="u">FINAL SCORE</div>' +
        '</div>' +

        '<div class="es-fx">' + rows +
          '<div class="fx sub"><span class="l">Subtotal</span><span class="d"></span>' +
            '<span class="p">' + sc.subtotal.toLocaleString('en-US') + '</span></div>' +
          '<div class="fx sub"><span class="l">Outcome multiplier</span>' +
            '<span class="d">' + oc.label.toLowerCase() + '</span>' +
            '<span class="p">× ' + sc.multiplier.toFixed(1) + '</span></div>' +
        '</div>' +

        modeNote +

        '<div class="es-submit">' +
          '<input id="es-name" maxlength="18" placeholder="Commander name" value="' +
            lastName.replace(/"/g, '&quot;') + '">' +
          '<button class="go" id="es-file">FILE WITH MISSION CONTROL</button>' +
        '</div>' +
        '<div class="es-actions">' +
          (outcome === 'capital' ? '<button class="ghost" id="es-continue">KEEP BUILDING</button>' : '') +
          '<button class="ghost" id="es-new">START A NEW COLONY</button>' +
        '</div>' +
      '</div>';

    $('es-file').onclick = function () {
      var nm = ($('es-name').value || '').trim().slice(0, 18) || 'Anonymous';
      try { localStorage.setItem(NAME_KEY, nm); } catch (e) {}
      var rowsL = LH.loadLeague();
      rowsL.push({
        name: nm,
        score: sc.total,
        outcome: outcome,
        outcomeLabel: oc.label,
        mode: mode,
        ranked: mode !== 'SANDBOX',
        day: s.day,
        pop: Math.round(s.pop),
        peak: sc.peak,
        tier: s.tier,
        tierName: (LH.TIERS[s.tier - 1] || {}).name || '—',
        morale: Math.round(s.morale),
        credits: Math.round(s.credits),
        exports: Math.round(s.totalExports || 0),
        deaths: s.deaths,
        depth: sc.depth,
        height: sc.height,
        modules: sc.modules,
        factors: sc.factors,
        date: new Date().toISOString().slice(0, 10)
      });
      LH.saveLeague(rowsL);
      m.className = '';
      LH.showLeague(sc.total);
    };

    var cont = $('es-continue');
    if (cont) cont.onclick = function () { m.className = ''; s.ended = 'continued'; };
    $('es-new').onclick = function () { m.className = ''; LH.confirmNew(true); };
  };

  /* --------------------------------------------------------- league board */

  var filter = 'all';

  LH.showLeague = function (highlight) {
    var m = $('league');
    if (!m) {
      m = document.createElement('div');
      m.id = 'league';
      document.body.appendChild(m);
      m.addEventListener('click', function (e) { if (e.target === m) LH.hideLeague(); });
    }
    m.className = 'show';
    renderLeague(m, highlight);
  };

  function renderLeague(m, highlight) {
    var all = LH.loadLeague();
    var rows = all.filter(function (r) {
      return filter === 'all' ? true :
             filter === 'ranked' ? r.ranked && r.mode === 'MANUAL' :
             r.mode === filter;
    });

    var body;
    if (!rows.length) {
      body = '<p class="lg-empty">No colonies on record' +
        (filter === 'all' ? ' yet. Finish a run — reach Lunar Capital, or file a final report from the Mission Control screen — and it lands here.' : ' for this filter.') + '</p>';
    } else {
      body = '<table class="lg-table"><thead><tr>' +
        '<th>#</th><th>Commander</th><th>Score</th><th>Outcome</th><th>Tier</th>' +
        '<th>Peak pop</th><th>Days</th><th>Depth</th><th>Deaths</th><th>Mode</th><th>Filed</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (r, i) {
          var medal = i === 0 ? 'g' : i === 1 ? 's' : i === 2 ? 'b' : '';
          var hi = (highlight !== undefined && r.score === highlight) ? ' hi' : '';
          return '<tr class="' + medal + hi + '" data-i="' + i + '">' +
            '<td class="rk">' + (i + 1) + '</td>' +
            '<td class="nm">' + esc(r.name) + '</td>' +
            '<td class="sc">' + r.score.toLocaleString('en-US') + '</td>' +
            '<td><span class="oc ' + (OUTCOMES[r.outcome] || {}).cls + '">' + esc(r.outcomeLabel || r.outcome) + '</span></td>' +
            '<td>' + r.tier + ' · ' + esc(r.tierName) + '</td>' +
            '<td>' + r.peak + '</td>' +
            '<td>' + r.day + '</td>' +
            '<td>' + r.depth + '</td>' +
            '<td class="' + (r.deaths ? 'neg' : '') + '">' + r.deaths + '</td>' +
            '<td><span class="md m-' + r.mode + '">' + r.mode + '</span></td>' +
            '<td class="dt">' + r.date + '</td>' +
            '</tr>' +
            '<tr class="det" id="lg-det-' + i + '"><td colspan="11">' +
              '<div class="det-in">' + (r.factors || []).map(function (x) {
                return '<span class="fchip' + (x.pts < 0 ? ' neg' : '') + '">' + esc(x.label) +
                  ' <b>' + (x.pts >= 0 ? '+' : '') + x.pts.toLocaleString('en-US') + '</b>' +
                  '<i>' + esc(x.detail) + '</i></span>';
              }).join('') + '</div></td></tr>';
        }).join('') +
        '</tbody></table>';
    }

    m.innerHTML =
      '<div class="lg-card">' +
        '<div class="lg-head">' +
          '<div><div class="lg-kicker">▲ LUNAR SETTLEMENT INITIATIVE · PROGRAMME RECORDS</div>' +
          '<h1>🏆 COLONY LEAGUE TABLE</h1></div>' +
          '<button class="lg-x" onclick="LH.hideLeague()">✕</button>' +
        '</div>' +
        '<div class="lg-filters">' +
          ['all|All runs', 'ranked|Ranked (manual)', 'AUTO|Autopilot', 'SANDBOX|Sandbox'].map(function (f) {
            var p = f.split('|');
            return '<button data-f="' + p[0] + '"' + (filter === p[0] ? ' class="on"' : '') + '>' + p[1] + '</button>';
          }).join('') +
        '</div>' +
        body +
        '<div class="lg-foot">' +
          '<span>' + all.length + ' colonies on record · click a row for the score breakdown</span>' +
          '<button class="lg-clear" onclick="LH.clearLeague()">Erase records</button>' +
        '</div>' +
      '</div>';

    Array.prototype.forEach.call(m.querySelectorAll('.lg-filters button'), function (b) {
      b.onclick = function () { filter = b.dataset.f; renderLeague(m, highlight); };
    });
    Array.prototype.forEach.call(m.querySelectorAll('.lg-table tbody tr[data-i]'), function (tr) {
      tr.onclick = function () {
        var d = $('lg-det-' + tr.dataset.i);
        if (d) d.classList.toggle('open');
      };
    });
  }

  function esc(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  LH.hideLeague = function () { var m = $('league'); if (m) m.className = ''; };
  LH.leagueOpen = function () { var m = $('league'); return !!(m && m.className === 'show'); };

  /* Retire by choice — offered from the Mission Control report. */
  LH.retireColony = function () {
    var s = LH.S;
    if (s.day < 20) { LH.toast('Give it a few more days before filing a final report.', 'warn'); return; }
    if (!window.confirm('File your final report and close out this colony?\n\nThe run will be scored and entered into the league table.')) return;
    LH.hideReport();
    s.ended = null;
    LH.endRun(s, 'retired');
  };

})(window.LH);
