import * as THREE from 'three';
import { fbm2D, fbm3D, createSeededRng } from '../terrain/noise';
import { SurfaceNetsPalette } from '../terrain/surfaceNets';
import { TerrainEngine, WATER_LEVEL } from '../terrain/TerrainEngine';
import {
  addCartoonOutline,
  createBurlapTexture,
  createConcreteTexture,
  createCrateTexture,
  createFuelBarrelTexture,
  createToonMaterial,
} from '../graphics/textures';

export type IslandMapId = 'normandy' | 'pacific' | 'fjord';

export interface IslandMapDefinition {
  id: IslandMapId;
  name: string;
  subtitle: string;
  skyColor: number;
  fogColor: number;
  sunColor: number;
  ambientColor: number;
  waterColor: number;
  deepWaterColor: number;
  palette: SurfaceNetsPalette;
  seed: number;
  field: (wx: number, wy: number, wz: number) => { density: number; mud?: number; scorch?: number };
  spawnZones: {
    allies: Array<[number, number]>;
    axis: Array<[number, number]>;
  };
  propTheme: 'normandy' | 'pacific' | 'fjord';
}

export interface DestructibleProp {
  mesh: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  falling: boolean;
  radius: number;
  alive: boolean;
  explosive?: boolean;
  spinChild?: THREE.Object3D;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export const WW2_ISLANDS: IslandMapDefinition[] = [
  {
    id: 'normandy',
    name: 'Pointe du Hoc',
    subtitle: 'Big Normandy clay bluffs, tank ridge, trenches & bunkers',
    skyColor: 0x4ca3de,
    fogColor: 0xc5e4f5,
    sunColor: 0xfff3cf,
    ambientColor: 0x5c7352,
    waterColor: 0x1e8ab0,
    deepWaterColor: 0x0e3f59,
    seed: 1944,
    palette: {
      topColor: [0.36, 0.62, 0.24],      // Vibrant cartoon Normandy meadow green
      midClayColor: [0.62, 0.38, 0.21],  // Warm sculpted terracotta-brown clay
      deepMudColor: [0.34, 0.21, 0.13],  // Rich wet mud
      wetShoreColor: [0.30, 0.25, 0.19], // Damp shoreline clay/sand
      scorchColor: [0.16, 0.12, 0.10],   // Charred crater mud
      rockSlopeColor: [0.56, 0.44, 0.30], // Stylized coastal earthen cliff
    },
    field: (wx, wy, wz) => {
      // Sprawling ~74m wide Normandy peninsula island completely surrounded by ocean!
      const nx = wx / 37.5;
      const nz = wz / 31.5;
      const warp = fbm2D(wx * 0.042, wz * 0.042, 1944, 3) * 0.26;
      const radial = Math.hypot(nx * 0.92, nz * 1.04) + warp;

      const islandMask = 1 - smoothstep(0.66, 1.02, radial);

      // Three dramatic commanding bluffs + sunken central muddy battlefield valley
      const westBluff = Math.exp(-((wx + 17) ** 2 + (wz - 3) ** 2) / 210) * 8.6;
      const eastBluff = Math.exp(-((wx - 17) ** 2 + (wz + 3) ** 2) / 210) * 8.2;
      const northHill = Math.exp(-((wx - 1) ** 2 + (wz + 16) ** 2) / 145) * 6.4;
      const centerRidge = Math.exp(-(wz * wz) / 95) * 3.1;
      const hills = fbm2D(wx * 0.055, wz * 0.055, 1945, 4) * 4.4;

      // Iconic WW2 shell craters & mud trench scars across the middle
      const crater1 = Math.exp(-((wx + 4) ** 2 + (wz - 5) ** 2) / 22) * 3.0;
      const crater2 = Math.exp(-((wx - 7) ** 2 + (wz + 7) ** 2) / 18) * 2.4;
      const crater3 = Math.exp(-((wx + 1) ** 2 + (wz + 2) ** 2) / 16) * 2.1;

      const surfaceY =
        WATER_LEVEL -
        3.2 +
        islandMask * (10.2 + westBluff + eastBluff + northHill + centerRidge + hills) -
        crater1 -
        crater2 -
        crater3;

      const clayNoise = fbm3D(wx * 0.09, wy * 0.11, wz * 0.09, 1946, 3) * 1.35;
      let density = (surfaceY - wy) / 0.85 + clayNoise * islandMask;

      // Tunnelable coastal sea cave under the south bluff!
      const caveDist = Math.hypot((wx - 2) * 0.55, (wy - (WATER_LEVEL + 3.0)) * 0.95, (wz - 14) * 0.38);
      if (caveDist < 4.5) {
        density = Math.min(density, (caveDist - 4.5) * 1.6);
      }

      const mud = crater1 + crater2 + crater3 > 0.75 ? 0.82 : 0;
      const scorch = crater1 + crater2 + crater3 > 1.2 ? 0.48 : 0;
      return { density, mud, scorch };
    },
    spawnZones: {
      allies: [
        [-22, -6],
        [-16, 10],
        [-11, -13],
        [-25, 4],
      ],
      axis: [
        [22, 6],
        [16, -10],
        [11, 13],
        [25, -4],
      ],
    },
    propTheme: 'normandy',
  },
  {
    id: 'pacific',
    name: 'Volcanic Atoll',
    subtitle: 'Large Pacific turquoise lagoon, volcano peak & landing boat',
    skyColor: 0x35b0e6,
    fogColor: 0xc2f0fa,
    sunColor: 0xfff7d6,
    ambientColor: 0x5c8058,
    waterColor: 0x16b5b8,
    deepWaterColor: 0x0b566b,
    seed: 1945,
    palette: {
      topColor: [0.40, 0.68, 0.22],      // Bright tropical jungle green
      midClayColor: [0.70, 0.34, 0.18],  // Vibrant red Pacific laterite clay
      deepMudColor: [0.33, 0.18, 0.12],  // Deep wet volcanic mud
      wetShoreColor: [0.82, 0.74, 0.52], // Sunny tropical beach sand!
      scorchColor: [0.14, 0.11, 0.10],   // Volcanic soot
      rockSlopeColor: [0.45, 0.36, 0.29], // Stylized volcanic cliff
    },
    field: (wx, wy, wz) => {
      // Massive crescent Pacific island wrapping a bright lagoon + central mud islet!
      const warp = fbm2D(wx * 0.048, wz * 0.048, 1945, 3) * 0.24;
      const radial = Math.hypot(wx / 36.5, wz / 34.5) + warp;
      const outerMask = 1 - smoothstep(0.64, 1.01, radial);

      // Scenic turquoise central lagoon open to the southern ocean
      const lagoonDist = Math.hypot((wx - 0.5) / 14.0, (wz - 9.5) / 16.5);
      const lagoonCarve = 1 - smoothstep(0.54, 1.06, lagoonDist);

      // Small stepping-stone mud islet right inside the lagoon!
      const isletMask = 1 - smoothstep(0.45, 1.0, Math.hypot((wx - 0.5) / 6.2, (wz - 5.5) / 5.8));

      // Suribachi-style towering volcano peak on north crest + twin arms
      const peak = Math.exp(-((wx + 1) ** 2 + (wz + 17) ** 2) / 155) * 14.5;
      const caldera = Math.exp(-((wx + 1) ** 2 + (wz + 17) ** 2) / 22) * 4.2;
      const westArm = Math.exp(-((wx + 20) ** 2 + (wz - 4) ** 2) / 165) * 6.8;
      const eastArm = Math.exp(-((wx - 20) ** 2 + (wz - 4) ** 2) / 165) * 6.8;
      const bumps = fbm2D(wx * 0.06, wz * 0.06, 1947, 4) * 3.8;

      const landFactor = Math.max(isletMask * 0.65, Math.max(0, outerMask - lagoonCarve * 0.94));
      const surfaceY =
        WATER_LEVEL - 3.2 + landFactor * (8.6 + peak - caldera + westArm + eastArm + bumps);

      const clayNoise = fbm3D(wx * 0.085, wy * 0.1, wz * 0.085, 1948, 3) * 1.25;
      const density = (surfaceY - wy) / 0.85 + clayNoise * landFactor;
      return { density, mud: caldera > 1.2 ? 0.85 : peak > 6 ? 0.35 : 0, scorch: caldera > 1.6 ? 0.65 : 0 };
    },
    spawnZones: {
      allies: [
        [-22, 6],
        [-19, -8],
        [-11, -18],
        [-24, -1],
      ],
      axis: [
        [22, 6],
        [19, -8],
        [11, -18],
        [24, -1],
      ],
    },
    propTheme: 'pacific',
  },
  {
    id: 'fjord',
    name: 'Fjord Outpost',
    subtitle: 'Massive twin Arctic islands, sea-arch bridge & radar tower',
    skyColor: 0x5c96c7,
    fogColor: 0xd0e3f2,
    sunColor: 0xf4f9ff,
    ambientColor: 0x627c96,
    waterColor: 0x1d6887,
    deepWaterColor: 0x0d2d42,
    seed: 1942,
    palette: {
      topColor: [0.90, 0.94, 0.98],      // Crisp cartoon snow blanket
      midClayColor: [0.50, 0.36, 0.25],  // Cold brown permafrost clay
      deepMudColor: [0.27, 0.21, 0.18],  // Dark frozen mud
      wetShoreColor: [0.26, 0.30, 0.35], // Icy slate shoreline
      scorchColor: [0.14, 0.13, 0.13],   // Soot & wet mud
      rockSlopeColor: [0.43, 0.48, 0.54], // Bright Nordic cliff slate
    },
    field: (wx, wy, wz) => {
      // Twin massive snow-capped islands linked by a destructible clay/rock bridge over a huge sea arch!
      const warp = fbm2D(wx * 0.055, wz * 0.055, 1942, 3) * 0.22;

      const westDist = Math.hypot((wx + 19.5) / 18.5, (wz + 1.5) / 22.5) + warp;
      const eastDist = Math.hypot((wx - 19.5) / 18.5, (wz - 1.5) / 22.5) + warp;
      const westMask = 1 - smoothstep(0.62, 1.02, westDist);
      const eastMask = 1 - smoothstep(0.62, 1.02, eastDist);

      // Wide curved destructible land bridge connecting the twin islands!
      const bridgeMask =
        (1 - smoothstep(4.2, 7.6, Math.abs(wz + Math.sin(wx * 0.11) * 2.2))) *
        (1 - smoothstep(14.0, 20.5, Math.abs(wx)));

      const combined = Math.min(1, Math.max(westMask, eastMask, bridgeMask * 0.9));
      const cliffs = fbm2D(wx * 0.065, wz * 0.065, 1943, 4) * 4.5;
      const spireW = Math.exp(-((wx + 21) ** 2 + (wz + 4) ** 2) / 130) * 9.5;
      const spireE = Math.exp(-((wx - 21) ** 2 + (wz - 4) ** 2) / 130) * 9.5;

      const surfaceY = WATER_LEVEL - 3.2 + combined * (10.0 + spireW + spireE + cliffs);
      const clayNoise = fbm3D(wx * 0.095, wy * 0.11, wz * 0.095, 1949, 3) * 1.3;
      let density = (surfaceY - wy) / 0.85 + clayNoise * combined;

      // Dramatic sea-arch tunnel right beneath the central bridge!
      const archDist = Math.hypot(wx * 0.42, (wy - (WATER_LEVEL + 0.8)) * 0.82);
      if (archDist < 5.0 && Math.abs(wz) < 12) {
        density = Math.min(density, (archDist - 5.0) * 1.7);
      }

      return { density };
    },
    spawnZones: {
      allies: [
        [-22, -7],
        [-17, 9],
        [-26, 4],
        [-14, -10],
      ],
      axis: [
        [22, 7],
        [17, -9],
        [26, -4],
        [14, 10],
      ],
    },
    propTheme: 'fjord',
  },
];

export function getIslandMap(id: IslandMapId): IslandMapDefinition {
  return WW2_ISLANDS.find((m) => m.id === id) ?? WW2_ISLANDS[0];
}

// --- Upgraded Cartoony Textured WW2 Props ---

let concreteTex: THREE.CanvasTexture | null = null;
let crateTex: THREE.CanvasTexture | null = null;
let barrelTex: THREE.CanvasTexture | null = null;
let burlapTex: THREE.CanvasTexture | null = null;

function ensurePropTextures(): void {
  if (typeof document === 'undefined') return;
  if (!concreteTex) concreteTex = createConcreteTexture();
  if (!crateTex) crateTex = createCrateTexture();
  if (!barrelTex) barrelTex = createFuelBarrelTexture();
  if (!burlapTex) burlapTex = createBurlapTexture();
}

function createConcreteBunker(): THREE.Group {
  ensurePropTextures();
  const g = new THREE.Group();
  const concrete = createToonMaterial(0xaeb3a8, concreteTex ? { map: concreteTex } : undefined);
  const darkSlot = new THREE.MeshBasicMaterial({ color: 0x171817 });
  const gunMat = createToonMaterial(0x3a403e);

  const base = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.75, 2.9), concrete);
  base.position.y = 0.85;
  base.castShadow = true;
  base.receiveShadow = true;
  addCartoonOutline(base, 1.04);
  g.add(base);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.45, 3.35), concrete);
  roof.position.y = 1.85;
  roof.castShadow = true;
  addCartoonOutline(roof, 1.03);
  g.add(roof);

  const slit = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.4, 0.24), darkSlot);
  slit.position.set(0, 1.12, 1.38);
  g.add(slit);

  // Chunky cartoon cannon barrel poking out of the bunker slit!
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.5, 8), gunMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.12, 1.9);
  barrel.castShadow = true;
  addCartoonOutline(barrel, 1.12);
  g.add(barrel);

  return g;
}

