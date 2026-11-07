/* ==========================================================================
   REGOLITH ROVERS — the kit (DOM-free)
   Every name and behaviour here is original to this game.
   kind:  charge  — hold fire to build launch speed, release to fire
          instant — fires on press
          target  — pick a point on the map, then fire
          utility — does not end the turn
          skip    — ends the turn
   Blast radius R is in pixels (20 px = 1 m); push is knockback in m/s.
   ========================================================================== */
'use strict';
var RR = globalThis.RR || (globalThis.RR = {});

(function () {
  const WEAPONS = [
    { id: 'bone', key: '1', name: 'Bone Rocket', icon: '🦴', ammo: Infinity, kind: 'charge',
      proj: { r: 3 }, blast: { R: 44, dmg: 48, push: 7 },
      desc: 'Explodes on impact. Flies a pure ballistic arc.' },
    { id: 'ball', key: '2', name: 'Fetch Ball', icon: '🎾', ammo: Infinity, kind: 'charge',
      proj: { r: 4, bounce: true, restitution: 0.5 }, fuse: true, blast: { R: 38, dmg: 44, push: 7 },
      desc: 'Bounces until its fuse runs out (Q / E set 1–5 s).' },
    { id: 'scatter', key: '3', name: 'Sample Scatter', icon: '🧪', ammo: 2, kind: 'charge',
      proj: { r: 3 }, blast: { R: 24, dmg: 22, push: 4 },
      bomblets: { n: 5, r: 2, R: 22, dmg: 20, push: 4 },
      desc: 'A sample canister that bursts into five bomblets on impact.' },
    { id: 'drop', key: '4', name: 'Supply Drop', icon: '📦', ammo: 1, kind: 'target',
      proj: { r: 4 }, blast: { R: 32, dmg: 30, push: 6 },
      desc: 'Pick a point: three cargo pods fall on it along the current gravity.' },
    { id: 'laser', key: '5', name: 'Laser Pointer', icon: '🔦', ammo: 2, kind: 'instant',
      range: 600, dmg: 20, push: 3,
      desc: 'A straight beam up to 30 m. Light ignores the gravity setting.' },
    { id: 'thrust', key: '6', name: 'Thruster Pack', icon: '🚀', ammo: 1, kind: 'utility',
      accel: 6, fuel: 3,
      desc: '6 m/s² of thrust for 3 s. Hold fire to burn; aim to steer.' },
    { id: 'printer', key: '7', name: 'Regolith Printer', icon: '🧱', ammo: 2, kind: 'utility',
      len: 60, thick: 9,
      desc: 'Prints a 3 m sintered-regolith slab along your aim.' },
    { id: 'drill', key: '8', name: 'Drill Paw', icon: '⛏️', ammo: 2, kind: 'utility',
      time: 2, speed: 1.2, R: 12,
      desc: 'Bores a tunnel along your aim for 2 s.' },
    { id: 'skip', key: '0', name: 'Skip Turn', icon: '⏭️', ammo: Infinity, kind: 'skip',
      desc: 'End your turn without firing.' },
  ];
  const BY_ID = {};
  for (const w of WEAPONS) BY_ID[w.id] = w;

  RR.WEAPONS = WEAPONS;
  RR.WEAPON = BY_ID;
  RR.CHARGE_TIME = 1.6;   // seconds of holding fire to reach full launch speed
})();
