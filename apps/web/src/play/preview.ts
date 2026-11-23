import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

/** A static, low-cost preview. No simulation loop runs in the menu. */
export function createPreview(container: HTMLElement): () => void {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 1, 0.1, 30);
  camera.position.set(4, 2.7, 5);
  camera.lookAt(0, 0.5, 0);
  scene.add(new HemisphereLight(0xc5e8ed, 0x352515, 3));
  const light = new DirectionalLight(0xffe6ad, 4);
  light.position.set(-3, 5, 2);
  scene.add(light);
  const geometry = new BoxGeometry(1, 1, 1);
  const paint = new MeshStandardMaterial({ color: new Color("#ffcb47"), roughness: 0.32 });
  const glass = new MeshStandardMaterial({ color: "#1b292e", roughness: 0.25 });
  const parts = [
    { position: [0, 0.55, 0], scale: [1.7, 0.65, 3.5], material: paint },
    { position: [0, 1.05, -0.2], scale: [1.4, 0.6, 1.65], material: glass },
    ...[-0.83, 0.83].flatMap((x) =>
      [-1, 1].map((z) => ({ position: [x, 0.3, z], scale: [0.28, 0.55, 0.65], material: glass })),
    ),
  ];
  for (const part of parts) {
    const mesh = new Mesh(geometry, part.material);
    mesh.position.set(part.position[0] ?? 0, part.position[1] ?? 0, part.position[2] ?? 0);
    mesh.scale.set(part.scale[0] ?? 1, part.scale[1] ?? 1, part.scale[2] ?? 1);
    mesh.rotation.y = -0.25;
    scene.add(mesh);
  }
  container.append(renderer.domElement);
  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  return () => {
    observer.disconnect();
    geometry.dispose();
    paint.dispose();
    glass.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
