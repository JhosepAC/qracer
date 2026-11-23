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
  const models = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(textures);
  return { models, dispose: () => textures.dispose() };
}
