/* Lunar Habitat — design constants and the module catalogue.
   Everything the designer tunes lives in this file. */

var LH = window.LH || {};

LH.C = {
  GRID_W: 140,          // columns
  MAX_UP: 26,           // buildable levels above the surface (0 = surface deck)
  MAX_DOWN: 24,         // excavatable levels below the surface
  CELL_W: 22,
  CELL_H: 34,

  START_CREDITS: 200000,

  DAY_MS: 4000,         // real ms per colony day at 1x
  LUNAR_CYCLE: 28,      // days per lunar cycle (14 lit, 14 dark)

  EXCAV_BASE: 220,      // credits per cell excavated at depth 1
  EXCAV_DEPTH_MULT: 0.14,

  // life-support draw per colonist per day
  O2_PER_POP: 0.9,
  WATER_PER_POP: 0.8,
  FOOD_PER_POP: 0.7,
  POWER_PER_POP: 0.35,

  ORE_PRICE: 55,
  HE3_PRICE: 1500,

  // a module more than this many transit-steps from an airlock is "remote"
  COMMUTE_GOOD: 18,
  COMMUTE_BAD: 55
};

/* Radiation exposure by level. Deep = safe, surface = bad, high tower = worst.
   Returns 0 (shielded) .. 1 (fully exposed). */
LH.radiationAt = function (level) {
  if (level < 0) return Math.max(0, 0.35 + level * 0.12);  // -3 and below is safe
  return Math.min(1, 0.45 + level * 0.02);
};

LH.CATS = [
  { id: 'infra',  name: 'Infrastructure', color: '#8b98a8' },
  { id: 'power',  name: 'Power',          color: '#e8b13a' },
  { id: 'life',   name: 'Life Support',   color: '#49c1a0' },
  { id: 'hab',    name: 'Habitation',     color: '#5b9bd5' },
  { id: 'work',   name: 'Industry',       color: '#c96f4a' },
  { id: 'mine',   name: 'Mining',         color: '#a2795f' },
  { id: 'amen',   name: 'Amenities',      color: '#b07fd0' }
];

