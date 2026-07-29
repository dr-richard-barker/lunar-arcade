# Roadmap

A retrospective and a plan for Lunar Arcade. Written after the first build push, when the repo had
reached three playable games and roughly 8,000 lines with no plan document, no tests and no CI.

Everything numeric below was measured in this repo. Where a claim comes from a file, the path is
given so it can be checked rather than trusted.

---

## 1. What exists

| Area | Files | Lines |
|---|---:|---:|
| Hub root (`index.html`, `README.md`, `LICENSE`, `.nojekyll`) | 4 | 278 |
| `assets/hub.css` | 1 | 142 |
| `mission-control/` | 2 | 619 |
| `games/boring-mining/` | 3 | 2,853 |
| `games/lunar-habitat/` | 11 | 4,816 |
| **Total** | **21** | **7,939** |

### The Boring Mining Game

A drone-swarm ISRU mining game on a 176×104 tile map. The design rests on four scalar fields relaxed
over the grid: ore scent that propagates *through* rock, a per-colony pheromone trail laid by loaded
drones, an alarm field, and a BFS home-distance field through actual tunnels. Miners bore toward
what they can smell; productive seams become highways because drones keep reinforcing the trail home.

One 2,300-line file, no modules, no build. The loop is a `requestAnimationFrame` wrapper around a
fixed 1/60 s accumulator, so the 0.25×–8× speed dial rescales the simulation rather than the frame
rate. It has an unprivileged autoplay agent, three difficulties, real win/lose conditions, a league
table, a six-tier surface plant that grows as tonnage is delivered, fully synthesised WebAudio (zero
audio files), rebindable keys and pointer/touch play.

This is the most finished thing in the repo — a repo-wide search for `TODO|FIXME|XXX|HACK` returns
one benign display sentinel.

### Lunar Habitat

A vertical colony builder: dig 24 levels down, build 26 up, with excavation cost scaling with depth
and radiation shielding improving as you go deeper. Nine JS modules with clean separation:

| File | Lines | Responsibility |
|---|---:|---|
| `js/config.js` | 267 | Tuning constants, radiation curve, the 34-module catalogue, the 6 charter tiers. Pure data. |
| `js/grid.js` | 304 | World state, placement legality and cost, the Dijkstra transit solver from airlocks, amenity coverage, shielding. |
| `js/sim.js` | 403 | The one-day tick: power and load shedding, staffing, life support, the ore/He-3 economy, morale, population, events, tier promotion. |
| `js/render.js` | 1,311 | Procedural canvas renderer — parallax sky and regolith, plus bespoke animated interior art for every module id. |
| `js/autopilot.js` | 759 | A colony director AI: reserved shaft-column planning, a strict priority ladder, tower and room-clearing strategies. |
| `js/ui.js` | 308 | Build palette, readouts, side panel, toasts. |
| `js/report.js` | 250 | Mission Control modal: sparklines, a letter-grade assessment, census. |
| `js/league.js` | 348 | End-of-run scoring, outcome multipliers, the persistent league table. |
| `js/main.js` | 323 | Bootstrap, input, the day accumulator, save/load. |

Measured behaviour:

- A well-built colony sustains **morale 73 with health 100**. The identical layout capped at **44**
  before the economy rebalance.
- That colony runs **+₵6,564/day at population 228** — roughly a fortnight of saving to fund a
  charter tier.
- The autopilot brought average commute from **24 → 7** steps and worst-case **58 → 16**, and flare
  deaths from **48 → 0**. Peak population **~192**, still short of tier 4's 220.

### Lunar Farm

Deliberately not built here. Commit `24c730e` retired a Regolith Farm placeholder — a card, a
Mission Control panel and a README heading with no code behind them — and pointed at the finished
game in the LunarSims repo instead of building the same game twice. The regolith-into-soil premise
survives there as bed conditioning.

---

## 2. The plan that would have brought us here

The work above was done without a plan. This is the same work re-ordered as it should have been
sequenced. The ordering is the whole lesson.

1. **Settle the legal footing on day one.** The source material was retail Maxis binaries running
   under DOSBox. Decide clean-room genre tribute, state it publicly, and ship nothing — no code,
   art, audio or data — from the originals. This we did get right, and it shaped the repo.

