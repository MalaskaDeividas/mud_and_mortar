import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TerrainEngine, WATER_LEVEL } from '../src/terrain/TerrainEngine';
import { WW2_ISLANDS } from '../src/maps/ww2Islands';
import { buildSurfaceNetsChunk } from '../src/terrain/surfaceNets';

describe('3D Clay/Mud Terrain & Bigger WW2 Islands', () => {
  it('generates every bigger WW2 map as a true island completely surrounded by ocean water', () => {
    for (const map of WW2_ISLANDS) {
      const terrain = new TerrainEngine(map.palette);
      terrain.generate(map.field);

      // Bigger island must have substantial land above water spanning far across the grid
      let landAboveWater = 0;
      for (let x = -28; x <= 28; x += 4) {
        for (let z = -24; z <= 24; z += 4) {
          const h = terrain.getSurfaceHeight(x, z);
          if (h !== null && h > WATER_LEVEL + 1.0) landAboveWater++;
        }
      }
      expect(landAboveWater).toBeGreaterThan(24);

      // Entire outer perimeter around the bigger grid must be strictly below water / air
      const edgeCoord = (terrain.nx - 3) * 0.5 * terrain.voxelSize;
      for (let t = -edgeCoord; t <= edgeCoord; t += 5) {
        expect(terrain.sampleDensity(edgeCoord, WATER_LEVEL + 0.5, t)).toBeLessThan(0);
        expect(terrain.sampleDensity(-edgeCoord, WATER_LEVEL + 0.5, t)).toBeLessThan(0);
        expect(terrain.sampleDensity(t, WATER_LEVEL + 0.5, edgeCoord)).toBeLessThan(0);
        expect(terrain.sampleDensity(t, WATER_LEVEL + 0.5, -edgeCoord)).toBeLessThan(0);
      }

      terrain.dispose();
    }
  });

  it('produces outward-facing Surface Nets triangles matching SDF normals', () => {
    const map = WW2_ISLANDS[0];
    const terrain = new TerrainEngine(map.palette);
    terrain.generate(map.field);

    const chunk = buildSurfaceNetsChunk({
      density: terrain.density,
      scorch: terrain.scorch,
      mudExposed: terrain.mudExposed,
      nx: terrain.nx,
      ny: terrain.ny,
      nz: terrain.nz,
      xStart: 32,
      xEnd: 48,
      zStart: 32,
      zEnd: 48,
      voxelSize: terrain.voxelSize,
      originX: terrain.originX,
      originY: terrain.originY,
      originZ: terrain.originZ,
      waterLevelWorld: terrain.waterLevel,
      palette: map.palette,
    });

    expect(chunk.indices.length).toBeGreaterThan(100);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const triN = new THREE.Vector3();
    const vN = new THREE.Vector3();

    let aligned = 0;
    let total = 0;
    for (let i = 0; i < chunk.indices.length; i += 3) {
      const i0 = chunk.indices[i];
      const i1 = chunk.indices[i + 1];
      const i2 = chunk.indices[i + 2];

      a.fromArray(chunk.positions, i0 * 3);
      b.fromArray(chunk.positions, i1 * 3);
      c.fromArray(chunk.positions, i2 * 3);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      triN.crossVectors(ab, ac);
      if (triN.lengthSq() < 1e-8) continue;
      triN.normalize();

      vN.fromArray(chunk.normals, i0 * 3);
      if (triN.dot(vN) > 0) aligned++;
      total++;
    }

    expect(total).toBeGreaterThan(50);
    expect(aligned / total).toBeGreaterThan(0.95);
    terrain.dispose();
  });

  it('carves smooth clay/mud craters, ejects mud clods, and lowers surface elevation', () => {
    const map = WW2_ISLANDS[0];
    const terrain = new TerrainEngine(map.palette);
    terrain.generate(map.field);

    const hitX = -17;
    const hitZ = 3;
    const beforeY = terrain.getSurfaceHeight(hitX, hitZ);
    expect(beforeY).not.toBeNull();

    const blastPoint = new THREE.Vector3(hitX, beforeY!, hitZ);
    const result = terrain.carveCrater(blastPoint, {
      radius: 4.6,
      rimHeight: 0.72,
      slumpPasses: 2,
      scorch: 0.9,
    });

    expect(result.removedVoxels).toBeGreaterThan(30);
    expect(result.ejectedClods.length).toBeGreaterThanOrEqual(10);
    expect(result.affectedChunks).toBeGreaterThanOrEqual(1);

    expect(terrain.sampleDensity(hitX, beforeY! - 1.5, hitZ)).toBeLessThan(0);

    const afterY = terrain.getSurfaceHeight(hitX, hitZ);
    expect(afterY === null || afterY < beforeY! - 2.0).toBe(true);

    const splatPt = new THREE.Vector3(hitX + 7, beforeY!, hitZ);
    const beforeSplat = terrain.sampleDensity(splatPt.x, splatPt.y, splatPt.z);
    terrain.depositMudSplat(splatPt, 1.0);
    const afterSplat = terrain.sampleDensity(splatPt.x, splatPt.y, splatPt.z);
    expect(afterSplat).toBeGreaterThan(beforeSplat);

    terrain.dispose();
  });
});