/* Module fields
     w        cells wide
     cost     credits to build
     up       upkeep, credits/day
     pop      resident capacity
     tour     visitor capacity
     jobs     workers required to run at full output
     power    +generate / -consume per day
     o2/water/food   +produce / -consume per day
     ore/ice/he3     production per day
     ore_in   ore consumed per day
     income   credits/day when fully operational
     amen     { r: radius in cells, v: morale value }
     where    'any' | 'surface' | 'above' | 'below'
     minL/maxL  hard level limits
     tier     charter tier required to unlock
     vertical true = drawn/placed as a shaft spanning levels
*/
LH.MODULES = [
  // ---------------------------------------------------------------- infra
  { id: 'corridor', name: 'Corridor', cat: 'infra', w: 1, cost: 400, up: 1,
    where: 'any', tier: 1, color: '#7d8794',
    desc: 'Pressurised walkway. Modules must form an unbroken run back to a shaft and an airlock.' },

  { id: 'ladder', name: 'Ladder Well', cat: 'infra', w: 1, cost: 320, up: 1,
    where: 'any', tier: 1, vertical: true, span: 6, speed: 2.4, color: '#6f7b88',
    desc: 'Cheap vertical link, max 6 levels. Slow — colonists hate long climbs.' },

  { id: 'lift', name: 'Transit Shaft', cat: 'infra', w: 1, cost: 1400, up: 3,
    where: 'any', vertical: true, span: 20, speed: 1, tier: 1, color: '#9aa7b5',
    desc: 'Standard pressurised lift. Drag vertically to size the shaft.' },

  { id: 'express', name: 'Mag-Lift Shaft', cat: 'infra', w: 1, cost: 4600, up: 14,
    where: 'any', vertical: true, span: 40, speed: 0.35, tier: 3, color: '#cfd9e6',
    desc: 'High-speed shaft. Three times the reach of a transit shaft — the backbone of any deep colony.' },

  { id: 'airlock', name: 'Surface Airlock', cat: 'infra', w: 4, cost: 6500, up: 15,
    where: 'surface', tier: 1, color: '#b8c4d2',
    desc: 'The colony\'s front door. Every module is scored on its transit distance back to the nearest airlock.' },

  { id: 'pad', name: 'Landing Pad', cat: 'infra', w: 9, cost: 26000, up: 55,
    where: 'surface', tier: 1, color: '#8d9aa8',
    desc: 'Receives crew rotations and tourists. No pad, no immigration.' },

  { id: 'shield', name: 'Regolith Shield Cap', cat: 'infra', w: 2, cost: 1600, up: 2,
    where: 'above', tier: 1, color: '#6b5f52',
    desc: 'Sintered regolith slab. Shields everything in its columns on the level directly below.' },

  // ---------------------------------------------------------------- power
  { id: 'solar', name: 'Solar Array', cat: 'power', w: 4, cost: 9000, up: 30,
    where: 'aboveOr0', power: 54, tier: 1, color: '#e8b13a',
    desc: 'Free power — for the 14 days a month the sun is up. Dust cuts output until a maintenance bay cleans it.' },

  { id: 'battery', name: 'Battery Bank', cat: 'power', w: 2, cost: 8600, up: 18,
    where: 'any', store: 420, tier: 1, color: '#c9a227',
    desc: 'Banks daytime surplus so the colony survives the fourteen-day lunar night.' },

  { id: 'rtg', name: 'RTG Cluster', cat: 'power', w: 1, cost: 16000, up: 45,
    where: 'any', power: 14, tier: 1, color: '#d4762f',
    desc: 'Small, expensive, and utterly indifferent to the sun. Keeps life support alive through a blackout.' },

  { id: 'fission', name: 'Fission Plant', cat: 'power', w: 6, cost: 95000, up: 520,
    where: 'below', maxL: -6, power: 270, jobs: 6, tier: 3, color: '#f0d060',
    desc: 'Buried deep for shielding. The only honest answer to the lunar night.' },

  // ---------------------------------------------------------------- life
  { id: 'scrubber', name: 'O2 Scrubber', cat: 'life', w: 3, cost: 8000, up: 26,
    where: 'any', o2: 34, power: -11, tier: 1, color: '#49c1a0',
    desc: 'Cracks oxygen out of stored regolith oxides. Run out and people start dying.' },

  { id: 'recycler', name: 'Water Recycler', cat: 'life', w: 3, cost: 8500, up: 26,
    where: 'any', water: 28, power: -9, tier: 1, color: '#3fa8c4',
    desc: 'Closes the water loop. Never quite closes it all the way.' },

  { id: 'hydro', name: 'Hydroponics Bay', cat: 'life', w: 6, cost: 19000, up: 55,
    where: 'any', food: 34, o2: 11, power: -22, water: -16, jobs: 4, tier: 1, color: '#5fc46a',
    desc: 'Food and a little oxygen. Thirsty and power-hungry.' },

  // ---------------------------------------------------------------- hab
  { id: 'pod', name: 'Crew Pod', cat: 'hab', w: 4, cost: 12000, up: 25,
    where: 'any', pop: 6, income: 190, power: -3, tier: 1, color: '#5b9bd5',
    desc: 'Six bunks and a viewport. Entry-level housing.' },

  { id: 'block', name: 'Habitat Block', cat: 'hab', w: 7, cost: 31000, up: 60,
    where: 'any', pop: 18, income: 560, power: -7, tier: 2, color: '#4a86c4',
    desc: 'Proper apartments. Residents expect an amenity or two within walking distance.' },

  { id: 'hotel', name: 'Transit Quarters', cat: 'hab', w: 6, cost: 27000, up: 90,
    where: 'any', tour: 14, income: 60, power: -8, jobs: 3, tier: 2, color: '#7ab0e0',
    desc: 'Rooms for visitors. Income scales with how much there is to see — build attractions.' },

  { id: 'suite', name: 'Lunar Suite', cat: 'hab', w: 9, cost: 72000, up: 150,
    where: 'any', pop: 10, income: 1400, power: -12, tier: 4, color: '#3d74ad',
    desc: 'Ruinously expensive housing for people who can afford the view. Demands high morale to fill.' },

  // ---------------------------------------------------------------- work
  { id: 'admin', name: 'Admin Centre', cat: 'work', w: 5, cost: 18000, up: 45,
    where: 'any', jobs: 6, income: 340, power: -8, tier: 1, color: '#c96f4a',
    desc: 'Contracts, payroll, and paperwork. Dull, reliable money.' },

  { id: 'lab', name: 'Research Lab', cat: 'work', w: 5, cost: 23000, up: 80,
    where: 'any', jobs: 8, income: 460, power: -14, tier: 2, color: '#d4835c',
    desc: 'Grant income from the agencies back home. Pays better the deeper the colony gets.' },

  { id: 'fab', name: 'Fabricator', cat: 'work', w: 5, cost: 21000, up: 90,
    where: 'any', jobs: 6, ore_in: 5, income: 390, power: -16, tier: 2, color: '#b3603f',
    desc: 'Turns raw ore into parts and spares. Needs a mine feeding it.' },

  { id: 'refinery', name: 'Refinery', cat: 'work', w: 8, cost: 47000, up: 260,
    where: 'any', jobs: 10, ore_in: 14, income: 1150, power: -34, tier: 3, color: '#9e5334',
    desc: 'Bulk metals for export. The backbone of a real industrial base.' },

  { id: 'comms', name: 'Comms Array', cat: 'work', w: 3, cost: 16000, up: 50,
    where: 'above', jobs: 2, income: 230, power: -7, tier: 1, color: '#dd9a70',
    desc: 'Relay bandwidth sold to Earth. Must be above the surface to see the sky.' },

  // ---------------------------------------------------------------- mine
  { id: 'mine', name: 'Regolith Mine', cat: 'mine', w: 5, cost: 21000, up: 110,
    where: 'below', maxL: -3, jobs: 6, ore: 9, power: -19, tier: 1, color: '#a2795f',
    desc: 'Chews ore out of the rock. Must be at least three levels down.' },

  { id: 'icemine', name: 'Ice Extraction', cat: 'mine', w: 5, cost: 36000, up: 160,
    where: 'below', maxL: -10, jobs: 6, water: 30, power: -26, tier: 2, color: '#79a8c0',
    desc: 'Taps buried polar ice. Ten levels down or it hits nothing but dry rock.' },

  { id: 'he3', name: 'He-3 Extractor', cat: 'mine', w: 6, cost: 58000, up: 300,
    where: 'surface', jobs: 8, he3: 1.4, power: -32, tier: 2, color: '#c8b06a',
    desc: 'Bakes helium-3 out of sun-baked surface regolith. The single most valuable export on the Moon.' },

  { id: 'core', name: 'Deep Core Complex', cat: 'mine', w: 6, cost: 130000, up: 700,
    where: 'below', maxL: -18, jobs: 12, ore: 24, he3: 3, power: -64, tier: 5, color: '#8a6448',
    desc: 'An industrial bore into the deep crust. Eighteen levels down, and worth every credit.' },

  // ---------------------------------------------------------------- amenities
  { id: 'mess', name: 'Mess Hall', cat: 'amen', w: 5, cost: 14000, up: 70,
    where: 'any', jobs: 4, income: 150, power: -8, amen: { r: 13, v: 8 }, tier: 1, color: '#b07fd0',
    desc: 'Hot food and somewhere to sit. The cheapest morale you can buy.' },

  { id: 'med', name: 'Medical Bay', cat: 'amen', w: 4, cost: 20000, up: 140,
    where: 'any', jobs: 5, power: -10, amen: { r: 22, v: 7 }, health: true, tier: 1, color: '#d47fa0',
    desc: 'Treats radiation exposure and accidents. Casualties are far worse without one in range.' },

  { id: 'gym', name: 'Exercise Deck', cat: 'amen', w: 4, cost: 12000, up: 55,
    where: 'any', jobs: 2, power: -6, amen: { r: 15, v: 6 }, tier: 1, color: '#9f6fc0',
    desc: 'Two hours a day of resistance training, or their bones dissolve.' },

  { id: 'school', name: 'School', cat: 'amen', w: 5, cost: 17000, up: 100,
    where: 'any', jobs: 4, power: -8, amen: { r: 17, v: 9 }, tier: 3, color: '#c08fd8',
    desc: 'The moment children arrive, a base becomes a settlement.' },

  { id: 'rec', name: 'Rec Dome', cat: 'amen', w: 7, cost: 33000, up: 190,
    where: 'any', jobs: 4, income: 240, power: -14, amen: { r: 20, v: 12 }, draw: 3, tier: 3, color: '#9d5fc9',
    desc: 'Bars, courts, low-gravity sport. Draws tourists as well as lifting morale.' },

  { id: 'obs', name: 'Observatory', cat: 'amen', w: 6, cost: 42000, up: 220,
    where: 'above', minL: 3, jobs: 4, income: 520, power: -12, amen: { r: 16, v: 8 }, draw: 6, tier: 3, color: '#8f7fe0',
    desc: 'Earthrise, and no atmosphere in the way. Must sit three levels above the surface.' },

  { id: 'garden', name: 'Garden Dome', cat: 'amen', w: 9, cost: 48000, up: 280,
    where: 'above', o2: 16, jobs: 3, power: -16, water: -10, amen: { r: 28, v: 18 }, draw: 8, tier: 4, color: '#63c98b',
    desc: 'Trees under glass. The one thing every colonist says they miss.' },

  { id: 'security', name: 'Security Post', cat: 'amen', w: 3, cost: 10000, up: 80,
    where: 'any', jobs: 3, power: -5, amen: { r: 24, v: 2 }, guard: true, tier: 2, color: '#8090a8',
    desc: 'Cuts damage from breaches and quakes within its patrol radius.' },

  { id: 'maint', name: 'Maintenance Bay', cat: 'amen', w: 4, cost: 12000, up: 70,
    where: 'any', jobs: 3, power: -6, repair: true, amen: { r: 30, v: 1 }, tier: 1, color: '#7f8f7a',
    desc: 'Repairs damaged modules and scrubs dust off solar arrays. Build one early.' }
];

