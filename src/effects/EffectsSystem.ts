import * as THREE from 'three';
import { EjectedMudClod, TerrainEngine, WATER_LEVEL } from '../terrain/TerrainEngine';
import { sound } from '../audio/sound';
import { addCartoonOutline, createToonMaterial } from '../graphics/textures';

interface MudClodActor {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  radius: number;
  bouncesLeft: number;
  life: number;
  canDeposit: boolean;
}

interface PuffParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  startScale: number;
  endScale: number;
  gravity: number;
}

interface ShockRing {
  mesh: THREE.Mesh;
  age: number;
  maxAge: number;
  maxRadius: number;
}

export class EffectsSystem {
  readonly group = new THREE.Group();
  private mudClods: MudClodActor[] = [];
  private puffs: PuffParticle[] = [];
  private rings: ShockRing[] = [];
  private readonly clodGeom = new THREE.DodecahedronGeometry(1, 0);
  private readonly puffGeom = new THREE.SphereGeometry(0.48, 8, 7);
  private readonly ringGeom = new THREE.RingGeometry(0.72, 1.0, 26);
  private splatCooldown = 0;

  constructor(scene: THREE.Scene) {
    this.ringGeom.rotateX(-Math.PI / 2);
    scene.add(this.group);
  }

  spawnMudClods(clods: EjectedMudClod[]): void {
    clods.forEach((c, idx) => {
      const mat = createToonMaterial(c.color.getHex());
      const mesh = new THREE.Mesh(this.clodGeom, mat);
      mesh.scale.set(
        c.radius * (0.85 + Math.random() * 0.45),
        c.radius * (0.72 + Math.random() * 0.45),
        c.radius * (0.85 + Math.random() * 0.45)
      );
      mesh.position.copy(c.position);
      mesh.castShadow = true;
      addCartoonOutline(mesh, 1.14);
      this.group.add(mesh);

      this.mudClods.push({
        mesh,
        position: c.position.clone(),
        velocity: c.velocity.clone(),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10
        ),
        radius: c.radius,
        bouncesLeft: 1,
        life: 4.8,
        canDeposit: idx < 4 && c.radius > 0.28,
      });
    });
  }

  spawnExplosion(center: THREE.Vector3, radius: number): void {
    // Bright comic-book flash core + puffy cartoon blast clouds
    const fireCount = Math.min(22, Math.max(10, Math.floor(radius * 3.8)));
    for (let i = 0; i < fireCount; i++) {
      const tier = i / fireCount;
      const color =
        tier < 0.2
          ? 0xfff8c4
          : tier < 0.52
          ? Math.random() < 0.5
            ? 0xffb82e
            : 0xff5a1f
          : 0x453d36;
      const hot = tier < 0.52;

      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: hot ? 0.95 : 0.78,
      });
      const mesh = new THREE.Mesh(this.puffGeom, mat);
      mesh.position.copy(center).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * radius * 0.55,
          Math.random() * radius * 0.4,
          (Math.random() - 0.5) * radius * 0.55
        )
      );
      this.group.add(mesh);

      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        0.55 + Math.random() * 1.4,
        (Math.random() - 0.5) * 2
      ).normalize();

      this.puffs.push({
        mesh,
        velocity: dir.multiplyScalar((hot ? 5.2 : 3.0) * (0.5 + Math.random() * 0.85)),
        age: 0,
        maxAge: hot ? 0.45 + Math.random() * 0.25 : 1.15 + Math.random() * 0.65,
        startScale: radius * (hot ? 0.4 : 0.32),
        endScale: radius * (hot ? 1.05 : 1.55),
        gravity: hot ? -2.4 : -1.6,
      });
    }

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd24d,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(this.ringGeom, ringMat);
    ringMesh.position.set(center.x, center.y + 0.3, center.z);
    this.group.add(ringMesh);
    this.rings.push({
      mesh: ringMesh,
      age: 0,
      maxAge: 0.44,
      maxRadius: radius * 1.55,
    });
  }

  spawnSmokeTrail(pos: THREE.Vector3, colorHex = 0xf2eee4, size = 0.3): void {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.65,
    });
    const mesh = new THREE.Mesh(this.puffGeom, mat);
    mesh.position.copy(pos);
    this.group.add(mesh);
    this.puffs.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.9, (Math.random() - 0.5) * 0.5),
      age: 0,
      maxAge: 0.55,
      startScale: size,
      endScale: size * 2.5,
      gravity: -0.7,
    });
  }

  spawnWaterSplash(pos: THREE.Vector3, scale = 1.0): void {
    sound.playSplash();
    const drops = Math.floor(12 * scale);
    for (let i = 0; i < drops; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.Mesh(this.puffGeom, mat);
      mesh.position.set(pos.x, WATER_LEVEL + 0.2, pos.z);
      this.group.add(mesh);

      const ang = (i / drops) * Math.PI * 2 + Math.random() * 0.3;
      const spd = (2.4 + Math.random() * 4.0) * scale;
      this.puffs.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(ang) * spd,
          (5.5 + Math.random() * 5.0) * scale,
          Math.sin(ang) * spd
        ),
        age: 0,
        maxAge: 0.78,
        startScale: 0.38 * scale,
        endScale: 0.14 * scale,
        gravity: 16.5,
      });
    }

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(this.ringGeom, ringMat);
    ringMesh.position.set(pos.x, WATER_LEVEL + 0.1, pos.z);
    this.group.add(ringMesh);
    this.rings.push({
      mesh: ringMesh,
      age: 0,
      maxAge: 0.75,
      maxRadius: 4.2 * scale,
    });
  }

  update(dt: number, terrain: TerrainEngine): void {
    if (this.splatCooldown > 0) this.splatCooldown -= dt;

    for (let i = this.mudClods.length - 1; i >= 0; i--) {
      const c = this.mudClods[i];
      c.life -= dt;
      c.velocity.y -= 22.0 * dt;
      c.position.addScaledVector(c.velocity, dt);
      c.mesh.position.copy(c.position);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;

      if (c.position.y < WATER_LEVEL) {
        if (c.radius > 0.25 && this.splatCooldown <= 0) {
          this.spawnWaterSplash(c.position, 0.5);
          this.splatCooldown = 0.08;
        }
        this.removeClod(i);
        continue;
      }

      if (c.life < 4.65 && terrain.sampleDensity(c.position.x, c.position.y, c.position.z) > 0) {
        if (c.canDeposit) {
          terrain.depositMudSplat(c.position, c.radius * 2.2);
          c.canDeposit = false;
        }
        if (this.splatCooldown <= 0) {
          sound.playMudSplat();
          this.splatCooldown = 0.06;
        }
        if (c.bouncesLeft > 0 && c.velocity.length() > 3.5) {
          const n = terrain.sampleNormal(c.position.x, c.position.y, c.position.z);
          c.position.addScaledVector(n, 0.28);
          c.velocity.reflect(n).multiplyScalar(0.32);
          c.mesh.scale.y *= 0.7;
          c.bouncesLeft--;
        } else {
          this.spawnSmokeTrail(c.position, 0x6b4528, 0.3);
          this.removeClod(i);
          continue;
        }
      }

      if (c.life <= 0) {
        this.removeClod(i);
      }
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.group.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      const t = p.age / p.maxAge;
      p.velocity.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      const s = THREE.MathUtils.lerp(p.startScale, p.endScale, t);
      p.mesh.scale.setScalar(s);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age >= r.maxAge) {
        this.group.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const t = r.age / r.maxAge;
      r.mesh.scale.setScalar(0.4 + t * r.maxRadius);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
    }
  }

  private removeClod(index: number): void {
    const c = this.mudClods[index];
    this.group.remove(c.mesh);
    (c.mesh.material as THREE.Material).dispose();
    c.mesh.children.forEach((child) => {
      const m = child as THREE.Mesh;
      if (m.material) (m.material as THREE.Material).dispose();
    });
    this.mudClods.splice(index, 1);
  }

  clear(): void {
    while (this.mudClods.length > 0) this.removeClod(0);
    for (const p of this.puffs) {
      this.group.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.puffs = [];
    for (const r of this.rings) {
      this.group.remove(r.mesh);
      (r.mesh.material as THREE.Material).dispose();
    }
    this.rings = [];
  }
}