2. **Design the endgame before the midgame.** Decide what the final tiers actually *give* the
   player. Skipping this is the single most expensive mistake in the log: most of the effort went
   into making an AI reach charter tier 6 while tier 6 unlocks nothing at all.

3. **Build the sim core, then immediately prove the win condition is reachable.** Before any AI, art
   or UI: script an ideal colony, tick it, and assert the final tier's requirements can be met. When
   we finally did this it took minutes and showed morale had a hard ceiling of 44 against a
   requirement of 70 — amenity coverage measured 4 out of a possible 26, and crew health regenerated
   at +1.6/day against −6 per crisis and −20 per solar flare.

4. **Build a headless balance harness before tuning anything.** Fixed seed, N-day run, assertions on
   survival, population, morale and the ledger. Every productive change in the balance work came
   from a measurement; every wasted one came from a guess, and without a harness the early game was
   repeatedly regressed and re-fixed.

5. **Then art and UI.** Low-risk, went smoothly, needed no rework.

6. **Then the director AI.** It is an excellent balance test-rig and it surfaced genuine simulation
   bugs, but it is a poor *first* feature: its own layout heuristics become the rabbit hole, and it
   is easy to spend days improving an AI when the game itself is the thing that is broken.

7. **Then scoring and the league**, which presuppose a game that can actually be won.

8. **Cut scope deliberately, and say so in the commit.** Retiring Regolith Farm was the cheapest
   good decision here: one card, one commit, no duplicate game.

---

## 3. Invariants

Bug classes found the hard way. Each cost real time; each is worth checking any future change
against.

- **Never size a decision from a post-mitigation measurement.** `st.powerUse` is measured *after*
  load shedding, so in the middle of the brownout you need to fix, it reads low and the controller
  concludes all is well.
- **Storage and generation are not interchangeable.** Solar has to cover roughly `2 × (demand −
  steady)` to bank the fourteen-day night, not merely show a positive daytime margin. Sizing to a
  bare margin leaves fifty people with three arrays and a flat battery.
- **Recovery must outpace damage.** Health regenerating slower than misfortune drains it turns every
  setback into a permanent penalty and every wobble into a death spiral.
- **Two subsystems that can undo each other will loop forever.** The charter built a school, the
  insolvency rescue sold it, repeat — at 65% loss per lap.
- **Removing a module can strand its neighbours.** Selling one out of the middle of a level severs
  the corridor run and orphans everything past it, which the orphan sweep then demolishes.
- **Placement legality is not connectivity.** `checkPlace` permits level-0 placement anywhere, so a
  perfectly legal build can be an island.
- **A failed action must not abort a priority chain.** A helper that returned false on failure killed
  every lower priority, so one unaffordable mess hall froze the entire director.
- **Reach must scale with the world.** An amenity radius of 13, with vertical distance weighted ×3,
  covered four levels of a colony that grows to twenty-four.
- **Compute inputs before consumers, within a tick.** See the ordering bug in Phase 2 below.
- **If a description says "in range", the code must check range.** Several module descriptions
  promise behaviour the simulation implements globally, or not at all.

---

## 4. Forward roadmap

Priority: **finish Lunar Habitat**. Depth over breadth — the trilogy is already complete.

### Phase 1 — Make the ceiling provable

`tools/harness.html`: a headless scenario runner reusing `LH.newState`, `LH.place`, `LH.tick` and
`LH.scoreRun` directly, with no new simulation code. Three scenarios as assertions:

- an ideal colony meets the tier-6 requirements
- a starter colony survives 400 days
- the autopilot survives 3,000 days solvent

This is the tool whose absence caused the repeated regressions. It comes first.

### Phase 2 — Correctness debt

Cheap, and some of it quietly distorted the balance work.

- **Amenity ordering bug.** `LH.solveAmenity` runs at the *end* of `LH.tick` (`js/sim.js:288`) while
  `LH.amenityAt` is consumed earlier in the same tick (`js/sim.js:159`). Morale is therefore always
  computed against the previous day's amenity list, and on the first tick `s.amenList` is undefined
  so coverage reads zero.
