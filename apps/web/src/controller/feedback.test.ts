import { expect, it } from "vitest";
import { FeedbackWindow } from "./options.ts";

it("discards expired or duplicate feedback and limits pulse frequency per epoch", () => {
  const window = new FeedbackWindow();
  expect(window.accept(1, undefined, 100)).toBe(false);
  expect(window.accept(2, 95, 101)).toBe(true);
  expect(window.accept(2, 96, 400)).toBe(false);
  expect(window.accept(3, 120, 150)).toBe(false);
  expect(window.accept(3, 120, 500)).toBe(false);
  expect(window.accept(4, 500, 501)).toBe(true);
  window.reset();
  expect(window.accept(1, 520, 521)).toBe(true);
});

it("lets an impact preempt a lower pulse but never replays stale or invalid feedback", () => {
  const window = new FeedbackWindow();
  expect(window.accept(1, 100, 100, 0)).toBe(true);
  expect(window.accept(2, 120, 120, 2)).toBe(true);
  expect(window.accept(3, 130, 130, 1)).toBe(false);
  expect(window.accept(3, 300, 300, 2)).toBe(false);
  expect(window.accept(4, NaN, 400, 2)).toBe(false);
  expect(window.accept(4, 401, 400, 2)).toBe(false);
  expect(window.accept(4, 99, 400, 2)).toBe(false);
  expect(window.accept(4, 400, 400, 2)).toBe(true);
});
