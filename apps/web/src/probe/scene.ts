import {
  ACESFilmicToneMapping,
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector2,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { assetRoot, materialParts } from "../graphics/batching.ts";
import { gpuTimer, Histogram } from "./render-metrics.ts";
import type { Input } from "./link.ts";
import { expiredInput } from "./freshness.ts";

export type Profile = "low" | "balanced" | "high";
export const profiles = {
  low: {
    traffic: 8,
    palms: 8,
    cliffs: 4,
    towers: 2,
    segments: 6,
    dpr: 1,
    width: 1280,
    height: 720,
    shadow: 0,
  },
  balanced: {
    traffic: 12,
    palms: 12,
    cliffs: 4,
    towers: 3,
    segments: 7,
    dpr: 1.25,
    width: 1920,
    height: 1080,
    shadow: 1024,
  },
  high: {
    traffic: 24,
    palms: 24,
    cliffs: 8,
    towers: 6,
    segments: 9,
    dpr: 1.5,
    width: 1920,
    height: 1080,
    shadow: 2048,
  },
} as const;

export async function createStress(
  container: HTMLElement,
  profile: Profile,
  auto: boolean,
  status: (message: string) => void,
) {
  const initStarted = performance.now();
  const config = profiles[profile];
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  const scene = new Scene();
  const roots: Object3D[] = [];
  const extraMaterials: Material[] = [];
  const batches: InstancedMesh[] = [];
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) {
    renderer.dispose();
    throw new Error("Activa WebGL 2 para la muestra gráfica.");
  }
  const timer = gpuTimer(gl);
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = debug
    ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
  const software = /swiftshader|llvmpipe|software|warp/i.test(gpu);
  if (software && !auto) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw new Error(
      "Render por software: la escena se omite para mantener fluido el mando. Activa aceleración gráfica para probar 3D.",
    );
  }
  const frames = new Histogram(),
    cpu = new Histogram();
  let input: Input & { paused: boolean; receivedAt: number } = {
    steer: 0,
    throttle: 0,
    brake: 0,
    seq: 0,
    paused: true,
    receivedAt: -Infinity,
  };
  let frame = 0,
    disposed = false,
    lost = false,
    speed = 0,
    travel = 0,
    lateral = 0;
  let began = 0,
    previous = 0,
    maxCalls = 0,
    maxTriangles = 0,
    longTasks = 0,
    longTaskMs = 0;
  let activeMs = 0;
  let suspended = false;
  const camera = new PerspectiveCamera(52, 1, 0.1, 600);
  camera.position.set(0, 3.2, 8.5);
  camera.lookAt(0, 1, -16);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = config.shadow > 0;
  renderer.domElement.className = "stress-canvas";
  container.prepend(renderer.domElement);
  const environment = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment, 0.04);
  environment.dispose();
  pmrem.dispose();
  scene.environment = environmentMap.texture;
  scene.environmentIntensity = 0.65;
  scene.fog = new FogExp2(0xc5987d, 0.009);
  scene.add(new HemisphereLight(0xb6dce2, 0x594343, 2));
  const sun = new DirectionalLight(0xffc591, 3.4);
  sun.position.set(-16, 25, 10);
  sun.target.position.set(0, 0, -20);
  sun.castShadow = config.shadow > 0;
  if (config.shadow) sun.shadow.mapSize.set(config.shadow, config.shadow);
  Object.assign(sun.shadow.camera, {
    left: -23,
    right: 23,
    top: 38,
    bottom: -38,
    near: 0.5,
    far: 100,
  });
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.0001;
  scene.add(sun, sun.target);
  const sky = new Mesh(
    new SphereGeometry(450, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      vertexShader:
        "varying vec3 vDir; void main(){vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `varying vec3 vDir; void main(){ vec3 d=normalize(vDir); float h=max(0.,d.y);
      vec3 c=mix(vec3(.96,.48,.26),vec3(.035,.18,.25),pow(h,.48));
      float s=dot(d,normalize(vec3(-.55,.13,-1.))); c+=vec3(1.,.5,.18)*pow(max(0.,s),48.)*.6;
      c+=vec3(1.,.8,.5)*smoothstep(.9992,.9998,s)*2.; gl_FragColor=vec4(c,1.); }`,
    }),
  );
  scene.add(sky);
  const sea = new Mesh(
    new PlaneGeometry(360, 400),
    new MeshStandardMaterial({ color: 0x316b72, metalness: 0.35, roughness: 0.32 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-175, -1.3, -140);
  scene.add(sea);
  const land = new Mesh(
    new PlaneGeometry(80, 400),
    new MeshStandardMaterial({ color: 0x8c7759, roughness: 1 }),
  );
  land.rotation.x = -Math.PI / 2;
  land.position.set(45, -0.19, -140);
  land.receiveShadow = true;
  scene.add(land);
  const promenade = new Mesh(
    new BoxGeometry(45, 1.1, 400),
    new MeshStandardMaterial({ color: 0x8c8972, roughness: 1 }),
  );
  promenade.position.set(-28.5, -0.85, -140);
  promenade.receiveShadow = true;
  scene.add(promenade);
  const dummy = new Object3D();
  function instantiate(root: Object3D, count: number, shadow: boolean, tinted = false) {
    return materialParts(root).map((part) => {
      let material = part.material;
      if (tinted && material instanceof MeshStandardMaterial && material.name.includes("Paint")) {
        material = material.clone();
        (material as MeshStandardMaterial).color.set(0xffffff);
        extraMaterials.push(material);
      }
      const mesh = new InstancedMesh(part.geometry, material, count);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      for (let i = 0; i < count; i++) {
        dummy.position.set(0, 0, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (tinted && material.name.includes("Paint"))
          mesh.setColorAt(i, new Color([0x396b77, 0xb36540, 0xbbb6a8, 0x647052][i % 4]));
      }
      mesh.frustumCulled = false;
      scene.add(mesh);
      batches.push(mesh);
      return mesh;
    });
  }
  const resize = () => {
    const w = Math.max(1, container.clientWidth),
      h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(
      Math.min(devicePixelRatio, config.dpr, config.width / w, config.height / h),
    );
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const receive = (event: Event) => {
    input = (event as CustomEvent<Input & { paused: boolean; receivedAt: number }>).detail;
  };
  container.addEventListener("probe-input", receive);
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    lost = true;
    status("Contexto gráfico perdido. Recarga para recuperar la prueba.");
  });
  let tasks: PerformanceObserver | undefined;
  if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    tasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.startTime >= began + 30000) {
          longTasks++;
          longTaskMs += entry.duration;
        }
    });
    tasks.observe({ entryTypes: ["longtask"] });
  }
  function dispose() {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    tasks?.disconnect();
    timer.dispose();
    container.removeEventListener("probe-input", receive);
    const geometries = new Set<import("three").BufferGeometry>(),
      materials = new Set<Material>(),
      textures = new Set<Texture>();
    for (const root of [scene, ...roots])
      root.traverse((node) => {
        if (node instanceof Mesh) {
          geometries.add(node.geometry);
          for (const mat of Array.isArray(node.material) ? node.material : [node.material])
            materials.add(mat);
        }
      });
    for (const material of [...materials, ...extraMaterials]) {
      for (const value of Object.values(material))
        if (value instanceof Texture) textures.add(value);
      material.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    environmentMap.dispose();
    sun.shadow.map?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  try {
    const loader = new GLTFLoader();
    async function load(name: string) {
      const response = await fetch(`/assets/probe/${name}.glb`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("No se pudo cargar la muestra 3D");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 8 * 1024 * 1024) throw new Error("Modelo fuera de presupuesto");
      const asset = await loader.parseAsync(buffer, "");
      roots.push(asset.scene);
      return asset.scene;
    }
    const car = await load("coupe"),
      coast = await load("coast");
    const hero = instantiate(assetRoot(car, "qracer_lod", 0), 1, true);
    const traffic = instantiate(
      assetRoot(car, "qracer_lod", 1),
      config.traffic,
      config.shadow > 0,
      true,
    );
    const road = instantiate(assetRoot(coast, "qracer_asset", "road"), config.segments, false);
    const palms = instantiate(
      assetRoot(coast, "qracer_asset", "palm"),
      config.palms,
      config.shadow > 0,
    );
    const cliffs = instantiate(
      assetRoot(coast, "qracer_asset", "cliff"),
      config.cliffs,
      config.shadow > 0,
    );
    const towers = instantiate(
      assetRoot(coast, "qracer_asset", "tower"),
      config.towers,
      config.shadow > 0,
    );
    const contact = new InstancedMesh(
      new PlaneGeometry(3.2, 5.3).rotateX(-Math.PI / 2),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader:
          "varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}",
        fragmentShader:
          "varying vec2 vUv; void main(){vec2 p=(vUv-.5)*2.; float a=(1.-smoothstep(.15,1.,dot(p,p)))*.32;gl_FragColor=vec4(0.,0.,0.,a);}",
      }),
      config.traffic + 1,
    );
    contact.frustumCulled = false;
    scene.add(contact);
    function place(
      meshes: InstancedMesh[],
      i: number,
      x: number,
      y: number,
      z: number,
      yaw = 0,
      scale = 1,
    ) {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      for (const mesh of meshes) mesh.setMatrixAt(i, dummy.matrix);
    }
    for (let i = 0; i < config.cliffs; i++)
      place(cliffs, i, 18 + (i % 2) * 8, -0.2, -20 - i * 28, 0.7 * i, 1 + (i % 3) * 0.25);
    for (let i = 0; i < config.towers; i++)
      place(towers, i, -22 - (i % 2) * 15, -0.3, -40 - i * 36, 0.15 * i, 0.65 + (i % 3) * 0.2);
    await renderer.compileAsync(scene, camera);
    const shaderReadyMs = performance.now();
    began = shaderReadyMs;
    previous = began;
    const viewport = new Vector2();
    const lanes = [-4.2, -1.4, 1.4, 4.2];
    function animate(now: number) {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      if (document.hidden || lost) {
        suspended = true;
        previous = now;
        return;
      }
      if (suspended) {
        previous = now;
        suspended = false;
      }
      const start = performance.now();
      const delta = Math.min((now - previous) / 1000, 0.05);
      activeMs += now - previous;
      const measuring = activeMs >= 30000;
      if (measuring) frames.add(now - previous);
      previous = now;
      const paused = !auto && (input.paused || expiredInput(input.receivedAt, now));
      const steer = auto ? Math.sin(travel * 0.012) * 0.1 : input.steer;
      const throttle = auto ? 1 : input.throttle;
      speed = paused
        ? 0
        : Math.max(0, Math.min(32, speed + (input.brake ? -55 : throttle ? 18 : -12) * delta));
      if (!paused) lateral = Math.max(-4.6, Math.min(4.6, lateral + steer * delta * 4));
      travel = (travel + speed * delta) % 100000;
      place(hero, 0, lateral, 0.01, 0, -steer * 0.055);
      dummy.position.y = 0.008;
      dummy.updateMatrix();
      contact.setMatrixAt(0, dummy.matrix);
      for (let i = 0; i < config.traffic; i++) {
        place(
          traffic,
          i,
          lanes[i % 4] ?? 0,
          0,
          12 - ((i * 9 - travel * (0.2 + (i % 3) * 0.06) + 100000) % (config.traffic * 9 + 30)),
        );
        dummy.position.y = 0.008;
        dummy.updateMatrix();
        contact.setMatrixAt(i + 1, dummy.matrix);
      }
      contact.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < config.segments; i++) place(road, i, 0, 0, 24 - i * 24 + (travel % 24));
      for (let i = 0; i < config.palms; i++)
        place(
          palms,
          i,
          (i % 2 ? -1 : 1) * (8.2 + (i % 3) * 0.4),
          0,
          12 - i * 12 + (travel % 24),
          i * 2.4,
          0.85 + (i % 3) * 0.12,
        );
      for (const mesh of batches) mesh.instanceMatrix.needsUpdate = true;
      renderer.info.reset();
      timer.begin(measuring);
      renderer.render(scene, camera);
      timer.end();
      maxCalls = Math.max(maxCalls, renderer.info.render.calls);
      maxTriangles = Math.max(maxTriangles, renderer.info.render.triangles);
      if (measuring) cpu.add(performance.now() - start);
    }
    frame = requestAnimationFrame(animate);
    container.dataset.graphics = "ready";
    status(
      software
        ? "Render por software detectado: este resultado no valida una GPU física."
        : "Escena 3D lista. Treinta segundos de calentamiento antes de medir.",
    );
    return {
      dispose,
      report: () => {
        renderer.getDrawingBufferSize(viewport);
        const textures = new Set<Texture>();
        for (const batch of batches)
          for (const value of Object.values(batch.material))
            if (value instanceof Texture) textures.add(value);
        const textureBytes = [...textures].reduce((sum, texture) => {
          const image = texture.image as { width?: number; height?: number } | undefined;
          return sum + (Number(image?.width ?? 0) * Number(image?.height ?? 0) * 4 * 4) / 3;
        }, 0);
        return {
          profile,
          auto,
          elapsedSeconds: (performance.now() - began) / 1000,
          activeSeconds: activeMs / 1000,
          warmupSeconds: 30,
          startupMs: shaderReadyMs - initStarted,
          lateral,
          paused: !auto && input.paused,
          gpu,
          software,
          width: viewport.x,
          height: viewport.y,
          frames: frames.summary(),
          cpu: cpu.summary(),
          gpuTimer: timer.supported ? timer.histogram.summary() : null,
          maxCalls,
          maxTriangles,
          longTasks,
          longTaskMs,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          programs: renderer.info.programs?.length ?? 0,
          estimatedMaterialTextureBytes: Math.round(textureBytes),
          shadowMapSize: config.shadow,
          note: "Texturas RGBA8+mips estimadas; IBL/sombras aparte. CPU es envío de comandos, no tiempo de GPU. Intervalos cuantizados a 0.1 ms; >=500 ms en último bin.",
        };
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
