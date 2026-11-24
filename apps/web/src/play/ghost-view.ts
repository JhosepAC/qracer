import { InstancedMesh, MeshBasicMaterial, type Object3D } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { assetRoot, materialParts } from "../graphics/batching.ts";

/** Reuse the original Blender coupe silhouette with one translucent draw and no shadow. */
export function ghostMesh(car: Object3D) {
  const parts = materialParts(assetRoot(car, "qracer_lod", 1), car);
  const geometries = parts.map(({ geometry }) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    for (const name of Object.keys(flat.attributes))
      if (name !== "position") flat.deleteAttribute(name);
    return flat;
  });
  const geometry = mergeGeometries(geometries);
  for (const part of geometries) part.dispose();
  if (!geometry) throw new Error("Incompatible ghost silhouette");
  const material = new MeshBasicMaterial({
    color: 0x67e8db,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new InstancedMesh(geometry, material, 1);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}
