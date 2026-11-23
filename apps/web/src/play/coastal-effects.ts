import { type Race, randomWord, roadPose, TICK_HZ } from "@qracer/game-core";
import {
  AdditiveBlending,
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
} from "three";

interface Particle {
  at: number;
  life: number;
  distance: number;
  lane: number;
  drift: number;
  speed: number;
  spark: boolean;
}

export function coastalEffects(capacity: number) {
  const particles = Array.from(
    { length: capacity },
    (): Particle => ({
      at: -Infinity,
      life: 0,
      distance: 0,
      lane: 0,
      drift: 0,
      speed: 0,
      spark: false,
    }),
  );
  const geometry = new BufferGeometry();
  const positions = new Float32BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(
    DynamicDrawUsage,
  );
  const effects = new Float32BufferAttribute(new Float32Array(capacity * 2), 2).setUsage(
    DynamicDrawUsage,
  );
  geometry.setAttribute("position", positions);
  geometry.setAttribute("effect", effects);
  geometry.setDrawRange(0, 0);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: `
      attribute vec2 effect;
      varying vec2 sprite;
      void main() {
        vec4 eye = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * eye;
        gl_PointSize = clamp(mix(42., 75., effect.y) / max(1., -eye.z), 1., 16.);
        sprite = effect;
      }
    `,
    fragmentShader: `
      varying vec2 sprite;
      void main() {
        float radius = length(gl_PointCoord - .5) * 2.;
        vec3 color = mix(vec3(.10, .60, 1.), vec3(1., .43, .10), sprite.y);
        float opacity = (1. - smoothstep(.12, 1., radius)) * sprite.x * .8;
        gl_FragColor = vec4(color, opacity);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new Points(geometry, material);
  mesh.frustumCulled = false;
  const pose = { x: 0, z: 0, heading: 0 };
  let previousTick = -1;
  let integrity = 0;
  let cursor = 0;

  return {
    mesh,
    update(state: Race, tick: number, origin: number, reducedMotion: boolean) {
      if (reducedMotion || state.phase === "countdown" || state.tick < previousTick) {
        for (const particle of particles) particle.at = -Infinity;
        geometry.setDrawRange(0, 0);
        previousTick = state.tick;
        integrity = state.driver.integrity;
        return;
      }
      if (state.tick !== previousTick) {
        const hit = integrity > state.driver.integrity;
        const amount = hit ? capacity / 4 : state.driver.boosting && state.tick % 3 === 0 ? 2 : 0;
        for (let i = 0; i < amount; i++) {
          const particle = particles[cursor];
          if (!particle) break;
          const r = randomWord(state.seed, state.tick, 120 + i) / 0xffffffff;
          particle.at = tick;
          particle.life = hit ? 0.26 + r * 0.17 : 0.19;
          particle.distance = state.driver.s + (hit ? 0.8 : -2.15);
          particle.lane = state.driver.d + (i % 2 === 0 ? -0.51 : 0.51);
          particle.drift = (r - 0.5) * (hit ? 8.4 : 1.5);
          particle.speed = state.driver.speed * (hit ? 0.66 : 0.82);
          particle.spark = hit;
          cursor = (cursor + 1) % capacity;
        }
        previousTick = state.tick;
        integrity = state.driver.integrity;
      }
      let count = 0;
      for (const particle of particles) {
        const age = (tick - particle.at) / TICK_HZ;
        if (age < 0 || age >= particle.life) continue;
        const height = particle.spark ? 0.4 + age * (3.8 - age * 8) : 0.25 + age * 0.6;
        roadPose(
          particle.distance + age * particle.speed,
          particle.lane + age * particle.drift,
          origin,
          pose,
        );
        positions.setXYZ(count, pose.x, height, pose.z);
        effects.setXY(count, 1 - age / particle.life, Number(particle.spark));
        count++;
      }
      positions.needsUpdate = effects.needsUpdate = true;
      geometry.setDrawRange(0, count);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
