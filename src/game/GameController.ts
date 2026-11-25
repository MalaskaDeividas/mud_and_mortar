import * as THREE from 'three';
import { TerrainEngine, WATER_LEVEL } from '../terrain/TerrainEngine';
import {
  DestructibleProp,
  getIslandMap,
  IslandMapDefinition,
  IslandMapId,
  populateIslandProps,
} from '../maps/ww2Islands';
import { OceanEnvironment } from '../world/OceanEnvironment';
import { ALLIED_NAMES, AXIS_NAMES, Soldier, TeamId } from '../entities/Soldier';
import { SupplyCrate } from '../entities/SupplyCrate';
import { getWeaponDef, rollCrateWeapon, WeaponDef, WeaponId, WEAPONS } from '../weapons/weapons';
import { EffectsSystem } from '../effects/EffectsSystem';
import { sound } from '../audio/sound';
import { addCartoonOutline, createToonMaterial } from '../graphics/textures';

export type GameMode = 'ai' | 'hotseat';
type TurnPhase = 'menu' | 'aiming' | 'charging' | 'projectile' | 'retreat' | 'ai_thinking' | 'victory';

interface ActiveProjectile {
  mesh: THREE.Group;
  weapon: WeaponDef;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  burrowing: boolean;
  burrowRemaining: number;
  smokeAcc: number;
  isSubShell: boolean;
}

interface PendingNavalShell {
  delay: number;
  targetX: number;
  targetZ: number;
  weapon: WeaponDef;
}

interface PendingBarrelBlast {
  delay: number;
  position: THREE.Vector3;
}

interface FloatingPopup {
  el: HTMLDivElement;
  worldPos: THREE.Vector3;
  age: number;
  maxAge: number;
}

export interface HudCallbacks {
  onHudUpdate: (state: {
    phase: TurnPhase;
    team: TeamId;
    soldierName: string;
    timer: number;
    alliesHp: number;
    axisHp: number;
    maxTeamHp: number;
    windAngle: number;
    windSpeed: number;
    selectedWeapon: WeaponId;
    ammo: Record<WeaponId, number>;
    charge: number;
    freeCam: boolean;
    isAiTurn: boolean;
  }) => void;
  onAnnouncement: (text: string) => void;
  onVictory: (winner: TeamId | 'draw', stats: string) => void;
}

export class GameController {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly ocean: OceanEnvironment;
  private readonly effects: EffectsSystem;
  private readonly callbacks: HudCallbacks;
  private readonly tagsLayer: HTMLElement;

  private terrain: TerrainEngine;
  private currentMap: IslandMapDefinition;
  private propsGroup = new THREE.Group();
  private props: DestructibleProp[] = [];
  private soldiersGroup = new THREE.Group();
  private soldiers: Soldier[] = [];
  private tagElements = new Map<string, HTMLDivElement>();
  private popups: FloatingPopup[] = [];

  // Aiming trajectory preview dots & ground target ring
  private aimDotsGroup = new THREE.Group();
  private aimDots: THREE.Mesh[] = [];
  private impactMarker: THREE.Mesh;

  // Projectiles, parachute supply crates, naval barrage, and chain fuel-barrel blasts
  private projectilesGroup = new THREE.Group();
  private projectiles: ActiveProjectile[] = [];
  private cratesGroup = new THREE.Group();
  private crates: SupplyCrate[] = [];
  private pendingNaval: PendingNavalShell[] = [];
  private pendingBarrels: PendingBarrelBlast[] = [];

  // Match & Turn State
  private mode: GameMode = 'ai';
  private squadSize = 3;
  private phase: TurnPhase = 'menu';
  private activeTeam: TeamId = 'allies';
  private teamSoldierCursor: Record<TeamId, number> = { allies: 0, axis: 0 };
  private activeSoldier: Soldier | null = null;
  private turnTimer = 45;
  private retreatTimer = 0;
  private postBlastWait = 0;
  private turnCount = 1;
  private cratersCarved = 0;

  private selectedWeapon: WeaponId = 'bazooka';
  private teamAmmo: Record<TeamId, Record<WeaponId, number>> = {
    allies: this.createInitialAmmo(),
    axis: this.createInitialAmmo(),
  };

  // Charging state
  private charge = 0;
  private chargeDir = 1;

  // Wind vector (X, Z)
  private wind = new THREE.Vector2(0, 0);

  // Camera state (scaled for bigger WW2 islands!)
  private freeCam = false;
  private camYaw = 0.6;
  private camPitch = 0.42;
  private camDist = 18.0;
  private camTarget = new THREE.Vector3(0, 11, 0);
  private freeCamCenter = new THREE.Vector3(0, 11, 0);
  private shakeIntensity = 0;

  // Input state
  private keys = new Set<string>();
  private draggingOrbit = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private jumpQueued = false;

  // AI state
  private aiTimer = 0;
  private aiPlan: {
    weapon: WeaponId;
    targetYaw: number;
    targetPitch: number;
    power: number;
    fired: boolean;
  } | null = null;

  private clock = new THREE.Clock();
  private animFrameId = 0;
  private hudSyncAcc = 0;

  constructor(canvas: HTMLCanvasElement, tagsLayer: HTMLElement, callbacks: HudCallbacks) {
    this.tagsLayer = tagsLayer;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.3, 620);

    this.ocean = new OceanEnvironment(this.scene);
    this.effects = new EffectsSystem(this.scene);
    this.scene.add(this.propsGroup, this.soldiersGroup, this.cratesGroup, this.projectilesGroup, this.aimDotsGroup);

