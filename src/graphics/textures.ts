import * as THREE from 'three';

/**
 * Generates a crisp 4-band toon shading gradient texture for MeshToonMaterial.
 */
export function createToonGradientMap(steps = 4): THREE.DataTexture {
  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    // Keep shadows warm & readable (never pitch black) for a bright cartoony look
    const v = Math.round(92 + (i / (steps - 1)) * 163);
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

let sharedGradient: THREE.DataTexture | null = null;
export function getSharedToonGradient(): THREE.DataTexture {
  if (!sharedGradient) {
    sharedGradient = createToonGradientMap(4);
  }
  return sharedGradient;
}

export function createToonMaterial(
  color: number,
  extra?: Partial<THREE.MeshToonMaterialParameters>
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: getSharedToonGradient(),
    ...extra,
  });
}

/**
 * Adds a bold cartoony dark ink outline to a mesh via inverted-hull BackSide rendering.
 */
export function addCartoonOutline(
  mesh: THREE.Mesh,
  thickness = 1.07,
  color = 0x1a1917
): THREE.Mesh {
  const outlineMat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
  });
  const outline = new THREE.Mesh(mesh.geometry, outlineMat);
  outline.scale.setScalar(thickness);
  outline.castShadow = false;
  outline.receiveShadow = false;
  mesh.add(outline);
  return outline;
}

/**
 * Procedural hand-painted clay & turf brushstroke texture for triplanar terrain detail.
 */
export function createClayDetailTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#dcdcdc';
  ctx.fillRect(0, 0, size, size);

  // Soft hand-sculpted clay thumbprints & organic paint dabs (tiled cleanly)
  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 320; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rx = 6 + rand() * 20;
    const ry = 4 + rand() * 12;
    const rot = rand() * Math.PI;
    const light = rand() > 0.45;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.12)' : 'rgba(65,50,40,0.13)';

    // Wrap draw across edges for seamless tiling
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.save();
        ctx.translate(x + ox, y + oy);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // Subtle speckles / mud grit
  for (let i = 0; i < 450; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1 + rand() * 2.2;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(40,30,22,0.14)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural cartoony ocean water texture with bright painterly wave ripples & foam swirls.
 */
export function createCartoonWaterTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Subtle stylized darker sea cells
  ctx.fillStyle = '#d4eef7';
  for (let y = 0; y < size; y += 32) {
    for (let x = 0; x < size; x += 32) {
      const ox = (y / 32) % 2 === 0 ? 0 : 16;
      ctx.beginPath();
      ctx.ellipse((x + ox) % size, y + 14, 15, 7, 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Crisp bright cartoon wave crests
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const x = (i * 53) % size;
    const y = (i * 37) % size;
    for (const ox of [-size, 0, size]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y);
      ctx.quadraticCurveTo(x + ox + 12, y - 5, x + ox + 26, y);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 22);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural WW2 painted concrete bunker texture with panel lines & stencil weathering.
 */
export function createConcreteTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#9b9e96';
  ctx.fillRect(0, 0, size, size);

  // Concrete formwork stripes
  ctx.strokeStyle = 'rgba(55, 58, 52, 0.35)';
  ctx.lineWidth = 2;
  for (let y = 16; y < size; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Paint mottling & grime
  for (let i = 0; i < 65; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(60,64,58,0.16)' : 'rgba(220,222,210,0.14)';
    ctx.fillRect((i * 29) % size, (i * 47) % size, 12, 8);
  }

  // Bold cartoon WW2 bunker stripe
  ctx.fillStyle = 'rgba(218, 178, 72, 0.55)';
  ctx.fillRect(0, size - 20, size, 8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural painted wood crate texture with planks & stenciled cross.
 */
export function createCrateTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#8b7748';
  ctx.fillRect(0, 0, size, size);

  // Horizontal planks
  ctx.strokeStyle = '#4a3d22';
  ctx.lineWidth = 4;
  for (let y = 0; y <= size; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Outer wooden frame border
  ctx.strokeStyle = '#635330';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, size - 14, size - 14);

  // Stenciled white military star/box mark
  ctx.fillStyle = 'rgba(245, 236, 200, 0.8)';
  ctx.fillRect(size / 2 - 14, size / 2 - 5, 28, 10);
  ctx.fillRect(size / 2 - 5, size / 2 - 14, 10, 28);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural red explosive WW2 fuel drum texture with yellow hazard band.
 */
export function createFuelBarrelTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#cf372b';
  ctx.fillRect(0, 0, size, size);

  // Rib bands
  ctx.fillStyle = '#992219';
  ctx.fillRect(0, 28, size, 8);
  ctx.fillRect(0, size - 36, size, 8);

  // Bold yellow warning stripe
  ctx.fillStyle = '#f2c138';
  ctx.fillRect(0, 48, size, 32);

  // Black hazard chevrons
  ctx.fillStyle = '#1c1b18';
  for (let x = -20; x < size + 20; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, 48);
    ctx.lineTo(x + 12, 48);
    ctx.lineTo(x + 2, 80);
    ctx.lineTo(x - 10, 80);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural burlap sandbag weave texture.
 */
export function createBurlapTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#bfa878';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(110, 90, 56, 0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < size; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
