import {
  BackSide,
  Color,
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  PMREMGenerator,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type WebGLRenderer,
} from "three";

export const horizon = new Color(0xe4a590);
export const sunDirection = new Vector3(0.43, 0.15, -0.89).normalize();
const zenith = new Color(0x283c62);
const afterglow = new Color(0xffbb78);

const vertexShader = `
  varying vec3 world;
  void main() {
    world = (modelMatrix * vec4(position, 1.)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;

const lightUniforms = () => ({
  horizon: { value: horizon.clone() },
  zenith: { value: zenith.clone() },
  sun: { value: sunDirection.clone() },
});

export function coastalSky() {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: { ...lightUniforms(), daylight: { value: 1 } },
    vertexShader,
    fragmentShader: `
      uniform vec3 horizon, zenith, sun;
      uniform float daylight;
      varying vec3 world;
      void main() {
        vec3 ray = normalize(world - cameraPosition);
        float height = max(ray.y, 0.);
        float bearing = atan(ray.x, -ray.z);
        float light = max(dot(ray, sun), 0.);
        vec3 sky = mix(horizon, zenith, pow(smoothstep(0., .58, height), .7));
        sky += vec3(.41, .13, .034) * pow(light, 13.) * exp(-height * 3.);
        float clouds = sin(bearing * 16. + height * 57.) * .52 +
          sin(bearing * 42. - height * 111.) * .27 +
          sin(bearing * 7. + height * 184.) * .21;
        float veil = smoothstep(.19, .77, clouds) * smoothstep(.03, .085, height) *
          (1. - smoothstep(.15, .48, height));
        sky = mix(sky, vec3(.36, .14, .19) + pow(light, 7.) * vec3(.42, .13, .02), veil * .52);
        float disc = smoothstep(.99958, .99974, light);
        sky += vec3(1., .55, .23) * (.33 * pow(light, 92.) + disc) * daylight;

        float headland = exp(-pow(abs(bearing + .61) * 2.65, 2.));
        float islands = exp(-pow(abs(bearing - .73) * 5.3, 2.)) +
          .56 * exp(-pow(abs(bearing - .44) * 8.7, 2.));
        float ridge = .003 + (.014 + .006 * sin(bearing * 35.) +
          .004 * sin(bearing * 87.)) * islands;
        float cliffs = .008 + headland * (.097 + .014 * sin(bearing * 21.) +
          .009 * sin(bearing * 51.));
        sky = mix(sky, vec3(.33, .208, .22), (1. - smoothstep(ridge, ridge + .004, ray.y)) * .75);
        sky = mix(sky, vec3(.195, .133, .17),
          (1. - smoothstep(cliffs, cliffs + .005, ray.y)) * headland * .9);
        gl_FragColor = vec4(sky, 1.);
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new Mesh(new SphereGeometry(420, 32, 16), material);
  sky.renderOrder = 5;
  return sky;
}

export function coastalWater(detail: boolean) {
  const time = { value: 0 };
  const offset = { value: 0 };
  const material = new ShaderMaterial({
    toneMapped: false,
    defines: { DETAILED_WATER: detail ? 1 : 0 },
    uniforms: {
      ...lightUniforms(),
      time,
      offset,
    },
    vertexShader,
    fragmentShader: `
      uniform vec3 horizon, sun;
      uniform float time, offset;
      varying vec3 world;
      void main() {
        vec3 toward = world - cameraPosition;
        float distanceToEye = length(toward);
        vec3 ray = toward / max(distanceToEye, .001);
        vec2 sea = vec2(world.x, world.z - offset);
        float depth = smoothstep(6., 210., distanceToEye);
        float a = sin(sea.x * .23 + sea.y * .64 - time * .9);
        float b = sin(sea.x * .51 - sea.y * .29 + time * .53);
        float ripple = .64 * a + .36 * b;
        #if DETAILED_WATER
          ripple += .22 * sin(sea.x * 2.24 + sea.y * .97 - time) *
            (1. - smoothstep(45., 135., distanceToEye));
        #endif
        float glitter = pow(max(dot(normalize(vec3(ray.x, -ray.y + ripple * .022, ray.z)), sun), 0.), 21.);
        vec3 water = mix(vec3(.028, .16, .18), vec3(.047, .145, .20), depth);
        water += ripple * vec3(.015, .034, .036) * (1. - depth * .86);
        water += glitter * (0.28 + smoothstep(.12, .91, ripple) * .48) * vec3(.95, .41, .14);
        vec3 color = mix(water, horizon * vec3(.82,.70,.76), smoothstep(106., 405., distanceToEye));
        gl_FragColor = vec4(color, 1.);
        #include <colorspace_fragment>
      }
    `,
  });
  return {
    mesh: new Mesh(new PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2), material),
    update(seconds: number, distance: number) {
      time.value = seconds;
      offset.value = distance;
    },
  };
}

/** Small authored HDR sky keeps the coupe's glass and bodywork readable on both sides. */
export function coastalReflections(renderer: WebGLRenderer) {
  const width = 128;
  const height = 64;
  const pixels = new Uint16Array(width * height * 4);
  const color = new Color();
  const direction = new Vector3();
  for (let y = 0; y < height; y++) {
    const latitude = ((y + 0.5) / height - 0.5) * Math.PI;
    const radius = Math.cos(latitude);
    for (let x = 0; x < width; x++) {
      const angle = ((x + 0.5) / width - 0.5) * Math.PI * 2;
      direction.set(radius * Math.cos(angle), Math.sin(latitude), radius * Math.sin(angle));
      const facing = Math.max(0, direction.dot(sunDirection));
      color.copy(horizon).lerp(zenith, Math.min(1, Math.abs(direction.y) * 1.2));
      if (direction.y < 0) color.multiplyScalar(0.29);
      const glow = facing ** 38 * 4;
      const at = (y * width + x) * 4;
      pixels[at] = DataUtils.toHalfFloat(color.r + afterglow.r * glow);
      pixels[at + 1] = DataUtils.toHalfFloat(color.g + afterglow.g * glow);
      pixels[at + 2] = DataUtils.toHalfFloat(color.b + afterglow.b * glow);
      pixels[at + 3] = DataUtils.toHalfFloat(1);
    }
  }
  const sky = new DataTexture(pixels, width, height, RGBAFormat, HalfFloatType);
  sky.mapping = EquirectangularReflectionMapping;
  sky.minFilter = sky.magFilter = LinearFilter;
  sky.needsUpdate = true;
  const generator = new PMREMGenerator(renderer);
  try {
    return generator.fromEquirectangular(sky);
  } finally {
    generator.dispose();
    sky.dispose();
  }
}
