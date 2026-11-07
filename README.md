# Lunar Arcade

Original browser games in the spirit of the classic 1990s Maxis simulation games,
plus a turn-based artillery game, rebuilt from scratch with a lunar-settlement
theme. Everything is vanilla JavaScript — no build step, no dependencies, no
assets to download. Open `index.html` or serve the folder and play
(`python3 tools/serve.py` serves the repository at http://127.0.0.1:8433/).

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

### Balance harness

`tools/harness.html` runs the real simulation headlessly and asserts on the outcome — three
scenarios covering whether the final charter tier is reachable at all, whether a competent opening
survives 400 days, and whether the autopilot survives 3,000 days unattended. It loads only
config/grid/sim/autopilot/league, so it writes nothing to localStorage and cannot disturb a saved
colony. Open it and press *Run all scenarios*, or append `?run` to the URL.

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
and the league table), `js/save.js` (pure serialize/deserialize plus localStorage
wrappers), `js/ui.js` (DOM chrome), `js/main.js` (input + main loop).

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

### Regolith Rovers (`games/regolith-rovers/`) — playable

Turn-based artillery for teams of Space Robot Dogs on a moon base, built around
one idea: gravity is a control. Teams take turns to walk, jump and fire across
destructible ground; the base's (fictional) gravity plating lets the team on turn
change how hard gravity pulls and which way.

- **Three gravities, real numbers.** The top-right button cycles Moon 1.62 and
  Mars 3.73 m/s² (NASA NSSDCA fact sheets) and Earth 9.81 m/s² (standard
  gravity, 9.80665). The arena is airless on every setting, so every shot is an
  exact parabola: the same launch goes about six times farther on the Moon.
- **A gravity compass.** Drag the needle (15° steps, `[` `]`, `V` for straight
  down) to point gravity anywhere. Turn it a quarter turn and a shot that would
  land 40 m down-range lands 40 m up a wall.
- **Mag-paws.** Standing dogs grip floor, wall or ceiling and ignore gravity
  changes; anything airborne — shots, debris, jumping or blasted dogs — obeys
  the current setting. Falls hurt by impact speed, so the same 5 m drop is
  harmless on the Moon and painful on Earth.
- **Two arena types,** freshly generated each match: an open-sky surface base
  (lander, habitat dome, solar arrays, a CoSE greenhouse module) where gravity
  pointed skyward sends anything airborne into space, and an enclosed lava tube
  under skylights inside an indestructible bedrock frame.
- **Eight original tools:** Bone Rocket, Fetch Ball (bouncing, 1–5 s fuse),
  Sample Scatter, Supply Drop (pods fall along the *current* gravity), Laser
  Pointer (straight beam, ignores gravity), Thruster Pack (thrust-to-weight
  3.7 on the Moon, 0.61 on Earth — it cannot lift off there), Regolith Printer
  and Drill Paw.
- **2–4 teams on one device,** each human or CPU (Cadet, Specialist,
  Commander). The CPU searches hundreds of shots through the same physics step
  the game uses, and sets the planet and compass itself before it fires.
- **◈ AUTO AI** (`F`) hands the team on turn to the computer; **∞ AMMO** (`U`)
  makes every kit bottomless. Both sit top right beside the gravity controls and
  are badged on the mission report.
- **Training aid** draws the first part of each shot's arc and shows launch
  speed in m/s; `?training=1` in the link turns it on. A field manual gives the
  formulas, worked numbers and sources.

Tests: `node tools/test-regolith-rovers.mjs` checks flat-ground range and flight
time against v²·sin2θ/g and 2v·sinθ/g on all three worlds, rotated gravity,
mag-paws, falls, the thrust-to-weight cut-off, blasts, the arena generator, both
toggles and the Commander CPU's hit rate.

Code layout: `js/physics.js` (fixed-step physics, DOM-free), `js/terrain.js`
(seeded arena generator), `js/weapons.js`, `js/ai.js` (CPU shot search),
`js/game.js` (match engine, DOM-free), `js/render.js`, `js/audio.js`
(synthesised suit-radio sounds), `js/ui.js`, `js/main.js`.

### Lunar Farm — lives in its own repository

The farm sim folded into **[Lunar Sims](https://dr-richard-barker.github.io/LunarSims/farm/)**
([source](https://github.com/dr-richard-barker/LunarSims)) rather than being built twice. Same
premise — light against power, water against recycling losses, crop choice against a colony that
has to be fed — carried out at the Marius Hills skylight, with the regolith-into-soil idea kept
as a mechanic: fresh beds run at about two-thirds yield until roots and stubble have been worked
through them.

## Copyright

These are tributes to a genre, not ports or reskins. No code, artwork, audio or
data files from any commercial game are used, included or distributed here.
Game *mechanics* are ideas, and ideas are free to build on; the specific
expression of the classics belongs to the people who made them.

MIT licensed.
