import {
  arc,
  firstSegment,
  MAX_TRAFFIC,
  type Race,
  randomWord,
  ROAD_SEGMENTS,
  type RoadPose,
  roadPose,
  SEGMENT_LENGTH,
  segmentCurvature,
  trafficPosition,
} from "@qracer/game-core";
import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Texture,
  WebGLRenderer,
} from "three";
import { assetRoot, materialParts } from "../graphics/batching.ts";
import { raceAssetLoader } from "./race-assets.ts";

const colors = [0x469baf, 0xd06b56, 0xbfc8d8, 0x69759e].map((value) => new Color(value));
type Batch = InstancedMesh<Mesh["geometry"], Material>[];

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

export async function createRaceView(container: HTMLElement, signal: AbortSignal) {
  const scene = new Scene();
  const roots: Object3D[] = [scene];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  if (!context) throw new Error("Activa WebGL 2 y recarga para abrir el circuito.");
  const renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  const camera = new PerspectiveCamera(52, 1, 0.2, 490);
  const pose = { x: 0, z: 0, heading: 0 };
  const dummy = new Object3D();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let observer: ResizeObserver | undefined;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    disposeObjects(roots);
    renderer.dispose();
    renderer.domElement.remove();
  };

  function batch(model: Object3D, count: number): Batch {
    return materialParts(model).map(({ geometry, material }) => {
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
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.24;
    scene.fog = new FogExp2(0xe3a880, 0.0055);
    scene.add(new HemisphereLight(0xf4ddc5, 0x294a60, 2.5));
    const sunlight = new DirectionalLight(0xffd397, 3.2);
    sunlight.position.set(-40, 21, -28);
    scene.add(sunlight);

    const loader = raceAssetLoader(renderer);
    async function load(name: string) {
      const response = await fetch(`/assets/coast/${name}.glb`, {
        signal,
      });
      if (!response.ok) throw new Error("El servidor no pudo entregar los modelos del circuito.");
      const glb = await response.arrayBuffer();
      if (glb.byteLength > 8 * 1024 * 1024) throw new Error("Recurso fuera de presupuesto.");
      const asset = await loader.models.parseAsync(glb, "");
      roots.push(asset.scene);
      signal.throwIfAborted();
      return asset.scene;
    }

    const [car, coast, props] = await (async () => {
      try {
        return [await load("coupe"), await load("coast"), await load("props")] as const;
      } finally {
        loader.dispose();
      }
    })();
    const hero = batch(assetRoot(car, "qracer_lod", 0), 1);
    const traffic = batch(assetRoot(car, "qracer_lod", 1), MAX_TRAFFIC);
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
    const ground = new PlaneGeometry(44, SEGMENT_LENGTH, 1, 12).rotateX(-Math.PI / 2);
    ground.translate(-14, -0.19, 0);
    tile.add(new Mesh(ground, new MeshStandardMaterial({ color: 0x536249, roughness: 1 })));
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
          opacity: 0.44,
          depthWrite: false,
        }),
      ),
    );
    roots.push(shadowModel);
    const shadows = batch(shadowModel, MAX_TRAFFIC + 1);
    const ocean = new Mesh(
      new PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ color: 0x386b75, roughness: 0.47, metalness: 0.2 }),
    );
    scene.add(ocean);
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
          if (i % 3 === 1)
            addPose(
              villas,
              roadPose(start + 8, -15.4 - (decor % 3) * 1.5, origin, pose),
              -0.17,
              (decor % 10) * 0.07 - 0.35,
              0.9 + (decor % 3) * 0.14,
            );
          if (i % 4 === 0)
            addPose(cliffs, roadPose(start + 12, -20, origin, pose), -1.1, decor % 7, 1.35);
          if (i % 4 === 2)
            addPose(
              towers,
              roadPose(start + 12, -29, origin, pose),
              -0.22,
              0,
              0.8 + (decor % 3) * 0.24,
            );
        }
        for (const mesh of environment) mesh.instanceMatrix.needsUpdate = true;
        ocean.position.set(0, -1.4, -130);
      }
      for (const mesh of moving) mesh.count = 0;
      roadPose(distance, lateral, origin, pose);
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
        if (s - distance > 232 || distance - s > 18) continue;
        for (const vehicle of row.cars) {
          roadPose(s, vehicle.d, origin, pose);
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
      roadPose(distance - 9.5, lateral * 0.57, origin, pose);
      camera.position.set(pose.x, 4.45, pose.z);
      roadPose(distance + 23, lateral * 0.15, origin, pose);
      camera.lookAt(pose.x, 0.35, pose.z);
      renderer.render(scene, camera);
    }

    function resize() {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1, 1280 / w, 720 / h));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    container.append(renderer.domElement);
    resize();
    await renderer.compileAsync(scene, camera);
    signal.throwIfAborted();
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