function createCartoonTank(): THREE.Group {
  const g = new THREE.Group();
  const hullMat = createToonMaterial(0x5b7340);
  const darkMat = createToonMaterial(0x2e332d);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xf7f2d7 });

  // Chunky treads
  const treadGeo = new THREE.BoxGeometry(0.68, 0.72, 3.5);
  const treadL = new THREE.Mesh(treadGeo, darkMat);
  treadL.position.set(-1.15, 0.4, 0);
  treadL.castShadow = true;
  addCartoonOutline(treadL, 1.05);
  const treadR = treadL.clone();
  treadR.position.x = 1.15;
  g.add(treadL, treadR);

  // Armored body
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.92, 3.15), hullMat);
  hull.position.y = 0.88;
  hull.castShadow = true;
  addCartoonOutline(hull, 1.04);
  g.add(hull);

  // Rounded turret
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.92, 0.75, 10), hullMat);
  turret.position.set(0, 1.66, -0.1);
  turret.castShadow = true;
  addCartoonOutline(turret, 1.06);
  g.add(turret);

  // White Allied star badge on side
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.26, 5), starMat);
  badge.position.set(1.06, 0.92, 0.2);
  badge.rotation.y = Math.PI / 2;
  g.add(badge);

  // Main gun barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.35, 8), darkMat);
  barrel.rotation.x = Math.PI / 2 - 0.12;
  barrel.position.set(0, 1.78, 1.35);
  barrel.castShadow = true;
  addCartoonOutline(barrel, 1.1);
  g.add(barrel);

  return g;
}

