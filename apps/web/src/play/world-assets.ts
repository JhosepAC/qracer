import {
  Mesh as SceneMesh,
  type Material,
  type Mesh,
  type InstancedMesh,
  type Object3D,
  type WebGLRenderer,
} from "three";
import { assetRoot } from "../graphics/batching.ts";
import { raceAssetLoader } from "./race-assets.ts";
import type { Biome } from "./biomes.ts";

type Batch = InstancedMesh<Mesh["geometry"], Material>[];
export async function loadWorldAsset(name: string, renderer: WebGLRenderer, signal: AbortSignal) {
  const response = await fetch(`/assets/world/${name}.glb`, { signal });
  if (!response.ok) throw new Error("No se pudo descargar el siguiente entorno.");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error("Modelo fuera de presupuesto.");
  const loader = raceAssetLoader(renderer);
  try {
    const model = await loader.models.parseAsync(buffer, "");
    if (signal.aborted) {
      model.scene.traverse((node) => {
        if (node instanceof SceneMesh) {
          node.geometry.dispose();
          for (const material of Array.isArray(node.material) ? node.material : [node.material])
            material.dispose();
        }
      });
      signal.throwIfAborted();
    }
    return model.scene;
  } finally {
    loader.dispose();
  }
}

export function worldAssets(
  renderer: WebGLRenderer,
  signal: AbortSignal,
  roots: Object3D[],
  batch: (root: Object3D, count: number, space?: Object3D) => Batch,
  changed: () => void,
) {
  const kits = new Map<Biome, Record<string, Batch>>();
  const pending = new Map<Biome, Promise<void>>();
  const batches: Batch[] = [];
  async function load(key: Biome) {
    if (key === "coast" || kits.has(key)) return;
    const existing = pending.get(key);
    if (existing) return existing;
    const request = (async () => {
      const model = await loadWorldAsset(key, renderer, signal);
      roots.push(model);
      const names =
        key === "city" ? ["arcology", "portal", "bridge"] : ["mesa", "cactus", "portal", "bridge"];
      const kit: Record<string, Batch> = {};
      for (const name of names) {
        const instances = batch(
          assetRoot(model, "qracer_asset", name),
          name === "arcology" ? 24 : 18,
          model,
        );
        kit[name] = instances;
        batches.push(instances);
      }
      kits.set(key, kit);
      changed();
    })();
    pending.set(key, request);
    try {
      await request;
    } finally {
      pending.delete(key);
    }
  }
  return { kits, batches, load, ready: (key: Biome) => key === "coast" || kits.has(key) };
}