LH.MOD = {};
LH.MODULES.forEach(function (m) { LH.MOD[m.id] = m; });

LH.TIERS = [
  { n: 1, name: 'Outpost',       req: {} },
  { n: 2, name: 'Base',          req: { pop: 30,   need: ['airlock', 'pad'] } },
  { n: 3, name: 'Settlement',    req: { pop: 90,   morale: 52, need: ['med'] } },
  { n: 4, name: 'Colony',        req: { pop: 220,  morale: 58, need: ['rec', 'school', 'refinery'] } },
  { n: 5, name: 'City',          req: { pop: 500,  morale: 62, need: ['obs', 'garden'] } },
  { n: 6, name: 'Lunar Capital', req: { pop: 1000, morale: 70, need: ['core'] } }
];

/* Is this module allowed at this level? */
LH.levelOk = function (m, level) {
  if (m.minL !== undefined && level < m.minL) return false;
  if (m.maxL !== undefined && level > m.maxL) return false;
  switch (m.where) {
    case 'surface':  return level === 0;
    case 'above':    return level >= 1;
    case 'aboveOr0': return level >= 0;
    case 'below':    return level <= -1;
    default:         return true;
  }
};

LH.levelRule = function (m) {
  var s = '';
  switch (m.where) {
    case 'surface':  s = 'Surface deck only'; break;
    case 'above':    s = 'Above surface only'; break;
    case 'aboveOr0': s = 'Surface or above'; break;
    case 'below':    s = 'Subsurface only'; break;
    default:         s = 'Any level';
  }
  if (m.maxL !== undefined && m.maxL < 0) s = 'Level ' + m.maxL + ' or deeper';
  if (m.minL !== undefined && m.minL > 0) s = 'Level +' + m.minL + ' or higher';
  return s;
};

LH.excavCost = function (level) {
  var d = Math.abs(level);
  return Math.round(LH.C.EXCAV_BASE * (1 + d * LH.C.EXCAV_DEPTH_MULT));
};

window.LH = LH;
