/* ==========================================================================
   REGOLITH ROVERS — suit-radio audio
   Vacuum carries no sound, so everything here is "telemetry": short
   synthesised blips, thumps and hiss built with WebAudio. No samples.
   ========================================================================== */
'use strict';
var RR = globalThis.RR || (globalThis.RR = {});

(function () {
  let ac = null, master = null, noiseBuf = null, muted = false, thrustNode = null;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  function tone(type, f0, f1, dur, peak, delay) {
    if (!ac || muted) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.005, peak, dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, freq, q, peak, delay) {
    if (!ac || muted) return;
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 0.7;
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    const g = ac.createGain(); env(g, t, 0.004, peak, dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }

  const SFX = {
    fire()   { noise(0.25, 2400, 1, 0.35); tone('sine', 220, 520, 0.18, 0.18); },
    boom(R)  { const k = Math.min(1.3, (R || 40) / 40); noise(0.6 * k, 900, 0.8, 0.7 * k); tone('sine', 90, 38, 0.5 * k, 0.6 * k); },
    bounce() { tone('sine', 640, 320, 0.09, 0.15); },
    laser()  { tone('sawtooth', 1500, 380, 0.28, 0.12); },
    jump()   { tone('square', 330, 660, 0.08, 0.07); },
    land()   { tone('sine', 140, 70, 0.08, 0.15); },
    woof()   { tone('square', 420, 300, 0.07, 0.08); tone('square', 520, 360, 0.08, 0.08, 0.11); },
    lost()   { tone('sine', 900, 90, 1.1, 0.16); },
    down()   { tone('triangle', 500, 60, 0.6, 0.18); },
    click()  { tone('square', 900, 0, 0.03, 0.05); },
    gravity(planet) { tone('sine', [330, 440, 660][planet] || 440, 0, 0.12, 0.1); },
    tick()   { tone('square', 1200, 0, 0.03, 0.05); },
    hurt()   { tone('square', 260, 140, 0.15, 0.1); },
    print()  { noise(0.2, 1400, 2, 0.2); tone('triangle', 200, 260, 0.2, 0.1); },
    noammo() { tone('square', 180, 150, 0.12, 0.08); },
    win()    { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, 0, 0.22, 0.14, i * 0.13)); },
  };

  function thrust(on) {
    if (!ac) return;
    if (on && !thrustNode && !muted) {
      const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6;
      const g = ac.createGain(); g.gain.value = 0.12;
      s.connect(f); f.connect(g); g.connect(master); s.start();
      thrustNode = { s, g };
    } else if (!on && thrustNode) {
      thrustNode.g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.05);
      thrustNode.s.stop(ac.currentTime + 0.2);
      thrustNode = null;
    }
  }

  function onEvent(e) {
    switch (e.type) {
      case 'fire': SFX.fire(); break;
      case 'explode': SFX.boom(e.R); break;
      case 'bounce': SFX.bounce(); break;
      case 'laser': SFX.laser(); break;
      case 'jump': SFX.jump(); break;
      case 'land': if (e.vin > 2) SFX.land(); break;
      case 'turn': SFX.woof(); break;
      case 'lost': SFX.lost(); break;
      case 'down': SFX.down(); break;
      case 'damage': SFX.hurt(); break;
      case 'gravity': SFX.gravity(e.planet); break;
      case 'print': SFX.print(); break;
      case 'noammo': SFX.noammo(); break;
      case 'weapon': case 'auto': case 'ammo': case 'fuse': SFX.click(); break;
      case 'over': if (e.winner) SFX.win(); break;
    }
  }

  RR.Audio = {
    init, onEvent, thrust, tick: () => SFX.tick(),
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; if (m) thrust(false); },
    get muted() { return muted; },
  };
})();
