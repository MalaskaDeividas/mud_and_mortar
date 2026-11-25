# MUD & MORTAR — WW2 Island Artillery

A Worms 3D / Armageddon-inspired turn-based 3D artillery tactics game featuring WW2 squads battling across **destructible clay & mud islands surrounded by ocean water**.

## Features

- **3D Sculpted Clay & Mud Terrain Physics**:
  - Real-time chunked 3D Signed Distance Field (SDF) meshed with **Surface Nets** for organic, clay-like sculpted hills, cliffs, caves, and craters (no blocky cubes).
  - **Blast Carving & Rim Displacement**: Explosions scoop smooth organic chunks out of the island, push soft displaced mud upward into raised crater rims, and expose dark wet clay & blast scorch beneath the turf.
  - **Clay Slumping & Flying Mud Clods**: Post-blast gravitational relaxation rounds jagged overhangs and ejects physical 3D mud clods that arc, bounce with wet squelch damping, deposit tiny mud splats, or splash into the ocean.
  - **Floodable Craters**: Every map is a true island surrounded by animated water — blast deep enough to sea level and the ocean floods directly into your crater, or launch enemy soldiers straight into the sea.
- **3 WW2-Inspired Island Battlefields**:
  - **Pointe du Hoc (Normandy)** — Coastal clay cliffs, shell craters, sea cave, bunkers & Czech hedgehogs.
  - **Volcanic Atoll (Pacific)** — Crescent volcanic cove with a central lagoon, red laterite clay, palm trees & pillboxes.
  - **Fjord Outpost (Arctic)** — Twin snow-capped sea stacks connected by a destructible clay sea-arch bridge.
- **WW2 Military Squads & Arsenal**:
  - Allied (Olive / M1 helmets) vs Axis (Field Grey / Stahlhelm) squads in **1P vs AI** or **2P Hotseat** mode.
  - 6 WW2 weapons: **Bazooka**, **Mortar**, **Frag Grenade**, **Drill Shell** (burrows deep into clay before detonating), **Satchel TNT** (drop & run), and **Naval Strike** (flare calling a 4-shell battleship barrage).
- **Simple, Clean UI & Procedural Audio**: Minimal military HUD, live 3D island title preview, and synthesized Web Audio explosions, mud splats, and splashes.

## Controls

- **W A S D / Arrows** — Walk across clay terrain (or pan in Free Cam)
- **Shift** — Jump / hop onto ledges
- **Right-Click Drag** (or **Q / E** + **R / F**) — Orbit camera & aim direction/elevation
- **Hold Left-Click** or **Space** — Charge power bar & release to fire
- **1 – 6** — Switch weapon
- **C** — Toggle Follow / Free Tactical Camera
- **Scroll Wheel** — Zoom

## Getting Started

```bash
npm install
npm run dev
```

Run tests and production build:

```bash
npm test
npm run build
```
