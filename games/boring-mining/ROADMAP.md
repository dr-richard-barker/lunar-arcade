# The Boring Mining Game — plan

Scope: **this game only**. Nothing here concerns Lunar Habitat, Lunar Farm or the arcade hub; the
programme-level plan lives in [`../../ROADMAP.md`](../../ROADMAP.md) and the two do not overlap.

Every number below was measured with `../../tools/soak-mining.html`, which runs the autoplay agent to
completion with the tripwires armed. Anything not measured is marked as an estimate.

---

## 1. Where the game is

A lunar ISRU drone-swarm sim on a 176×104 tile claim. You pilot DRONE-01; the rest of the swarm is
autonomous and navigates on four scalar fields — ore scent that propagates *through* rock, a haul
trail that loaded drones reinforce, an alarm field, and a BFS home-distance field through the tunnels
actually dug. One 2,300-line file, no modules, no build step.

Complete and working: three difficulties, real win/lose, autoplay agent, 0.25×–8× speed on a fixed
1/60 s timestep, five runtime-synthesised audio packs plus an adaptive score, a growing six-tier
surface plant that launches cargo to Earth, a persistent league table, minimap panning, pointer and
touch play, and 19 rebindable actions.

**Verified, not asserted.** The soak harness runs all three contracts and checks: nothing non-finite,
no agent motionless-and-not-drilling, no transient AI state outliving its threshold, every run
terminates, and every run files a league row. Runs are seeded, so any result replays exactly — the
same seed produces hash-identical state across 2,000 steps, and the seed is stamped on the league row.

### Measured difficulty curve

Agent-driven, three seeds each (101 / 202 / 303), fabricator integrity remaining at the end:

| Contract | Hub left | Wins | Stalemates | Length |
|---|---|---:|---:|---|
| Survey Run | 95 / 93 / 94% | 3/3 | 0 | ~10 min |
| Claim Dispute | 76 / 75 / 79% | 3/3 | 0 | ~10 min |
| Hostile Takeover | 69 / 59 / 56% | 3/3 | 0 | ~10 min |

Three seeds is a thin sample — treat the ordering as established and the exact percentages as
indicative.

---

## 2. Invariants

Bug classes this game has actually produced. Check any change against them.

- **A collider that resolves axes separately cannot cross a diagonal-only gap.** Drones that dig must
  dig orthogonally or they wall themselves in. A unit test on the collider would have passed — the
  collider was right and world-gen made a shape it could not traverse.
- **A diffusing signal that evaporates cannot serve as a global recall.** Alarm pheromone died long
  before crossing the map; a colony under attack needs an explicit order, not a gradient.
- **A state must not be enterable when its exit cannot fire.** Twice now: the agent fled home to
  repair when repair only happened on unloading cargo, and later gated its assault on hub integrity
  above 55% — a quantity that never regenerates, so once chipped the agent turtled forever and the
  contract could not end at all.
- **Never gate behaviour on a monotonically falling quantity.** The general form of the above.
- **Measure progress, not effort.** The stuck-breaker tested *speed*, so a drone orbiting a local
  minimum of the scent field kept full velocity and got nowhere for an entire contract. Displacement
  is the only signal that separates working from busy.
- **An escape hatch must be available to whoever needs it.** The stuck-breaker picked an escape
  heading for patrolling guards, who were not permitted to bore and so could not act on it.
- **Never divide by a layout measurement.** A zero-size canvas rect makes the scale factor Infinity
  and NaN reaches the simulation.
- **Reset every module-level variable the simulation touches.** `scentDir` and `auto.wob` leaked
  across contracts, so the same seed produced different games.
- **Cosmetic randomness must not draw from the seeded stream.** Particle spawns gated by unseeded
  chance were consuming simulation entropy and desynchronising replays.

---

## 3. What to do next

Ordered by value per hour. Everything in Phase A is small, independent and player-visible.

### Phase A — the first five minutes (~5 h total)

The game teaches you almost nothing. Its central verb — beacons — is on `Q` and `E` and a new player
will never find it, which means they play a worse game than the one that exists.

- **Contextual tutorial through the existing log ticker** (~2 h). No new UI: fire one-off hints off
  events that already exist — first tile bored, first full hold, first unload, first raid, first time
  ore is banked. Five lines, each triggered once, dismissible. The ticker, the log styling and the
  event hooks are all already there.
- **Show and share the seed** (~1 h). Determinism already landed; surface it. Print the seed on the
  title screen and the end-of-run banner, accept `?seed=`, and add a "copy challenge link" button.
  Turns the league table into something two people can compare fairly.
- **A visible objective readout** (~1 h). The win condition — breach the Helios fabricator — is stated
  once on the title screen and never again. Put it in the HUD as a live objective line.
- **Name the difficulty consequences** (~1 h). The picker describes flavour, not stakes. Now that the
  tiers genuinely differ, say what changes: raid frequency, raid size, and how much less fabricator
  you start with.

### Phase B — make a contract survivable across sessions (~4 h)

A run is ten minutes and cannot be paused across a browser close. Snapshot the map, the four fields,
the drones and the colonies to localStorage under a versioned key; restore on load with a "resume
contract" button. The fields are typed arrays, so this is mechanical. Keep the league key untouched.

### Phase C — lock the balance in (~2 h)

Now that the curve is measured, stop it regressing silently. Extend the soak to assert a *band* per
difficulty — win rate, damage taken, run length — over a fixed seed set, and fail if a tier drifts
out of its envelope or the ordering inverts. This is cheap because the harness already runs the runs;
it only needs the assertions. Do this before any further tuning.

### Phase D — depth (estimates, unmeasured)

- **Crawlers are nearly decorative.** They exist, they occasionally eat a drone, and no player
  strategy changes because of them. Either give them a behaviour worth planning around — nesting,
  hunting the trail, blocking a seam — or cut them.
- **One loss condition only.** Losing means the fabricator dies. A quota contract ("ship 200 t before
  the third night") would make the clock matter and give the day/night cycle teeth it currently lacks.
- **The agent has never lost.** Across every run this session it is 100% on all three tiers. That is
  fine for a demo but means there is headroom above Hostile Takeover for a fourth tier, and the soak
  can now tell you exactly where it starts losing.

---

## 4. Not doing

- **No shared library with the other games.** Their league rows, autopilots and save formats have
  almost nothing in common with this one; the real intersection is about fifteen lines, and sharing
  would put both games behind one failure mode. See the programme roadmap for the full argument.
- **No build step, bundler, package.json or TypeScript.** This file opens in a browser and will keep
  opening in a browser.
- **No ES modules.** They would break `file://` and, more importantly, remove the console access to
  top-level state that has found every bug in this game — including via the soak harness, which
  works precisely because `game.js` is a classic script.
- **No localStorage key renames.** The league table is the only durable thing a player owns.
- **No fourth game.** Depth here, not breadth.