function createWatchtower(): THREE.Group {
  const g = new THREE.Group();
  const wood = createToonMaterial(0x875f3c);
  const roofMat = createToonMaterial(0x526142);

  // Four chunky legs
  const legGeo = new THREE.BoxGeometry(0.24, 3.6, 0.24);
  for (const sx of [-0.95, 0.95]) {
    for (const sz of [-0.95, 0.95]) {
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(sx, 1.8, sz);
      leg.castShadow = true;
      addCartoonOutline(leg, 1.08);
      g.add(leg);
    }
  }

  // Platform & railings
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.28, 2.5), wood);
  floor.position.y = 3.55;
  floor.castShadow = true;
  addCartoonOutline(floor, 1.04);
  g.add(floor);

  const rail = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.75, 2.45), wood);
  rail.position.y = 4.02;
  rail.castShadow = true;
  addCartoonOutline(rail, 1.04);
  g.add(rail);

  // Slanted corrugated roof
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.05, 1.1, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 5.4;
  roof.castShadow = true;
  addCartoonOutline(roof, 1.04);
  g.add(roof);

  return g;
}

function createLandingCraft(): THREE.Group {
  const g = new THREE.Group();
  const hullMat = createToonMaterial(0x69767d);
  const woodMat = createToonMaterial(0x8f6b47);
  const rampMat = createToonMaterial(0x475157);

  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 4.6), hullMat);
  base.position.y = 0.28;
  base.castShadow = true;
  addCartoonOutline(base, 1.04);
  g.add(base);

  const sideGeo = new THREE.BoxGeometry(0.24, 1.05, 4.4);
  const sL = new THREE.Mesh(sideGeo, hullMat);
  sL.position.set(-1.12, 0.85, 0);
  const sR = sL.clone();
  sR.position.x = 1.12;
  addCartoonOutline(sL, 1.06);
  addCartoonOutline(sR, 1.06);
  g.add(sL, sR);

  // Dropped bow ramp
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, 1.5), rampMat);
  ramp.position.set(0, 0.35, 2.8);
  ramp.rotation.x = 0.25;
  addCartoonOutline(ramp, 1.05);
  g.add(ramp);

  // Stern cockpit box
  const stern = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.25, 1.1), woodMat);
  stern.position.set(0, 1.0, -1.75);
  stern.castShadow = true;
  addCartoonOutline(stern, 1.05);
  g.add(stern);

  return g;
}

