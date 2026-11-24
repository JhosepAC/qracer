import {
  BufferAttribute,
  type BufferGeometry,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Asset roots have stable metadata; exported node names are intentionally irrelevant. */
export function assetRoot(scene: Object3D, property: string, value: string | number): Object3D {
  let found: Object3D | undefined;
  scene.traverse((node) => {
    if (node.userData[property] === value) found = node;
  });
  if (!found) throw new Error(`Missing asset ${property}`);
  return found;
}

export function materialParts(
  root: Object3D,
  modelSpace = root,
): { geometry: BufferGeometry; material: Material }[] {
  root.updateWorldMatrix(true, true);
  const inverse = new Matrix4().copy(modelSpace.matrixWorld).invert();
  const groups = new Map<Material, BufferGeometry[]>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    if (Array.isArray(node.material)) throw new Error("Expected glTF material primitives");
    const geometry = node.geometry.clone();
    // Meshopt can store normalized integers and put the decode transform on the
    // node. Baking that transform into another integer attribute clips positions.
    for (const name of ["position", "normal", "tangent", "uv", "uv1", "color"]) {
      const source = geometry.getAttribute(name);
      if (!source || source.array instanceof Float32Array) continue;
      const values = new Float32Array(source.count * source.itemSize);
      for (let i = 0; i < source.count; i++)
        for (let component = 0; component < source.itemSize; component++)
          values[i * source.itemSize + component] = source.getComponent(i, component);
      geometry.setAttribute(name, new BufferAttribute(values, source.itemSize));
    }
    geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, node.matrixWorld));
    const group = groups.get(node.material) ?? [];
    group.push(geometry);
    groups.set(node.material, group);
  });
  return [...groups].map(([material, geometries]) => {
    const geometry = mergeGeometries(geometries);
    for (const part of geometries) part.dispose();
    if (!geometry) throw new Error("Incompatible asset attributes");
    return { geometry, material };
  });
}
