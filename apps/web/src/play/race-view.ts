import {
  arc,
  createRace,
  firstSegment,
  MAX_TRAFFIC,
  type Race,
  randomWord,
  ROAD_SEGMENTS,
  type RoadPose,
  roadPose,
  SEGMENT_LENGTH,
  segmentCurvature,
  TICK_HZ,
  trafficPosition,
  trafficLateral,
} from "@qracer/game-core";
import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  Float32BufferAttribute,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LinearFilter,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  Texture,
  type WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { assetRoot, materialParts } from "../graphics/batching.ts";
import { coastalEffects } from "./coastal-effects.ts";
import {
  coastalReflections,
  coastalSky,
  coastalWater,
  horizon,
  sunDirection,
} from "./coastal-light.ts";
import { qualities, type Quality } from "./quality.ts";
import { raceAssetLoader } from "./race-assets.ts";

const colors = [0x469baf, 0xd06b56, 0xbfc8d8, 0x69759e].map((value) => new Color(value));
type Batch = InstancedMesh<Mesh["geometry"], Material>[];
export interface RaceViewOptions {
  quality?: Quality;
  progress?: (completed: number, label: string) => void;
}

function terrainHeight(lateral: number) {
  return -0.19 + 4.5 * Math.min(1, Math.max(0, -lateral - 10) / 50) ** 1.65;
}

function shadowTexture() {
  const size = 48;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      pixels[(y * size + x) * 4 + 1] = Math.round(255 * (1 - Math.min(1, radius)) ** 0.7);
    }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function disposeObjects(roots: Object3D[]) {
  const geometries = new Set<Mesh["geometry"]>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  for (const root of roots)
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      if (node instanceof InstancedMesh) node.dispose();
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof Texture) textures.add(value);
      }
    });
  for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
}

