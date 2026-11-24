import { expect, it } from "vitest";
import { audioSettings, defaultAudio, VoiceBudget } from "./audio-settings.ts";
import { noteFrequency, score } from "./music.ts";

it("clamps malformed audio preferences and preserves a reliable mute switch", () => {
  expect(audioSettings(null)).toEqual(defaultAudio);
  expect(audioSettings({ muted: true, master: 99, music: -4, effects: NaN })).toEqual({
    muted: true,
    master: 1,
    music: 0,
    effects: defaultAudio.effects,
  });
  expect(audioSettings({ muted: "false", master: "1" })).toEqual(defaultAudio);
});
it("reserves the eight-voice budget for important feedback and expires old voices", () => {
  const voices = new VoiceBudget();
  const slots = Array.from({ length: 8 }, () => voices.claim(2, 10, 0));
  expect(voices.claim(0, 10, 0)).toBeUndefined();
  const impact = voices.claim(3, 10, 0);
  expect(impact?.victim).toBe(slots[0]?.id);
  expect(voices.size).toBe(8);
  expect(voices.claim(0, 20, 11)?.victim).toBeUndefined();
  expect(voices.size).toBe(1);
  voices.clear();
  expect(voices.size).toBe(0);
});
it("uses a finite original score with bounded audible pitches", () => {
  expect(noteFrequency(69)).toBeCloseTo(440);
  expect(score.every((note) => noteFrequency(note) > 100 && noteFrequency(note) < 2000)).toBe(true);
});
