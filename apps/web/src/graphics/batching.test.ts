import {
  BufferGeometry,
  Group,
  Int16BufferAttribute,
  Int8BufferAttribute,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { expect, it } from "vitest";
import { materialParts } from "./batching.ts";

it("bakes the node transform of quantized geometry without clipping it", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Int16BufferAttribute([0, 0, 0, 32767, 0, 0, 0, 0, 32767], 3, true),
  );
  geometry.setAttribute(
    "normal",
    new Int8BufferAttribute([0, 127, 0, 0, 127, 0, 0, 127, 0], 3, true),
  );
  const material = new MeshStandardMaterial();
  const mesh = new Mesh(geometry, material);
  mesh.position.set(3, 2, -5);
  mesh.scale.set(8, 5, 4);
  mesh.rotation.z = Math.PI / 2;
  const root = new Group();
  root.position.set(100, 7, 25);
  root.add(mesh);

  const [part] = materialParts(root);
  if (!part) throw new Error("Missing batched primitive");
  const positions = part.geometry.getAttribute("position");
  expect(Array.from(positions.array)).toEqual([3, 2, -5, 3, 10, -5, 3, 2, -1]);
  const normals = part.geometry.getAttribute("normal");
  expect(normals.getX(0)).toBeCloseTo(-1);
  expect(normals.getY(0)).toBeCloseTo(0);
  material.dispose();
  geometry.dispose();
  part.geometry.dispose();
});
