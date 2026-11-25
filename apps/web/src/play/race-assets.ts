import { LoadingManager, type WebGLRenderer } from "three";
import basisScript from "three/addons/libs/basis/basis_transcoder.js?url&no-inline";
import basisWasm from "three/addons/libs/basis/basis_transcoder.wasm?url&no-inline";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

const script = "basis_transcoder.js";
const wasm = "basis_transcoder.wasm";

export function raceAssetLoader(renderer: WebGLRenderer) {
  const manager = new LoadingManager().setURLModifier((url) => {
    if (url === script) return basisScript;
    if (url === wasm) return basisWasm;
    return url;
  });
  const textures = new KTX2Loader(manager).setWorkerLimit(1).detectSupport(renderer);
  const initialize = textures.init.bind(textures);
  let ready: Promise<void> | undefined;
  // Three r187's Basis glue uses dynamic invokers. A named worker lets its CSP
  // be isolated from documents; initialization/transfers retain the pinned loader contract.
  textures.init = () => {
    ready ??= initialize().then(() => {
      textures.workerPool.setWorkerCreator(() => {
        const binary = textures.transcoderBinary;
        if (!binary) throw new Error("Texture decoder did not initialize");
        const worker = new Worker("/decoder-worker.js", { name: "qracer-textures" });
        worker.postMessage({ type: "load-decoder", source: textures.workerSourceURL });
        const transcoderBinary = binary.slice(0);
        worker.postMessage({ type: "init", config: textures.workerConfig, transcoderBinary }, [
          transcoderBinary,
        ]);
        return worker;
      });
    });
    return ready;
  };
  const models = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(textures);
  return { models, dispose: () => textures.dispose() };
}
