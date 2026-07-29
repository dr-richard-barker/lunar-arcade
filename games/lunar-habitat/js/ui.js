/* Lunar Habitat — DOM chrome: palette, readouts, side panel, toasts. */

(function (LH) {
  'use strict';

  var ui = LH.ui = { tool: null, hover: null, drag: null, sel: null, tab: 'status', pan: false };
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  /* ------------------------------------------------------------- palette */

  LH.buildPalette = function (s) {
    var p = $('palette');
    p.innerHTML = '';

    var bull = el('div', 'tool' + (ui.tool === 'bulldoze' ? ' on' : ''),
      '<div class="sw" style="background:#ff6b6b"></div><div class="nm">Bulldoze</div><div class="ct">X</div>');
    bull.onclick = function () { LH.setTool('bulldoze'); };
    p.appendChild(el('h4', null, 'Demolition'));
    p.appendChild(bull);

    LH.CATS.forEach(function (cat) {
      var mods = LH.MODULES.filter(function (m) { return m.cat === cat.id; });
      if (!mods.length) return;
      p.appendChild(el('h4', null, cat.name));
      mods.forEach(function (m) {
        var locked = !s.sandbox && m.tier > s.tier;
        var row = el('div', 'tool' + (locked ? ' locked' : '') + (ui.tool === m.id ? ' on' : ''),
          '<div class="sw" style="background:' + m.color + '"></div>' +
          '<div class="nm">' + m.name + '</div>' +
          '<div class="ct">' + (locked ? 'T' + m.tier : (s.sandbox ? 'FREE' : shortMoney(m.cost) + (m.vertical ? '/lv' : ''))) + '</div>');
        row.title = m.name + ' — ' + m.desc;
        if (!locked) row.onclick = function () { LH.setTool(m.id); };
        row.onmouseenter = function () { LH.previewModule(m); };
        row.onmouseleave = function () { LH.setHint(null); };
        p.appendChild(row);
      });
    });
  };

  function shortMoney(n) {
    if (n >= 1000) return '₵' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return '₵' + n;
  }

  LH.setTool = function (id) {
    ui.tool = (ui.tool === id) ? null : id;
    ui.drag = null;
    LH.buildPalette(LH.S);
    if (!ui.tool) { LH.setHint(null); return; }
    if (ui.tool === 'bulldoze') { LH.setHint('<b>Bulldoze</b> — click a module to remove it. You get 35% of the build cost back.'); return; }
    LH.previewModule(LH.MOD[ui.tool]);
  };

  LH.previewModule = function (m) {
    if (!m) return;
    var bits = [];
    bits.push('<b>' + m.name + '</b> · ' + LH.money(m.cost) + (m.vertical ? ' per level' : '') +
      ' · upkeep ' + LH.money(m.up) + '/day');
    var f = [];
    if (m.pop) f.push(m.pop + ' berths');
    if (m.tour) f.push(m.tour + ' visitor rooms');
    if (m.jobs) f.push(m.jobs + ' jobs');
    if (m.power > 0) f.push('+' + m.power + ' power');
    if (m.power < 0) f.push(m.power + ' power');
    if (m.store) f.push(m.store + ' power storage');
    if (m.o2) f.push((m.o2 > 0 ? '+' : '') + m.o2 + ' O₂');
    if (m.water) f.push((m.water > 0 ? '+' : '') + m.water + ' water');
    if (m.food) f.push('+' + m.food + ' food');
    if (m.ore) f.push('+' + m.ore + ' ore');
    if (m.ore_in) f.push('−' + m.ore_in + ' ore');
    if (m.he3) f.push('+' + m.he3 + ' He-3');
    if (m.income) f.push(LH.money(m.income) + '/day');
    if (m.amen) f.push('morale ' + m.amen.v + ' within ' + m.amen.r);
    bits.push('<span style="color:var(--dim)">' + LH.levelRule(m) + ' · ' + m.w + ' cells wide</span>');
    if (f.length) bits.push(f.join(' · '));
    bits.push('<span style="color:var(--dim)">' + m.desc + '</span>');
    LH.setHint(bits.join('<br>'));
  };

  var hintLock = null;
  LH.setHint = function (html) {
    var h = $('hint');
    if (html === null) {
      h.innerHTML = hintLock || 'Pick a module on the left, then click to build. <b>Right-drag</b> or <b>Space</b> to pan, <b>scroll</b> to zoom.';
    } else h.innerHTML = html;
  };
  LH.lockHint = function (html) { hintLock = html; };

  /* -------------------------------------------------------------- toasts */

  LH.toast = function (msg, kind) {
    var t = el('div', 'toast ' + (kind || ''), msg);
    $('toast').appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .4s'; t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 420);
    }, 4200);
  };

  /* ------------------------------------------------------------- top bar */

  LH.refreshTop = function (s) {
    var st = s.stats;
    $('s-credits').textContent = LH.money(s.credits);
    $('s-credits').className = 'v' + (s.credits < 0 ? ' neg' : '');

    var bal = (st.income || 0) - (st.upkeep || 0);
    var b = $('s-balance');
    b.textContent = (bal >= 0 ? '+' : '') + LH.money(bal) + '/d';
    b.className = 'v small ' + (bal >= 0 ? 'pos' : 'neg');

    var sun = LH.sunFactor(s.day);
    $('s-day').innerHTML = '<span class="phase-dot" id="s-phase"></span>' + s.day;
    var dot = $('s-phase');
    var phase = ((s.day - 1) % LH.C.LUNAR_CYCLE) / LH.C.LUNAR_CYCLE;
    var off = Math.cos(phase * Math.PI * 2) * 12;
    dot.style.boxShadow = 'inset ' + off.toFixed(1) + 'px 0 0 0 #0b0f18';
    dot.title = sun > 0.05 ? 'Lunar day — solar arrays producing' : 'Lunar night — solar arrays are dead';

    $('s-pop').textContent = Math.round(s.pop) + (s.tourists >= 1 ? ' +' + Math.round(s.tourists) : '');
    $('s-housing').textContent = Math.floor(st.housing || 0) + ' berths';

    var mo = $('s-morale');
    mo.textContent = Math.round(s.morale);
    mo.className = 'v ' + (s.morale >= 58 ? 'pos' : s.morale < 38 ? 'neg' : '');

    $('s-power').textContent = Math.round(st.powerGen || 0) + ' / ' + Math.round(st.powerUse || 0);
    $('s-power').className = 'v small ' + ((st.powerGen || 0) >= (st.powerUse || 0) ? 'pos' : 'neg');
    $('s-store').textContent = 'bank ' + Math.round(s.res.power) + '/' + Math.round(st.powerCap || 0);

    var life = ['o2', 'water', 'food'].map(function (r) {
      var v = s.res[r], bal2 = st[r + 'Bal'] || 0;
      var col = v <= 0 ? 'var(--bad)' : bal2 < 0 ? 'var(--warn)' : 'var(--good)';
      var lbl = r === 'o2' ? 'O₂' : r === 'water' ? 'H₂O' : 'FD';
      return '<span style="color:' + col + '">' + lbl + '&nbsp;' + Math.round(v) + '</span>';
    }).join(' ');
    $('s-life').innerHTML = life;

    var tier = LH.TIERS[s.tier - 1];
    $('charter').textContent = (tier ? tier.name.toUpperCase() : '—') + ' · TIER ' + s.tier;
  };

  /* ---------------------------------------------------------- side panel */

  LH.refreshPanel = function (s) {
    var body = $('panelbody');
    if (ui.tab === 'log') return renderLog(s, body);
    if (ui.tab === 'charter') return renderCharter(s, body);
    renderStatus(s, body);
  };

  function row(l, r, cls) {
    return '<div class="row"><span class="l">' + l + '</span><span class="r ' + (cls || '') + '">' + r + '</span></div>';
  }
  function bar(v, max, warnAt) {
    var f = Math.max(0, Math.min(1, max > 0 ? v / max : 0));
    var cls = f < (warnAt || 0.2) ? 'bad' : f < 0.45 ? 'warn' : '';
    return '<div class="bar"><i class="' + cls + '" style="width:' + (f * 100).toFixed(0) + '%"></i></div>';
  }

  function renderStatus(s, body) {
    var st = s.stats, h = '';

    if (ui.sel && s.inst[ui.sel]) {
      var inst = s.inst[ui.sel], m = LH.MOD[inst.mid];
      h += '<div class="sec">Selected</div>';
      h += '<div style="font-size:13px;color:' + m.color + '">' + m.name + '</div>';
      h += '<div class="mdesc">' + m.desc + '</div>';
      h += row('Level', LH.fmtL(inst.l0) + (inst.l1 !== inst.l0 ? ' → ' + LH.fmtL(inst.l1) : ''));
      h += row('Transit distance', inst.dist === Infinity ? '<span style="color:var(--bad)">unreachable</span>' :
        Math.round(inst.dist) + (inst.dist > LH.C.COMMUTE_GOOD ? ' <span style="color:var(--warn)">(far)</span>' : ''));
      h += row('Status', inst.dist === Infinity ? '<span style="color:var(--bad)">Isolated</span>' :
        !inst.on ? '<span style="color:var(--warn)">Offline — no power</span>' : '<span style="color:var(--good)">Operational</span>');
      if (inst.dmg > 0.01) h += row('Damage', '<span style="color:var(--bad)">' + Math.round(inst.dmg * 100) + '%</span>');
      if (m.id === 'solar') h += row('Dust loss', Math.round(inst.dust * 100) + '%');
      if (m.pop) h += row('Berths filled', Math.round(inst.occCap || 0) + ' / ' + m.pop);
      h += row('Shielded', LH.shielded(s, inst) ? '<span style="color:var(--good)">yes</span>' :
        '<span style="color:var(--warn)">no — ' + Math.round(LH.radiationAt(inst.l) * 100) + '% exposure</span>');
      h += '<button class="act danger" onclick="LH.bulldozeSelected()">Demolish (refund ' +
        LH.money(Math.round((m.vertical ? m.cost * inst.cells.length : m.cost) * 0.35)) + ')</button>';
      h += '<button class="act" onclick="LH.ui.sel=null;LH.refreshPanel(LH.S)">Clear selection</button>';
    }

    h += '<div class="sec">Power</div>';
    h += row('Generation', Math.round(st.powerGen || 0));
    h += row('Demand', Math.round(st.powerUse || 0));
    h += row('Banked', Math.round(s.res.power) + ' / ' + Math.round(st.powerCap || 0));
    h += bar(s.res.power, st.powerCap || 1);
    if (st.shed) h += row('Shed offline', '<span style="color:var(--bad)">' + st.shed + ' modules</span>');
    h += row('Sunlight', Math.round(LH.sunFactor(s.day) * 100) + '%',
      LH.sunFactor(s.day) < 0.05 ? 'neg' : '');

    h += '<div class="sec">Life Support</div>';
    [['o2', 'Oxygen'], ['water', 'Water'], ['food', 'Food']].forEach(function (p) {
      var bal = st[p[0] + 'Bal'] || 0;
      h += row(p[1], Math.round(s.res[p[0]]) + '  <span style="color:' +
        (bal < 0 ? 'var(--bad)' : 'var(--good)') + '">' + (bal >= 0 ? '+' : '') + bal.toFixed(1) + '</span>');
      h += bar(s.res[p[0]], 200 + s.pop * 5);
    });

    h += '<div class="sec">Colony</div>';
    h += row('Population', Math.round(s.pop));
    h += row('Berths', Math.floor(st.housing || 0));
    h += row('Visitors', Math.round(s.tourists) + (st.draw ? ' (draw ' + st.draw.toFixed(0) + ')' : ''));
    h += row('Jobs', Math.round(st.jobs || 0) + ' / ' + Math.round(st.workers || 0) + ' workers',
      (st.staffing || 1) < 0.85 ? 'neg' : '');
    h += row('Morale', Math.round(s.morale) + ' → ' + Math.round(st.moraleTarget || 0));
    h += row('Crew health', Math.round(s.health));
    if (st.orphans) h += row('Unreachable modules', '<span style="color:var(--bad)">' + st.orphans + '</span>');

    h += '<div class="sec">Ledger</div>';
    h += row('Income', LH.money(st.income || 0), 'pos');
    h += row('Upkeep', LH.money(-(st.upkeep || 0)), 'neg');
    h += row('of which exports', LH.money(st.exports || 0));
    h += row('Ore stock', Math.round(s.res.ore) + (st.oreRate ? ' (+' + st.oreRate.toFixed(1) + ')' : ''));
    if (st.he3Rate) h += row('He-3 output', st.he3Rate.toFixed(1) + '/day');

    body.innerHTML = h;
  }

  function renderCharter(s, body) {
    var h = '', p = LH.tierProgress(s);
    h += '<div class="sec">Current charter</div>';
    var t = LH.TIERS[s.tier - 1];
    h += '<div style="font-size:15px;color:var(--accent)">' + t.name + '</div>';
    h += '<div class="mdesc">Tier ' + s.tier + ' of 6. Each charter upgrade unlocks new module classes.</div>';

    if (p) {
      h += '<div class="sec">Next: ' + p.name + '</div>';
      p.items.forEach(function (i) {
        h += '<div class="chk ' + (i.ok ? 'ok' : 'no') + '"><span class="m">' +
          (i.ok ? '✔' : '○') + '</span><span>' + i.label + '</span></div>';
      });
    } else {
      h += '<div class="sec">Complete</div><p class="mdesc">You have built a lunar capital. ' +
        'The colony now runs itself — keep it alive and keep it growing.</p>';
    }

    h += '<div class="sec">All tiers</div>';
    LH.TIERS.forEach(function (tt) {
      var got = s.tier >= tt.n;
      h += '<div class="chk ' + (got ? 'ok' : 'no') + '"><span class="m">' + (got ? '✔' : tt.n) +
        '</span><span>' + tt.name + (tt.req.pop ? ' · ' + tt.req.pop + ' pop' : '') + '</span></div>';
    });

    h += '<div class="sec">Unlocked by tier</div>';
    for (var n = 2; n <= 6; n++) {
      var mods = LH.MODULES.filter(function (m) { return m.tier === n; });
      if (!mods.length) continue;
      h += '<div style="font-size:10px;color:var(--dim);margin-top:6px">TIER ' + n + '</div>';
      h += mods.map(function (m) {
        return '<span class="pill" style="' + (s.tier >= n ? 'color:' + m.color + ';border-color:' + m.color + '44' : '') + '">' + m.name + '</span>';
      }).join('');
    }

    h += '<button class="act" onclick="LH.saveGame()">Save colony</button>';
    h += '<button class="act danger" onclick="LH.confirmNew()">Abandon &amp; start over</button>';
    body.innerHTML = h;
  }

  function renderLog(s, body) {
    if (!s.log.length) { body.innerHTML = '<p class="mdesc">Nothing has happened yet. Give it a few days.</p>'; return; }
    body.innerHTML = s.log.map(function (e) {
      return '<div class="logline ' + e.kind + '"><span class="d">Day ' + e.day + '</span><br>' + e.msg + '</div>';
    }).join('');
  }

  LH.toggleSandbox = function () {
    var s = LH.S;
    s.sandbox = !s.sandbox;
    var b = document.getElementById('btn-sandbox');
    if (b) b.classList.toggle('on', !!s.sandbox);
    LH.buildPalette(s);
    LH.toast(s.sandbox ?
      'Sandbox open — every module is free and every tier is unlocked. Build the colony of your dreams.' :
      'Sandbox closed. Costs and charter locks are back in force.', s.sandbox ? 'good' : 'warn');
  };

  LH.bulldozeSelected = function () {
    if (!ui.sel) return;
    var r = LH.remove(LH.S, ui.sel);
    ui.sel = null;
    LH.toast('Module demolished. ' + LH.money(r) + ' recovered.', 'warn');
    LH.refreshPanel(LH.S);
  };

  /* --------------------------------------------------------------- tabs */

  LH.initTabs = function () {
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      b.onclick = function () {
        ui.tab = b.dataset.tab;
        Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (o) {
          o.classList.toggle('on', o === b);
        });
        LH.refreshPanel(LH.S);
      };
    });
  };

})(window.LH);
