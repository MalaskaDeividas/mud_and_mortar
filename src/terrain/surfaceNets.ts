// Watertight Chunked Surface Nets Mesher for Smooth Sculpted Clay/Mud 3D Terrain
// Positive density (> 0) = solid mud/clay, Negative/zero density (<= 0) = air.

export interface SurfaceNetsPalette {
  topColor: [number, number, number];
  midClayColor: [number, number, number];
  deepMudColor: [number, number, number];
  wetShoreColor: [number, number, number];
  scorchColor: [number, number, number];
  rockSlopeColor: [number, number, number];
}

export interface ChunkMeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

const CUBE_CORNERS: ReadonlyArray<[number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

const CUBE_EDGES: ReadonlyArray<[number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7], // X edges
  [0, 2], [1, 3], [4, 6], [5, 7], // Y edges
  [0, 4], [1, 5], [2, 6], [3, 7], // Z edges
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp3(
  out: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
  t: number
): void {
  const k = clamp01(t);
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
}

export interface SurfaceNetsParams {
  density: Float32Array;
  scorch: Float32Array;
  mudExposed: Float32Array;
  nx: number;
  ny: number;
  nz: number;
  xStart: number;
  xEnd: number; // exclusive grid-edge ownership range
  zStart: number;
  zEnd: number;
  voxelSize: number;
  originX: number;
  originY: number;
  originZ: number;
  waterLevelWorld: number;
  palette: SurfaceNetsPalette;
}

/**
 * Generates a seamless chunk of a Surface Nets mesh.
 * Each chunk owns grid edges in x in [xStart, xEnd), y in [1, ny - 1), z in [zStart, zEnd).
 * To emit quads for those edges, we compute cell vertices in [xStart - 1, xEnd) x [0, ny - 1) x [zStart - 1, zEnd).
 */
export function buildSurfaceNetsChunk(params: SurfaceNetsParams): ChunkMeshData {
  const {
    density,
    scorch,
    mudExposed,
    nx,
    ny,
    nz,
    xStart,
    xEnd,
    zStart,
    zEnd,
    voxelSize,
    originX,
    originY,
    originZ,
    waterLevelWorld,
    palette,
  } = params;

  const strideY = nx;
  const strideZ = nx * ny;
  const idx = (x: number, y: number, z: number) => x + y * strideY + z * strideZ;

  // Cell range needed to support all owned edges
  const cxMin = Math.max(0, xStart - 1);
  const cxMax = Math.min(nx - 2, xEnd - 1);
  const cyMin = 0;
  const cyMax = ny - 2;
  const czMin = Math.max(0, zStart - 1);
  const czMax = Math.min(nz - 2, zEnd - 1);

  const cellSpanX = cxMax - cxMin + 1;
  const cellSpanY = cyMax - cyMin + 1;
  const cellSpanZ = czMax - czMin + 1;

  if (cellSpanX <= 0 || cellSpanY <= 0 || cellSpanZ <= 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint32Array(0),
    };
  }

  const cellToVert = new Int32Array(cellSpanX * cellSpanY * cellSpanZ);
  cellToVert.fill(-1);

  const localCellIdx = (cx: number, cy: number, cz: number) =>
    (cx - cxMin) + (cy - cyMin) * cellSpanX + (cz - czMin) * cellSpanX * cellSpanY;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const cornerVals = new Float32Array(8);
  const tmpCol: [number, number, number] = [0, 0, 0];

  const sampleFieldTrilinear = (field: Float32Array, gx: number, gy: number, gz: number): number => {
    const x0 = Math.max(0, Math.min(nx - 2, Math.floor(gx)));
    const y0 = Math.max(0, Math.min(ny - 2, Math.floor(gy)));
    const z0 = Math.max(0, Math.min(nz - 2, Math.floor(gz)));
    const tx = clamp01(gx - x0);
    const ty = clamp01(gy - y0);
    const tz = clamp01(gz - z0);

    const c000 = field[idx(x0, y0, z0)];
    const c100 = field[idx(x0 + 1, y0, z0)];
    const c010 = field[idx(x0, y0 + 1, z0)];
    const c110 = field[idx(x0 + 1, y0 + 1, z0)];
    const c001 = field[idx(x0, y0, z0 + 1)];
    const c101 = field[idx(x0 + 1, y0, z0 + 1)];
    const c011 = field[idx(x0, y0 + 1, z0 + 1)];
    const c111 = field[idx(x0 + 1, y0 + 1, z0 + 1)];

    const x00 = c000 + (c100 - c000) * tx;
    const x10 = c010 + (c110 - c010) * tx;
    const x01 = c001 + (c101 - c001) * tx;
    const x11 = c011 + (c111 - c011) * tx;
    const y0v = x00 + (x10 - x00) * ty;
    const y1v = x01 + (x11 - x01) * ty;
    return y0v + (y1v - y0v) * tz;
  };

  // Pass 1: Compute one smooth clay surface vertex per sign-changing cell
  for (let cz = czMin; cz <= czMax; cz++) {
    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [ox, oy, oz] = CUBE_CORNERS[c];
          const v = density[idx(cx + ox, cy + oy, cz + oz)];
          cornerVals[c] = v;
          if (v > 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;

        for (let e = 0; e < 12; e++) {
          const [a, b] = CUBE_EDGES[e];
          const va = cornerVals[a];
          const vb = cornerVals[b];
          if ((va > 0) !== (vb > 0)) {
            const denom = va - vb;
            const t = Math.abs(denom) > 1e-6 ? clamp01(va / denom) : 0.5;
            const ca = CUBE_CORNERS[a];
            const cb = CUBE_CORNERS[b];
            sx += ca[0] + (cb[0] - ca[0]) * t;
            sy += ca[1] + (cb[1] - ca[1]) * t;
            sz += ca[2] + (cb[2] - ca[2]) * t;
            crossings++;
          }
        }

        if (crossings === 0) continue;

        const inv = 1 / crossings;
        const gx = cx + sx * inv;
        const gy = cy + sy * inv;
        const gz = cz + sz * inv;

        const wx = originX + gx * voxelSize;
        const wy = originY + gy * voxelSize;
        const wz = originZ + gz * voxelSize;

        // Smooth analytical gradient normal from SDF (outward = -grad density)
        const eps = 0.6;
        const dx =
          sampleFieldTrilinear(density, gx + eps, gy, gz) -
          sampleFieldTrilinear(density, gx - eps, gy, gz);
        const dy =
          sampleFieldTrilinear(density, gx, gy + eps, gz) -
          sampleFieldTrilinear(density, gx, gy - eps, gz);
        const dz =
          sampleFieldTrilinear(density, gx, gy, gz + eps) -
          sampleFieldTrilinear(density, gx, gy, gz - eps);

        let nmx = -dx;
        let nmy = -dy;
        let nmz = -dz;
        const len = Math.hypot(nmx, nmy, nmz);
        if (len > 1e-5) {
          nmx /= len;
          nmy /= len;
          nmz /= len;
        } else {
          nmx = 0;
          nmy = 1;
          nmz = 0;
        }

        // Clay / mud layered material shading
        const sc = clamp01(sampleFieldTrilinear(scorch, gx, gy, gz));
        const mud = clamp01(sampleFieldTrilinear(mudExposed, gx, gy, gz));

        // Base material transitions from slope/cliff clay -> lush top turf
        const slopeTop = clamp01((nmy - 0.42) / 0.38);
        lerp3(tmpCol, palette.rockSlopeColor, palette.topColor, slopeTop);

        // Exposed clay/mud from blasting or crater rims overrides turf cleanly
        const clayMix = clamp01(mud * 1.15);
        lerp3(tmpCol, tmpCol, palette.midClayColor, clayMix);

        // Deeper interior / overhang clay gets darker wet mud tone
        const overhang = clamp01((-nmy + 0.15) * 0.9);
        lerp3(tmpCol, tmpCol, palette.deepMudColor, overhang * 0.55 + clayMix * 0.25);

        // Wet shoreline darkening near/below water level
        const aboveWater = wy - waterLevelWorld;
        if (aboveWater < 1.8) {
          const shoreT = clamp01(1 - (aboveWater + 0.6) / 2.4);
          lerp3(tmpCol, tmpCol, palette.wetShoreColor, shoreT * 0.82);
        }

        // Blast scorch char in explosion core
        if (sc > 0.02) {
          lerp3(tmpCol, tmpCol, palette.scorchColor, clamp01(sc * 0.88));
        }

        // Subtle organic clay mottling variation so surfaces feel tactile
        const mottle =
          Math.sin(wx * 0.9 + wz * 0.7) * Math.cos(wy * 1.1 - wz * 0.5) * 0.035;

        const vIdx = positions.length / 3;
        positions.push(wx, wy, wz);
        normals.push(nmx, nmy, nmz);
        colors.push(
          clamp01(tmpCol[0] + mottle),
          clamp01(tmpCol[1] + mottle * 0.9),
          clamp01(tmpCol[2] + mottle * 0.8)
        );
        cellToVert[localCellIdx(cx, cy, cz)] = vIdx;
      }
    }
  }

  const emitQuad = (v0: number, v1: number, v2: number, v3: number, flip: boolean) => {
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
    if (!flip) {
      indices.push(v0, v1, v2, v0, v2, v3);
    } else {
      indices.push(v0, v3, v2, v0, v2, v1);
    }
  };

  // Pass 2: Emit quads for every sign-changing edge owned by this chunk
  const exMin = Math.max(1, xStart);
  const exMax = Math.min(nx - 2, xEnd - 1);
  const ezMin = Math.max(1, zStart);
  const ezMax = Math.min(nz - 2, zEnd - 1);

  // Also include edge at x=xStart when xStart == 0 (for X edges only we need y>=1,z>=1)
  const xLoopMin = Math.max(0, xStart);
  const xLoopMax = Math.min(nx - 2, xEnd - 1);
  const zLoopMin = Math.max(0, zStart);
  const zLoopMax = Math.min(nz - 2, zEnd - 1);

  for (let z = zLoopMin; z <= zLoopMax; z++) {
    for (let y = 0; y <= ny - 2; y++) {
      for (let x = xLoopMin; x <= xLoopMax; x++) {
        const d0 = density[idx(x, y, z)] > 0;

        // X-edge: (x,y,z) -> (x+1,y,z), shared by 4 cells around y-1/y and z-1/z
        if (y >= 1 && z >= 1) {
          const dxSolid = density[idx(x + 1, y, z)] > 0;
          if (d0 !== dxSolid) {
            const v0 = cellToVert[localCellIdx(x, y - 1, z - 1)];
            const v1 = cellToVert[localCellIdx(x, y, z - 1)];
            const v2 = cellToVert[localCellIdx(x, y, z)];
            const v3 = cellToVert[localCellIdx(x, y - 1, z)];
            // If d0 is solid (+X is outward): (v0->v1=+Y, v0->v3=+Z, +Y x +Z = +X) -> CCW is (v0,v1,v2,v3)
            emitQuad(v0, v1, v2, v3, !d0);
          }
        }

        // Y-edge: (x,y,z) -> (x,y+1,z), shared by 4 cells around x-1/x and z-1/z
        if (x >= exMin && x <= exMax && z >= ezMin && z <= ezMax) {
          const dySolid = density[idx(x, y + 1, z)] > 0;
          if (d0 !== dySolid) {
            const v0 = cellToVert[localCellIdx(x - 1, y, z - 1)];
            const v1 = cellToVert[localCellIdx(x - 1, y, z)];
            const v2 = cellToVert[localCellIdx(x, y, z)];
            const v3 = cellToVert[localCellIdx(x, y, z - 1)];
            // If d0 is solid (+Y is outward): (v0->v1=+Z, v0->v3=+X, +Z x +X = +Y) -> CCW is (v0,v1,v2,v3)
            emitQuad(v0, v1, v2, v3, !d0);
          }
        }

        // Z-edge: (x,y,z) -> (x,y,z+1), shared by 4 cells around x-1/x and y-1/y
        if (x >= exMin && x <= exMax && y >= 1) {
          const dzSolid = density[idx(x, y, z + 1)] > 0;
          if (d0 !== dzSolid) {
            const v0 = cellToVert[localCellIdx(x - 1, y - 1, z)];
            const v1 = cellToVert[localCellIdx(x, y - 1, z)];
            const v2 = cellToVert[localCellIdx(x, y, z)];
            const v3 = cellToVert[localCellIdx(x - 1, y, z)];
            // If d0 is solid (+Z is outward): (v0->v1=+X, v0->v3=+Y, +X x +Y = +Z) -> CCW is (v0,v1,v2,v3)
            emitQuad(v0, v1, v2, v3, !d0);
          }
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
