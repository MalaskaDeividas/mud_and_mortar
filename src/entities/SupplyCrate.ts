import * as THREE from 'three';
import { TerrainEngine, WATER_LEVEL } from '../terrain/TerrainEngine';
import { WeaponDef } from '../weapons/weapons';
import { addCartoonOutline, createCrateTexture, createToonMaterial } from '../graphics/textures';

let sharedCrateTex: THREE.CanvasTexture | null = null;

/**
 * Classic Worms-style WW2 Parachute Weapon Supply Crate!
 * Floats gently down from the sky under a billowing white/olive canopy,
 * lands cleanly on the sculpted clay terrain, and refills limited WW2 weapons when collected.
 */
export class SupplyCrate {
  readonly weapon: WeaponDef;
  readonly amount: number;
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  private readonly chuteGroup = new THREE.Group();
  private readonly beaconRing: THREE.Mesh;
  private chuteCollapse = 0;

  parachuting = true;
  grounded = false;
  alive = true;
  swayPhase = Math.random() * Math.PI * 2;

  constructor(weapon: WeaponDef, spawnPos: THREE.Vector3) {
    this.weapon = weapon;
    this.amount = Math.max(1, weapon.crateDropAmount);
    this.position.copy(spawnPos);

    if (typeof document !== 'undefined' && !sharedCrateTex) {
      sharedCrateTex = createCrateTexture();
    }

    // Chunky cartoon WW2 wooden weapon crate with golden strap
    const crateMat = createToonMaterial(0xffffff, sharedCrateTex ? { map: sharedCrateTex } : { color: 0x99804a });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 1.15), crateMat);
    box.position.y = 0.48;
    box.castShadow = true;
    box.receiveShadow = true;
    addCartoonOutline(box, 1.07);
    this.group.add(box);

    // Bright gold/amber weapon crate ribbon so it stands out from decorative props!
    const ribbonMat = createToonMaterial(0xffc93c);
    const bandA = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 1.2), ribbonMat);
    bandA.position.y = 0.48;
    this.group.add(bandA);

    // Glowing beacon ring on the ground once landed
    this.beaconRing = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1.08, 22),
      new THREE.MeshBasicMaterial({
        color: 0xffe054,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      })
    );
    this.beaconRing.rotation.x = -Math.PI / 2;
    this.beaconRing.position.y = 0.08;
    this.beaconRing.visible = false;
    this.group.add(this.beaconRing);

    // Billowing Cartoon WW2 Parachute Canopy + 4 Suspension Cords
    const canopyMat = createToonMaterial(0xf7f2e4, { side: THREE.DoubleSide });
    const stripeMat = createToonMaterial(0x527a3d, { side: THREE.DoubleSide });

    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1.75, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
      canopyMat
    );
    canopy.position.y = 3.1;
    canopy.scale.set(1.0, 0.72, 1.0);
    canopy.castShadow = true;
    addCartoonOutline(canopy, 1.04);
    this.chuteGroup.add(canopy);

    // Olive WW2 parachute accent band
    const capBand = new THREE.Mesh(
      new THREE.CylinderGeometry(1.66, 1.76, 0.24, 12, 1, true),
      stripeMat
    );
    capBand.position.y = 3.16;
    this.chuteGroup.add(capBand);

    // 4 Rigging cords from crate top corners up to canopy rim
    const cordMat = new THREE.MeshBasicMaterial({ color: 0xe8e2d0 });
    const corners: Array<[number, number]> = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ];
    for (const [cx, cz] of corners) {
      const start = new THREE.Vector3(cx, 0.92, cz);
      const end = new THREE.Vector3(cx * 2.5, 3.1, cz * 2.5);
      const mid = start.clone().add(end).multiplyScalar(0.5);
      const len = start.distanceTo(end);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 4), cordMat);
      cord.position.copy(mid);
      cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
      this.chuteGroup.add(cord);
    }

    this.group.add(this.chuteGroup);
    this.group.position.copy(this.position);
  }

  update(
    dt: number,
    terrain: TerrainEngine,
    windX: number,
    windZ: number,
    onSplash: (pos: THREE.Vector3) => void
  ): void {
    if (!this.alive) return;

    if (this.parachuting) {
      // Slow gentle parachute descent with slight wind drift & cartoon pendulum sway!
      this.swayPhase += dt * 2.6;
      this.velocity.y = -4.8;
      this.velocity.x = windX * 0.35;
      this.velocity.z = windZ * 0.35;

      const nextY = this.position.y + this.velocity.y * dt;
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;

      // Check landing on clay terrain
      if (terrain.sampleDensity(this.position.x, nextY, this.position.z) > 0) {
        const groundY = terrain.findLocalGroundY(this.position.x, this.position.y, this.position.z, 1.0, 1.5);
        this.position.y = (groundY ?? this.position.y) + 0.02;
        this.velocity.set(0, 0, 0);
        this.parachuting = false;
        this.grounded = true;
        this.group.rotation.set(0, this.group.rotation.y, 0);
        this.beaconRing.visible = true;
      } else {
        this.position.y = nextY;
        this.group.rotation.z = Math.sin(this.swayPhase) * 0.16;
        this.group.rotation.x = Math.cos(this.swayPhase * 0.8) * 0.1;
      }
    } else {
      // Collapse and hide parachute cleanly once landed
      if (this.chuteGroup.visible) {
        this.chuteCollapse += dt * 2.8;
        const s = Math.max(0.01, 1 - this.chuteCollapse);
        this.chuteGroup.scale.set(s, s * 0.7, s);
        this.chuteGroup.position.y -= dt * 1.8;
        if (this.chuteCollapse >= 1) {
          this.chuteGroup.visible = false;
        }
      }

      // Pulse golden pickup ring gently
      const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.1;
      this.beaconRing.scale.setScalar(pulse);

      // Keep crate settled firmly on clay terrain (and drop cleanly if blasted underneath!)
      if (this.grounded) {
        const groundY = terrain.findLocalGroundY(this.position.x, this.position.y, this.position.z, 1.2, 0.45);
        if (groundY !== null) {
          this.position.y = groundY + 0.02;
          this.velocity.y = 0;
        } else {
          this.grounded = false;
        }
      } else {
        this.velocity.y -= 22.0 * dt;
        const nextY = this.position.y + this.velocity.y * dt;
        if (this.velocity.y <= 0 && terrain.sampleDensity(this.position.x, nextY, this.position.z) > 0) {
          const groundY = terrain.findLocalGroundY(this.position.x, this.position.y, this.position.z, 1.2, 1.2);
          this.position.y = (groundY ?? nextY) + 0.02;
          this.velocity.y = 0;
          this.grounded = true;
        } else {
          this.position.y = nextY;
        }
      }
    }

    this.group.position.copy(this.position);

    // Drown crate if it lands or falls into the ocean
    if (this.position.y < WATER_LEVEL - 0.3) {
      onSplash(new THREE.Vector3(this.position.x, WATER_LEVEL, this.position.z));
      this.alive = false;
    }
  }
}
