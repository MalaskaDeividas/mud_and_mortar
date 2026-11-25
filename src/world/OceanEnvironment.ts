import * as THREE from 'three';
import { WATER_LEVEL } from '../terrain/TerrainEngine';
import { IslandMapDefinition } from '../maps/ww2Islands';
import { createCartoonWaterTexture, createToonMaterial } from '../graphics/textures';

export class OceanEnvironment {
  readonly group = new THREE.Group();
  private waterMesh: THREE.Mesh;
  private waterGeom: THREE.PlaneGeometry;
  private basePositions: Float32Array;
  private waterMat: THREE.MeshToonMaterial;
  private waterTex: THREE.CanvasTexture;
  private seabedMat: THREE.MeshBasicMaterial;
  private skyMat: THREE.ShaderMaterial;
  private sunDisc: THREE.Mesh;
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private clouds: THREE.Group;

  constructor(scene: THREE.Scene) {
    // Bright cartoony sunlit lighting covering the bigger island maps
    this.hemiLight = new THREE.HemisphereLight(0xf2f8ff, 0x5c694a, 1.05);
    this.group.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff5db, 2.05);
    this.sunLight.position.set(52, 68, 44);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 12;
    this.sunLight.shadow.camera.far = 210;
    const d = 58;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.group.add(this.sunLight);

    const fillLight = new THREE.DirectionalLight(0x8fd3f5, 0.55);
    fillLight.position.set(-45, 22, -38);
    this.group.add(fillLight);

    // Stylized gradient cartoon sky dome
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x4ba3e3) },
        horizonColor: { value: new THREE.Color(0xd2eefc) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        varying vec3 vWorldPos;
        void main() {
          float h = clamp(normalize(vWorldPos).y * 1.4, 0.0, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(h, 0.72));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(320, 20, 14), this.skyMat);
    this.group.add(skyDome);

    // Bright cartoony sun disc in the sky
    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(11, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff5c0, fog: false })
    );
    this.sunDisc.position.set(145, 165, 120);
    this.group.add(this.sunDisc);

    // Vibrant animated cartoon ocean surrounding every island
    this.waterGeom = new THREE.PlaneGeometry(560, 560, 68, 68);
    this.waterGeom.rotateX(-Math.PI / 2);
    this.basePositions = new Float32Array(this.waterGeom.attributes.position.array);

    this.waterTex = createCartoonWaterTexture();
    this.waterMat = createToonMaterial(0x1f8fb0, {
      map: this.waterTex,
      transparent: true,
      opacity: 0.86,
    });

    this.waterMesh = new THREE.Mesh(this.waterGeom, this.waterMat);
    this.waterMesh.position.y = WATER_LEVEL;
    this.waterMesh.receiveShadow = true;
    this.group.add(this.waterMesh);

    // Deep stylized seabed underneath translucent water
    const seabedGeom = new THREE.PlaneGeometry(580, 580);
    seabedGeom.rotateX(-Math.PI / 2);
    this.seabedMat = new THREE.MeshBasicMaterial({
      color: 0x0f3b52,
    });
    const seabed = new THREE.Mesh(seabedGeom, this.seabedMat);
    seabed.position.y = WATER_LEVEL - 5.8;
    this.group.add(seabed);

    // Chunky fluffy cartoon clouds floating around the horizon
    this.clouds = new THREE.Group();
    const cloudMat = createToonMaterial(0xffffff);
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const dist = 115 + (i % 3) * 26;
      const cluster = new THREE.Group();
      for (let p = 0; p < 4; p++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(4.2 + (p % 2) * 1.6, 10, 8), cloudMat);
        puff.position.set((p - 1.5) * 3.8, (p === 1 || p === 2 ? 1.4 : 0), (p % 2) * 1.3);
        puff.scale.set(1.3, 0.72, 1.0);
        cluster.add(puff);
      }
      cluster.position.set(Math.cos(ang) * dist, 42 + (i % 4) * 5.5, Math.sin(ang) * dist);
      this.clouds.add(cluster);
    }
    this.group.add(this.clouds);

    scene.add(this.group);
  }

  applyMapTheme(scene: THREE.Scene, map: IslandMapDefinition): void {
    scene.background = new THREE.Color(map.skyColor);
    scene.fog = new THREE.FogExp2(map.fogColor, 0.0036);
    this.skyMat.uniforms.topColor.value.setHex(map.skyColor);
    this.skyMat.uniforms.horizonColor.value.setHex(map.fogColor);
    this.sunLight.color.setHex(map.sunColor);
    this.hemiLight.color.setHex(map.fogColor);
    this.hemiLight.groundColor.setHex(map.ambientColor);
    this.waterMat.color.setHex(map.waterColor);
    this.seabedMat.color.setHex(map.deepWaterColor);
  }

  update(time: number, windX: number, windZ: number): void {
    const pos = this.waterGeom.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = this.basePositions[i];
      const z = this.basePositions[i + 2];
      const wave =
        Math.sin(x * 0.11 + time * 1.55) * 0.22 +
        Math.cos(z * 0.13 + time * 1.2) * 0.18 +
        Math.sin((x + z) * 0.07 + time * 0.95) * 0.12;
      arr[i + 1] = wave;
    }
    pos.needsUpdate = true;
    this.waterGeom.computeVertexNormals();

    // Scroll painted cartoon water waves gently
    this.waterTex.offset.x = (time * 0.028) % 1;
    this.waterTex.offset.y = (time * 0.018) % 1;

    this.clouds.rotation.y += (0.0035 + (windX + windZ) * 0.0005) * 0.016;
  }
}
