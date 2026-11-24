import {
  BufferAttribute,
  FloatType,
  HalfFloatType,
  UnsignedIntType,
  UnsignedShortType,
  InstancedMesh,
  InterleavedBufferAttribute,
  Line,
  Mesh,
  Points,
  ShaderMaterial,
  Texture,
  type Material,
  type Object3D,
} from "three";

function collect(roots: Object3D[]) {
  const geometries = new Set<Mesh["geometry"]>(),
    materials = new Set<Material>();
  const textures = new Set<Texture>(),
    instances = new Set<InstancedMesh>();
  const texture = (value: unknown) => {
    if (value instanceof Texture) textures.add(value);
    else if (Array.isArray(value))
      for (const item of value) if (item instanceof Texture) textures.add(item);
  };
  for (const root of roots)
    root.traverse((node) => {
      if (!(node instanceof Mesh || node instanceof Points || node instanceof Line)) return;
      geometries.add(node.geometry);
      if (node instanceof InstancedMesh) instances.add(node);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
        for (const value of Object.values(material)) texture(value);
        if (material instanceof ShaderMaterial)
          for (const uniform of Object.values(material.uniforms)) texture(uniform.value);
      }
    });
  return { geometries, materials, textures, instances };
}

/** Dispose each owned resource once, including shared maps and instance buffers. */
export function disposeObjects(roots: Object3D[]) {
  const resources = collect(roots);
  const bitmaps = new Set<ImageBitmap>();
  if (typeof ImageBitmap !== "undefined")
    for (const texture of resources.textures)
      if (texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
  for (const instance of resources.instances) instance.dispose();
  for (const group of [resources.geometries, resources.materials, resources.textures])
    for (const item of group) item.dispose();
  for (const bitmap of bitmaps) bitmap.close();
}

/** Conservative storage estimate, not a driver VRAM reading; includes source geometry. */
export function resourceBytes(roots: Object3D[], extras: Texture[] = []) {
  const resources = collect(roots);
  const buffers = new Set<BufferAttribute | InterleavedBufferAttribute["data"]>();
  const attribute = (value: unknown) => {
    if (value instanceof InterleavedBufferAttribute) buffers.add(value.data);
    else if (value instanceof BufferAttribute) buffers.add(value);
  };
  for (const geometry of resources.geometries) {
    for (const value of Object.values(geometry.attributes)) attribute(value);
    attribute(geometry.index);
  }
  for (const mesh of resources.instances) {
    attribute(mesh.instanceMatrix);
    attribute(mesh.instanceColor);
  }
  for (const texture of extras) resources.textures.add(texture);
  let textureBytes = 0;
  for (const texture of resources.textures) {
    const image = texture.image as
      | { width?: number; height?: number; data?: { byteLength: number } }
      | undefined;
    const supplied = texture.mipmaps.reduce(
      (total, mip) =>
        total + ("data" in mip && ArrayBuffer.isView(mip.data) ? mip.data.byteLength : 0),
      0,
    );
    const component =
      texture.type === FloatType || texture.type === UnsignedIntType
        ? 4
        : texture.type === HalfFloatType || texture.type === UnsignedShortType
          ? 2
          : 1;
    const base =
      image?.data?.byteLength ?? (image?.width ?? 0) * (image?.height ?? 0) * 4 * component;
    textureBytes += supplied || Math.ceil(base * (texture.generateMipmaps ? 4 / 3 : 1));
  }
  return {
    geometryBytesEstimate: [...buffers].reduce((total, item) => total + item.array.byteLength, 0),
    textureBytesEstimate: textureBytes,
  };
}

/** Upload material maps ahead of the first biome frame, outside the simulation loop. */
export function materialTextures(root: Object3D) {
  return collect([root]).textures;
}
