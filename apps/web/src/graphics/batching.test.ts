import { readFile } from "node:fs/promises";
import {
  Box3,
  BufferGeometry,
  Group,
  Int16BufferAttribute,
  Int8BufferAttribute,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { expect, it } from "vitest";
import { assetRoot, materialParts } from "./batching.ts";

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

it("keeps both production coupe LODs at authored scale and wheel height", async () => {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  async function load(path: string) {
    const bytes = await readFile(new URL(path, import.meta.url));
    return (await loader.parseAsync(new Uint8Array(bytes).buffer, "")).scene;
  }

  const original = await load("../../public/assets/probe/coupe.glb");
  const compressed = await load("../../public/assets/coast/coupe.glb");
  for (const lod of [0, 1]) {
    const reference = new Box3().setFromObject(assetRoot(original, "qracer_lod", lod), true);
    const model = assetRoot(compressed, "qracer_lod", lod);
    const bounds = new Box3().makeEmpty();
    for (const { geometry } of materialParts(model, compressed)) {
      geometry.computeBoundingBox();
      if (geometry.boundingBox) bounds.union(geometry.boundingBox);
      geometry.dispose();
    }
    for (const axis of ["x", "y", "z"] as const) {
      expect(bounds.min[axis]).toBeCloseTo(reference.min[axis], 3);
      expect(bounds.max[axis]).toBeCloseTo(reference.max[axis], 3);
    }
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.001);
  }
});

it("merges mixed quantized UV formats in the shipped F08 traffic without sinking wheels", async () => {
  const bytes = await readFile(new URL("../../public/assets/world/traffic.glb", import.meta.url));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const model = (await loader.parseAsync(new Uint8Array(bytes).buffer, "")).scene;
  let checked = 0;
  model.traverse((node) => {
    if (node.userData.qracer_lod === undefined) return;
    const bounds = new Box3().makeEmpty();
    for (const part of materialParts(node, model)) {
      part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) bounds.union(part.geometry.boundingBox);
      expect(part.geometry.getAttribute("uv").array).toBeInstanceOf(Float32Array);
      part.geometry.dispose();
    }
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(4);
    checked++;
  });
  expect(checked).toBe(4);
});