function createRadarTower(): { group: THREE.Group; dish: THREE.Object3D } {
  const g = new THREE.Group();
  const steel = createToonMaterial(0x6e7b87);
  const accent = createToonMaterial(0xd64838);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.35, 2.8, 8), steel);
  base.position.y = 1.4;
  base.castShadow = true;
  addCartoonOutline(base, 1.05);
  g.add(base);

  const dishPivot = new THREE.Group();
  dishPivot.position.y = 3.2;

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.9, 8), steel);
  dishPivot.add(mast);

  const dish = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.35, 0.22), accent);
  dish.position.set(0, 0.55, 0.25);
  dish.rotation.x = -0.25;
  dish.castShadow = true;
  addCartoonOutline(dish, 1.05);
  dishPivot.add(dish);

  g.add(dishPivot);
  return { group: g, dish: dishPivot };
}

function createLighthouse(): THREE.Group {
  const g = new THREE.Group();
  const white = createToonMaterial(0xf2efe6);
  const red = createToonMaterial(0xd93f32);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe97d });

  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85 - i * 0.11, 0.98 - i * 0.11, 1.1, 10),
      i % 2 === 0 ? white : red
    );
    seg.position.y = 0.55 + i * 1.05;
    seg.castShadow = true;
    addCartoonOutline(seg, 1.05);
    g.add(seg);
  }

  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.72, 10), lampMat);
  lantern.position.y = 4.6;
  g.add(lantern);

  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.68, 0.8, 10), red);
  cap.position.y = 5.32;
  addCartoonOutline(cap, 1.06);
  g.add(cap);

  return g;
}