export async function createRaceView(
  container: HTMLElement,
  signal: AbortSignal,
  { quality = "balanced", progress }: RaceViewOptions = {},
) {
  const profile = qualities[quality];
  const scene = new Scene();
  const roots: Object3D[] = [scene];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: quality !== "low",
    powerPreference: "high-performance",
  });
  if (!context) throw new Error("Activa WebGL 2 y recarga para abrir el circuito.");
  const renderer = new WebGLRenderer({ canvas, context });
  const camera = new PerspectiveCamera(52, 1, 0.2, 490);
  const pose = { x: 0, z: 0, heading: 0 };
  const dummy = new Object3D();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const effects = coastalEffects(profile.particles);
  const sunlight = new DirectionalLight(0xffca9a, 3.6);
  let reflections: WebGLRenderTarget | undefined;
  let observer: ResizeObserver | undefined;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    effects.dispose();
    sunlight.shadow.dispose();
    reflections?.dispose();
    disposeObjects(roots);
    renderer.dispose();
    renderer.domElement.remove();
    renderer.forceContextLoss();
  };

  function batch(model: Object3D, count: number, modelSpace?: Object3D): Batch {
    return materialParts(model, modelSpace).map(({ geometry, material }) => {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    });
  }

  function addPose(
    meshes: Batch,
    point: RoadPose,
    height = 0,
    turn = 0,
    scale = 1,
    tilt = 0,
    color?: Color,
  ) {
    dummy.position.set(point.x, height, point.z);
    dummy.rotation.set(0, -point.heading + turn, tilt);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    for (const mesh of meshes) {
      mesh.setMatrixAt(mesh.count, dummy.matrix);
      if (color && mesh.material.name.includes("Paint")) mesh.setColorAt(mesh.count, color);
      mesh.count++;
    }
  }

  try {
    renderer.info.autoReset = false;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    scene.fog = new FogExp2(horizon, 0.0054);
    scene.add(
      new HemisphereLight(0xffddc3, 0x527785, 2.36),
      sunlight,
      sunlight.target,
      effects.mesh,
    );
    if (profile.shadow) {
      renderer.shadowMap.enabled = true;
      sunlight.castShadow = true;
      sunlight.shadow.mapSize.set(profile.shadow, profile.shadow);
      Object.assign(sunlight.shadow.camera, {
        left: -12,
        right: 12,
        top: 12,
        bottom: -12,
        near: 1,
        far: 75,
      });
      sunlight.shadow.camera.updateProjectionMatrix();
      sunlight.shadow.bias = -0.0004;
      sunlight.shadow.normalBias = 0.045;
      sunlight.shadow.intensity = 0.7;
      reflections = coastalReflections(renderer);
      scene.environment = reflections.texture;
      scene.environmentIntensity = 0.55;
    }
    const sky = coastalSky();
    scene.add(sky);

    const loader = raceAssetLoader(renderer);
    async function load(name: string, completed: number) {
      const response = await fetch(`/assets/coast/${name}.glb`, {
        signal,
      });
      if (!response.ok) throw new Error("El servidor no pudo entregar los modelos del circuito.");
      const glb = await response.arrayBuffer();
      if (glb.byteLength > 8 * 1024 * 1024) throw new Error("Recurso fuera de presupuesto.");
      const asset = await loader.models.parseAsync(glb, "");
      roots.push(asset.scene);
      signal.throwIfAborted();
      progress?.(completed, "Preparando modelos");
      return asset.scene;
    }

    const [car, coast, props] = await (async () => {
      try {
        return [await load("coupe", 2), await load("coast", 3), await load("props", 4)] as const;
      } finally {
        loader.dispose();
      }
    })();
    // Meshopt places each coupe LOD's decode transform on its tagged root.
    // The GLB scene owns the original pivot at wheel height, used by all instances.
    const hero = batch(assetRoot(car, "qracer_lod", quality === "low" ? 1 : 0), 1, car);
    if (profile.shadow) for (const part of hero) part.castShadow = true;
    const traffic = batch(assetRoot(car, "qracer_lod", 1), MAX_TRAFFIC, car);
    const palms = batch(assetRoot(coast, "qracer_asset", "palm"), 16);
    const cliffs = batch(assetRoot(coast, "qracer_asset", "cliff"), 5);
    const towers = batch(assetRoot(coast, "qracer_asset", "tower"), 5);
    const villas = batch(assetRoot(props, "qracer_asset", "villa"), 8);
    const lamps = batch(assetRoot(props, "qracer_asset", "lamp"), 9);
    const hazards = {
      cones: batch(assetRoot(props, "qracer_asset", "cones"), MAX_TRAFFIC),
      barrier: batch(assetRoot(props, "qracer_asset", "barrier"), MAX_TRAFFIC),
    };
    const tile = assetRoot(coast, "qracer_asset", "road").clone();
    const excluded: Mesh[] = [];
    let asphalt: Material | undefined;
    tile.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      if (node.name.startsWith("QR_Road24m")) {
        if (!Array.isArray(node.material)) asphalt = node.material;
        excluded.push(node);
      } else if (node.name.startsWith("QR_LaneDash")) excluded.push(node);
    });
    for (const mesh of excluded) mesh.removeFromParent();
    if (!asphalt) throw new Error("Falta el material del asfalto.");
    // Retain the Blender curbs, barriers and asphalt texture. Subdivide the new
    // surface along its length so the arc and the three lane markings align.
    const surface = new PlaneGeometry(13.2, SEGMENT_LENGTH, 1, 12).rotateX(-Math.PI / 2);
    const uv = surface.getAttribute("uv");
    const position = surface.getAttribute("position");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getX(i) / 4, -position.getZ(i) / 4);
    tile.add(new Mesh(surface, asphalt));
    const ground = new PlaneGeometry(72, SEGMENT_LENGTH, 18, 12).rotateX(-Math.PI / 2);
    ground.translate(-28, 0, 0);
    const groundPoints = ground.getAttribute("position");
    const groundColors = ground.getAttribute("uv");
    const sage = new Color(0x6d7962);
    const limestone = new Color(0xa68c6c);
    const tint = new Color();
    const groundPalette = new Float32Array(groundPoints.count * 3);
    for (let i = 0; i < groundPoints.count; i++) {
      const x = groundPoints.getX(i);
      const wave = Math.cos(groundColors.getY(i) * Math.PI * 2);
      groundPoints.setY(i, terrainHeight(x));
      const stone = 0.26 + 0.18 * Math.sin(x * 0.63 + 0.7 * wave) + 0.13 * wave;
      tint.copy(sage).lerp(limestone, stone);
      tint.toArray(groundPalette, i * 3);
    }
    ground.setAttribute("color", new Float32BufferAttribute(groundPalette, 3));
    ground.computeVertexNormals();
    tile.add(new Mesh(ground, new MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
    const seawall = assetRoot(props, "qracer_asset", "seawall").clone();
    seawall.position.set(8.8, -0.19, 0);
    tile.add(seawall);
    const marking = new PlaneGeometry(0.13, 3).rotateX(-Math.PI / 2);
    const paint = new MeshStandardMaterial({ color: 0xe5e2c8, roughness: 0.82 });
    for (const x of [-2, 2])
      for (const z of [-9, -3, 3, 9]) {
        const dash = new Mesh(marking, paint);
        dash.position.set(x, 0.008, z);
        tile.add(dash);
      }
    roots.push(tile);
    const roads = new Map<number, Batch>();
    for (const index of [0, 1, 4]) {
      const curve = segmentCurvature(index);
      const meshes = batch(tile, ROAD_SEGMENTS);
      for (const mesh of meshes) {
        mesh.receiveShadow = Boolean(profile.shadow) && mesh.material === asphalt;
        const points = mesh.geometry.getAttribute("position");
        const normals = mesh.geometry.getAttribute("normal");
        const center = { x: 0, z: 0, heading: 0 };
        for (let i = 0; i < points.count; i++) {
          arc(SEGMENT_LENGTH / 2 - points.getZ(i), curve, center);
          const cos = Math.cos(center.heading);
          const sin = Math.sin(center.heading);
          const x = points.getX(i);
          const nx = normals.getX(i);
          const nz = normals.getZ(i);
          points.setXYZ(i, center.x + x * cos, points.getY(i), center.z + x * sin);
          normals.setXYZ(i, nx * cos - nz * sin, normals.getY(i), nx * sin + nz * cos);
        }
      }
      roads.set(curve, meshes);
    }

    const shadowModel = new Group();
    const footprint = new CircleGeometry(1, 24).rotateX(-Math.PI / 2).scale(1.15, 1, 2.35);
    shadowModel.add(
      new Mesh(
        footprint,
        new MeshBasicMaterial({
          color: 0x142123,
          transparent: true,
          opacity: 0.74,
          alphaMap: shadowTexture(),
          depthWrite: false,
        }),
      ),
    );
    roots.push(shadowModel);
    const shadows = batch(shadowModel, MAX_TRAFFIC + 1);
    const ocean = coastalWater(quality !== "low");
    scene.add(ocean.mesh);
    const moving = [hero, traffic, shadows, ...Object.values(hazards)].flat();
    const environment = [...roads.values(), palms, cliffs, towers, villas, lamps].flat();
    let lastSegment = Number.NaN;
    let lastPrevious: Race | undefined;
    let lastCurrent: Race | undefined;
    let lastAlpha = 0;

    function draw(previous: Race, current: Race, alpha: number) {
      const p = previous.driver;
      const c = current.driver;
      const distance = p.s + (c.s - p.s) * alpha;
      const lateral = p.d + (c.d - p.d) * alpha;
      const origin = Math.floor(distance / SEGMENT_LENGTH);
      if (origin !== lastSegment) {
        lastSegment = origin;
        for (const mesh of environment) mesh.count = 0;
        const first = firstSegment(distance);
        for (let i = first; i < first + ROAD_SEGMENTS; i++) {
          const start = i * SEGMENT_LENGTH;
          const road = roads.get(segmentCurvature(i));
          if (road) addPose(road, roadPose(start, 0, origin, pose));
          const decor = randomWord(current.seed, i, 11);
          if (i > first)
            addPose(
              palms,
              roadPose(start + 12, decor % 2 ? -8.1 : 8.1, origin, pose),
              -0.14,
              decor % 7,
              0.85 + (decor % 4) * 0.12,
            );
          if (i % 2 === 0) addPose(lamps, roadPose(start + 6, 7.6, origin, pose), -0.14);
          if (i % 3 === 1) {
            const hillside = -15.4 - (decor % 3) * 1.5;
            addPose(
              villas,
              roadPose(start + 8, hillside, origin, pose),
              terrainHeight(hillside) - 0.16,
              (decor % 10) * 0.07 - 0.35,
              0.9 + (decor % 3) * 0.14,
            );
          }
          if (i % 4 === 0)
            addPose(cliffs, roadPose(start + 12, -20, origin, pose), -1.1, decor % 7, 1.35);
          if (i % 4 === 2 && (quality !== "low" || i - first < 11))
            addPose(
              towers,
              roadPose(start + 12, -29, origin, pose),
              terrainHeight(-29) - 0.45,
              0,
              0.8 + (decor % 3) * 0.24,
            );
        }
        for (const mesh of environment) mesh.instanceMatrix.needsUpdate = true;
        ocean.mesh.position.set(0, -1.4, -130);
      }
      for (const mesh of moving) mesh.count = 0;
      roadPose(distance, lateral, origin, pose);
      sunlight.target.position.set(pose.x, 0, pose.z);
      sunlight.position.copy(sunlight.target.position).addScaledVector(sunDirection, 36);
      addPose(
        hero,
        pose,
        0.025,
        -c.lateral * 0.024,
        1,
        reducedMotion.matches ? 0 : -c.lateral * 0.012,
      );
      addPose(shadows, pose, 0.015);
      const tick = previous.tick + (current.tick - previous.tick) * alpha;
      for (const row of current.traffic.rows) {
        const s = trafficPosition(row, Math.max(tick, row.tick));
        if (s - distance > profile.trafficRange || distance - s > 18) continue;
        for (const vehicle of row.cars) {
          roadPose(s, trafficLateral(vehicle, tick), origin, pose);
          if (row.hazard) {
            addPose(hazards[row.hazard], pose, 0.015);
            continue;
          }
          addPose(traffic, pose, 0.02, 0, 1, 0, colors[vehicle.paint]);
          addPose(shadows, pose, 0.014);
        }
      }
      for (const mesh of moving) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      const reduced = reducedMotion.matches;
      const pace = p.speed + (c.speed - p.speed) * alpha;
      const fast = reduced ? 0 : Math.max(0, pace - 18) / 35;
      roadPose(distance - 7.1 - fast * 0.72, lateral * 0.69, origin, pose);
      camera.position.set(pose.x, 3.12 + fast * 0.21, pose.z);
      roadPose(distance + 22, lateral * 0.2, origin, pose);
      camera.lookAt(pose.x, 0.41, pose.z);
      const fov = 49 + fast * 3.8;
      if (Math.abs(camera.fov - fov) >= 0.08) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      sky.position.copy(camera.position);
      ocean.update(reduced ? 0 : tick / TICK_HZ, origin * SEGMENT_LENGTH);
      effects.update(current, tick, origin, reduced);
      renderer.info.reset();
      renderer.render(scene, camera);
    }

    function resize() {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      renderer.setPixelRatio(
        Math.min(devicePixelRatio, profile.dpr, profile.width / w, profile.height / h),
      );
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    container.append(renderer.domElement);
    resize();
    progress?.(5, "Precalentando gráficos");
    await renderer.compileAsync(scene, camera);
    signal.throwIfAborted();
    const initial = createRace();
    draw(initial, initial, 0);
    progress?.(6, "Circuito listo");
    observer = new ResizeObserver(() => {
      resize();
      if (lastPrevious && lastCurrent) draw(lastPrevious, lastCurrent, lastAlpha);
    });
    observer.observe(container);
    return {
      draw(previous: Race, current: Race, alpha: number) {
        draw(previous, current, alpha);
        lastPrevious = previous;
        lastCurrent = current;
        lastAlpha = alpha;
      },
      dispose,
      canvas: renderer.domElement,
      stats: () => ({
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        width: renderer.domElement.width,
        height: renderer.domElement.height,
      }),
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
