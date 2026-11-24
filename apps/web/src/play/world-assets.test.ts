import { expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type WebGLRenderer,
} from "three";
import { worldAssets } from "./world-assets.ts";
import { disposeObjects } from "../graphics/resources.ts";

it("deduplicates pending loads and rolls back a failed warm-up before retrying", async () => {
  const scene = new Group(),
    roots: Object3D[] = [scene];
  const models: Group[] = [];
  const load = vi.fn(async () => {
    const model = new Group();
    for (const name of ["mesa", "cactus", "portal", "bridge"]) {
      const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
      mesh.userData.qracer_asset = name;
      model.add(mesh);
    }
    models.push(model);
    return model;
  });
  let fail = true;
  const world = worldAssets(
    {} as WebGLRenderer,
    new AbortController().signal,
    roots,
    (root, count) => {
      const source = root as Mesh<BoxGeometry, MeshBasicMaterial>;
      const mesh = new InstancedMesh(source.geometry.clone(), source.material, count);
      scene.add(mesh);
      return [mesh];
    },
    () => {},
    async () => {
      if (fail) throw new Error("compile failed");
    },
    load,
  );
  const pending = world.load("desert"),
    duplicate = world.load("desert");
  expect(load).toHaveBeenCalledTimes(1);
  const results = await Promise.allSettled([pending, duplicate]);
  expect(results.every((item) => item.status === "rejected")).toBe(true);
  expect(world.ready("desert")).toBe(false);
  expect(world.batches).toHaveLength(0);
  expect(scene.children).toHaveLength(0);
  expect(roots).toHaveLength(1);
  fail = false;
  await world.load("desert");
  expect(load).toHaveBeenCalledTimes(2);
  expect(world.ready("desert")).toBe(true);
  expect(world.batches).toHaveLength(4);
  expect(roots).toHaveLength(2);
  disposeObjects(roots);
});

it("does not dispose twice when the owner aborts during shader preparation", async () => {
  const scene = new Group(),
    roots: Object3D[] = [scene],
    abort = new AbortController();
  const material = new MeshBasicMaterial(),
    geometry = new BoxGeometry();
  const released = vi.spyOn(material, "dispose");
  const model = new Group();
  for (const name of ["mesa", "cactus", "portal", "bridge"]) {
    const mesh = new Mesh(geometry, material);
    mesh.userData.qracer_asset = name;
    model.add(mesh);
  }
  const world = worldAssets(
    {} as WebGLRenderer,
    abort.signal,
    roots,
    (root, count) => {
      const mesh = new InstancedMesh((root as Mesh).geometry.clone(), material, count);
      scene.add(mesh);
      return [mesh];
    },
    () => {},
    async () => {
      abort.abort();
      disposeObjects(roots);
      world.clear();
      scene.clear();
      roots.length = 0;
    },
    async () => model,
  );
  await expect(world.load("desert")).rejects.toThrow();
  expect(released).toHaveBeenCalledTimes(1);
  expect(roots).toHaveLength(0);
});
