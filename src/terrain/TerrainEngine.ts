import * as THREE from 'three';
import { fbm3D } from './noise';
import { buildSurfaceNetsChunk, SurfaceNetsPalette } from './surfaceNets';
import { createClayDetailTexture, getSharedToonGradient } from '../graphics/textures';

export interface CraterOptions {
  radius: number;         // World-space blast radius
  rimHeight?: number;     // How much clay bulges upward around the crater rim (0..1)
  scorch?: number;        // Blast char/darkening strength (0..1)
  slumpPasses?: number;   // Mud/clay gravitational slumping iterations (1..3)
  verticalStretch?: number; // >1 digs deeper vertically (e.g. mortar / satchel)
  seed?: number;
}

export interface EjectedMudClod {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  color: THREE.Color;
}

export interface CraterResult {
  removedVoxels: number;
  ejectedClods: EjectedMudClod[];
  affectedChunks: number;
}

export interface RaycastHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

// Bigger WW2 island grid: 112 x 48 x 112 @ 0.85m = 95m x 41m x 95m (~2.3x surface area!)
export const GRID_NX = 112;
export const GRID_NY = 48;
export const GRID_NZ = 112;
export const CHUNK_SIZE = 16; // 7 x 7 = 49 chunks (blasts still only rebuild 1-4 chunks!)
export const VOXEL_SIZE = 0.85;
export const WATER_LEVEL = 6.2; // World Y of ocean surface

export class TerrainEngine {
  readonly nx = GRID_NX;
  readonly ny = GRID_NY;
  readonly nz = GRID_NZ;
  readonly chunkSize = CHUNK_SIZE;
  readonly voxelSize = VOXEL_SIZE;
  readonly waterLevel = WATER_LEVEL;

  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;

  readonly density: Float32Array;
  readonly scorch: Float32Array;
  readonly mudExposed: Float32Array;
  private readonly slumpScratch: Float32Array;

  readonly chunksX: number;
  readonly chunksZ: number;
  readonly group: THREE.Group;
  private readonly chunkMeshes: (THREE.Mesh | null)[];
  private readonly material: THREE.MeshToonMaterial;
  private readonly clayDetailTex: THREE.CanvasTexture | null;
  private palette: SurfaceNetsPalette;

