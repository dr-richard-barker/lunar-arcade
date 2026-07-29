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

The following four came out of the mining game rather than the colony, and are about agents and
physics rather than economies. They generalise.

- **A diffusing signal that evaporates cannot serve as a global recall.** Alarm pheromone decayed to
  nothing long before it crossed the map, so guards on the far side of the claim never learned the
  fabricator was being drilled. A colony under attack needs an explicit colony-level order; a field
  gradient is a *local* signal and can only ever be one.
- **A collider that resolves axes separately cannot traverse a diagonal-only gap.** Drones bored
  diagonally, which produced staircases with no orthogonal opening, and then wedged in them —
  permanently, while still reporting a live non-idle state. Agents that dig must dig orthogonally.
  Note that a unit test on the collider would have *passed*: the collider was correct and world
  generation produced a shape it could not traverse. The bug lived between two correct components,
  which is exactly what unit tests cannot see.
- **A state must not be enterable when its exit condition cannot fire.** The autoplay agent fled home
  to repair, but repair only ever happened as a side effect of unloading cargo — so an agent that
  arrived empty sat there forever. Every state needs an exit that does not depend on an unrelated
  event.
- **Never divide by a layout measurement.** Screen-to-world conversion divided by the canvas's
  bounding rect, which is zero in a hidden tab or a collapsed container. The scale factor becomes
  Infinity, NaN reaches the entity's velocity, and the run is unrecoverable from that frame on.

---

## 4. Forward roadmap

Priority: **finish Lunar Habitat**. Depth over breadth — the trilogy is already complete.

### Phase 1 — Make the ceiling provable ✅ done

[`tools/harness.html`](tools/harness.html) — a headless scenario runner reusing `LH.newState`,
`LH.place`, `LH.tick` and `LH.scoreRun` with no new simulation code. It loads config/grid/sim/
autopilot/league only, so there is no canvas, no autosave and **no localStorage write** (verified with
a sentinel: a harness run cannot touch a saved colony or the league). The event RNG is seeded, so runs
are repeatable — verified identical across runs, and divergent under a different seed.

Three scenarios, all passing:

| Scenario | Result |
|---|---|
| Final charter is reachable | **Lunar Capital in 8 days** — pop 1,008, morale 89.6, health 100, nothing shed |
| Starter colony survives 400 days | Survives on a ₵189,538 opening, ends solvent at ₵77,814 |
| Autopilot survives 3,000 days | Survives; 6 shafts, avg commute 6.9, morale 72.6, zero deaths |

Expectations are read from `LH.C`, `LH.MOD` and `LH.TIERS`, so a config change reshapes the tests
rather than silently invalidating them. Checks can be marked *known debt* — reported truthfully but
not failing the suite — so the harness never goes permanently red and gets ignored.

**What it found within an hour of existing:**

- A **performance pathology in the autopilot**: `reservedFree()` rescanned every instance for every
  candidate column, on the order of 10⁸ operations a day in a mature colony. Now cached per step —
  a 3,000-day run went from over two minutes to about six seconds, and the real game no longer
  risks stalling at 8× speed.
- Two of its own bugs, which is the point: a `Report` field named `note` shadowed the `note()` method
  and threw inside a `setTimeout`, so the page hung on "running…" forever with no error. Both fixed;
  scenario failures now surface instead of hanging.
- Two known-debt items in the director, tracked for Phase 3: **7 distress sales** and **15 orphan
  demolitions** across 3,000 days.

Run it: open `tools/harness.html`, or append `?run` to run on load. Results also land on
`window.HARNESS_RESULT` for automation.

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

The harness reports the blockers directly: *Population 192 / 220; Rec Dome; Refinery*. The spine,
morale and shielding problems are fixed; what remains is capacity and late-game
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

That verdict holds up under examination. The two league implementations are not the same thing in
different clothes: mining rows are thirteen scalars scored by a three-line formula with a difficulty
multiplier, habitat rows carry a thirteen-factor itemised breakdown with a penalty floor and outcome
multipliers. The two autopilots share no surface at all — a priority ladder over a building grid
versus a steering controller for a physics body. The genuine intersection across both games is about
fifteen lines of "read a JSON array, push, sort, slice, write". Both leagues were also added in the
*same* commit and have never been co-edited since, so the cost of the duplication has so far been
realised exactly zero times, while consolidating would create a single failure mode across both
games on a live site with no CI. The CSS is the one exception and it is worth doing: the palettes are
already the same colours under different names (`--amber:#ffc857` against `--accent:#ffc861`, `--fg`
against `--ink`, `--muted` against `--dim`), so unifying the tokens is mechanical and any mistake is
visible at a glance.

### Second track — the mining game

The phases above are all Lunar Habitat, which is right: it is the game with an unfinished endgame.
The mining game needs almost nothing by comparison, but it does need one thing, and it is the same
thing Phase 1 is.

Every bug ever found in it was found by running the simulation headlessly at speed and watching for
things that stopped moving — the four agent-and-physics invariants in §3 above are all soak findings.
That technique currently exists only as something done by hand, once. It should be a file:
`tools/soak-mining.html`, loading the game with tripwires armed and running the autoplay agent to
completion across all three difficulties, asserting no NaN anywhere, no living agent motionless while
in a non-idle state, no AI state older than a threshold, and termination inside a step budget.

Reproducibility is the prerequisite, not a feature. World generation is already deterministic, but
about six simulation-relevant `Math.random()` sites remain — drone and crawler wobble, crawler
placement, and the two stuck-breaker directions — so a soak failure reports "failed on run 7" with no
way to replay run 7. A seeded generator on those sites, with cosmetic randomness (audio, particles)
deliberately left on `Math.random()` so visual noise never consumes simulation entropy, closes it in
an afternoon.

Habitat needs no equivalent: `config.js`, `grid.js` and `sim.js` contain zero DOM references and zero
`Math.random()` calls, so that simulation is already both headless-runnable and deterministic. The
work there is to *verify* it — double-run the harness and diff — which then becomes a free
regression test.

### Mission Control

`mission-control/` is a top-level entry point from the hub and is not covered above. It reads exactly
one localStorage key, `bmg_league`, and everything else on the page — readiness bars, the downlink
log, the site telemetry tables — is hand-written. The footer says so; the top of the page, with its
live pulse and ground clock, implies otherwise.

The theatre is the best thing about that page and should survive. The fix is provenance, not
subtraction:

- **Wire habitat's league in for real.** Same origin, same three lines already used for the mining
  read, against `lunarhabitat.league.v1`. This closes the biggest gap on the page — the larger of the
  two games currently contributes nothing to it.
- **Badge blocks `LIVE` or `SPEC`.** "Ore grade 4.9%" is a measured design constant, not telemetry.
  Labelling it converts an honesty problem into a design feature at near-zero cost.
- **Say that the farm cannot report.** It is served from a different origin, so its localStorage is
  unreachable by construction — no amount of work short of a backend changes that, and a hidden-iframe
  bridge is not worth building. Badge it `OFF-SITE`, on the hub card too, which currently marks it
  identically to the two local games while linking away from the site.
- **Derive the sites-operational tile** from what actually reports rather than a hardcoded count.

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