- **Save/load integrity.** `s.history`, `s.rseed`, `s.brownDays`, `s.zeroDays`, `s.stats` and
  `s.alerts` are not persisted (`js/main.js:222-239`). Consequences: sparklines reset on reload;
  `assess()` reads an empty history and so unconditionally awards "+15, population trending up" even
  for a colony in freefall (`js/report.js:73-78`); reloading resets the three-day unpowered death
  clock and the twelve-day collapse countdown; and because `rseed` restarts at a hardcoded `12345`,
  reloading replays an identical solar-flare sequence — a working save-scum exploit.
- **A finished run reloads as an un-endable zombie.** `ended` is saved and `checkEnd` early-returns
  on it (`js/league.js:116`), so a bankrupt or collapsed save resumes at 1× with no end screen and
  no scoring.
- **Autosave announces itself every 90 seconds, forever** (`js/main.js:235`, `:318`).
- **`s.tierJustUp` is set and never read** (`js/sim.js:399`). A charter promotion — the game's main
  reward moment — produces only a line in the log. Wiring this up is the cheapest available win.

### Phase 3 — Close the autopilot capacity gap (~190 → 220+)

The spine, morale and shielding problems are fixed; what remains is capacity and late-game
stability. Diagnose with the Phase 1 harness rather than by eye: why housing stalls near 190, and
what destabilises the colony after roughly 4,000 days. Also worth fixing: the director only builds a
He-3 extractor when nearly broke (`js/autopilot.js:599`), so a healthy colony never touches the most
profitable export in the game.

### Phase 4 — Give the endgame a reason to exist

The real prize, and larger than it first appears.

- **Tier 6 unlocks nothing**, and tiers 4 and 5 unlock three modules between them (Lunar Suite,
  Garden Dome, Deep Core Complex). Roughly 74% of the 34-module catalogue is available by tier 2.
  Decide what Colony → City → Lunar Capital actually gives the player, then build it. All three
  late modules already have bespoke art written for them that no player has ever seen.
- **The vertical axis is nearly empty.** Only four module ids can be placed above the surface —
  shield cap, comms array, observatory, garden dome — one of which is redundant and one tier-4,
  against `MAX_UP: 26` levels of build space. Half the stated premise, "tower upward or excavate
  downward", has almost nothing in it.
- **The tourist economy is fully wired but mathematically inert until tier 3.** Occupancy scales with
  a `draw` term that needs to reach 12; the only sources are the Rec Dome (3, tier 3), Observatory
  (6, tier 3) and Garden Dome (8, tier 4). Transit Quarters unlocks at tier 2 and earns exactly
  nothing while costing 90/day and three jobs — a trap for the player. Its declared `income: 60` is
  dead code, shadowed by the `m.tour` branch (`js/sim.js:239-256`).

### Phase 5 — Polish and consolidate

A charter-completion screen, sound, touch and tablet controls, onboarding beyond the opening modal.
**Port rather than reinvent**: the mining game already solved runtime WebAudio synthesis with no
asset files, pointer/touch play, and fully rebindable keys.

Then clear the known duplication — `row()` is defined identically in `js/ui.js:158` and
`js/report.js:106`, the charter checklist is built three times, and a ~40-line reverse-lookup is
duplicated inside `js/autopilot.js` — and delete the dead state: `s.dirty`, `s.logDirty`,
`s.distMap`, `s.ticks`, `s.stats.connected`, `s.finalScore`, `inst.occ`, `inst.staff`, `ui.pan`,
`LH.isNight`.

The trilogy is complete; resist a fourth game. Both local games independently implement a day/night
cycle, an autoplay agent, a speed dial, localStorage saves and a league table — factor those into a
shared kit only if a third local game is genuinely wanted. Until then the duplication is cheaper
than the abstraction.

---

## 5. Known mismatches between description and behaviour

Worth either implementing or rewording, because the module descriptions are what the player plans
against:

- **Security Post** says it cuts damage from breaches *and quakes*, but `guard` is only read in the
  micrometeorite branch (`js/sim.js:350`) and never for moonquakes (`js/sim.js:354-361`).
- **Medical Bay** says casualties are far worse without one *in range*, but medical cover is
  evaluated colony-wide (`js/sim.js:231`, `:321`); its radius is used only for morale.
- **Regolith Shield Cap** costs ₵1,600, but `LH.shielded` (`js/grid.js:289`) only asks whether
  something occupies the cells overhead — a ₵400 corridor shields a habitat exactly as well.
