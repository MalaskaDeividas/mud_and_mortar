import * as THREE from 'three';
import { TerrainEngine, WATER_LEVEL } from '../terrain/TerrainEngine';
import { addCartoonOutline, createToonMaterial } from '../graphics/textures';

export type TeamId = 'allies' | 'axis';
export type WeaponVisualStyle = 'bazooka' | 'mortar' | 'grenade' | 'drill' | 'satchel' | 'flare';

export const ALLIED_NAMES = ['Pvt. Miller', 'Cpl. Baker', 'Sgt. Kowalski', 'Pvt. Davies'];
export const AXIS_NAMES = ['Schtz. Weber', 'Gefr. Klein', 'Uffz. Brandt', 'Schtz. Vogel'];

export class Soldier {
  readonly id: string;
  readonly team: TeamId;
  readonly name: string;

  readonly group = new THREE.Group();
  private readonly bodyPivot = new THREE.Group();
  private readonly weaponPivot = new THREE.Group();
  private readonly leftLeg: THREE.Group;
  private readonly rightLeg: THREE.Group;
  private readonly leftArm: THREE.Group;
  private readonly rightArm: THREE.Group;
  private readonly activeRing: THREE.Mesh;
  private readonly weaponMeshes: Record<WeaponVisualStyle, THREE.Group>;

  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  aimPitch = 0.3; // radians above horizontal

  hp = 100;
  readonly maxHp = 100;
  alive = true;
  drowned = false;
  grounded = false;
  walkPhase = 0;
  knockbackTimer = 0;

  readonly radius = 0.52;
  readonly height = 1.85;

