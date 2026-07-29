/* Lunar Habitat — Mission Control uplink: a dashboard that reports the
   colony's growth and vital signs back to Earth. Opened with the REPORT
   button or the R key. Pure DOM + tiny canvas sparklines. */

(function (LH) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function spark(canvas, series, color, fill) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width = canvas.clientWidth * 2;
    var H = canvas.height = canvas.clientHeight * 2;
    ctx.clearRect(0, 0, W, H);
    if (series.length < 2) {
      ctx.fillStyle = 'rgba(132,150,173,0.6)';
      ctx.font = '18px ui-monospace, monospace';
      ctx.fillText('awaiting telemetry…', 12, H / 2 + 5);
      return;
    }
    var min = Infinity, max = -Infinity, i;
    for (i = 0; i < series.length; i++) {
      if (series[i] < min) min = series[i];
      if (series[i] > max) max = series[i];
    }
    if (max === min) { max += 1; min -= 1; }
    var pad = (max - min) * 0.12;
    max += pad; min -= pad;

    // zero line if the series crosses it
    if (min < 0 && max > 0) {
      var zy = H - (0 - min) / (max - min) * H;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(W, zy); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    for (i = 0; i < series.length; i++) {
      var x = i / (series.length - 1) * (W - 4) + 2;
      var y = H - 3 - (series[i] - min) / (max - min) * (H - 8);
      ctx[i ? 'lineTo' : 'moveTo'](x, y);
    }
    if (fill) {
      ctx.save();
      ctx.lineTo(W - 2, H); ctx.lineTo(2, H); ctx.closePath();
      ctx.fillStyle = color.replace('1)', '0.12)');
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      for (i = 0; i < series.length; i++) {
        var x2 = i / (series.length - 1) * (W - 4) + 2;
        var y2 = H - 3 - (series[i] - min) / (max - min) * (H - 8);
        ctx[i ? 'lineTo' : 'moveTo'](x2, y2);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // last-value dot
    var lx = (series.length - 1) / (series.length - 1) * (W - 4) + 2;
    var ly = H - 3 - (series[series.length - 1] - min) / (max - min) * (H - 8);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(lx - 2, ly, 4, 0, Math.PI * 2); ctx.fill();
  }

  /* Mission assessment: a letter grade Earth-side would sign off on. */
  function assess(s) {
    var st = s.stats, score = 0, notes = [];
    var h = s.history;
    var growth = h.length > 10 ? s.pop - h[Math.max(0, h.length - 30)].pop : s.pop;

    if (s.pop >= 100) score += 30; else score += s.pop * 0.3;
    if (growth > 0) { score += 15; notes.push('population trending up'); }
    else if (growth < 0) { score -= 10; notes.push('population decline concerns the board'); }
    if (s.morale >= 62) { score += 20; notes.push('crew morale excellent'); }
    else if (s.morale >= 48) score += 10;
    else { score -= 5; notes.push('morale requires intervention'); }
    var bal = (st.income || 0) - (st.upkeep || 0);
    if (bal > 0) { score += 15; notes.push('operating in the black'); }
    else notes.push('running a deficit');
    if (s.credits > 100000) score += 10;
    if ((st.orphans || 0) === 0) score += 5; else notes.push((st.orphans) + ' modules unreachable');
    if (s.deaths === 0) { score += 10; notes.push('zero fatalities'); }
    else { score -= s.deaths; notes.push(s.deaths + ' lives lost to date'); }
    if (s.tier >= 3) score += 10;

    var grade = score >= 85 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : score >= 25 ? 'D' : 'E';
    var verdict =
      grade === 'A' ? 'Exemplary. Funding renewed without debate.' :
      grade === 'B' ? 'Solid progress. Keep the growth curve pointed up.' :
      grade === 'C' ? 'Viable, but the board wants stronger numbers next cycle.' :
      grade === 'D' ? 'The programme is under review. Stabilise life support and the ledger.' :
                      'Mission survival in doubt. Immediate corrective action required.';
    return { grade: grade, verdict: verdict, notes: notes };
  }

  function tile(k, v, sub, cls) {
    return '<div class="mc-tile"><div class="k">' + k + '</div><div class="v ' + (cls || '') + '">' + v +
      '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }

  function row(l, r, cls) {
    return '<div class="row"><span class="l">' + l + '</span><span class="r ' + (cls || '') + '">' + r + '</span></div>';
  }

  LH.showReport = function () {
    var s = LH.S, st = s.stats;
    var modal = $('report');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'report';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) LH.hideReport();
      });
    }
    modal.className = 'show';

    var a = assess(s);
    var tierName = (LH.TIERS[s.tier - 1] || {}).name || '—';
    var bal = (st.income || 0) - (st.upkeep || 0);
    var sunPct = Math.round(LH.sunFactor(s.day) * 100);
    var cycleDay = ((s.day - 1) % LH.C.LUNAR_CYCLE) + 1;

    var counts = {};
    var total = 0;
    for (var iid in s.inst) { counts[s.inst[iid].mid] = (counts[s.inst[iid].mid] || 0) + 1; total++; }
    var catCount = {};
    LH.MODULES.forEach(function (m) {
      if (counts[m.id]) catCount[m.cat] = (catCount[m.cat] || 0) + counts[m.id];
    });
    var census = LH.CATS.map(function (c) {
      return catCount[c.id] ? '<span class="pill" style="color:' + c.color + ';border-color:' + c.color + '55">' +
        c.name + ' × ' + catCount[c.id] + '</span>' : '';
    }).join('');

    var prog = LH.tierProgress(s);
    var progHtml = prog
      ? prog.items.map(function (i2) {
          return '<div class="chk ' + (i2.ok ? 'ok' : 'no') + '"><span class="m">' + (i2.ok ? '✔' : '○') +
            '</span><span>' + i2.label + '</span></div>';
        }).join('')
      : '<div class="chk ok"><span class="m">✔</span><span>Final charter achieved — Lunar Capital</span></div>';

    var depth = 0, height = 0;
    for (var k2 in s.inst) {
      var inst = s.inst[k2];
      if (inst.l0 < -depth) depth = -inst.l0;
      if (inst.l1 > height) height = inst.l1;
    }

    modal.innerHTML =
      '<div class="mc-card">' +
        '<div class="mc-head">' +
          '<div>' +
            '<div class="mc-kicker">▲ UPLINK · EARTH RELAY 04 · SIGNAL DELAY 1.3 s</div>' +
            '<h1>MISSION CONTROL — COLONY STATUS REPORT</h1>' +
            '<div class="mc-sub">Mare Tranquillitatis Station · Sol Day ' + s.day +
              ' · Lunar cycle day ' + cycleDay + '/' + LH.C.LUNAR_CYCLE + ' · Sunlight ' + sunPct + '%' +
              (s.auto ? ' · <span style="color:var(--accent-2)">AUTOPILOT IN COMMAND</span>' : '') + '</div>' +
          '</div>' +
          '<div class="mc-grade g-' + a.grade + '">' + a.grade + '</div>' +
        '</div>' +

        '<div class="mc-tiles">' +
          tile('Population', Math.round(s.pop), Math.floor(st.housing || 0) + ' berths · ' +
            Math.round(s.tourists) + ' visitors') +
          tile('Charter', 'T' + s.tier, tierName) +
          tile('Morale', Math.round(s.morale), 'health ' + Math.round(s.health) + '%',
            s.morale >= 55 ? 'pos' : s.morale < 38 ? 'neg' : '') +
          tile('Treasury', LH.money(s.credits), (bal >= 0 ? '+' : '') + LH.money(bal) + '/day',
            s.credits < 0 ? 'neg' : '') +
          tile('Structure', total + ' modules', depth + ' deep · ' + height + ' high') +
          tile('Fatalities', s.deaths, s.deaths === 0 ? 'perfect record' : 'reported to Earth',
            s.deaths ? 'neg' : 'pos') +
        '</div>' +

        '<div class="mc-charts">' +
          '<div class="mc-chart"><div class="t">POPULATION</div><canvas id="mc-sp-pop"></canvas></div>' +
          '<div class="mc-chart"><div class="t">TREASURY ₵</div><canvas id="mc-sp-cr"></canvas></div>' +
          '<div class="mc-chart"><div class="t">MORALE</div><canvas id="mc-sp-mo"></canvas></div>' +
        '</div>' +

        '<div class="mc-cols">' +
          '<div>' +
            '<div class="sec">Life support</div>' +
            row('Oxygen', Math.round(s.res.o2) + ' <span class="' + ((st.o2Bal || 0) < 0 ? 'neg' : 'pos') + '">' +
              ((st.o2Bal || 0) >= 0 ? '+' : '') + (st.o2Bal || 0).toFixed(1) + '/d</span>') +
            row('Water', Math.round(s.res.water) + ' <span class="' + ((st.waterBal || 0) < 0 ? 'neg' : 'pos') + '">' +
              ((st.waterBal || 0) >= 0 ? '+' : '') + (st.waterBal || 0).toFixed(1) + '/d</span>') +
            row('Food', Math.round(s.res.food) + ' <span class="' + ((st.foodBal || 0) < 0 ? 'neg' : 'pos') + '">' +
              ((st.foodBal || 0) >= 0 ? '+' : '') + (st.foodBal || 0).toFixed(1) + '/d</span>') +
            '<div class="sec">Power grid</div>' +
            row('Generation', Math.round(st.powerGen || 0) + ' /day') +
            row('Demand', Math.round(st.powerUse || 0) + ' /day', (st.powerGen || 0) >= (st.powerUse || 0) ? '' : 'neg') +
            row('Battery bank', Math.round(s.res.power) + ' / ' + Math.round(st.powerCap || 0)) +
            row('Load shed', (st.shed || 0) + ' modules', st.shed ? 'neg' : '') +
          '</div>' +
          '<div>' +
            '<div class="sec">Economy</div>' +
            row('Income', LH.money(st.income || 0), 'pos') +
            row('Upkeep', LH.money(-(st.upkeep || 0)), 'neg') +
            row('Exports', LH.money(st.exports || 0)) +
            row('Ore stock', Math.round(s.res.ore) + (st.oreRate ? ' (+' + st.oreRate.toFixed(1) + '/d)' : '')) +
            '<div class="sec">Workforce</div>' +
            row('Jobs', Math.round(st.jobs || 0)) +
            row('Workers', Math.round(st.workers || 0)) +
            row('Staffing', Math.round((st.staffing || 1) * 100) + '%', (st.staffing || 1) < 0.85 ? 'neg' : 'pos') +
          '</div>' +
          '<div>' +
            '<div class="sec">Next charter: ' + (prog ? prog.name : 'complete') + '</div>' + progHtml +
            '<div class="sec">Colony census</div>' +
            '<div class="mc-census">' + (census || '<span class="pill">nothing built yet</span>') + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="mc-verdict">' +
          '<div class="t">BOARD ASSESSMENT</div>' +
          '<p>“' + a.verdict + (a.notes.length ? ' Noted: ' + a.notes.join('; ') + '.' : '') + '”</p>' +
          '<div class="sig">— Programme Board, Lunar Settlement Initiative, Earth</div>' +
        '</div>' +

        '<button class="mc-close" onclick="LH.hideReport()">CLOSE UPLINK ✕</button>' +
      '</div>';

    var h = s.history;
    spark($('mc-sp-pop'), h.map(function (p) { return p.pop; }), 'rgba(95,212,138,1)', true);
    spark($('mc-sp-cr'), h.map(function (p) { return p.cr; }), 'rgba(255,200,97,1)', true);
    spark($('mc-sp-mo'), h.map(function (p) { return p.mo; }), 'rgba(176,127,208,1)', true);
  };

  LH.hideReport = function () {
    var m = $('report');
    if (m) m.className = '';
  };

  LH.reportOpen = function () {
    var m = $('report');
    return !!(m && m.className === 'show');
  };

})(window.LH);
