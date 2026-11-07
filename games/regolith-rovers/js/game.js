/* ==========================================================================
   REGOLITH ROVERS — match engine (DOM-free)
   Turns, weapons, damage, gravity controls, the Auto AI and ∞ Ammo
   toggles. The page feeds it held inputs and one-shot commands and reads
   back state and an event queue; the node tests drive it the same way.
   ========================================================================== */
'use strict';
var RR = globalThis.RR || (globalThis.RR = {});

(function () {
  const P = RR.physics, PPM = P.PPM;
  const RETREAT = 3;

  const TEAM_NAMES = ['Artemis Pack', 'Shackleton Squad', 'Tranquility Terriers', 'Marius Mutts'];
  const TEAM_COLORS = ['#ffb347', '#54C9BA', '#ff6b6b', '#a993ff'];
  const DOG_NAMES = ['Rover', 'Sputnik', 'Bolt', 'Comet', 'Pixel', 'Gizmo', 'Nova', 'Orbit',
    'Rivet', 'Sprocket', 'Quark', 'Echo', 'Vector', 'Zippy', 'Tycho', 'Kepler', 'Biscuit',
    'Widget', 'Patch', 'Ziggy', 'Boson', 'Servo', 'Dipper', 'Crater', 'Regolith', 'Lander'];

  function createGame(cfg) {
    const gen = RR.terrain.generate({ arena: cfg.arena, seed: cfg.seed, W: cfg.W, H: cfg.H });
    const G = {
      cfg,
      world: gen.world, info: gen.info, rng: gen.rng,
      planet: cfg.planet != null ? cfg.planet : 0,
      gdir: cfg.gdir != null ? cfg.gdir : 180,
      teams: [], dogs: [], projectiles: [], events: [],
      phase: 'start', turn: 0, teamIdx: -1, active: null,
      timer: 0, retreat: 0, settleT: 0, time: 0,
      turnTime: cfg.turnTime ? cfg.turnTime : Infinity,
      aim: { angle: 35, power: 0, charging: false, weapon: 'bone', fuse: 3, target: null, lastPower: 0.5 },
      input: { left: false, right: false, up: false, down: false, fire: false },
      prevFire: false, walkKey: 0, walkSign: 1,
      thrusting: false, thrustOn: false, thrustFuel: 0, thrustVec: null, toldHeavy: false,
      drilling: 0, drillDir: null,
      infiniteAmmo: !!cfg.infiniteAmmo, usedInfinite: !!cfg.infiniteAmmo,
      ai: null, aiBudget: cfg.aiBudget || 20,
      lastShot: null, mainShot: null, winner: null, over: false,
      stats: { shots: 0, longest: null, lostToSpace: 0 },
    };

    /* ------------------------------------------------------------ teams */
    const nTeams = Math.max(2, Math.min(4, cfg.teams.length));
    const perTeam = Math.max(1, Math.min(4, cfg.dogsPerTeam || 3));
    const names = DOG_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(G.rng() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
    for (let t = 0; t < nTeams; t++) {
      const tc = cfg.teams[t];
      const ammo = {};
      for (const w of RR.WEAPONS) ammo[w.id] = w.ammo;
      G.teams.push({ idx: t, name: tc.name || TEAM_NAMES[t], color: tc.color || TEAM_COLORS[t],
        ctrl: tc.ctrl || 'human', auto: false, usedAuto: false, dogs: [], next: 0, ammo,
        shots: 0, dealt: 0, lastWeapon: 'bone' });
    }
    const spawns = RR.terrain.findSpawns(G.world, G.info, nTeams * perTeam, G.rng);
    for (let i = spawns.length - 1; i > 0; i--) { const j = Math.floor(G.rng() * (i + 1)); [spawns[i], spawns[j]] = [spawns[j], spawns[i]]; }
    let k = 0;
    for (let i = 0; i < perTeam; i++) {
      for (const team of G.teams) {
        const s = spawns[k++];
        if (!s) break;
        const d = P.makeDog(s.x, s.y);
        d.grounded = true; d.nx = s.nx; d.ny = s.ny;
        d.fs = s.x < G.world.W / 2 ? 1 : -1;
        d.team = team.idx; d.name = names[(team.idx * perTeam + i) % names.length];
        d.id = G.dogs.length;
        team.dogs.push(d); G.dogs.push(d);
      }
    }

    /* ---------------------------------------------------------- helpers */
    const emit = e => { G.events.push(e); };
    G.g = () => P.gravityVec(G.planet, G.gdir);
    G.team = () => G.teams[G.teamIdx];
    G.isAI = () => { const t = G.team(); return !!t && (t.ctrl !== 'human' || t.auto); };
    G.humanTurn = () => G.phase === 'aim' && !G.isAI();
    G.canSetGravity = () => G.humanTurn();
    G.teamAlive = t => t.dogs.some(d => d.alive);
    G.ammoOf = (t, wid) => G.infiniteAmmo ? Infinity : t.ammo[wid];
    G.drain = () => { const e = G.events; G.events = []; return e; };

    function useAmmo(team, wid) {
      if (G.infiniteAmmo || team.ammo[wid] === Infinity) return true;
      if (team.ammo[wid] > 0) { team.ammo[wid]--; return true; }
      return false;
    }

    function hurt(d, amount, cause) {
      if (!d.alive || amount <= 0) return;
      d.hp = Math.max(0, d.hp - amount);
      emit({ type: 'damage', dog: d, amount, cause });
      if (d === G.active && G.phase === 'aim') endAim('hurt');
    }

    function lose(d) {
      if (!d.alive) return;
      d.alive = false; d.hp = 0; d.lost = true;
      G.stats.lostToSpace++;
      emit({ type: 'lost', dog: d });
      if (d === G.active && (G.phase === 'aim' || G.phase === 'retreat')) endAim('lost');
    }

    function endAim(reason) {
      G.thrusting = false; G.thrustOn = false; G.thrustVec = null;
      if (G.drilling > 0) finishDrill();
      G.aim.charging = false;
      G.ai = null;
      if (G.phase === 'aim' || G.phase === 'retreat') {
        G.phase = G.projectiles.length ? 'flight' : 'settle';
        G.settleT = 0;
        emit({ type: 'endaim', reason });
      }
    }

    /* ----------------------------------------------------------- turns */
    function nextTurn() {
      const n = G.teams.length;
      let team = null;
      for (let s = 1; s <= n; s++) {
        const t = G.teams[(G.teamIdx + s + n) % n];
        if (G.teamAlive(t)) { team = t; break; }
      }
      if (!team) return finish();
      G.teamIdx = team.idx;
      let dog = null;
      for (let s = 0; s < team.dogs.length; s++) {
        const d = team.dogs[(team.next + s) % team.dogs.length];
        if (d.alive) { dog = d; team.next = (team.next + s + 1) % team.dogs.length; break; }
      }
      G.active = dog;
      G.turn++;
      G.phase = 'aim';
      G.timer = G.turnTime;
      G.aim.power = 0; G.aim.charging = false; G.aim.target = null;
      G.aim.weapon = G.ammoOf(team, team.lastWeapon) > 0 ? team.lastWeapon : 'bone';
      G.thrusting = false; G.thrustOn = false; G.thrustVec = null; G.toldHeavy = false;
      G.drilling = 0; G.prevFire = !!G.input.fire; G.walkKey = 0;
      G.ai = null;
      emit({ type: 'turn', team, dog });
      if (G.isAI()) startAI();
    }

    function finish() {
      const alive = G.teams.filter(G.teamAlive);
      G.winner = alive.length === 1 ? alive[0] : null;
      G.phase = 'over'; G.over = true;
      emit({ type: 'over', winner: G.winner });
    }

    G.start = function () { if (G.phase === 'start') nextTurn(); };

    /* ------------------------------------------------------------- fire */
    function aimDir() { return P.aimDir(G.active, G.aim.angle); }

    function spawnProjectile(wid, x, y, vx, vy, extra) {
      const W = RR.WEAPON[wid];
      const p = Object.assign({ x, y, vx, vy, r: W.proj.r, age: 0, owner: G.active, weapon: wid,
        bounce: !!W.proj.bounce, restitution: W.proj.restitution || 0, fuse: null,
        blast: W.blast, main: false }, extra || {});
      G.projectiles.push(p);
      return p;
    }

    function fire() {
      const team = G.team(), dog = G.active, W = RR.WEAPON[G.aim.weapon];
      G.aim.charging = false;
      if (!useAmmo(team, W.id)) { emit({ type: 'noammo', weapon: W }); G.aim.power = 0; return false; }
      team.shots++; team.lastWeapon = W.id; G.stats.shots++;
      const d = aimDir();
      if (W.kind === 'charge') {
        const pw = Math.max(0.03, G.aim.power);
        G.aim.lastPower = pw;
        const v = pw * P.V_MAX;
        const ox = dog.x + d.x * (dog.r + 5), oy = dog.y + d.y * (dog.r + 5);
        const p = spawnProjectile(W.id, ox, oy, d.x * v, d.y * v,
          { main: true, fuse: W.fuse ? G.aim.fuse : null, x0: ox, y0: oy, t0: G.time, v0: v });
        G.mainShot = p;
        G.phase = 'flight';
        emit({ type: 'fire', weapon: W, dog, v, angle: G.aim.angle });
        if (P.solid(G.world, ox, oy)) detonate(p, ox, oy);
      } else if (W.kind === 'instant') {
        laser(W, dog, d);
        G.phase = 'flight';
      } else if (W.kind === 'target') {
        supplyDrop(W, G.aim.target);
        G.phase = 'flight';
        emit({ type: 'fire', weapon: W, dog });
      }
      G.aim.power = 0;
      G.ai = null;
      return true;
    }

    function laser(W, dog, d) {
      let x = dog.x + d.x * (dog.r + 2), y = dog.y + d.y * (dog.r + 2), hit = null;
      const x0 = x, y0 = y;
      for (let i = 0; i < W.range; i++) {
        x += d.x; y += d.y;
        if (P.solid(G.world, x, y)) { hit = 'solid'; break; }
        const target = G.dogs.find(o => o.alive && o !== dog && Math.hypot(o.x - x, o.y - y) < o.r);
        if (target) { hit = target; break; }
      }
      emit({ type: 'laser', x0, y0, x1: x, y1: y });
      if (hit === 'solid') P.carve(G.world, x, y, 8);
      else if (hit) {
        hurt(hit, W.dmg, 'laser');
        G.team().dealt += W.dmg;
        P.launch(hit, d.x * W.push, d.y * W.push);
      }
    }

    function supplyDrop(W, target) {
      const g = G.g(), gx = g.x / g.g, gy = g.y / g.g;
      const Wd = G.world.W, Hd = G.world.H, m = 40;
      // walk back from the target against gravity to the arena edge
      let t = Infinity;
      if (gx > 1e-6) t = Math.min(t, (target.x + m) / gx);
      if (gx < -1e-6) t = Math.min(t, (target.x - Wd - m) / gx);
      if (gy > 1e-6) t = Math.min(t, (target.y + m) / gy);
      if (gy < -1e-6) t = Math.min(t, (target.y - Hd - m) / gy);
      if (!isFinite(t)) t = 0;
      const sx = target.x - gx * t, sy = target.y - gy * t;
      const px = -gy, py = gx;
      for (let k = -1; k <= 1; k++) {
        spawnProjectile(W.id, sx + px * k * 34, sy + py * k * 34, gx * 4, gy * 4,
          { main: k === 0, x0: sx, y0: sy, t0: G.time, owner: null });
      }
    }

    function explode(x, y, R, dmg, push, owner) {
      P.carve(G.world, x, y, R);
      emit({ type: 'explode', x, y, R });
      const hits = P.blastHits(G.dogs, x, y, R, dmg, push);
      const ownerTeam = owner ? owner.team : (G.active ? G.active.team : -1);
      for (const h of hits) {
        if (h.dog.team !== ownerTeam && G.teams[ownerTeam]) G.teams[ownerTeam].dealt += h.dmg;
        hurt(h.dog, h.dmg, 'blast');
        const d = h.dog;
        let vx = h.vx, vy = h.vy;
        if (d.grounded) {
          // the ground takes the part of the push that points into it
          const vn = vx * d.nx + vy * d.ny;
          if (vn < 0) { vx -= vn * d.nx; vy -= vn * d.ny; }
        }
        const sp = Math.hypot(vx, vy);
        if (sp > 0.8) {
          if (d.grounded) { d.x += d.nx; d.y += d.ny; P.launch(d, vx, vy); }
          else { d.vx += vx; d.vy += vy; }
        }
      }
      for (const p of G.projectiles) {
        const dd = Math.hypot(p.x - x, p.y - y);
        if (dd < R * 1.2 && dd > 0.5) {
          const f = 1 - dd / (R * 1.2);
          p.vx += (p.x - x) / dd * push * f; p.vy += (p.y - y) / dd * push * f;
        }
      }
    }

    function detonate(p, x, y) {
      const W = RR.WEAPON[p.weapon];
      const b = p.blast || W.blast;
      const i = G.projectiles.indexOf(p);
      if (i >= 0) G.projectiles.splice(i, 1);
      explode(x, y, b.R, b.dmg, b.push, p.owner);
      if (W.bomblets && p.main) {
        const bl = W.bomblets;
        const n = P.normalAt(G.world, x, y, 10) || { x: -G.g().x / G.g().g, y: -G.g().y / G.g().g };
        const base = Math.atan2(n.y, n.x);
        for (let k = 0; k < bl.n; k++) {
          const a = base + (k / (bl.n - 1) - 0.5) * 2.1 + (G.rng() - 0.5) * 0.2;
          const sp = 3 + G.rng() * 3;
          spawnProjectile(p.weapon, x + Math.cos(a) * 3, y + Math.sin(a) * 3, Math.cos(a) * sp, Math.sin(a) * sp,
            { r: bl.r, blast: { R: bl.R, dmg: bl.dmg, push: bl.push }, owner: p.owner, age: 0.2 });
        }
      }
      if (p.main) recordShot(p, x, y, 'hit');
    }

    function recordShot(p, x, y, how) {
      const dist = Math.hypot(x - p.x0, y - p.y0) / PPM;
      const t = G.time - p.t0;
      G.lastShot = { dist, t, how, planet: G.planet, weapon: p.weapon, v: p.v0 || null };
      if (how === 'hit' && (!G.stats.longest || dist > G.stats.longest.dist)) G.stats.longest = Object.assign({}, G.lastShot);
      emit({ type: 'shot', shot: G.lastShot });
    }

    /* -------------------------------------------------------- utilities */
    function useUtility() {
      const team = G.team(), dog = G.active, W = RR.WEAPON[G.aim.weapon];
      if (W.id === 'thrust' && G.thrusting) return false;
      if (!dog.alive) return false;
      if (!useAmmo(team, W.id)) { emit({ type: 'noammo', weapon: W }); return false; }
      if (W.id === 'thrust') {
        G.thrusting = true; G.thrustFuel = W.fuel; G.toldHeavy = false;
        const twr = W.accel / G.g().g;
        emit({ type: 'thrust', twr });
      } else if (W.id === 'printer') {
        const d = aimDir();
        const off = dog.r + 4 + W.len / 2;
        const placed = P.fillSlab(G.world, dog.x + d.x * off, dog.y + d.y * off, W.len, W.thick,
          Math.atan2(d.y, d.x), P.MAT.SLAB, RR.terrain.PAINT.SLAB,
          (x, y) => G.dogs.some(o => o.alive && Math.hypot(o.x - x, o.y - y) < o.r + 1.5));
        emit({ type: 'print', placed });
      } else if (W.id === 'drill') {
        G.drilling = W.time; G.drillDir = aimDir();
        if (dog.grounded) { dog.grounded = false; dog.vx = 0; dog.vy = 0; dog.ux = dog.nx; dog.uy = dog.ny; }
        emit({ type: 'drill' });
      }
      return true;
    }

    function finishDrill() {
      const dog = G.active;
      G.drilling = 0;
      if (!dog || !dog.alive) return;
      dog.vx = 0; dog.vy = 0;
      if (P.touching(G.world, dog.x, dog.y, dog.r + 2)) P.land(G.world, dog, G.g());
    }

    function drillStep(dt) {
      const dog = G.active, W = RR.WEAPON.drill;
      G.drilling -= dt;
      const dx = G.drillDir.x * W.speed * PPM * dt, dy = G.drillDir.y * W.speed * PPM * dt;
      P.carve(G.world, dog.x + G.drillDir.x * 4 + dx, dog.y + G.drillDir.y * 4 + dy, W.R);
      if (!P.circleHits(G.world, dog.x + dx, dog.y + dy, dog.r)) { dog.x += dx; dog.y += dy; }
      else G.drilling = Math.min(G.drilling, 0);   // bedrock stops the drill
      dog.walkPhase += dt * 14;
      if (G.drilling <= 0) finishDrill();
    }

    function thrustStep(dt) {
      const dog = G.active, W = RR.WEAPON.thrust;
      G.thrustVec = null;
      if (!dog || !dog.alive) { G.thrusting = false; return; }
      if (G.thrustOn && G.thrustFuel > 0) {
        G.thrustFuel -= dt;
        const d = aimDir();
        const ax = d.x * W.accel, ay = d.y * W.accel, g = G.g();
        if (dog.grounded) {
          if (P.thrustWouldLift(dog, g, ax, ay)) {
            dog.x += dog.nx; dog.y += dog.ny;
            P.launch(dog, 0, 0);
          } else if (!G.toldHeavy) {
            G.toldHeavy = true;
            emit({ type: 'heavy', twr: W.accel / g.g });
          }
        }
        if (!dog.grounded) G.thrustVec = { x: ax, y: ay };
      }
      if (G.thrustFuel <= 0) { G.thrusting = false; G.thrustOn = false; G.thrustVec = null; emit({ type: 'fuelout' }); }
    }

    /* ------------------------------------------------------------- walk */
    function walkSignFor(dog, dir) {
      const tx = -dog.ny, ty = dog.nx;
      if (Math.abs(tx) >= 0.35) return (tx * dir > 0) ? 1 : -1;
      // on a wall: "right" climbs a wall that is to your right
      const climb = dog.nx < 0 ? -1 : 1;
      return (ty * climb * dir < 0) ? 1 : -1;
    }

    function walk(dog, dir, dt) {
      if (!dog.grounded) return;
      if (dir !== G.walkKey) { G.walkKey = dir; G.walkSign = walkSignFor(dog, dir); dog.fs = G.walkSign; dog.walkAcc = 0; }
      dog.walkAcc += P.WALK * PPM * dt;
      while (dog.walkAcc >= 1) {
        dog.walkAcc -= 1;
        const r = P.walkStep(G.world, dog, G.walkSign);
        if (r !== 'ok') { dog.walkAcc = 0; break; }
      }
      dog.walkPhase += dt * 9;
    }

    function jump(dog) {
      if (!dog.grounded) return false;
      const f = P.frame(dog);
      const a = P.JUMP_ANG * Math.PI / 180;
      const vx = (Math.cos(a) * f.fx + Math.sin(a) * f.ux) * P.JUMP_V;
      const vy = (Math.cos(a) * f.fy + Math.sin(a) * f.uy) * P.JUMP_V;
      dog.x += dog.nx; dog.y += dog.ny;
      P.launch(dog, vx, vy);
      emit({ type: 'jump', dog });
      return true;
    }

    /* ------------------------------------------------------- human input */
    function human(dt) {
      const inp = G.input, dog = G.active, W = RR.WEAPON[G.aim.weapon];
      const edge = inp.fire && !G.prevFire;
      G.prevFire = inp.fire;
      const dir = inp.right ? 1 : inp.left ? -1 : 0;
      if (W.kind === 'target') {
        if (!G.aim.target) G.aim.target = { x: dog.x + dog.fs * 200, y: dog.y - 100 };
        G.aim.target.x = Math.max(0, Math.min(G.world.W, G.aim.target.x + dir * 320 * dt));
        G.aim.target.y = Math.max(0, Math.min(G.world.H, G.aim.target.y + ((inp.down ? 1 : 0) - (inp.up ? 1 : 0)) * 320 * dt));
        if (edge) fire();
        return;
      }
      if (G.thrusting) {
        G.thrustOn = inp.fire;
        if (dir && !dog.grounded) dog.fs = dir * (frameSignToScreen(dog));
      } else if (G.drilling <= 0) {
        if (dir && !G.aim.charging) walk(dog, dir, dt);
        else { G.walkKey = 0; dog.walkAcc = 0; }
      }
      const da = ((inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * 70 * dt;
      G.aim.angle = Math.max(-85, Math.min(90, G.aim.angle + da));
      if (G.drilling > 0) return;
      if (W.kind === 'charge') {
        if (inp.fire && (G.aim.charging || edge)) {
          if (!G.aim.charging) {
            if (G.ammoOf(G.team(), W.id) > 0) { G.aim.charging = true; G.aim.power = 0; }
            else emit({ type: 'noammo', weapon: W });
          } else {
            G.aim.power += dt / RR.CHARGE_TIME;
            if (G.aim.power >= 1) { G.aim.power = 1; fire(); }
          }
        } else if (!inp.fire && G.aim.charging) fire();
      } else if (W.kind === 'instant') {
        if (edge) fire();
      } else if (W.kind === 'utility') {
        if (edge && !(W.id === 'thrust' && G.thrusting)) { useUtility(); if (W.id === 'thrust') G.thrustOn = true; }
      } else if (W.kind === 'skip') {
        if (edge) { emit({ type: 'skip' }); endAim('skip'); }
      }
    }
    // airborne facing flip: keep "right" meaning screen-right
    function frameSignToScreen(dog) {
      const tx = -dog.uy;
      return tx >= 0 ? 1 : -1;
    }

    G.jump = function () {
      if (!(G.humanTurn() || (G.phase === 'retreat' && !G.isAI()))) return false;
      if (G.aim.charging || G.drilling > 0 || G.thrusting) return false;
      return jump(G.active);
    };

    G.selectWeapon = function (wid) {
      if (!G.humanTurn() || G.aim.charging || G.drilling > 0) return false;
      if (!RR.WEAPON[wid]) return false;
      if (G.thrusting) {
        if (!G.active.grounded) return false;
        G.thrusting = false; G.thrustOn = false; G.thrustVec = null;   // stow the pack
      }
      G.aim.weapon = wid;
      if (RR.WEAPON[wid].kind === 'target' && !G.aim.target) G.aim.target = { x: G.active.x + G.active.fs * 200, y: G.active.y - 100 };
      emit({ type: 'weapon', weapon: RR.WEAPON[wid] });
      return true;
    };
    G.setTarget = function (x, y) {
      if (!G.humanTurn() || RR.WEAPON[G.aim.weapon].kind !== 'target') return false;
      G.aim.target = { x, y };
      return true;
    };
    G.setFuse = function (s) {
      if (!G.humanTurn()) return false;
      G.aim.fuse = Math.max(1, Math.min(5, Math.round(s)));
      emit({ type: 'fuse', fuse: G.aim.fuse });
      return true;
    };

    /* ---------------------------------------------------------- gravity */
    function setPlanet(i) {
      G.planet = ((i % 3) + 3) % 3;
      emit({ type: 'gravity', planet: G.planet, gdir: G.gdir });
    }
    function setGdir(deg) {
      const v = ((Math.round(deg / 15) * 15) % 360 + 360) % 360;
      if (v === G.gdir) return;
      G.gdir = v;
      emit({ type: 'gravity', planet: G.planet, gdir: G.gdir });
    }
    G.cyclePlanet = function () { if (!G.canSetGravity()) return false; setPlanet(G.planet + 1); return true; };
    G.setPlanet = function (i) { if (!G.canSetGravity()) return false; setPlanet(i); return true; };
    G.setGravityDir = function (deg) { if (!G.canSetGravity()) return false; setGdir(deg); return true; };

    /* ---------------------------------------------------- the toggles */
    G.toggleAuto = function () {
      const t = G.team();
      if (!t || t.ctrl !== 'human' || G.over) return false;
      t.auto = !t.auto;
      if (t.auto) t.usedAuto = true;
      emit({ type: 'auto', team: t, on: t.auto });
      if (G.phase === 'aim') {
        if (t.auto) {
          if (!G.thrusting && G.drilling <= 0) { G.aim.charging = false; G.aim.power = 0; startAI(); }
        } else {
          G.ai = null; G.aim.charging = false; G.aim.power = 0; G.prevFire = !!G.input.fire;
        }
      }
      return true;
    };
    G.setInfiniteAmmo = function (on) {
      G.infiniteAmmo = !!on;
      if (on) G.usedInfinite = true;
      emit({ type: 'ammo', on: G.infiniteAmmo });
      return true;
    };

    /* --------------------------------------------------------------- AI */
    function startAI() {
      const t = G.team();
      const level = t.ctrl === 'human' ? 'commander' : t.ctrl;
      G.ai = { planner: RR.AI.planner(G, G.active, level), stage: 'think', t: 0, plan: null };
      emit({ type: 'think', team: t });
    }

    function aiStep(dt) {
      const ai = G.ai, dog = G.active;
      ai.t += dt;
      if (ai.stage === 'think') {
        const done = ai.planner.step(G.aiBudget);
        if (done && ai.t > 0.5) {
          ai.plan = ai.planner.result(G.rng);
          if (!ai.plan) { emit({ type: 'skip' }); endAim('skip'); return; }
          ai.stage = 'gravity'; ai.t = 0;
        }
      } else if (ai.stage === 'gravity') {
        if (ai.t < 0.14) return;
        ai.t = 0;
        if (G.planet !== ai.plan.cfg.planet) setPlanet(G.planet + 1);
        else if (G.gdir !== ai.plan.cfg.gdir) {
          let diff = ((ai.plan.cfg.gdir - G.gdir + 540) % 360) - 180;
          setGdir(G.gdir + Math.sign(diff) * 15);
        } else ai.stage = 'face';
      } else if (ai.stage === 'face') {
        dog.fs = ai.plan.fs;
        G.aim.weapon = ai.plan.wid;
        G.aim.fuse = 3;
        emit({ type: 'weapon', weapon: RR.WEAPON[ai.plan.wid] });
        ai.stage = 'aim';
      } else if (ai.stage === 'aim') {
        const diff = ai.plan.angle - G.aim.angle, step = 90 * dt;
        if (Math.abs(diff) <= step) { G.aim.angle = ai.plan.angle; ai.stage = 'charge'; G.aim.charging = true; G.aim.power = 0; }
        else G.aim.angle += Math.sign(diff) * step;
      } else if (ai.stage === 'charge') {
        G.aim.power += dt / RR.CHARGE_TIME;
        if (G.aim.power >= ai.plan.pw) { G.aim.power = ai.plan.pw; fire(); }
      }
    }

    /* ----------------------------------------------------------- update */
    function quiet() {
      if (G.projectiles.length || G.thrusting || G.drilling > 0) return false;
      for (const d of G.dogs) if (d.alive && !d.grounded) return false;
      return true;
    }

    function resolveDeaths() {
      let popped = false;
      for (const d of G.dogs) {
        if (d.alive && d.hp <= 0) {
          d.alive = false;
          emit({ type: 'down', dog: d });
          explode(d.x, d.y, 14, 10, 3, null);
          popped = true;
        }
      }
      return popped;
    }

    G.update = function (dt) {
      if (G.phase === 'start' || G.phase === 'over') return;
      G.time += dt;
      const g = G.g();
      const dog = G.active;

      if (G.phase === 'aim') {
        if (G.timer !== Infinity) {
          G.timer -= dt;
          if (G.timer <= 0) { G.timer = 0; emit({ type: 'timeout' }); endAim('timeout'); }
        }
        if (G.phase === 'aim') {
          if (G.ai) aiStep(dt);
          else if (!G.isAI()) human(dt);
        }
      } else if (G.phase === 'retreat') {
        G.retreat -= dt;
        if (!G.isAI() && dog && dog.alive) {
          const dir = G.input.right ? 1 : G.input.left ? -1 : 0;
          if (dir) walk(dog, dir, dt); else G.walkKey = 0;
        }
        if (G.retreat <= 0) { G.phase = 'settle'; G.settleT = 0; }
      }

      if (G.thrusting) thrustStep(dt);
      if (G.drilling > 0 && dog && dog.alive) drillStep(dt);

      for (const d of G.dogs) {
        if (!d.alive) continue;
        if (d === dog && G.drilling > 0) continue;
        if (!d.grounded) {
          const thr = d === dog && G.thrustVec ? G.thrustVec : null;
          const ev = P.stepAirborne(G.world, d, g, dt, thr ? thr.x : 0, thr ? thr.y : 0);
          if (ev) {
            emit({ type: 'land', dog: d, vin: ev.vin });
            const fd = P.fallDamage(ev.vin);
            if (fd) hurt(d, fd, 'fall');
          } else if (P.outOfPlay(d.x, d.y, G.world.W, G.world.H, g.x, g.y, 4000) || d.airTime > 40) lose(d);
        } else if (!P.supported(G.world, d)) {
          P.launch(d, 0, 0);
        }
      }

      for (let i = G.projectiles.length - 1; i >= 0; i--) {
        const p = G.projectiles[i];
        if (!p) continue;
        const ev = P.stepProjectile(G.world, p, g.x, g.y, dt, G.dogs);
        if (p.fuse != null && p.age >= p.fuse) { detonate(p, p.x, p.y); continue; }
        if (ev) {
          if (ev.kind === 'bounce') { if (ev.speed > 0.6) emit({ type: 'bounce', x: p.x, y: p.y, speed: ev.speed }); }
          else { detonate(p, p.x, p.y); continue; }
        }
        if (P.outOfPlay(p.x, p.y, G.world.W, G.world.H, g.x, g.y, 4000) || p.age > 45) {
          G.projectiles.splice(G.projectiles.indexOf(p), 1);
          if (p.main) recordShot(p, p.x, p.y, 'lost');
          emit({ type: 'gone', x: p.x, y: p.y });
        }
      }

      if (G.phase === 'flight' && G.projectiles.length === 0) {
        if (dog && dog.alive && !G.isAI()) { G.phase = 'retreat'; G.retreat = RETREAT; }
        else { G.phase = 'settle'; G.settleT = 0; }
        emit({ type: 'retreat' });
      }

      if (G.phase === 'settle') {
        if (quiet()) {
          G.settleT += dt;
          if (G.settleT > 0.45) {
            G.settleT = 0;
            if (!resolveDeaths()) {
              const alive = G.teams.filter(G.teamAlive);
              if (alive.length <= 1) finish(); else nextTurn();
            }
          }
        } else G.settleT = 0;
      }
    };

    return G;
  }

  RR.createGame = createGame;
  RR.TEAM_NAMES = TEAM_NAMES;
  RR.TEAM_COLORS = TEAM_COLORS;
})();
