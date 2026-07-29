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

A colony sim in the ant-farm tradition, on a lunar ore claim. You pilot
DRONE-01 — one unit of a swarm that is otherwise autonomous — while a rival
colony, Helios Extraction, works the same rock from the far side of the map.
Bore the fabricator's integrity to zero to win; lose yours and the contract
ends.

- **Four scalar fields do the actual thinking.** An *ore scent* relaxes outward
  from every ore and ice tile and attenuates faster through rock than through
  air, so miners can smell a seam through a wall and dig toward it. A *trail*
  pheromone is laid by loaded drones on the way home and diffuses and
  evaporates, so a seam that keeps paying becomes a highway and a spent one
  quietly goes cold. An *alarm* field recruits guards to a fight. A
  breadth-first *home* field gives exact routing back through whatever tunnel
  network the swarm has actually dug.
- **You steer the swarm by beacon, not by order.** `Q` drops an ore beacon that
  pulls miners in; `E` drops a rally beacon that pulls guards. Plant a rally
  beacon on the Helios fabricator and that reads as an assault order.
- **Solar economy** on a compressed lunar day/night cycle: print drones while
  the sun is up, because the night barely charges anything.
- **You are not the colony.** If DRONE-01 dies your link jumps to the nearest
  surviving unit. You only actually lose when the fabricator does.
- **Autoplay (`F`)** hands DRONE-01 to an agent that reads the same fields and
  drives the same four verbs you do — prospect, haul, defend, and eventually
  siege. It wins unaided on all three difficulties in roughly 9–11 minutes.
- **Speed dial** runs the sim from 0.25× to 8× on a fixed 1/60s timestep, so
  the physics are identical at every speed.

Single file each: `index.html`, `style.css`, `game.js` (no modules, no build).

### Regolith Farm — in development

## Copyright

These are tributes to a genre, not ports or reskins. No code, artwork, audio or
data files from any commercial game are used, included or distributed here.
Game *mechanics* are ideas, and ideas are free to build on; the specific
expression of the classics belongs to the people who made them.

MIT licensed.
