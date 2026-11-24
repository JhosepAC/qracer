import { arc, SEGMENT_LENGTH, type RoadPose } from "@qracer/game-core";
import { Color, Float32BufferAttribute, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";

export const BIOMES = ["coast", "desert", "city"] as const;
export type Biome = (typeof BIOMES)[number];
export const BIOME_LENGTH = 1152;
export const biomeNames = { coast: "Costa", desert: "Desierto", city: "Ciudad nocturna" };
export const themes = {
  coast: { horizon: 0xe4a590, zenith: 0x283c62, light: 3.6, exposure: 1.08, sun: 0xffca9a },
  desert: { horizon: 0xd7a16b, zenith: 0x4c3558, light: 3.9, exposure: 1.05, sun: 0xffba76 },
  city: { horizon: 0x20373d, zenith: 0x080f21, light: 0.85, exposure: 1.1, sun: 0x9acdda },
};
export function biomeAt(distance: number, initial: Biome = "coast"): Biome {
  const index = Math.max(0, Math.floor(distance / BIOME_LENGTH));
  return BIOMES[(index + BIOMES.indexOf(initial)) % BIOMES.length] ?? "coast";
}

/** One shared material; each tile carries baked colors and bends to the road. */
const terrainMaterial = () => new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
export function terrainTile(biome: Biome, curvature: number) {
  const geometry = new PlaneGeometry(160, SEGMENT_LENGTH, 40, 8).rotateX(-Math.PI / 2);
  const points = geometry.getAttribute("position");
  const colors = new Float32Array(points.count * 3);
  const low = new Color(biome === "city" ? 0x242f34 : biome === "desert" ? 0xa5764a : 0x6d7962);
  const high = new Color(biome === "city" ? 0x4a5557 : biome === "desert" ? 0xd6aa70 : 0xa68c6c);
  const color = new Color();
  const center: RoadPose = { x: 0, z: 0, heading: 0 };
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i);
    const z = points.getZ(i);
    const outside = Math.max(0, Math.abs(x) - 8);
    const noise = Math.cos((z * Math.PI) / 12) * Math.sin(x * 0.39);
    const height =
      biome === "city"
        ? -0.24
        : biome === "coast"
          ? x > 7
            ? -4
            : -0.24 + 4.5 * (Math.max(0, -x - 10) / 65) ** 1.65
          : -0.24 + outside ** 1.25 * 0.09 * (1 + noise * 0.22);
    arc(SEGMENT_LENGTH / 2 - z, curvature, center);
    points.setXYZ(
      i,
      center.x + x * Math.cos(center.heading),
      height,
      center.z + x * Math.sin(center.heading),
    );
    color.copy(low).lerp(high, 0.45 + 0.25 * noise);
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return new Mesh(geometry, terrainMaterial());
}
