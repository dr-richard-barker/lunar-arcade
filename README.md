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

- **Autopilot** (`◈ AUTO` / `B`): a colony-director AI that plays the game
  itself — it sites the airlock, sinks shafts, balances power against the lunar
  night, reacts to real life-support balances, opens satellite airlocks when
  commutes grow, and sells the gym when the books go red. Play-tested to
  200+ population over 1,500 days unattended.
- **Mission Control dashboard** (`📡 REPORT` / `R`): an uplink-styled status
  report with growth sparklines, a board assessment grade, and the full colony
  census.
- **Sandbox mode** (`⚒ SANDBOX` / `S`): all modules free, all tiers unlocked.
- **League table** (`🏆 LEAGUE` / `L`): every finished run is scored and filed
  permanently. A run ends when the charter reaches Lunar Capital, when the
  colony is abandoned (population zero for twelve days) or the programme is
  cancelled (deep bankruptcy) — or when you file a final report by choice from
  the Mission Control screen. The score is fully itemised: peak and final
  population, charter tier, morale, treasury, lifetime exports, excavation
  depth, tower height, colony scale and days survived, minus fatalities,
  life-support failures and stranded modules, all times an outcome multiplier
  (×1.5 for Lunar Capital, ×0.4 for a collapse). Runs are badged MANUAL, AUTO
  or SANDBOX; sandbox runs are filed unranked.

### Balance notes

The colony economy was retuned in July 2026 after instrumenting a mature
colony and finding morale — not money — was the real ceiling. Amenities now
reach roughly half again as far and a level counts double rather than triple
toward that distance, so a deep colony can actually be covered; commuting is
tolerated to 24 steps before morale suffers and transit shafts cost a third
less, so a dense spine is affordable; and crew health recovers fast enough
that one bad month is a setback rather than a death sentence. A well-built
colony now sustains **morale in the low 70s** — clearing the Lunar Capital
charter — against a hard ceiling of about 44 before.

Saves live in the browser's localStorage (autosave every 90 seconds).

Code layout: `js/config.js` (all tuning constants and the module catalogue),
`js/grid.js` (world state, placement rules, Dijkstra transit solver),
`js/sim.js` (the daily tick), `js/render.js` (procedural canvas renderer with
per-module animated interiors), `js/autopilot.js` (the colony director),
`js/report.js` (Mission Control dashboard), `js/league.js` (end-of-run scoring
and the league table), `js/ui.js` (DOM chrome),
`js/main.js` (input + main loop).

### The Boring Mining Game (`games/boring-mining/`) — playable

A lunar ISRU drone-swarm sim on a contested ore claim. You pilot
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
- **The surface plant grows with what it receives.** Cumulative delivered
  tonnage moves the plant through six build tiers — solar arrays, a high-gain
  dish, volatile tanks, radiator fins, a habitat dome — and once the pad is up
  it periodically launches a cargo stack to Earth orbit. A third of every ore
  delivery is set aside for that contract; shipped tonnage is your score.

Single file each: `index.html`, `style.css`, `game.js` (no modules, no build).

### Regolith Farm — in development

## Copyright

These are tributes to a genre, not ports or reskins. No code, artwork, audio or
data files from any commercial game are used, included or distributed here.
Game *mechanics* are ideas, and ideas are free to build on; the specific
expression of the classics belongs to the people who made them.

MIT licensed.