function createCzechHedgehog(): THREE.Group {
  const g = new THREE.Group();
  const rust = createToonMaterial(0x6b5241);
  const beamGeo = new THREE.BoxGeometry(0.18, 1.75, 0.18);

  const b1 = new THREE.Mesh(beamGeo, rust);
  b1.rotation.set(0.62, 0, 0.55);
  const b2 = new THREE.Mesh(beamGeo, rust);
  b2.rotation.set(-0.62, 0, 0.55);
  const b3 = new THREE.Mesh(beamGeo, rust);
  b3.rotation.set(0, 0.55, -0.78);

  [b1, b2, b3].forEach((b) => {
    b.position.y = 0.7;
    b.castShadow = true;
    addCartoonOutline(b, 1.12);
    g.add(b);
  });
  return g;
}

function createSandbagWall(): THREE.Group {
  ensurePropTextures();
  const g = new THREE.Group();
  const bagMat = createToonMaterial(0xd1ba8a, burlapTex ? { map: burlapTex } : undefined);
  const bagGeo = new THREE.CapsuleGeometry(0.22, 0.5, 4, 8);

  for (let row = 0; row < 2; row++) {
    const count = row === 0 ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(bagGeo, bagMat);
      m.rotation.z = Math.PI / 2;
      m.position.set((i - (count - 1) * 0.5) * 0.8, 0.22 + row * 0.36, (row % 2) * 0.05);
      m.castShadow = true;
      m.receiveShadow = true;
      addCartoonOutline(m, 1.07);
      g.add(m);
    }
  }
  return g;
}