  constructor(id: string, team: TeamId, name: string, spawnPos: THREE.Vector3) {
    this.id = id;
    this.team = team;
    this.name = name;
    this.position.copy(spawnPos);

    const isAllies = team === 'allies';
    // Bright, unmistakable cartoon WW2 palette
    const uniformMat = createToonMaterial(isAllies ? 0x6b8f42 : 0x627382);
    const collarMat = createToonMaterial(isAllies ? 0xa18e5d : 0xc94238);
    const pantsMat = createToonMaterial(isAllies ? 0x8f7d4f : 0x47525c);
    const helmetMat = createToonMaterial(isAllies ? 0x4b6e2f : 0x3b444d);
    const skinMat = createToonMaterial(0xf7c59f);
    const cheekMat = new THREE.MeshBasicMaterial({ color: 0xeb8d7c });
    const bootMat = createToonMaterial(isAllies ? 0x4d3320 : 0x222426);
    const packMat = createToonMaterial(isAllies ? 0xa38c56 : 0x575952);
    const metalMat = createToonMaterial(0x3a4042);
    const hazardMat = createToonMaterial(0xf2be38);
    const redMat = createToonMaterial(0xd93c2b);

    // Chunky cartoon Legs with boots
    const makeLeg = (x: number) => {
      const legGroup = new THREE.Group();
      legGroup.position.set(x, 0.52, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.32, 4, 8), pantsMat);
      leg.position.y = -0.18;
      leg.castShadow = true;
      addCartoonOutline(leg, 1.1);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.4), bootMat);
      boot.position.set(0, -0.42, 0.07);
      boot.castShadow = true;
      addCartoonOutline(boot, 1.08);
      legGroup.add(leg, boot);
      return legGroup;
    };

    this.leftLeg = makeLeg(-0.2);
    this.rightLeg = makeLeg(0.2);
    this.bodyPivot.add(this.leftLeg, this.rightLeg);

    // Chunky Heroic Cartoon Torso (rounded barrel chest)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.31, 0.72, 10), uniformMat);
    torso.position.y = 0.94;
    torso.castShadow = true;
    torso.receiveShadow = true;
    addCartoonOutline(torso, 1.07);
    this.bodyPivot.add(torso);

    // Collar / Scarf accent
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.075, 6, 12), collarMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.28;
    this.bodyPivot.add(collar);

    // Belt + Brass Buckle
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 10), bootMat);
    belt.position.y = 0.66;
    this.bodyPivot.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.08), hazardMat);
    buckle.position.set(0, 0.66, 0.33);
    this.bodyPivot.add(buckle);

    // Detailed WW2 Backpack (Allied canvas pack + bedroll vs Axis pack + gas mask canister)
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.26), packMat);
    pack.position.set(0, 0.96, -0.34);
    pack.castShadow = true;
    addCartoonOutline(pack, 1.07);
    this.bodyPivot.add(pack);

    if (isAllies) {
      const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.56, 8), collarMat);
      bedroll.rotation.z = Math.PI / 2;
      bedroll.position.set(0, 1.24, -0.34);
      addCartoonOutline(bedroll, 1.1);
      this.bodyPivot.add(bedroll);
    } else {
      const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.44, 8), metalMat);
      canister.rotation.z = 0.45;
      canister.position.set(0, 0.68, -0.38);
      addCartoonOutline(canister, 1.1);
      this.bodyPivot.add(canister);
    }

    // Oversized Expressive Cartoon Head
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.56;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), skinMat);
    head.castShadow = true;
    addCartoonOutline(head, 1.07);
    headGroup.add(head);

    // Cute cartoon nose & rosy cheeks
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), skinMat);
    nose.position.set(0, -0.02, 0.33);
    headGroup.add(nose);

    const cheekL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), cheekMat);
    cheekL.position.set(-0.18, -0.06, 0.28);
    cheekL.scale.set(1.2, 0.7, 0.5);
    const cheekR = cheekL.clone();
    cheekR.position.x = 0.18;
    headGroup.add(cheekL, cheekR);

    // Big expressive cartoon white eyes + black pupils + determined eyebrows!
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x151515 });
    const browMat = new THREE.MeshBasicMaterial({ color: 0x3b291a });

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), whiteMat);
      eye.position.set(side * 0.125, 0.05, 0.28);
      eye.scale.set(0.95, 1.15, 0.6);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.044, 6, 6), pupilMat);
      pupil.position.set(side * 0.125, 0.05, 0.33);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.045, 0.05), browMat);
      brow.position.set(side * 0.13, 0.15, 0.31);
      brow.rotation.z = side * -0.24; // determined WW2 cartoon scowl!
      headGroup.add(eye, pupil, brow);
    }

    // Iconic Cartoon WW2 Helmet
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
      helmetMat
    );
    dome.position.y = 0.05;
    dome.castShadow = true;
    addCartoonOutline(dome, 1.06);
    headGroup.add(dome);

    if (isAllies) {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.07, 12), helmetMat);
      brim.position.y = 0.06;
      addCartoonOutline(brim, 1.05);
      // White Allied Star on front of helmet!
      const star = new THREE.Mesh(new THREE.CircleGeometry(0.09, 5), whiteMat);
      star.position.set(0, 0.22, 0.37);
      star.rotation.x = -0.35;
      headGroup.add(brim, star);
    } else {
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 0.22, 12), helmetMat);
      skirt.position.set(0, 0.0, -0.05);
      addCartoonOutline(skirt, 1.05);
      // Red/White insignia stripe & cartoon goggles strap
      const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.405, 0.405, 0.06, 12), bootMat);
      strap.position.y = 0.12;
      const goggleL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8), hazardMat);
      goggleL.rotation.x = Math.PI / 2;
      goggleL.position.set(-0.11, 0.14, 0.38);
      const goggleR = goggleL.clone();
      goggleR.position.x = 0.11;
      headGroup.add(skirt, strap, goggleL, goggleR);
    }

    this.bodyPivot.add(headGroup);

    // Articulated Cartoon Arms
    const makeArm = (x: number) => {
      const armGroup = new THREE.Group();
      armGroup.position.set(x, 1.16, 0);
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 4, 8), uniformMat);
      sleeve.position.y = -0.18;
      sleeve.castShadow = true;
      addCartoonOutline(sleeve, 1.1);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), skinMat);
      hand.position.y = -0.38;
      addCartoonOutline(hand, 1.1);
      armGroup.add(sleeve, hand);
      return armGroup;
    };

    this.leftArm = makeArm(-0.44);
    this.rightArm = makeArm(0.44);
    this.rightArm.rotation.x = -0.85; // Holding weapon forward!
    this.bodyPivot.add(this.leftArm, this.rightArm);

    // Weapon Pivot (shoulder height, pitches with aimPitch)
    this.weaponPivot.position.set(0.4, 1.12, 0.15);
    this.bodyPivot.add(this.weaponPivot);

    // Build all 6 detailed cartoon WW2 weapons!
    this.weaponMeshes = {
      bazooka: this.buildBazookaMesh(metalMat, hazardMat, redMat),
      mortar: this.buildMortarMesh(metalMat, hazardMat, redMat),
      grenade: this.buildGrenadeMesh(isAllies, helmetMat, bootMat, redMat),
      drill: this.buildDrillMesh(metalMat, hazardMat),
      satchel: this.buildSatchelMesh(redMat, hazardMat, bootMat),
      flare: this.buildFlareMesh(hazardMat, bootMat, redMat),
    };

    for (const key of Object.keys(this.weaponMeshes) as WeaponVisualStyle[]) {
      this.weaponMeshes[key].visible = key === 'bazooka';
      this.weaponPivot.add(this.weaponMeshes[key]);
    }

    this.group.add(this.bodyPivot);

    // Active soldier selection ring on the ground
    this.activeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.64, 0.86, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffd147,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
      })
    );
    this.activeRing.rotation.x = -Math.PI / 2;
    this.activeRing.position.y = 0.08;
    this.activeRing.visible = false;
    this.group.add(this.activeRing);

    this.group.position.copy(this.position);
  }

  private buildBazookaMesh(metal: THREE.Material, yellow: THREE.Material, red: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.55, 10), metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = 0.16;
    tube.castShadow = true;
    addCartoonOutline(tube, 1.1);

    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.116, 0.116, 0.22, 10), yellow);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.z = 0.56;

    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.11, 0.24, 10), metal);
    bell.rotation.x = Math.PI / 2;
    bell.position.z = -0.6;
    addCartoonOutline(bell, 1.1);

    const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 8), red);
    warhead.rotation.x = Math.PI / 2;
    warhead.position.z = 1.02;
    addCartoonOutline(warhead, 1.1);

    g.add(tube, stripe, bell, warhead);
    return g;
  }

  private buildMortarMesh(metal: THREE.Material, brass: THREE.Material, red: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 1.1, 10), metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = 0.34;
    addCartoonOutline(tube, 1.09);

    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 10), brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = 0.8;

    const shellTip = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), red);
    shellTip.position.z = 0.92;
    g.add(tube, ring, shellTip);
    return g;
  }

  private buildGrenadeMesh(
    isAllies: boolean,
    green: THREE.Material,
    wood: THREE.Material,
    red: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();
    if (isAllies) {
      const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), green);
      body.position.set(0, 0.05, 0.36);
      addCartoonOutline(body, 1.14);
      const pin = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 6, 10), red);
      pin.position.set(0, 0.22, 0.36);
      g.add(body, pin);
    } else {
      // Iconic WW2 German Stick Grenade (Stielhandgranate)
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.38, 8), wood);
      handle.position.set(0, 0, 0.36);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 8), green);
      head.position.set(0, 0.25, 0.36);
      addCartoonOutline(head, 1.12);
      g.add(handle, head);
    }
    return g;
  }

  private buildDrillMesh(metal: THREE.Material, yellow: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.15, 10), metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = 0.2;
    addCartoonOutline(tube, 1.1);

    const auger = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 8), yellow);
    auger.rotation.x = Math.PI / 2;
    auger.position.z = 1.02;
    addCartoonOutline(auger, 1.1);
    g.add(tube, auger);
    return g;
  }

  private buildSatchelMesh(red: THREE.Material, yellow: THREE.Material, dark: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    for (let i = -1; i <= 1; i++) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.38, 8), red);
      stick.position.set(i * 0.1, 0.05, 0.36);
      addCartoonOutline(stick, 1.14);
      g.add(stick);
    }
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.16), dark);
    strap.position.set(0, 0.05, 0.36);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), yellow);
    spark.position.set(0, 0.28, 0.36);
    g.add(strap, spark);
    return g;
  }

  private buildFlareMesh(brass: THREE.Material, wood: THREE.Material, red: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.11), wood);
    grip.position.set(0, -0.06, 0.28);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 8), brass);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, 0.42);
    addCartoonOutline(barrel, 1.12);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 6), red);
    tip.position.set(0, 0.05, 0.66);
    g.add(grip, barrel, tip);
    return g;
  }

  setActiveHighlight(active: boolean): void {
    this.activeRing.visible = active && this.alive;
  }

  setDisplayedWeapon(style: WeaponVisualStyle): void {
    for (const key of Object.keys(this.weaponMeshes) as WeaponVisualStyle[]) {
      this.weaponMeshes[key].visible = key === style;
    }
  }

  getMuzzlePosition(terrain?: TerrainEngine): THREE.Vector3 {
    const dir = this.getAimDirection();
    const shoulder = new THREE.Vector3(this.position.x, this.position.y + 1.22, this.position.z);
    const muzzle = shoulder.clone().addScaledVector(dir, 1.05);
    // Bug fix: never spawn a shell inside a clay cliff directly touching the soldier's nose!
    if (terrain && terrain.sampleDensity(muzzle.x, muzzle.y, muzzle.z) > 0) {
      return shoulder.clone().addScaledVector(dir, 0.32);
    }
    return muzzle;
  }

  getAimDirection(): THREE.Vector3 {
    const cosP = Math.cos(this.aimPitch);
    return new THREE.Vector3(
      Math.sin(this.yaw) * cosP,
      Math.sin(this.aimPitch),
      Math.cos(this.yaw) * cosP
    ).normalize();
  }

  applyDamage(amount: number, impulse: THREE.Vector3): void {
    if (!this.alive) return;
    this.hp = Math.max(0, Math.round(this.hp - amount));
    this.velocity.add(impulse);
    this.grounded = false;
    this.knockbackTimer = Math.max(this.knockbackTimer, 0.85);

    if (this.hp <= 0) {
      this.kill(false);
    }
  }

  kill(drowned: boolean): void {
    if (!this.alive) return;
    this.alive = false;
    this.drowned = drowned;
    this.hp = 0;
    this.activeRing.visible = false;

    if (drowned) {
      this.group.visible = false;
    } else {
      // Stylized cartoon WW2 helmet-on-rifle battlefield memorial
      this.bodyPivot.clear();
      const wood = createToonMaterial(0x7d5533);
      const metal = createToonMaterial(0x3f4647);
      const helmColor = this.team === 'allies' ? 0x4b6e2f : 0x3b444d;
      const helmMat = createToonMaterial(helmColor);

      const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.15, 0.12), wood);
      rifle.position.y = 0.56;
      rifle.rotation.z = 0.08;
      addCartoonOutline(rifle, 1.12);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.65, 6), metal);
      barrel.position.y = 0.22;
      const helm = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.56),
        helmMat
      );
      helm.position.set(0.05, 1.08, 0);
      helm.rotation.z = -0.24;
      addCartoonOutline(helm, 1.08);
      this.bodyPivot.add(rifle, barrel, helm);
    }
  }

  updatePhysics(
    dt: number,
    terrain: TerrainEngine,
    moveInput: { forward: number; right: number; jump: boolean },
    onSplash: (pos: THREE.Vector3) => void
  ): void {
    if (!this.alive && this.drowned) return;

    const footOffset = 0.03; // Keeps boot soles crisp on sculpted Surface Nets peaks without floating
    const gravity = 23.5;
    const isMoving = Math.abs(moveInput.forward) > 0.01 || Math.abs(moveInput.right) > 0.01;

    if (this.knockbackTimer > 0) {
      this.knockbackTimer = Math.max(0, this.knockbackTimer - dt);
    }

    // --- 1. Compute desired horizontal velocity ---
    if (this.alive && this.knockbackTimer <= 0) {
      const speed = this.grounded ? 6.9 : 3.8;
      const fwdX = Math.sin(this.yaw);
      const fwdZ = Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      const wishX = (fwdX * moveInput.forward - rightX * moveInput.right) * speed;
      const wishZ = (fwdZ * moveInput.forward - rightZ * moveInput.right) * speed;

      if (this.grounded) {
        this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, wishX, Math.min(1, dt * 15));
        this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, wishZ, Math.min(1, dt * 15));
        if (moveInput.jump) {
          this.velocity.y = 10.6;
          this.grounded = false;
        }
      } else {
        this.velocity.x += wishX * dt * 1.6;
        this.velocity.z += wishZ * dt * 1.6;
      }
    } else if (this.grounded) {
      this.velocity.x *= Math.max(0, 1 - dt * 8);
      this.velocity.z *= Math.max(0, 1 - dt * 8);
      if (Math.hypot(this.velocity.x, this.velocity.z) < 0.04) {
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
    }

    // --- 2. Grounded vs Airborne Exact SDF Movement (Zero Bounce, Zero Sinking!) ---
    if (this.grounded) {
      const nextX = this.position.x + this.velocity.x * dt;
      const nextZ = this.position.z + this.velocity.z * dt;

      // Query exact continuous clay surface right at (nextX, nextZ)
      const groundY = terrain.findLocalGroundY(nextX, this.position.y, nextZ, 1.15, 0.55);

      if (groundY !== null) {
        const deltaY = groundY - this.position.y;
        // Block walking straight into sheer vertical cliffs or low cave walls
        const headBlocked =
          terrain.sampleDensity(nextX, groundY + 1.15, nextZ) > 0 ||
          terrain.sampleDensity(nextX, groundY + 1.65, nextZ) > 0;

        if (deltaY > 1.05 || headBlocked) {
          // Blocked horizontally: stay at current X/Z and re-lock cleanly to exact local ground
          this.velocity.x = 0;
          this.velocity.z = 0;
          const stayGround = terrain.findLocalGroundY(this.position.x, this.position.y, this.position.z, 1.4, 0.55);
          if (stayGround !== null) {
            this.position.y = stayGround + footOffset;
            this.velocity.y = 0;
          } else {
            this.grounded = false;
          }
        } else {
          // Smoothly track exact sculpted clay surface with zero oscillation!
          this.position.x = nextX;
          this.position.z = nextZ;
          this.position.y = groundY + footOffset;
          this.velocity.y = 0;
        }
      } else {
        // Walked off a cliff edge or terrain beneath got blasted away -> enter free-fall cleanly!
        this.position.x = nextX;
        this.position.z = nextZ;
        this.grounded = false;
      }
    } else {
      // Airborne / Jumping / Knockback Tumble: sub-step so soldiers NEVER tunnel into clay!
      this.velocity.y -= gravity * dt;
      const stepDist = this.velocity.length() * dt;
      const subSteps = Math.max(1, Math.min(8, Math.ceil(stepDist / 0.22)));
      const subDt = dt / subSteps;

      for (let s = 0; s < subSteps; s++) {
        const prevY = this.position.y;
        const candX = this.position.x + this.velocity.x * subDt;
        const candY = this.position.y + this.velocity.y * subDt;
        const candZ = this.position.z + this.velocity.z * subDt;

        // Side wall collision in midair
        if (terrain.sampleDensity(candX, candY + 0.9, candZ) > 0) {
          const n = terrain.sampleNormal(candX, candY + 0.9, candZ);
          this.velocity.x = n.x * Math.abs(this.velocity.x) * 0.25;
          this.velocity.z = n.z * Math.abs(this.velocity.z) * 0.25;
        } else {
          this.position.x = candX;
          this.position.z = candZ;
        }

        // Ceiling collision (e.g. jumping inside sea caves)
        if (this.velocity.y > 0 && terrain.sampleDensity(this.position.x, candY + this.height, this.position.z) > 0) {
          this.velocity.y = 0;
          continue;
        }

        // Exact landing detection when moving downward into solid clay
        if (this.velocity.y <= 0 && terrain.sampleDensity(this.position.x, candY, this.position.z) > 0) {
          // Bisect exact landing Y between candY (solid) and prevY (air)
          let lo = candY;
          let hi = Math.max(prevY, candY + 0.25);
          // Ensure hi is in air
          let guard = 0;
          while (terrain.sampleDensity(this.position.x, hi, this.position.z) > 0 && guard < 16) {
            hi += 0.2;
            guard++;
          }
          for (let k = 0; k < 8; k++) {
            const mid = (lo + hi) * 0.5;
            if (terrain.sampleDensity(this.position.x, mid, this.position.z) > 0) lo = mid;
            else hi = mid;
          }

          this.position.y = hi + footOffset;
          if (this.velocity.y < -19 && this.alive) {
            const fallDmg = Math.min(25, Math.floor((-this.velocity.y - 18) * 2.5));
            if (fallDmg > 0) {
              this.hp = Math.max(0, this.hp - fallDmg);
              if (this.hp <= 0) this.kill(false);
            }
          }
          this.velocity.y = 0;
          this.grounded = true;
          break;
        }

        this.position.y = candY;
      }
    }

    this.group.position.copy(this.position);

    // Check ocean drowning!
    if (this.position.y < WATER_LEVEL - 0.35) {
      if (this.alive) {
        onSplash(new THREE.Vector3(this.position.x, WATER_LEVEL, this.position.z));
        this.kill(true);
      } else {
        this.drowned = true;
        this.group.visible = false;
      }
      return;
    }

    // Expressive cartoon animations
    this.group.rotation.y = this.yaw;
    this.weaponPivot.rotation.x = -this.aimPitch;

    if (this.alive) {
      if (!this.grounded && this.knockbackTimer <= 0) {
        this.leftArm.rotation.x = -2.4;
        this.leftLeg.rotation.x = 0.4;
        this.rightLeg.rotation.x = -0.3;
      } else if (isMoving && this.grounded) {
        this.walkPhase += dt * 13;
        this.leftLeg.rotation.x = Math.sin(this.walkPhase) * 0.65;
        this.rightLeg.rotation.x = -Math.sin(this.walkPhase) * 0.65;
        this.leftArm.rotation.x = -Math.sin(this.walkPhase) * 0.55;
        this.bodyPivot.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.1;
        this.bodyPivot.rotation.z = Math.sin(this.walkPhase) * 0.06;
      } else {
        this.leftLeg.rotation.x *= 0.8;
        this.rightLeg.rotation.x *= 0.8;
        this.leftArm.rotation.x *= 0.8;
        this.bodyPivot.rotation.z *= 0.8;
        // Subtle idle torso breathing ONLY (keeps boots firmly planted on the ground!)
        this.bodyPivot.position.y = 0;
      }

      if (this.knockbackTimer > 0 && !this.grounded) {
        this.bodyPivot.rotation.x += dt * 7;
        this.leftArm.rotation.x = -2.6;
      } else {
        this.bodyPivot.rotation.x *= 0.8;
      }
    }
  }
}
