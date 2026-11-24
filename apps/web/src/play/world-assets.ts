import { disposeObjects } from "../graphics/resources.ts";
import type { Material, Mesh, InstancedMesh, Object3D, WebGLRenderer } from "three";
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
      disposeObjects([model.scene]);
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
  prepare: (model: Object3D) => Promise<void> = async () => {},
  loadModel = loadWorldAsset,
) {
  const kits = new Map<Biome, Record<string, Batch>>();
  const pending = new Map<Biome, Promise<void>>();
  const batches: Batch[] = [];
  async function load(key: Biome) {
    if (key === "coast" || kits.has(key)) return;
    const existing = pending.get(key);
    if (existing) return existing;
    const request = (async () => {
      const model = await loadModel(key, renderer, signal);
      if (signal.aborted) {
        disposeObjects([model]);
        signal.throwIfAborted();
      }
      roots.push(model);
      const created: Batch[] = [];
      try {
        const names =
          key === "city"
            ? ["arcology", "portal", "bridge"]
            : ["mesa", "cactus", "portal", "bridge"];
        const kit: Record<string, Batch> = {};
        for (const name of names) {
          const instances = batch(
            assetRoot(model, "qracer_asset", name),
            name === "arcology" ? 24 : 18,
            model,
          );
          kit[name] = instances;
          batches.push(instances);
          created.push(instances);
        }
        await prepare(model);
        signal.throwIfAborted();
        kits.set(key, kit);
      } catch (error) {
        for (const group of created) {
          for (const mesh of group) mesh.removeFromParent();
          const index = batches.indexOf(group);
          if (index >= 0) batches.splice(index, 1);
        }
        const root = roots.indexOf(model);
        if (root >= 0) {
          roots.splice(root, 1);
          disposeObjects([model, ...created.flat()]);
        }
        throw error;
      }
      changed();
    })();
    pending.set(key, request);
    try {
      await request;
    } finally {
      pending.delete(key);
    }
  }
  return {
    clear: () => {
      kits.clear();
      pending.clear();
      batches.length = 0;
    },
    kits,
    batches,
    load,
    ready: (key: Biome) => key === "coast" || kits.has(key),
  };
}
