/** Original QRacer four-bar score: A minor, 112 BPM. No sampled recordings. */
export const score = [
  69, 72, 76, 72, 67, 71, 74, 71, 65, 69, 72, 76, 67, 71, 74, 79, 69, 76, 72, 81, 67, 74, 71, 79,
  65, 72, 69, 76, 64, 67, 71, 76,
] as const;
export const bass = [45, 43, 41, 40] as const;
export const beatSeconds = 60 / 112;
export const noteFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
