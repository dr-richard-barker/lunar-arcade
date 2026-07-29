# Lunar Arcade

Original browser games in the spirit of the classic 1990s Maxis simulation games,
rebuilt from scratch with a lunar-settlement theme. Everything is vanilla
JavaScript — no build step, no dependencies, no assets to download. Open
`index.html` or serve the folder and play.

**Live site:** deploy this repository to GitHub Pages (Settings → Pages → deploy
from branch, root folder) and the hub page just works.

## The games

### Lunar Habitat (`games/lunar-habitat/`) — playable

A vertical colony builder inspired by the tower-management genre, with the
formula inverted: the surface is the most dangerous floor in the building.

- **Build up 26 levels, dig down 24.** Excavation is charged per cell and gets
  more expensive with depth — but three levels of rock overhead is full
  radiation shielding.
- **A 28-day lunar cycle.** Solar arrays are free power for a fortnight, then
  dead for a fortnight. Batteries, RTGs and (eventually) a buried fission plant
  carry the night.
- **Transit scoring.** Every module is rated on its commute back to a surface
  airlock through corridors, ladder wells and lift shafts. Long commutes wreck
  morale; disconnected modules simply don't run.
- **Events.** Solar particle events (with a two-day warning to get people under
  shield caps), moonquakes that crack deep seals, micrometeorites, dust on the
  arrays.
- **Six charter tiers** from Outpost to Lunar Capital, each gating new modules —
  33 module types across infrastructure, power, life support, habitation,
  industry, mining and amenities.

Saves live in the browser's localStorage (autosave every 90 seconds).

Code layout: `js/config.js` (all tuning constants and the module catalogue),
`js/grid.js` (world state, placement rules, Dijkstra transit solver),
`js/sim.js` (the daily tick), `js/render.js` (procedural canvas renderer),
`js/ui.js` (DOM chrome), `js/main.js` (input + main loop).

### The Boring Mining Game (`games/boring-mining/`) — playable

Pheromone-swarm mining: you pilot one drone, the rest of the swarm follows the
scent trails you reinforce.

### Regolith Farm — in development

## Copyright

These are tributes to a genre, not ports or reskins. No code, artwork, audio or
data files from any commercial game are used, included or distributed here.
Game *mechanics* are ideas, and ideas are free to build on; the specific
expression of the classics belongs to the people who made them.

MIT licensed.