    // 22 bright cartoony aiming trajectory dots + landing ring
    const dotGeo = new THREE.SphereGeometry(0.15, 7, 7);
    for (let i = 0; i < 22; i++) {
      const dotMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xffe054 : 0xff9b36,
        transparent: true,
        opacity: 1 - i / 25,
      });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.visible = false;
      this.aimDotsGroup.add(dot);
      this.aimDots.push(dot);
    }

    this.impactMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.9, 20),
      new THREE.MeshBasicMaterial({
        color: 0xff5a36,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
    );
    this.impactMarker.visible = false;
    this.aimDotsGroup.add(this.impactMarker);

    this.currentMap = getIslandMap('normandy');
    this.terrain = new TerrainEngine(this.currentMap.palette);
    this.scene.add(this.terrain.group);

    this.loadIslandPreview('normandy');
    this.bindEvents(canvas);
    this.loop();
  }

  private createInitialAmmo(): Record<WeaponId, number> {
    const map = {} as Record<WeaponId, number>;
    for (const w of WEAPONS) {
      map[w.id] = w.ammo;
    }
    return map;
  }

  loadIslandPreview(mapId: IslandMapId): void {
    this.currentMap = getIslandMap(mapId);
    this.clearMatchEntities();
    this.ocean.applyMapTheme(this.scene, this.currentMap);
    this.terrain.setPalette(this.currentMap.palette);
    this.terrain.generate(this.currentMap.field);
    this.props = populateIslandProps(this.currentMap, this.terrain, this.propsGroup);
    this.phase = 'menu';
  }

  startMatch(mapId: IslandMapId, mode: GameMode, squadSize: number): void {
    this.mode = mode;
    this.squadSize = squadSize;
    this.loadIslandPreview(mapId);

    this.teamAmmo = {
      allies: this.createInitialAmmo(),
      axis: this.createInitialAmmo(),
    };
    this.teamSoldierCursor = { allies: 0, axis: 0 };
    this.turnCount = 1;
    this.cratersCarved = 0;
    this.freeCam = false;
    this.selectedWeapon = 'bazooka';

    this.spawnSquad('allies', squadSize);
    this.spawnSquad('axis', squadSize);

    // Drop 2 initial parachute weapon crates right as battle starts!
    this.spawnParachuteCrate(false);
    this.spawnParachuteCrate(false);

    this.activeTeam = 'allies';
    this.beginTurn();
  }

  returnToMenu(): void {
    this.phase = 'menu';
    this.hideAimDots();
    this.clearTags();
  }

  selectWeapon(id: WeaponId): void {
    if (this.phase !== 'aiming') return;
    if (this.isCurrentTurnAi()) return;
    const ammo = this.teamAmmo[this.activeTeam][id];
    if (ammo === 0) return;
    this.selectedWeapon = id;
    this.syncSoldierWeaponVisual();
    this.emitHud();
  }

  toggleFreeCamera(): void {
    this.freeCam = !this.freeCam;
    if (this.freeCam) {
      this.freeCamCenter.copy(this.camTarget);
      this.camDist = Math.max(this.camDist, 36);
    } else {
      this.camDist = 17.5;
    }
    this.emitHud();
  }

  private spawnPopup(worldPos: THREE.Vector3, text: string, color = '#ffe054'): void {
    const el = document.createElement('div');
    el.className = 'dmg-popup';
    el.textContent = text;
    el.style.color = color;
    this.tagsLayer.appendChild(el);
    this.popups.push({
      el,
      worldPos: worldPos.clone().add(new THREE.Vector3(0, 2.2, 0)),
      age: 0,
      maxAge: 1.45,
    });
  }

  private spawnSquad(team: TeamId, count: number): void {
    const zones = this.currentMap.spawnZones[team];
    const names = team === 'allies' ? ALLIED_NAMES : AXIS_NAMES;

    for (let i = 0; i < count; i++) {
      const [baseX, baseZ] = zones[i % zones.length];
      let spawnX = baseX;
      let spawnZ = baseZ;
      let sy = this.terrain.getSurfaceHeight(spawnX, spawnZ);

      if (sy === null || sy < WATER_LEVEL + 1.1) {
        for (let r = 1.5; r <= 18; r += 1.5) {
          let found = false;
          for (let a = 0; a < 8; a++) {
            const tx = baseX + Math.cos((a / 8) * Math.PI * 2) * r;
            const tz = baseZ + Math.sin((a / 8) * Math.PI * 2) * r;
            const ty = this.terrain.getSurfaceHeight(tx, tz);
            if (ty !== null && ty >= WATER_LEVEL + 1.3) {
              spawnX = tx;
              spawnZ = tz;
              sy = ty;
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }

      const exactGround = this.terrain.findLocalGroundY(spawnX, sy ?? WATER_LEVEL + 5, spawnZ, 2.0, 2.0);
      const pos = new THREE.Vector3(spawnX, (exactGround ?? sy ?? WATER_LEVEL + 5) + 0.03, spawnZ);
      const soldier = new Soldier(`${team}-${i}`, team, names[i % names.length], pos);
      soldier.grounded = true;
      soldier.yaw = Math.atan2(-spawnX, -spawnZ);
      this.soldiersGroup.add(soldier.group);
      this.soldiers.push(soldier);

      const tag = document.createElement('div');
      tag.className = `soldier-tag ${team}`;
      tag.innerHTML = `<div class="soldier-tag-name">${soldier.name}</div><div class="soldier-tag-hp"><div class="soldier-tag-hp-fill"></div></div>`;
      this.tagsLayer.appendChild(tag);
      this.tagElements.set(soldier.id, tag);
    }
  }

  private beginTurn(): void {
    const aliveAllies = this.soldiers.filter((s) => s.team === 'allies' && s.alive);
    const aliveAxis = this.soldiers.filter((s) => s.team === 'axis' && s.alive);

    if (aliveAllies.length === 0 || aliveAxis.length === 0) {
      this.phase = 'victory';
      this.hideAimDots();
      const winner: TeamId | 'draw' =
        aliveAllies.length > 0 ? 'allies' : aliveAxis.length > 0 ? 'axis' : 'draw';
      sound.playVictory();
      this.callbacks.onVictory(
        winner,
        `${this.currentMap.name} · ${this.turnCount} turns · ${this.cratersCarved} clay craters blasted`
      );
      return;
    }

    const roster = this.soldiers.filter((s) => s.team === this.activeTeam && s.alive);
    const cursor = this.teamSoldierCursor[this.activeTeam] % roster.length;
    this.teamSoldierCursor[this.activeTeam] = (cursor + 1) % roster.length;

    this.activeSoldier = roster[cursor];
    for (const s of this.soldiers) {
      s.setActiveHighlight(s === this.activeSoldier);
    }

    if (this.teamAmmo[this.activeTeam][this.selectedWeapon] === 0) {
      this.selectedWeapon = 'bazooka';
    }
    this.syncSoldierWeaponVisual();

    const angle = Math.random() * Math.PI * 2;
    const mag = Math.random() * 5.0;
    this.wind.set(Math.cos(angle) * mag, Math.sin(angle) * mag);

    this.turnTimer = 45;
    this.charge = 0;
    this.freeCam = false;
    this.camDist = 17.5;
    this.camYaw = this.activeSoldier.yaw + Math.PI;
    this.camPitch = 0.36;

    // Parachute in a fresh WW2 weapon crate every 2nd turn (up to 4 on the island at once)!
    if (this.turnCount > 1 && this.turnCount % 2 === 0 && this.crates.length < 4) {
      this.spawnParachuteCrate(true);
    }

    if (this.isCurrentTurnAi()) {
      this.phase = 'ai_thinking';
      this.aiTimer = 1.05;
      this.aiPlan = this.computeAiPlan(this.activeSoldier);
      this.callbacks.onAnnouncement(`AXIS TURN · ${this.activeSoldier.name}`);
    } else {
      this.phase = 'aiming';
      const label = this.activeTeam === 'allies' ? 'ALLIES' : 'AXIS';
      this.callbacks.onAnnouncement(`${label} TURN · ${this.activeSoldier.name}`);
    }

    this.emitHud();
  }

  private endTurn(): void {
    this.activeTeam = this.activeTeam === 'allies' ? 'axis' : 'allies';
    this.turnCount++;
    this.beginTurn();
  }

  private isCurrentTurnAi(): boolean {
    return this.mode === 'ai' && this.activeTeam === 'axis';
  }

  private syncSoldierWeaponVisual(): void {
    if (!this.activeSoldier) return;
    const def = getWeaponDef(this.selectedWeapon);
    this.activeSoldier.setDisplayedWeapon(def.visualStyle);
  }

  // --- Weapon Firing & Ballistics ---

  private fireActiveWeapon(power01: number): void {
    if (!this.activeSoldier || !this.activeSoldier.alive) return;
    const weapon = getWeaponDef(this.selectedWeapon);

    if (this.teamAmmo[this.activeTeam][weapon.id] > 0) {
      this.teamAmmo[this.activeTeam][weapon.id]--;
    }

    const muzzle = this.activeSoldier.getMuzzlePosition(this.terrain);
    const aimDir = this.activeSoldier.getAimDirection();
    const clampedP = Math.max(0.08, Math.min(1, power01));

    if (weapon.isDropCharge) {
      const dropPos = this.activeSoldier.position
        .clone()
        .add(new THREE.Vector3(0, 0.9, 0))
        .addScaledVector(aimDir, 0.9);
      const vel = new THREE.Vector3(aimDir.x * 3.8, 3.6, aimDir.z * 3.8);
      this.spawnProjectile(weapon, dropPos, vel, false);
      sound.playBounce();
      this.phase = 'retreat';
      this.retreatTimer = 4.1;
      this.postBlastWait = 0;
      this.hideAimDots();
      this.callbacks.onAnnouncement('SATCHEL PLANTED — RUN FOR COVER!');
      this.emitHud();
      return;
    }

    const speed = THREE.MathUtils.lerp(weapon.minSpeed, weapon.maxSpeed, clampedP);
    const vel = aimDir.multiplyScalar(speed);
    this.spawnProjectile(weapon, muzzle, vel, false);
    sound.playLaunch(weapon.id === 'mortar' || weapon.id === 'bunker_buster');

    this.phase = 'projectile';
    this.postBlastWait = 0;
    this.hideAimDots();
    this.emitHud();
  }

  private spawnProjectile(
    weapon: WeaponDef,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    isSubShell: boolean
  ): void {
    const g = new THREE.Group();
    if (weapon.id === 'grenade') {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), createToonMaterial(0x476632));
      addCartoonOutline(m, 1.15);
      g.add(m);
    } else if (weapon.id === 'satchel') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.38), createToonMaterial(0xd93829));
      addCartoonOutline(m, 1.12);
      g.add(m);
    } else if (weapon.id === 'naval_strike' && !isSubShell) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8),
        new THREE.MeshBasicMaterial({ color: 0xff5233 })
      );
      g.add(m);
    } else {
      // Chunky cartoony rocket / mortar / battleship shell
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.82, 8), createToonMaterial(0x495443));
      body.rotation.x = Math.PI / 2;
      addCartoonOutline(body, 1.12);
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.36, 8),
        createToonMaterial(weapon.id === 'bunker_buster' ? 0xf5be33 : 0xe0402b)
      );
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.56;
      addCartoonOutline(tip, 1.12);
      g.add(body, tip);
    }

    g.position.copy(pos);
    this.projectilesGroup.add(g);

    this.projectiles.push({
      mesh: g,
      weapon,
      position: pos.clone(),
      velocity: vel.clone(),
      age: 0,
      burrowing: false,
      burrowRemaining: weapon.burrowSeconds,
      smokeAcc: 0,
      isSubShell,
    });
  }

  private detonateExplosion(
    impactPoint: THREE.Vector3,
    opts: {
      craterRadius: number;
      rimHeight: number;
      verticalStretch: number;
      slumpPasses: number;
      damage: number;
      blastRadius: number;
      knockback: number;
    }
  ): void {
    // 1. Sculpt & carve the 3D clay/mud island!
    const crater = this.terrain.carveCrater(impactPoint, {
      radius: opts.craterRadius,
      rimHeight: opts.rimHeight,
      verticalStretch: opts.verticalStretch,
      slumpPasses: opts.slumpPasses,
      scorch: 0.9,
    });
    this.cratersCarved++;

    // 2. Cartoony Explosion FX + Flying mud clods + Sound + Camera shake
    this.effects.spawnExplosion(impactPoint, opts.craterRadius);
    this.effects.spawnMudClods(crater.ejectedClods);
    sound.playExplosion(opts.craterRadius / 3.4);
    this.shakeIntensity = Math.min(1.25, opts.craterRadius * 0.16);

    // 3. Damage & knockback nearby soldiers with cartoon floating damage popups!
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      const soldierCenter = s.position.clone().add(new THREE.Vector3(0, 0.95, 0));
      const diff = soldierCenter.sub(impactPoint);
      const dist = diff.length();
      if (dist < opts.blastRadius) {
        const falloff = Math.max(0.2, 1 - dist / opts.blastRadius);
        const dmg = Math.round(opts.damage * falloff);
        const dir = dist > 0.05 ? diff.normalize() : new THREE.Vector3(0, 1, 0);
        dir.y = Math.max(0.5, dir.y + 0.62);
        dir.normalize();
        const impulse = dir.multiplyScalar(opts.knockback * falloff);
        s.applyDamage(dmg, impulse);
        this.spawnPopup(s.position, `-${dmg}`, dmg >= 40 ? '#ff5738' : '#ffe054');
      }
    }

    // 4. Knock loose props & chain-detonate explosive red fuel barrels!
    for (const p of this.props) {
      if (!p.alive) continue;
      const diff = p.position.clone().sub(impactPoint);
      const dist = diff.length();

      if (p.explosive && dist < opts.blastRadius * 1.05) {
        p.alive = false;
        this.propsGroup.remove(p.mesh);
        this.spawnPopup(p.position, 'BOOM!', '#ff8b33');
        this.pendingBarrels.push({
          delay: 0.22 + Math.random() * 0.18,
          position: p.position.clone(),
        });
        continue;
      }

      const groundUnder = this.terrain.sampleDensity(p.position.x, p.position.y - 0.15, p.position.z);
      if (dist < opts.blastRadius * 1.25 || groundUnder <= 0) {
        p.falling = true;
        const pushDir = dist > 0.1 ? diff.normalize() : new THREE.Vector3(0, 1, 0);
        const strength = dist < opts.blastRadius * 1.25 ? (1 - dist / (opts.blastRadius * 1.25)) * 12 : 1.5;
        p.velocity.addScaledVector(pushDir, strength);
        p.velocity.y += 3.8 + strength * 0.45;
        p.angularVelocity.set(
          (Math.random() - 0.5) * 4.5,
          (Math.random() - 0.5) * 4.5,
          (Math.random() - 0.5) * 4.5
        );
      }
    }

    this.postBlastWait = Math.max(this.postBlastWait, 1.55);
  }

  private detonateProjectile(proj: ActiveProjectile, impactPoint: THREE.Vector3): void {
    const w = proj.weapon;

    if (w.isFlareStrike && !proj.isSubShell) {
      sound.playLaunch(true);
      this.callbacks.onAnnouncement('INCOMING NAVAL BARRAGE!');
      for (let i = 0; i < 4; i++) {
        this.pendingNaval.push({
          delay: 0.5 + i * 0.4,
          targetX: impactPoint.x + (Math.random() - 0.5) * 10.5,
          targetZ: impactPoint.z + (Math.random() - 0.5) * 10.5,
          weapon: w,
        });
      }
      this.effects.spawnSmokeTrail(impactPoint, 0xff5a36, 1.1);
      return;
    }

    this.detonateExplosion(impactPoint, {
      craterRadius: w.craterRadius,
      rimHeight: w.rimHeight,
      verticalStretch: w.verticalStretch,
      slumpPasses: w.slumpPasses,
      damage: w.damage,
      blastRadius: w.blastRadius,
      knockback: w.knockback,
    });
  }

  // --- Tactical AI Opponent (with self-blast safety!) ---

  private computeAiPlan(ai: Soldier): {
    weapon: WeaponId;
    targetYaw: number;
    targetPitch: number;
    power: number;
    fired: boolean;
  } {
    const enemies = this.soldiers.filter((s) => s.team !== ai.team && s.alive);
    const target = enemies.reduce((best, cur) =>
      cur.position.distanceTo(ai.position) < best.position.distanceTo(ai.position) ? cur : best
    );

    const delta = target.position.clone().sub(ai.position);
    const horizDist = Math.hypot(delta.x, delta.z);

    const hasAmmo = (id: WeaponId) => this.teamAmmo[ai.team][id] !== 0;

    let chosen: WeaponId = 'bazooka';
    if (horizDist < 15 && hasAmmo('grenade')) {
      chosen = 'grenade';
    } else if (horizDist > 22 && hasAmmo('naval_strike') && Math.random() < 0.4) {
      chosen = 'naval_strike';
    } else if (hasAmmo('mortar') && Math.random() < 0.5) {
      chosen = 'mortar';
    } else if (hasAmmo('bunker_buster') && Math.random() < 0.4) {
      chosen = 'bunker_buster';
    } else {
      chosen = 'bazooka';
    }

    this.selectedWeapon = chosen;
    this.syncSoldierWeaponVisual();
    const w = getWeaponDef(chosen);

    const baseYaw = Math.atan2(delta.x, delta.z);
    let bestErr = Infinity;
    let bestYaw = baseYaw;
    let bestPitch = 0.62;
    let bestPower = 0.72;

    const pitchCandidates = chosen === 'mortar' ? [0.68, 0.85, 1.02, 1.15] : [0.25, 0.42, 0.6, 0.78, 0.95];
    const powerCandidates = [0.35, 0.52, 0.68, 0.84, 0.98];

    for (const pitch of pitchCandidates) {
      for (const power of powerCandidates) {
        const spd = THREE.MathUtils.lerp(w.minSpeed, w.maxSpeed, power);
        const estFlight = horizDist / Math.max(5, spd * Math.cos(pitch));
        const compX = delta.x - 0.5 * this.wind.x * w.windFactor * estFlight * estFlight;
        const compZ = delta.z - 0.5 * this.wind.y * w.windFactor * estFlight * estFlight;
        const yaw = Math.atan2(compX, compZ);

        const simPos = ai.position.clone().add(new THREE.Vector3(0, 1.25, 0));
        const cosP = Math.cos(pitch);
        const simVel = new THREE.Vector3(Math.sin(yaw) * cosP, Math.sin(pitch), Math.cos(yaw) * cosP).multiplyScalar(
          spd
        );

        let minToTarget = Infinity;
        let hitTooCloseToSelf = false;
        for (let step = 0; step < 65; step++) {
          const dt = 0.08;
          simVel.x += this.wind.x * w.windFactor * dt;
          simVel.z += this.wind.y * w.windFactor * dt;
          simVel.y -= 20.0 * w.gravityScale * dt;
          simPos.addScaledVector(simVel, dt);

          const d = simPos.distanceTo(target.position);
          if (d < minToTarget) minToTarget = d;

          if (simPos.y < WATER_LEVEL || this.terrain.sampleDensity(simPos.x, simPos.y, simPos.z) > 0) {
            // Bug fix: never shoot point-blank into a hill right in front of the AI!
            if (simPos.distanceTo(ai.position) < 4.5) {
              hitTooCloseToSelf = true;
            }
            minToTarget = Math.min(minToTarget, simPos.distanceTo(target.position));
            break;
          }
        }

        const score = hitTooCloseToSelf ? minToTarget + 80 : minToTarget;
        if (score < bestErr) {
          bestErr = score;
          bestYaw = yaw;
          bestPitch = pitch;
          bestPower = power;
        }
      }
    }

    return {
      weapon: chosen,
      targetYaw: bestYaw + (Math.random() - 0.5) * 0.06,
      targetPitch: Math.max(-0.2, Math.min(1.25, bestPitch + (Math.random() - 0.5) * 0.05)),
      power: Math.max(0.22, Math.min(0.98, bestPower + (Math.random() - 0.5) * 0.06)),
      fired: false,
    };
  }

  // --- Main Loop ---

  private loop = (): void => {
    this.animFrameId = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;

    this.ocean.update(elapsed, this.wind.x, this.wind.y);
    this.updateProps(dt);
    this.effects.update(dt, this.terrain);

    if (this.phase === 'menu') {
      // Wide scenic orbit around the bigger WW2 cartoon island!
      const ang = elapsed * 0.16;
      this.camera.position.set(Math.cos(ang) * 66, 34, Math.sin(ang) * 66);
      this.camera.lookAt(0, WATER_LEVEL + 4.5, 0);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.updateTurnAndControls(dt);
    this.updateProjectiles(dt);
    this.updateSoldiers(dt);
    this.updateCrates(dt);
    this.updateAimPreview();
    this.updateCamera(dt);
    this.updateFloatingTagsAndPopups(dt);

    this.hudSyncAcc += dt;
    if (this.hudSyncAcc >= 0.08) {
      this.hudSyncAcc = 0;
      this.emitHud();
    }

    this.renderer.render(this.scene, this.camera);
  };

  private updateTurnAndControls(dt: number): void {
    if (this.phase === 'victory') return;

    if (this.keys.has('KeyQ')) this.camYaw += dt * 2.0;
    if (this.keys.has('KeyE')) this.camYaw -= dt * 2.0;

    if (this.activeSoldier && (this.phase === 'aiming' || this.phase === 'charging') && !this.isCurrentTurnAi()) {
      if (this.keys.has('KeyR')) {
        this.activeSoldier.aimPitch = Math.min(1.25, this.activeSoldier.aimPitch + dt * 1.25);
      }
      if (this.keys.has('KeyF')) {
        this.activeSoldier.aimPitch = Math.max(-0.45, this.activeSoldier.aimPitch - dt * 1.25);
      }
    }

    if (this.freeCam) {
      const panSpeed = 34 * dt;
      const fwd = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.freeCamCenter.addScaledVector(fwd, panSpeed);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.freeCamCenter.addScaledVector(fwd, -panSpeed);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.freeCamCenter.addScaledVector(right, panSpeed);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.freeCamCenter.addScaledVector(right, -panSpeed);
      this.freeCamCenter.x = THREE.MathUtils.clamp(this.freeCamCenter.x, -42, 42);
      this.freeCamCenter.z = THREE.MathUtils.clamp(this.freeCamCenter.z, -42, 42);
    }

    const activeExplosions =
      this.projectiles.length > 0 || this.pendingNaval.length > 0 || this.pendingBarrels.length > 0;

    if (this.phase === 'aiming') {
      if (!this.activeSoldier || !this.activeSoldier.alive) {
        // Bug fix: pause briefly so player sees their soldier splash into the sea!
        this.phase = 'projectile';
        this.postBlastWait = 1.4;
        this.hideAimDots();
        return;
      }
      if (!this.freeCam) {
        this.activeSoldier.yaw = this.camYaw + Math.PI;
      }
      this.turnTimer -= dt;
      if (this.turnTimer <= 0) {
        this.callbacks.onAnnouncement('TIME EXPIRED!');
        this.endTurn();
      }
    } else if (this.phase === 'charging') {
      if (!this.activeSoldier || !this.activeSoldier.alive) {
        this.phase = 'projectile';
        this.postBlastWait = 1.4;
        this.hideAimDots();
        return;
      }
      this.charge += this.chargeDir * dt * 1.05;
      if (this.charge >= 1) {
        this.charge = 1;
        this.chargeDir = -1;
      } else if (this.charge <= 0.1) {
        this.charge = 0.1;
        this.chargeDir = 1;
      }
    } else if (this.phase === 'ai_thinking') {
      if (!this.activeSoldier || !this.activeSoldier.alive || !this.aiPlan) {
        this.endTurn();
        return;
      }
      const diffYaw = Math.atan2(
        Math.sin(this.aiPlan.targetYaw - this.activeSoldier.yaw),
        Math.cos(this.aiPlan.targetYaw - this.activeSoldier.yaw)
      );
      this.activeSoldier.yaw += diffYaw * Math.min(1, dt * 6);
      this.activeSoldier.aimPitch = THREE.MathUtils.lerp(this.activeSoldier.aimPitch, this.aiPlan.targetPitch, dt * 5);
      this.camYaw = this.activeSoldier.yaw + Math.PI;

      this.aiTimer -= dt;
      if (this.aiTimer <= 0 && !this.aiPlan.fired) {
        this.aiPlan.fired = true;
        this.fireActiveWeapon(this.aiPlan.power);
      }
    } else if (this.phase === 'retreat') {
      if (this.activeSoldier && this.activeSoldier.alive && !this.freeCam) {
        this.activeSoldier.yaw = this.camYaw + Math.PI;
      }
      this.retreatTimer -= dt;
      // Bug fix: after satchel detonates, transition to projectile-settle wait so you watch the blast!
      if (!activeExplosions) {
        this.postBlastWait -= dt;
        const anyTumbling = this.soldiers.some((s) => s.alive && (!s.grounded || s.knockbackTimer > 0.1));
        if (this.retreatTimer <= 0 && this.postBlastWait <= 0 && !anyTumbling) {
          this.endTurn();
        }
      }
    } else if (this.phase === 'projectile') {
      if (!activeExplosions) {
        this.postBlastWait -= dt;
        const anyTumbling = this.soldiers.some((s) => s.alive && (!s.grounded || s.knockbackTimer > 0.1));
        if (this.postBlastWait <= 0 && !anyTumbling) {
          this.endTurn();
        }
      }
    }
  }

  private updateProjectiles(dt: number): void {
    // Process chain-detonating explosive red fuel barrels!
    for (let i = this.pendingBarrels.length - 1; i >= 0; i--) {
      const b = this.pendingBarrels[i];
      b.delay -= dt;
      if (b.delay <= 0) {
        this.detonateExplosion(b.position, {
          craterRadius: 3.9,
          rimHeight: 0.72,
          verticalStretch: 1.15,
          slumpPasses: 2,
          damage: 45,
          blastRadius: 6.2,
          knockback: 18,
        });
        this.pendingBarrels.splice(i, 1);
      }
    }

    // Spawn queued Naval Strike battleship shells
    for (let i = this.pendingNaval.length - 1; i >= 0; i--) {
      const item = this.pendingNaval[i];
      item.delay -= dt;
      if (item.delay <= 0) {
        const start = new THREE.Vector3(item.targetX - 8, 56, item.targetZ - 6);
        const vel = new THREE.Vector3(4.8, -28, 3.6);
        this.spawnProjectile(item.weapon, start, vel, true);
        sound.playLaunch(true);
        this.pendingNaval.splice(i, 1);
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      p.smokeAcc += dt;

      if (p.burrowing) {
        p.burrowRemaining -= dt;
        const drillDir = p.velocity.clone().normalize();
        p.position.addScaledVector(drillDir, 5.8 * dt);
        p.mesh.position.copy(p.position);
        p.mesh.rotation.z += dt * 20;
        if (p.smokeAcc > 0.045) {
          p.smokeAcc = 0;
          this.effects.spawnSmokeTrail(p.position, 0x6b4528, 0.42);
        }
        if (p.burrowRemaining <= 0 || p.position.y < WATER_LEVEL - 1.5) {
          this.detonateProjectile(p, p.position.clone());
          this.removeProjectile(i);
        }
        continue;
      }

      p.velocity.x += this.wind.x * p.weapon.windFactor * dt;
      p.velocity.z += this.wind.y * p.weapon.windFactor * dt;
      p.velocity.y -= 20.0 * p.weapon.gravityScale * dt;

      const prevPos = p.position.clone();
      const stepVec = p.velocity.clone().multiplyScalar(dt);
      const stepLen = stepVec.length();

      if (p.smokeAcc > 0.04 && !p.weapon.isDropCharge) {
        p.smokeAcc = 0;
        const col = p.weapon.isFlareStrike && !p.isSubShell ? 0xff5a36 : 0xf4f0e6;
        this.effects.spawnSmokeTrail(p.position, col, 0.28);
      }

      // Check direct hit against soldiers OR explosive fuel barrels
      let hitDirect = false;
      if (!p.weapon.bounces && p.age > 0.1) {
        for (const s of this.soldiers) {
          if (!s.alive) continue;
          if (s === this.activeSoldier && p.age < 0.35) continue;
          const sc = s.position.clone().add(new THREE.Vector3(0, 0.95, 0));
          if (sc.distanceTo(p.position) < 1.05) {
            this.detonateProjectile(p, p.position.clone());
            this.removeProjectile(i);
            hitDirect = true;
            break;
          }
        }
        if (!hitDirect) {
          for (const prop of this.props) {
            if (!prop.alive || !prop.explosive) continue;
            if (prop.position.distanceTo(p.position) < 1.1) {
              this.detonateProjectile(p, p.position.clone());
              this.removeProjectile(i);
              hitDirect = true;
              break;
            }
          }
        }
      }
      if (hitDirect) continue;

      let hit =
        stepLen > 1e-4
          ? this.terrain.raycast(prevPos, stepVec.clone().divideScalar(stepLen), stepLen + 0.14)
          : null;
      if (
        !hit &&
        this.terrain.sampleDensity(prevPos.x + stepVec.x, prevPos.y + stepVec.y, prevPos.z + stepVec.z) > 0
      ) {
        const pt = prevPos.clone().add(stepVec);
        hit = { point: pt, normal: this.terrain.sampleNormal(pt.x, pt.y, pt.z), distance: stepLen };
      }

      if (hit) {
        if (p.weapon.burrowSeconds > 0) {
          p.position.copy(hit.point);
          p.burrowing = true;
          sound.playMudSplat();
          continue;
        } else if (p.weapon.bounces) {
          p.position.copy(hit.point).addScaledVector(hit.normal, 0.22);
          p.velocity.reflect(hit.normal).multiplyScalar(0.5);
          if (p.velocity.length() < 0.9) {
            p.velocity.multiplyScalar(0.5);
          } else {
            sound.playBounce();
          }
        } else {
          this.detonateProjectile(p, hit.point);
          this.removeProjectile(i);
          continue;
        }
      } else {
        p.position.add(stepVec);
      }

      p.mesh.position.copy(p.position);
      if (p.velocity.lengthSq() > 0.2 && !p.weapon.bounces) {
        p.mesh.lookAt(p.position.clone().add(p.velocity));
      } else {
        p.mesh.rotation.x += dt * 4.5;
      }

      if (p.weapon.fuseSeconds > 0 && p.age >= p.weapon.fuseSeconds) {
        this.detonateProjectile(p, p.position.clone());
        this.removeProjectile(i);
        continue;
      }

      if (p.position.y < WATER_LEVEL) {
        this.effects.spawnWaterSplash(p.position, 1.0);
        this.removeProjectile(i);
        this.postBlastWait = Math.max(this.postBlastWait, 0.85);
        continue;
      }

      if (p.age > 15 || Math.abs(p.position.x) > 135 || Math.abs(p.position.z) > 135) {
        this.removeProjectile(i);
        this.postBlastWait = Math.max(this.postBlastWait, 0.5);
      }
    }
  }

  private removeProjectile(index: number): void {
    const p = this.projectiles[index];
    this.projectilesGroup.remove(p.mesh);
    this.projectiles.splice(index, 1);
  }

  private updateSoldiers(dt: number): void {
    const canControl =
      (this.phase === 'aiming' || this.phase === 'retreat') && !this.freeCam && !this.isCurrentTurnAi();

    const moveInput = { forward: 0, right: 0, jump: false };
    if (canControl) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveInput.forward += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveInput.forward -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveInput.right += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveInput.right -= 1;
      if (this.jumpQueued) {
        moveInput.jump = true;
        this.jumpQueued = false;
      }
    } else {
      this.jumpQueued = false;
    }

    const idleInput = { forward: 0, right: 0, jump: false };

    for (const s of this.soldiers) {
      const inp = s === this.activeSoldier ? moveInput : idleInput;
      s.updatePhysics(dt, this.terrain, inp, (splashPos) => {
        this.effects.spawnWaterSplash(splashPos, 1.5);
        this.spawnPopup(splashPos, 'SPLASH!', '#7ce8ff');
        this.callbacks.onAnnouncement(`${s.name} LOST AT SEA!`);
      });
    }
  }

  private spawnParachuteCrate(announce: boolean): void {
    // Pick a solid high-ground spot on the island so crates land reliably on land
    let dropX = 0;
    let dropZ = 0;
    let found = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const tx = (Math.random() - 0.5) * 56;
      const tz = (Math.random() - 0.5) * 44;
      const sy = this.terrain.getSurfaceHeight(tx, tz);
      if (sy !== null && sy > WATER_LEVEL + 1.4) {
        const tooCloseToCrate = this.crates.some((c) => Math.hypot(c.position.x - tx, c.position.z - tz) < 7);
        if (!tooCloseToCrate) {
          dropX = tx;
          dropZ = tz;
          found = true;
          break;
        }
      }
    }
    if (!found) return;

    const weapon = rollCrateWeapon();
    // Compensate slightly for wind drift during descent so crate lands on the island
    const spawnPos = new THREE.Vector3(
      dropX - this.wind.x * 1.4,
      46 + Math.random() * 8,
      dropZ - this.wind.y * 1.4
    );
    const crate = new SupplyCrate(weapon, spawnPos);
    this.cratesGroup.add(crate.group);
    this.crates.push(crate);

    if (announce) {
      this.callbacks.onAnnouncement('PARACHUTE SUPPLY CRATE INCOMING!');
    }
  }

  private updateCrates(dt: number): void {
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.update(dt, this.terrain, this.wind.x, this.wind.y, (splashPos) => {
        this.effects.spawnWaterSplash(splashPos, 0.9);
      });

      if (!c.alive) {
        this.cratesGroup.remove(c.group);
        this.crates.splice(i, 1);
        continue;
      }

      // Check soldier collection (walk or jump into crate!)
      for (const s of this.soldiers) {
        if (!s.alive) continue;
        const dist = s.position.distanceTo(c.position);
        if (dist < 1.85) {
          const team = s.team;
          if (this.teamAmmo[team][c.weapon.id] >= 0) {
            this.teamAmmo[team][c.weapon.id] += c.amount;
          }
          sound.playPickup();
          this.spawnPopup(c.position, `+${c.amount} ${c.weapon.name.toUpperCase()}!`, '#7dff7a');
          this.callbacks.onAnnouncement(`${s.name} COLLECTED +${c.amount} ${c.weapon.name.toUpperCase()}!`);
          this.cratesGroup.remove(c.group);
          this.crates.splice(i, 1);
          this.emitHud();
          break;
        }
      }
    }
  }

  private updateProps(dt: number): void {
    for (const p of this.props) {
      if (!p.alive) continue;
      if (p.spinChild) {
        p.spinChild.rotation.y += dt * 1.1;
      }
      if (!p.falling) continue;
      p.velocity.y -= 20 * dt;
      p.position.addScaledVector(p.velocity, dt);
      p.mesh.position.copy(p.position);
      p.mesh.rotation.x += p.angularVelocity.x * dt;
      p.mesh.rotation.y += p.angularVelocity.y * dt;
      p.mesh.rotation.z += p.angularVelocity.z * dt;

      if (p.position.y < WATER_LEVEL - 0.6) {
        this.effects.spawnWaterSplash(p.position, 0.9);
        this.propsGroup.remove(p.mesh);
        p.alive = false;
        continue;
      }

      if (p.velocity.y < 0 && this.terrain.sampleDensity(p.position.x, p.position.y, p.position.z) > 0) {
        p.velocity.multiplyScalar(0.25);
        p.angularVelocity.multiplyScalar(0.3);
        if (p.velocity.length() < 0.8) {
          p.falling = false;
        }
      }
    }
  }

  private updateAimPreview(): void {
    const show =
      (this.phase === 'aiming' || this.phase === 'charging') &&
      !this.isCurrentTurnAi() &&
      this.activeSoldier !== null &&
      this.activeSoldier.alive;

    if (!show || !this.activeSoldier) {
      this.hideAimDots();
      return;
    }

    const w = getWeaponDef(this.selectedWeapon);
    if (w.isDropCharge) {
      this.hideAimDots();
      return;
    }

    const p0 = this.activeSoldier.getMuzzlePosition(this.terrain);
    const dir = this.activeSoldier.getAimDirection();
    const previewPower = this.phase === 'charging' ? this.charge : 0.6;
    const speed = THREE.MathUtils.lerp(w.minSpeed, w.maxSpeed, previewPower);
    const vel = dir.multiplyScalar(speed);
    const pos = p0.clone();

    let hitShown = false;
    for (let i = 0; i < this.aimDots.length; i++) {
      const dt = 0.068;
      vel.x += this.wind.x * w.windFactor * dt;
      vel.z += this.wind.y * w.windFactor * dt;
      vel.y -= 20.0 * w.gravityScale * dt;
      pos.addScaledVector(vel, dt);

      if (!hitShown && this.terrain.sampleDensity(pos.x, pos.y, pos.z) > 0) {
        const n = this.terrain.sampleNormal(pos.x, pos.y, pos.z);
        this.impactMarker.position.copy(pos).addScaledVector(n, 0.16);
        this.impactMarker.lookAt(this.impactMarker.position.clone().add(n));
        this.impactMarker.visible = true;
        hitShown = true;
      }

      this.aimDots[i].position.copy(pos);
      this.aimDots[i].visible = !hitShown;
    }

    if (!hitShown) {
      this.impactMarker.visible = false;
    }
  }

  private hideAimDots(): void {
    for (const d of this.aimDots) d.visible = false;
    this.impactMarker.visible = false;
  }

  private updateCamera(dt: number): void {
    let desiredTarget = this.camTarget.clone();

    if (this.freeCam) {
      desiredTarget.copy(this.freeCamCenter);
    } else if (this.projectiles.length > 0) {
      desiredTarget.copy(this.projectiles[0].position);
    } else if (this.activeSoldier && this.activeSoldier.alive) {
      desiredTarget.copy(this.activeSoldier.position).add(new THREE.Vector3(0, 1.7, 0));
    }

    this.camTarget.lerp(desiredTarget, Math.min(1, dt * 6.5));

    const dist = this.projectiles.length > 0 && !this.freeCam ? Math.max(this.camDist, 23) : this.camDist;
    const horiz = Math.cos(this.camPitch) * dist;
    const camPos = new THREE.Vector3(
      this.camTarget.x + Math.sin(this.camYaw) * horiz,
      this.camTarget.y + Math.sin(this.camPitch) * dist,
      this.camTarget.z + Math.cos(this.camYaw) * horiz
    );

    camPos.y = Math.max(WATER_LEVEL + 1.6, camPos.y);

    if (this.shakeIntensity > 0.01) {
      camPos.x += (Math.random() - 0.5) * this.shakeIntensity;
      camPos.y += (Math.random() - 0.5) * this.shakeIntensity;
      camPos.z += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 2.4);
    }

    this.camera.position.copy(camPos);
    this.camera.lookAt(this.camTarget);
  }

  private updateFloatingTagsAndPopups(dt: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const proj = new THREE.Vector3();

    for (const s of this.soldiers) {
      const el = this.tagElements.get(s.id);
      if (!el) continue;

      if (!s.alive) {
        el.style.display = 'none';
        continue;
      }

      proj.set(s.position.x, s.position.y + 2.45, s.position.z);
      proj.project(this.camera);

      if (proj.z > 1) {
        el.style.display = 'none';
        continue;
      }

      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;
      el.style.display = 'block';
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      el.classList.toggle('active', s === this.activeSoldier);

      const fill = el.querySelector('.soldier-tag-hp-fill') as HTMLElement | null;
      if (fill) {
        fill.style.width = `${(s.hp / s.maxHp) * 100}%`;
      }
    }

    // Update rising cartoon damage popups!
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.age += dt;
      if (pop.age >= pop.maxAge) {
        pop.el.remove();
        this.popups.splice(i, 1);
        continue;
      }
      pop.worldPos.y += dt * 2.2;
      proj.copy(pop.worldPos).project(this.camera);
      if (proj.z > 1) {
        pop.el.style.display = 'none';
        continue;
      }
      const t = pop.age / pop.maxAge;
      pop.el.style.display = 'block';
      pop.el.style.left = `${(proj.x * 0.5 + 0.5) * w}px`;
      pop.el.style.top = `${(-proj.y * 0.5 + 0.5) * h}px`;
      pop.el.style.opacity = String(1 - t * t);
    }
  }

  private emitHud(): void {
    const alliesHp = this.soldiers
      .filter((s) => s.team === 'allies' && s.alive)
      .reduce((sum, s) => sum + s.hp, 0);
    const axisHp = this.soldiers
      .filter((s) => s.team === 'axis' && s.alive)
      .reduce((sum, s) => sum + s.hp, 0);

    this.callbacks.onHudUpdate({
      phase: this.phase,
      team: this.activeTeam,
      soldierName: this.activeSoldier?.name ?? '',
      timer: Math.max(0, Math.ceil(this.phase === 'retreat' ? this.retreatTimer : this.turnTimer)),
      alliesHp,
      axisHp,
      maxTeamHp: this.squadSize * 100,
      windAngle: Math.atan2(this.wind.y, this.wind.x),
      windSpeed: Math.round(this.wind.length() * 10) / 10,
      selectedWeapon: this.selectedWeapon,
      ammo: { ...this.teamAmmo[this.activeTeam] },
      charge: this.phase === 'charging' ? this.charge : 0,
      freeCam: this.freeCam,
      isAiTurn: this.isCurrentTurnAi(),
    });
  }

  private bindEvents(canvas: HTMLCanvasElement): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Bug fix: clear stuck keys/drag when window loses focus
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.draggingOrbit = false;
      if (this.phase === 'charging') {
        this.releaseCharge();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (this.phase === 'menu' || this.phase === 'victory') return;
      this.keys.add(e.code);

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.jumpQueued = true;
      }
      if (e.code === 'KeyC') {
        this.toggleFreeCamera();
      }
      if (e.code.startsWith('Digit')) {
        const idx = parseInt(e.code.replace('Digit', ''), 10) - 1;
        if (idx >= 0 && idx < WEAPONS.length) {
          this.selectWeapon(WEAPONS[idx].id);
        }
      }
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        this.beginCharge();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' && this.phase === 'charging') {
        e.preventDefault();
        this.releaseCharge();
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
      if (this.phase === 'menu' || this.phase === 'victory') return;
      if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
        this.draggingOrbit = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      } else if (e.button === 0) {
        this.beginCharge();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.draggingOrbit) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.camYaw -= dx * 0.0065;
      if (this.freeCam) {
        this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.005, 0.14, 1.35);
      } else {
        this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004, 0.1, 0.98);
        if (this.activeSoldier && (this.phase === 'aiming' || this.phase === 'charging')) {
          this.activeSoldier.aimPitch = THREE.MathUtils.clamp(
            this.activeSoldier.aimPitch - dy * 0.006,
            -0.45,
            1.25
          );
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2 || e.button === 1 || (e.button === 0 && this.draggingOrbit)) {
        this.draggingOrbit = false;
      } else if (e.button === 0 && this.phase === 'charging') {
        this.releaseCharge();
      }
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.phase === 'menu') return;
        this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.018, 9.0, 86);
      },
      { passive: true }
    );
  }

  private beginCharge(): void {
    if (this.phase !== 'aiming' || this.isCurrentTurnAi() || this.freeCam) return;
    const w = getWeaponDef(this.selectedWeapon);
    if (w.isDropCharge) {
      this.fireActiveWeapon(1.0);
      return;
    }
    this.phase = 'charging';
    this.charge = 0.12;
    this.chargeDir = 1;
    this.emitHud();
  }

  private releaseCharge(): void {
    if (this.phase !== 'charging') return;
    this.fireActiveWeapon(this.charge);
  }

  private clearMatchEntities(): void {
    this.propsGroup.clear();
    this.props = [];
    this.soldiersGroup.clear();
    this.soldiers = [];
    this.cratesGroup.clear();
    this.crates = [];
    this.projectilesGroup.clear();
    this.projectiles = [];
    this.pendingNaval = [];
    this.pendingBarrels = [];
    this.effects.clear();
    this.clearTags();
    this.activeSoldier = null;
  }

  private clearTags(): void {
    this.tagsLayer.innerHTML = '';
    this.tagElements.clear();
    this.popups = [];
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    this.terrain.dispose();
    this.renderer.dispose();
  }
}