function createPalmTree(rng: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = createToonMaterial(0x966740);
  const leafMat = createToonMaterial(0x3ba635);
  const cocoMat = createToonMaterial(0x5e3c23);

  let y = 0;
  const tiltX = (rng() - 0.5) * 0.34;
  const tiltZ = (rng() - 0.5) * 0.34;
  for (let s = 0; s < 5; s++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.2 - s * 0.022, 0.26 - s * 0.022, 1.0, 7), trunkMat);
    seg.position.set(tiltX * s * 0.72, y + 0.48, tiltZ * s * 0.72);
    seg.rotation.set(tiltZ * 0.38, 0, -tiltX * 0.38);
    seg.castShadow = true;
    addCartoonOutline(seg, 1.08);
    g.add(seg);
    y += 0.88;
  }

  const topX = tiltX * 2.9;
  const topZ = tiltZ * 2.9;
  // Coconuts!
  for (let c = 0; c < 3; c++) {
    const ang = (c / 3) * Math.PI * 2;
    const coco = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 6), cocoMat);
    coco.position.set(topX + Math.cos(ang) * 0.26, y - 0.08, topZ + Math.sin(ang) * 0.26);
    g.add(coco);
  }

  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 2.35), leafMat);
    frond.position.set(topX + Math.sin(ang) * 0.98, y + 0.1, topZ + Math.cos(ang) * 0.98);
    frond.rotation.set(0.35, ang, 0);
    frond.castShadow = true;
    addCartoonOutline(frond, 1.06);
    g.add(frond);
  }
  return g;
}

function createCartoonTree(snowy: boolean): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = createToonMaterial(0x704a2d);
  const leafMat = createToonMaterial(snowy ? 0x2f6b56 : 0x3b8c32);
  const snowMat = createToonMaterial(0xf0f6fc);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.5, 7), trunkMat);
  trunk.position.y = 0.75;
  trunk.castShadow = true;
  addCartoonOutline(trunk, 1.08);
  g.add(trunk);

  for (let i = 0; i < 3; i++) {
    const r = 1.45 - i * 0.35;
    const h = 1.6 - i * 0.18;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), leafMat);
    cone.position.y = 1.75 + i * 0.95;
    cone.castShadow = true;
    addCartoonOutline(cone, 1.05);
    g.add(cone);

    if (snowy) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.65, h * 0.48, 8), snowMat);
      cap.position.y = cone.position.y + h * 0.32;
      g.add(cap);
    }
  }
  return g;
}

function createAmmoCrate(): THREE.Group {
  ensurePropTextures();
  const g = new THREE.Group();
  const wood = createToonMaterial(0xffffff, crateTex ? { map: crateTex } : { color: 0x8b7748 });

  const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.85), wood);
  box.position.y = 0.4;
  box.castShadow = true;
  box.receiveShadow = true;
  addCartoonOutline(box, 1.06);
  g.add(box);
  return g;
}

function createExplosiveFuelBarrel(): THREE.Group {
  ensurePropTextures();
  const g = new THREE.Group();
  const mat = createToonMaterial(0xffffff, barrelTex ? { map: barrelTex } : { color: 0xd93829 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.15, 10), mat);
  barrel.position.y = 0.58;
  barrel.castShadow = true;
  addCartoonOutline(barrel, 1.07);
  g.add(barrel);
  return g;
}