  constructor(palette: SurfaceNetsPalette) {
    this.palette = palette;
    this.originX = -(this.nx - 1) * 0.5 * this.voxelSize;
    this.originY = 0;
    this.originZ = -(this.nz - 1) * 0.5 * this.voxelSize;

    const total = this.nx * this.ny * this.nz;
    this.density = new Float32Array(total);
    this.scorch = new Float32Array(total);
    this.mudExposed = new Float32Array(total);
    this.slumpScratch = new Float32Array(total);

    this.chunksX = Math.ceil(this.nx / this.chunkSize);
    this.chunksZ = Math.ceil(this.nz / this.chunkSize);
    this.chunkMeshes = new Array(this.chunksX * this.chunksZ).fill(null);

    this.group = new THREE.Group();
    this.group.name = 'DestructibleClayIsland';

    this.clayDetailTex = typeof document !== 'undefined' ? createClayDetailTexture() : null;

    // Cartoony cel-shaded sculpted clay material with seamless triplanar brushstroke texture!
    this.material = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: getSharedToonGradient(),
    });

    if (this.clayDetailTex) {
      const detailTex = this.clayDetailTex;
      this.material.onBeforeCompile = (shader) => {
        shader.uniforms.uClayTex = { value: detailTex };
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
             varying vec3 vWorldPosClay;
             varying vec3 vWorldNormClay;`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vWorldPosClay = (modelMatrix * vec4(transformed, 1.0)).xyz;
             vWorldNormClay = normalize(mat3(modelMatrix) * objectNormal);`
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
             uniform sampler2D uClayTex;
             varying vec3 vWorldPosClay;
             varying vec3 vWorldNormClay;`
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             vec3 triBlend = pow(abs(vWorldNormClay), vec3(4.0));
             triBlend /= max(triBlend.x + triBlend.y + triBlend.z, 0.001);
             float s = 0.14;
             vec3 tx = texture2D(uClayTex, vWorldPosClay.zy * s).rgb;
             vec3 ty = texture2D(uClayTex, vWorldPosClay.xz * s).rgb;
             vec3 tz = texture2D(uClayTex, vWorldPosClay.xy * s).rgb;
             vec3 clayGrain = tx * triBlend.x + ty * triBlend.y + tz * triBlend.z;
             diffuseColor.rgb *= mix(vec3(0.84), vec3(1.14), clayGrain);`
          );
      };
      this.material.customProgramCacheKey = () => 'toon-clay-triplanar-v1';
    }
  }

  setPalette(palette: SurfaceNetsPalette): void {
    this.palette = palette;
  }

  getPalette(): SurfaceNetsPalette {
    return this.palette;
  }

  idx(x: number, y: number, z: number): number {
    return x + y * this.nx + z * this.nx * this.ny;
  }

  worldToGrid(wx: number, wy: number, wz: number): [number, number, number] {
    return [
      (wx - this.originX) / this.voxelSize,
      (wy - this.originY) / this.voxelSize,
      (wz - this.originZ) / this.voxelSize,
    ];
  }

  gridToWorld(gx: number, gy: number, gz: number): THREE.Vector3 {
    return new THREE.Vector3(
      this.originX + gx * this.voxelSize,
      this.originY + gy * this.voxelSize,
      this.originZ + gz * this.voxelSize
    );
  }

  /**
   * Populate the 3D scalar field from a map generator function.
   * Positive return = solid clay/earth, Negative = air/water.
   */
  generate(
    fieldFn: (wx: number, wy: number, wz: number) => { density: number; mud?: number; scorch?: number }
  ): void {
    for (let z = 0; z < this.nz; z++) {
      const wz = this.originZ + z * this.voxelSize;
      for (let y = 0; y < this.ny; y++) {
        const wy = this.originY + y * this.voxelSize;
        for (let x = 0; x < this.nx; x++) {
          const wx = this.originX + x * this.voxelSize;
          const i = this.idx(x, y, z);

          // Force clean water/air boundary around the entire outer edge so every map is a true island!
          if (x <= 1 || x >= this.nx - 2 || z <= 1 || z >= this.nz - 2 || y >= this.ny - 2) {
            this.density[i] = -6.0;
            this.scorch[i] = 0;
            this.mudExposed[i] = 0;
            continue;
          }
          if (y === 0) {
            this.density[i] = -3.0;
            this.scorch[i] = 0;
            this.mudExposed[i] = 0;
            continue;
          }

          const res = fieldFn(wx, wy, wz);
          this.density[i] = Math.max(-8, Math.min(8, res.density));
          this.mudExposed[i] = res.mud ?? 0;
          this.scorch[i] = res.scorch ?? 0;
        }
      }
    }

    this.rebuildAllChunks();
  }

  /**
   * Trilinearly sample the smooth SDF density at any world position.
   * > 0 means inside solid clay/mud; <= 0 means air/water.
   */
  sampleDensity(wx: number, wy: number, wz: number): number {
    const gx = (wx - this.originX) / this.voxelSize;
    const gy = (wy - this.originY) / this.voxelSize;
    const gz = (wz - this.originZ) / this.voxelSize;

    if (gx < 0 || gy < 0 || gz < 0 || gx >= this.nx - 1 || gy >= this.ny - 1 || gz >= this.nz - 1) {
      return -5.0;
    }

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const z0 = Math.floor(gz);
    const tx = gx - x0;
    const ty = gy - y0;
    const tz = gz - z0;

    const c000 = this.density[this.idx(x0, y0, z0)];
    const c100 = this.density[this.idx(x0 + 1, y0, z0)];
    const c010 = this.density[this.idx(x0, y0 + 1, z0)];
    const c110 = this.density[this.idx(x0 + 1, y0 + 1, z0)];
    const c001 = this.density[this.idx(x0, y0, z0 + 1)];
    const c101 = this.density[this.idx(x0 + 1, y0, z0 + 1)];
    const c011 = this.density[this.idx(x0, y0 + 1, z0 + 1)];
    const c111 = this.density[this.idx(x0 + 1, y0 + 1, z0 + 1)];

    const x00 = c000 + (c100 - c000) * tx;
    const x10 = c010 + (c110 - c010) * tx;
    const x01 = c001 + (c101 - c001) * tx;
    const x11 = c011 + (c111 - c011) * tx;
    const y0v = x00 + (x10 - x00) * ty;
    const y1v = x01 + (x11 - x01) * ty;
    return y0v + (y1v - y0v) * tz;
  }

  sampleNormal(wx: number, wy: number, wz: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.voxelSize * 0.55;
    const dx = this.sampleDensity(wx + e, wy, wz) - this.sampleDensity(wx - e, wy, wz);
    const dy = this.sampleDensity(wx, wy + e, wz) - this.sampleDensity(wx, wy - e, wz);
    const dz = this.sampleDensity(wx, wy, wz + e) - this.sampleDensity(wx, wy, wz - e);
    out.set(-dx, -dy, -dz);
    if (out.lengthSq() > 1e-6) {
      out.normalize();
    } else {
      out.set(0, 1, 0);
    }
    return out;
  }

  /**
   * Find highest solid surface Y at (wx, wz), or null if only ocean/air.
   */
  getSurfaceHeight(wx: number, wz: number, maxY?: number): number | null {
    const topY = maxY ?? this.originY + (this.ny - 3) * this.voxelSize;
    const step = this.voxelSize * 0.45;
    let prevY = topY;
    let prevD = this.sampleDensity(wx, prevY, wz);

    for (let y = topY - step; y >= this.originY + this.voxelSize; y -= step) {
      const d = this.sampleDensity(wx, y, wz);
      if (d > 0 && prevD <= 0) {
        const t = prevD / (prevD - d);
        return prevY + (y - prevY) * t;
      }
      prevY = y;
      prevD = d;
    }
    return null;
  }

  /**
   * Find exact continuous solid-to-air floor Y near a reference height (sub-millimeter bisection).
   * Respects caves/overhangs by searching within [refY - searchDown, refY + searchUp].
   * If refY + searchUp is still buried inside solid clay (e.g. a newly raised crater rim),
   * continues scanning upward until emerging into open air.
   */
  findLocalGroundY(
    wx: number,
    refY: number,
    wz: number,
    searchUp = 1.25,
    searchDown = 0.65
  ): number | null {
    const maxWorldY = this.originY + (this.ny - 3) * this.voxelSize;
    const minWorldY = this.originY + this.voxelSize;
    const step = 0.16;

    // 1. If the top of our local search window is buried inside solid clay, climb out into air first
    let topY = Math.min(maxWorldY, refY + searchUp);
    if (this.sampleDensity(wx, topY, wz) > 0) {
      let y = topY;
      while (y < maxWorldY && this.sampleDensity(wx, y, wz) > 0) {
        y += step;
      }
      if (y >= maxWorldY) return null;
      // Bisect exact surface between (y - step) [solid] and y [air]
      let lo = y - step;
      let hi = y;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) * 0.5;
        if (this.sampleDensity(wx, mid, wz) > 0) lo = mid;
        else hi = mid;
      }
      return hi;
    }

    // 2. Scan downward from topY (guaranteed air) down to bottomY to find the exact floor crossing
    const bottomY = Math.max(minWorldY, refY - searchDown);
    let prevY = topY;
    for (let y = topY - step; y >= bottomY - 1e-4; y -= step) {
      const clampedY = Math.max(bottomY, y);
      if (this.sampleDensity(wx, clampedY, wz) > 0) {
        let lo = clampedY; // solid
        let hi = prevY;    // air
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) * 0.5;
          if (this.sampleDensity(wx, mid, wz) > 0) lo = mid;
          else hi = mid;
        }
        return hi;
      }
      prevY = clampedY;
    }

    return null;
  }

  /**
   * Raymarch against the smooth 3D clay SDF for precise projectile hits & line-of-sight.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RaycastHit | null {
    const step = this.voxelSize * 0.36;
    let prevDist = 0;
    let prevD = this.sampleDensity(origin.x, origin.y, origin.z);
    const p = new THREE.Vector3();

    for (let dist = step; dist <= maxDist; dist += step) {
      p.copy(origin).addScaledVector(dir, dist);
      const d = this.sampleDensity(p.x, p.y, p.z);
      if (d > 0 && prevD <= 0) {
        let lo = prevDist;
        let hi = dist;
        for (let k = 0; k < 5; k++) {
          const mid = (lo + hi) * 0.5;
          p.copy(origin).addScaledVector(dir, mid);
          if (this.sampleDensity(p.x, p.y, p.z) > 0) {
            hi = mid;
          } else {
            lo = mid;
          }
        }
        const hitDist = (lo + hi) * 0.5;
        const hitPoint = origin.clone().addScaledVector(dir, hitDist);
        const normal = this.sampleNormal(hitPoint.x, hitPoint.y, hitPoint.z);
        return { point: hitPoint, normal, distance: hitDist };
      }
      prevDist = dist;
      prevD = d;
    }
    return null;
  }

  /**
   * Core Clay & Mud Deformation Physics!
   * 1. Carves an organic sculpted crater out of the 3D scalar field
   * 2. Pushes displaced soft clay outward & slightly upward into a raised muddy crater rim
   * 3. Exposes rich brown clay/wet mud & applies explosion scorch
   * 4. Runs a local clay/mud gravitational slumping pass to soften overhangs & collapse loose spikes
   * 5. Spawns physical 3D mud clods from actually excavated volume!
   */
  carveCrater(center: THREE.Vector3, opts: CraterOptions): CraterResult {
    const radius = Math.max(0.9, opts.radius);
    const rimHeight = opts.rimHeight ?? 0.62;
    const scorchPower = opts.scorch ?? 0.85;
    const slumpPasses = opts.slumpPasses ?? 2;
    const verticalStretch = opts.verticalStretch ?? 1.08;
    const seed = opts.seed ?? Math.floor((center.x * 31 + center.y * 17 + center.z * 53) * 100);

    const outerR = radius * 1.65;
    const [cgx, cgy, cgz] = this.worldToGrid(center.x, center.y, center.z);
    const rVoxels = Math.ceil(outerR / this.voxelSize) + 2;

    const minX = Math.max(2, Math.floor(cgx - rVoxels));
    const maxX = Math.min(this.nx - 3, Math.ceil(cgx + rVoxels));
    const minY = Math.max(1, Math.floor(cgy - rVoxels * verticalStretch));
    const maxY = Math.min(this.ny - 3, Math.ceil(cgy + rVoxels * verticalStretch));
    const minZ = Math.max(2, Math.floor(cgz - rVoxels));
    const maxZ = Math.min(this.nz - 3, Math.ceil(cgz + rVoxels));

    let removedVoxels = 0;
    const excavatedSamples: THREE.Vector3[] = [];

    for (let z = minZ; z <= maxZ; z++) {
      const wz = this.originZ + z * this.voxelSize;
      const dz = wz - center.z;
      for (let y = minY; y <= maxY; y++) {
        const wy = this.originY + y * this.voxelSize;
        const dy = (wy - center.y) / verticalStretch;
        for (let x = minX; x <= maxX; x++) {
          const wx = this.originX + x * this.voxelSize;
          const dx = wx - center.x;

          const rawDist = Math.hypot(dx, dy, dz);
          if (rawDist > outerR) continue;

          const lump = fbm3D(wx * 0.38, wy * 0.38, wz * 0.38, seed, 2) * (radius * 0.2);
          const dist = rawDist + lump;
          const i = this.idx(x, y, z);
          const oldD = this.density[i];

          if (dist < radius) {
            const carveVal = ((dist - radius) / this.voxelSize) * 1.38;
            const newD = Math.min(oldD, carveVal);
            if (oldD > 0 && newD <= 0) {
              removedVoxels++;
              if (excavatedSamples.length < 52 && ((x + y * 3 + z * 7) & 3) === 0) {
                excavatedSamples.push(new THREE.Vector3(wx, wy, wz));
              }
            }
            this.density[i] = Math.max(-8, newD);

            const coreT = 1 - dist / radius;
            this.mudExposed[i] = Math.min(1, Math.max(this.mudExposed[i], 0.72 + coreT * 0.28));
            this.scorch[i] = Math.min(1, Math.max(this.scorch[i], scorchPower * (0.42 + coreT * 0.58)));
          } else if (dist < radius * 1.54) {
            const bandT = (dist - radius) / (radius * 0.54);
            const rimBell = Math.sin(bandT * Math.PI);
            const nearSurface = Math.max(0, 1 - Math.abs(oldD) / 2.2);
            const upwardBias = wy >= center.y - radius * 0.35 ? 1.0 : 0.3;

            if (rimHeight > 0 && nearSurface > 0 && oldD > -1.4) {
              const bulge = rimBell * rimHeight * nearSurface * upwardBias * 1.05;
              this.density[i] = Math.min(8, oldD + bulge);
            }

            this.mudExposed[i] = Math.min(1, Math.max(this.mudExposed[i], rimBell * 0.95));
            this.scorch[i] = Math.min(1, Math.max(this.scorch[i], rimBell * scorchPower * 0.38));
          }
        }
      }
    }

    // Localized Clay / Mud Gravitational Slumping & Spike Relaxation
    const sMinX = Math.max(2, minX - 1);
    const sMaxX = Math.min(this.nx - 3, maxX + 1);
    const sMinY = Math.max(2, minY - 1);
    const sMaxY = Math.min(this.ny - 3, maxY + 1);
    const sMinZ = Math.max(2, minZ - 1);
    const sMaxZ = Math.min(this.nz - 3, maxZ + 1);

    for (let pass = 0; pass < slumpPasses; pass++) {
      for (let z = sMinZ - 1; z <= sMaxZ + 1; z++) {
        for (let y = sMinY - 1; y <= sMaxY + 1; y++) {
          for (let x = sMinX - 1; x <= sMaxX + 1; x++) {
            const i = this.idx(x, y, z);
            this.slumpScratch[i] = this.density[i];
          }
        }
      }

      for (let z = sMinZ; z <= sMaxZ; z++) {
        for (let y = sMinY; y <= sMaxY; y++) {
          for (let x = sMinX; x <= sMaxX; x++) {
            const i = this.idx(x, y, z);
            const c = this.slumpScratch[i];
            const below = this.slumpScratch[this.idx(x, y - 1, z)];
            const above = this.slumpScratch[this.idx(x, y + 1, z)];
            const nXm = this.slumpScratch[this.idx(x - 1, y, z)];
            const nXp = this.slumpScratch[this.idx(x + 1, y, z)];
            const nZm = this.slumpScratch[this.idx(x, y, z - 1)];
            const nZp = this.slumpScratch[this.idx(x, y, z + 1)];

            const horizAvg = (nXm + nXp + nZm + nZp) * 0.25;
            const fullAvg = (horizAvg * 4 + below + above) / 6;

            let solidNeighbors = 0;
            if (below > 0) solidNeighbors++;
            if (above > 0) solidNeighbors++;
            if (nXm > 0) solidNeighbors++;
            if (nXp > 0) solidNeighbors++;
            if (nZm > 0) solidNeighbors++;
            if (nZp > 0) solidNeighbors++;

            let nextD = c;
            if (c > 0 && solidNeighbors <= 1) {
              nextD = -0.75;
              removedVoxels++;
              if (excavatedSamples.length < 60) {
                excavatedSamples.push(this.gridToWorld(x, y, z));
              }
            } else {
              nextD = c + (fullAvg - c) * 0.24;
              if (c > 0 && below < 0 && above < 0.8) {
                nextD -= 0.22;
              } else if (c < 0 && above > 0.25 && this.mudExposed[i] > 0.3) {
                nextD += 0.08;
              }
            }

            this.density[i] = Math.max(-8, Math.min(8, nextD));
          }
        }
      }
    }

    const affectedChunks = this.rebuildChunksInGridBounds(sMinX - 2, sMaxX + 2, sMinZ - 2, sMaxZ + 2);

    const ejectedClods: EjectedMudClod[] = [];
    const maxClods = Math.min(30, Math.max(10, Math.floor(radius * 5.2)));
    const clayColorA = new THREE.Color(...this.palette.midClayColor);
    const clayColorB = new THREE.Color(...this.palette.deepMudColor);
    const scorchCol = new THREE.Color(...this.palette.scorchColor);

    const clodCount = Math.min(maxClods, Math.max(excavatedSamples.length, removedVoxels > 0 ? 10 : 0));
    for (let k = 0; k < clodCount; k++) {
      const sample =
        excavatedSamples.length > 0
          ? excavatedSamples[k % excavatedSamples.length]
          : center.clone().add(
              new THREE.Vector3(
                (Math.random() - 0.5) * radius * 0.8,
                Math.random() * radius * 0.4,
                (Math.random() - 0.5) * radius * 0.8
              )
            );

      const dir = sample.clone().sub(center);
      if (dir.lengthSq() < 0.05) {
        dir.set(Math.random() - 0.5, 0.8, Math.random() - 0.5);
      }
      dir.normalize();
      dir.y = Math.max(0.45, dir.y + 0.58);
      dir.normalize();

      const speed = (7.5 + Math.random() * 11.5) * Math.min(1.5, 0.78 + radius * 0.13);
      const col = clayColorA.clone().lerp(clayColorB, Math.random());
      if (Math.random() < 0.3) col.lerp(scorchCol, 0.45);

      ejectedClods.push({
        position: sample.clone().add(new THREE.Vector3(0, 0.28, 0)),
        velocity: dir.multiplyScalar(speed),
        radius: 0.2 + Math.random() * 0.28 * Math.min(1.4, radius * 0.26),
        color: col,
      });
    }

    return {
      removedVoxels,
      ejectedClods,
      affectedChunks,
    };
  }

  depositMudSplat(point: THREE.Vector3, radius = 0.65): void {
    const [cgx, cgy, cgz] = this.worldToGrid(point.x, point.y, point.z);
    const rV = Math.ceil(radius / this.voxelSize) + 1;
    const minX = Math.max(2, Math.floor(cgx - rV));
    const maxX = Math.min(this.nx - 3, Math.ceil(cgx + rV));
    const minY = Math.max(1, Math.floor(cgy - rV));
    const maxY = Math.min(this.ny - 3, Math.ceil(cgy + rV));
    const minZ = Math.max(2, Math.floor(cgz - rV));
    const maxZ = Math.min(this.nz - 3, Math.ceil(cgz + rV));

    let changed = false;
    for (let z = minZ; z <= maxZ; z++) {
      const wz = this.originZ + z * this.voxelSize;
      for (let y = minY; y <= maxY; y++) {
        const wy = this.originY + y * this.voxelSize;
        for (let x = minX; x <= maxX; x++) {
          const wx = this.originX + x * this.voxelSize;
          const d = Math.hypot(wx - point.x, wy - point.y, wz - point.z);
          if (d < radius) {
            const i = this.idx(x, y, z);
            const t = 1 - d / radius;
            this.density[i] = Math.min(8, this.density[i] + t * 0.35);
            this.mudExposed[i] = Math.min(1, Math.max(this.mudExposed[i], t * 0.95));
            changed = true;
          }
        }
      }
    }
    if (changed) {
      this.rebuildChunksInGridBounds(minX - 1, maxX + 1, minZ - 1, maxZ + 1);
    }
  }

  rebuildAllChunks(): void {
    for (let cz = 0; cz < this.chunksZ; cz++) {
      for (let cx = 0; cx < this.chunksX; cx++) {
        this.rebuildChunk(cx, cz);
      }
    }
  }

  private rebuildChunksInGridBounds(minX: number, maxX: number, minZ: number, maxZ: number): number {
    const cMinX = Math.max(0, Math.floor(minX / this.chunkSize));
    const cMaxX = Math.min(this.chunksX - 1, Math.floor(maxX / this.chunkSize));
    const cMinZ = Math.max(0, Math.floor(minZ / this.chunkSize));
    const cMaxZ = Math.min(this.chunksZ - 1, Math.floor(maxZ / this.chunkSize));

    let count = 0;
    for (let cz = cMinZ; cz <= cMaxZ; cz++) {
      for (let cx = cMinX; cx <= cMaxX; cx++) {
        this.rebuildChunk(cx, cz);
        count++;
      }
    }
    return count;
  }

  private rebuildChunk(cx: number, cz: number): void {
    const slot = cx + cz * this.chunksX;
    const oldMesh = this.chunkMeshes[slot];
    if (oldMesh) {
      this.group.remove(oldMesh);
      oldMesh.geometry.dispose();
      this.chunkMeshes[slot] = null;
    }

    const xStart = cx * this.chunkSize;
    const xEnd = Math.min(this.nx, (cx + 1) * this.chunkSize);
    const zStart = cz * this.chunkSize;
    const zEnd = Math.min(this.nz, (cz + 1) * this.chunkSize);

    const meshData = buildSurfaceNetsChunk({
      density: this.density,
      scorch: this.scorch,
      mudExposed: this.mudExposed,
      nx: this.nx,
      ny: this.ny,
      nz: this.nz,
      xStart,
      xEnd,
      zStart,
      zEnd,
      voxelSize: this.voxelSize,
      originX: this.originX,
      originY: this.originY,
      originZ: this.originZ,
      waterLevelWorld: this.waterLevel,
      palette: this.palette,
    });

    if (meshData.indices.length === 0) return;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(meshData.colors, 3));
    geom.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geom.computeBoundingSphere();

    const mesh = new THREE.Mesh(geom, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.chunkMeshes[slot] = mesh;
  }

  dispose(): void {
    for (let i = 0; i < this.chunkMeshes.length; i++) {
      const m = this.chunkMeshes[i];
      if (m) {
        this.group.remove(m);
        m.geometry.dispose();
        this.chunkMeshes[i] = null;
      }
    }
    this.material.dispose();
    this.clayDetailTex?.dispose();
  }
}
