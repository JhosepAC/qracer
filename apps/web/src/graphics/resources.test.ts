import { describe, expect, it, vi } from "vitest";
import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Points,
  ShaderMaterial,
} from "three";
import { disposeObjects, resourceBytes } from "./resources.ts";
import { coastalSky, horizon } from "../play/coastal-light.ts";

describe("graphics ownership", () => {
  it("keeps scene lighting independent across restarts", () => {
    const first = coastalSky(),
      second = coastalSky();
    expect(first.material.uniforms.horizon?.value).not.toBe(horizon);
    first.material.uniforms.horizon?.value.set(0);
    expect(second.material.uniforms.horizon?.value).toEqual(horizon);
    disposeObjects([first, second]);
  });
  it("deduplicates shared resources, points, uniforms and instance buffers", () => {
    const root = new Group(),
      geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const map = new DataTexture(new Uint8Array(16), 2, 2);
    map.generateMipmaps = false;
    const material = new MeshBasicMaterial({ map, alphaMap: map });
    const shader = new ShaderMaterial({ uniforms: { maps: { value: [map] } } });
    const mesh = new InstancedMesh(geometry, material, 2);
    root.add(mesh, new Mesh(geometry, material), new Points(geometry, shader));
    const counts = [
      vi.spyOn(geometry, "dispose"),
      vi.spyOn(map, "dispose"),
      vi.spyOn(material, "dispose"),
      vi.spyOn(shader, "dispose"),
      vi.spyOn(mesh, "dispose"),
    ];
    expect(resourceBytes([root, root])).toEqual({
      geometryBytesEstimate: 36 + 128,
      textureBytesEstimate: 16,
    });
    disposeObjects([root, root]);
    for (const count of counts) expect(count).toHaveBeenCalledTimes(1);
  });
});