export function populateIslandProps(
  map: IslandMapDefinition,
  terrain: TerrainEngine,
  parentGroup: THREE.Group
): DestructibleProp[] {
  const rng = createSeededRng(map.seed + 777);
  const props: DestructibleProp[] = [];

  const placeProp = (
    mesh: THREE.Group,
    wx: number,
    wz: number,
    radius: number,
    opts?: { rotY?: number; explosive?: boolean; spinChild?: THREE.Object3D }
  ) => {
    const sy = terrain.getSurfaceHeight(wx, wz);
    if (sy === null || sy < WATER_LEVEL + 0.85) return;
    mesh.position.set(wx, sy - 0.16, wz);
    mesh.rotation.y = opts?.rotY ?? rng() * Math.PI * 2;
    parentGroup.add(mesh);
    props.push({
      mesh,
      position: mesh.position.clone(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      falling: false,
      radius,
      alive: true,
      explosive: opts?.explosive,
      spinChild: opts?.spinChild,
    });
  };

  if (map.propTheme === 'normandy') {
    placeProp(createConcreteBunker(), -17.5, 3.0, 1.9, { rotY: 1.3 });
    placeProp(createConcreteBunker(), 17.5, -3.0, 1.9, { rotY: -1.8 });
    placeProp(createCartoonTank(), -1.5, -14.5, 1.8, { rotY: 0.35 });
    placeProp(createWatchtower(), 4.5, 11.5, 1.5, { rotY: 2.2 });

    for (let i = 0; i < 9; i++) {
      placeProp(createCzechHedgehog(), (rng() - 0.5) * 56, (rng() - 0.5) * 44, 0.85);
    }
    for (let i = 0; i < 8; i++) {
      placeProp(createSandbagWall(), (rng() - 0.5) * 52, (rng() - 0.5) * 38, 1.15);
    }
    for (let i = 0; i < 12; i++) {
      placeProp(createCartoonTree(false), (rng() - 0.5) * 60, (rng() - 0.5) * 46, 0.95);
    }
  } else if (map.propTheme === 'pacific') {
    placeProp(createConcreteBunker(), -1.5, -15.5, 1.9, { rotY: 0.1 });
    placeProp(createWatchtower(), -18.5, -4.5, 1.5, { rotY: 1.1 });
    placeProp(createLandingCraft(), 11.5, 13.5, 2.0, { rotY: -2.4 });
    placeProp(createLandingCraft(), -12.0, 14.0, 2.0, { rotY: 2.3 });

    for (let i = 0; i < 18; i++) {
      placeProp(createPalmTree(rng), (rng() - 0.5) * 62, (rng() - 0.5) * 52, 0.85);
    }
    for (let i = 0; i < 8; i++) {
      placeProp(createSandbagWall(), (rng() - 0.5) * 54, (rng() - 0.5) * 46, 1.15);
    }
  } else {
    // Fjord Outpost
    placeProp(createConcreteBunker(), -19.0, -2.5, 1.9, { rotY: 1.5 });
    placeProp(createConcreteBunker(), 19.0, 2.5, 1.9, { rotY: -1.6 });
    const radar = createRadarTower();
    placeProp(radar.group, -21.0, -8.0, 1.4, { spinChild: radar.dish });
    placeProp(createLighthouse(), 21.5, 9.0, 1.3);

    for (let i = 0; i < 16; i++) {
      placeProp(createCartoonTree(true), (rng() - 0.5) * 62, (rng() - 0.5) * 46, 0.95);
    }
    for (let i = 0; i < 7; i++) {
      placeProp(createSandbagWall(), (rng() - 0.5) * 50, (rng() - 0.5) * 34, 1.15);
    }
  }

  // Supply crates + explosive red WW2 fuel barrels scattered around every island!
  for (let i = 0; i < 7; i++) {
    placeProp(createAmmoCrate(), (rng() - 0.5) * 48, (rng() - 0.5) * 38, 0.65);
  }
  for (let i = 0; i < 6; i++) {
    placeProp(createExplosiveFuelBarrel(), (rng() - 0.5) * 46, (rng() - 0.5) * 34, 0.6, { explosive: true });
  }

  return props;
}
