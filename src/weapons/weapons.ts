import { WeaponVisualStyle } from '../entities/Soldier';

export type WeaponId = 'bazooka' | 'mortar' | 'grenade' | 'bunker_buster' | 'satchel' | 'naval_strike';

export interface WeaponDef {
  id: WeaponId;
  key: string;
  name: string;
  shortDesc: string;
  ammo: number; // -1 = unlimited (only Bazooka is unlimited!)
  crateDropAmount: number;
  crateWeight: number;
  visualStyle: WeaponVisualStyle;
  minSpeed: number;
  maxSpeed: number;
  gravityScale: number;
  windFactor: number;
  bounces: boolean;
  fuseSeconds: number; // 0 = detonate on impact
  burrowSeconds: number; // >0 drills into clay before exploding!
  isDropCharge: boolean; // drops at soldier feet
  isFlareStrike: boolean; // calls naval barrage onto impact point
  craterRadius: number;
  rimHeight: number;
  verticalStretch: number;
  slumpPasses: number;
  damage: number;
  blastRadius: number;
  knockback: number;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'bazooka',
    key: '1',
    name: 'Bazooka',
    shortDesc: 'Unlimited rocket launcher, crisp clay crater',
    ammo: -1,
    crateDropAmount: 0,
    crateWeight: 0,
    visualStyle: 'bazooka',
    minSpeed: 18,
    maxSpeed: 48,
    gravityScale: 0.7,
    windFactor: 1.1,
    bounces: false,
    fuseSeconds: 0,
    burrowSeconds: 0,
    isDropCharge: false,
    isFlareStrike: false,
    craterRadius: 3.6,
    rimHeight: 0.62,
    verticalStretch: 1.0,
    slumpPasses: 2,
    damage: 42,
    blastRadius: 5.5,
    knockback: 15,
  },
  {
    id: 'mortar',
    key: '2',
    name: 'Mortar',
    shortDesc: 'Limited heavy artillery, massive mud crater',
    ammo: 2,
    crateDropAmount: 2,
    crateWeight: 30,
    visualStyle: 'mortar',
    minSpeed: 14,
    maxSpeed: 39,
    gravityScale: 1.05,
    windFactor: 0.9,
    bounces: false,
    fuseSeconds: 0,
    burrowSeconds: 0,
    isDropCharge: false,
    isFlareStrike: false,
    craterRadius: 4.9,
    rimHeight: 0.8,
    verticalStretch: 1.2,
    slumpPasses: 2,
    damage: 54,
    blastRadius: 7.0,
    knockback: 20,
  },
  {
    id: 'grenade',
    key: '3',
    name: 'Frag Grenade',
    shortDesc: 'Limited 3s fuse, bounces into trenches & craters',
    ammo: 2,
    crateDropAmount: 2,
    crateWeight: 28,
    visualStyle: 'grenade',
    minSpeed: 10,
    maxSpeed: 31,
    gravityScale: 1.0,
    windFactor: 0.32,
    bounces: true,
    fuseSeconds: 3.0,
    burrowSeconds: 0,
    isDropCharge: false,
    isFlareStrike: false,
    craterRadius: 3.2,
    rimHeight: 0.52,
    verticalStretch: 1.0,
    slumpPasses: 1,
    damage: 46,
    blastRadius: 5.6,
    knockback: 16,
  },
  {
    id: 'bunker_buster',
    key: '4',
    name: 'Drill Shell',
    shortDesc: 'Limited burrow shell, collapses earth from below',
    ammo: 1,
    crateDropAmount: 1,
    crateWeight: 18,
    visualStyle: 'drill',
    minSpeed: 16,
    maxSpeed: 42,
    gravityScale: 0.88,
    windFactor: 0.6,
    bounces: false,
    fuseSeconds: 0,
    burrowSeconds: 0.58,
    isDropCharge: false,
    isFlareStrike: false,
    craterRadius: 4.8,
    rimHeight: 0.4,
    verticalStretch: 1.38,
    slumpPasses: 3,
    damage: 54,
    blastRadius: 6.5,
    knockback: 18,
  },
  {
    id: 'satchel',
    key: '5',
    name: 'Satchel TNT',
    shortDesc: 'Limited drop & run charge! Giant excavation pit',
    ammo: 1,
    crateDropAmount: 1,
    crateWeight: 14,
    visualStyle: 'satchel',
    minSpeed: 3.5,
    maxSpeed: 4.5,
    gravityScale: 1.0,
    windFactor: 0,
    bounces: true,
    fuseSeconds: 4.0,
    burrowSeconds: 0,
    isDropCharge: true,
    isFlareStrike: false,
    craterRadius: 6.0,
    rimHeight: 0.92,
    verticalStretch: 1.32,
    slumpPasses: 3,
    damage: 74,
    blastRadius: 8.4,
    knockback: 25,
  },
  {
    id: 'naval_strike',
    key: '6',
    name: 'Naval Strike',
    shortDesc: 'Limited flare calling 4 battleship shells',
    ammo: 1,
    crateDropAmount: 1,
    crateWeight: 12,
    visualStyle: 'flare',
    minSpeed: 13,
    maxSpeed: 38,
    gravityScale: 0.92,
    windFactor: 0.35,
    bounces: false,
    fuseSeconds: 0,
    burrowSeconds: 0,
    isDropCharge: false,
    isFlareStrike: true,
    craterRadius: 3.8,
    rimHeight: 0.68,
    verticalStretch: 1.15,
    slumpPasses: 2,
    damage: 38,
    blastRadius: 5.8,
    knockback: 15,
  },
];

export function getWeaponDef(id: WeaponId): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}

/**
 * Picks a weighted random limited weapon (never Bazooka) for parachute supply crates.
 */
export function rollCrateWeapon(rng = Math.random): WeaponDef {
  const pool = WEAPONS.filter((w) => w.crateWeight > 0);
  const total = pool.reduce((sum, w) => sum + w.crateWeight, 0);
  let r = rng() * total;
  for (const w of pool) {
    r -= w.crateWeight;
    if (r <= 0) return w;
  }
  return pool[0];
}
