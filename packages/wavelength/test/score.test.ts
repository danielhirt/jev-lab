import { describe, expect, test } from "bun:test";
import { bandFor, closestClue, distanceTo, expectedFromProbabilities, gradeClue } from "../src/score";

describe("bands", () => {
  test("score the edges of each band", () => {
    expect(bandFor(0).points).toBe(4);
    expect(bandFor(0.35)).toEqual({ points: 4, label: "bullseye" });
    expect(bandFor(0.36).label).toBe("close");
    expect(bandFor(0.75).label).toBe("close");
    expect(bandFor(0.76).label).toBe("nearby");
    expect(bandFor(1.25).label).toBe("nearby");
    expect(bandFor(1.26).label).toBe("off");
    expect(bandFor(2).label).toBe("off");
    expect(bandFor(2.01)).toEqual({ points: 0, label: "miss" });
  });
});

describe("gradeClue", () => {
  test("uses absolute distance from the target", () => {
    expect(distanceTo(1.2, 0.8)).toBeCloseTo(0.4);
    const graded = gradeClue("mustard", 1.2, 0.8, 0.7, [0.4, 0.4, 0.2, 0, 0]);
    expect(graded.distance).toBeCloseTo(0.4);
    expect(graded.band).toBe("close");
    expect(graded.points).toBe(3);
  });

  test("expected level is the probability-weighted index", () => {
    expect(expectedFromProbabilities([0.5, 0.5, 0, 0, 0])).toBeCloseTo(0.5);
    expect(expectedFromProbabilities([0, 0, 0, 0.25, 0.75])).toBeCloseTo(3.75);
  });
});

describe("closestClue", () => {
  test("keeps the earlier clue when distances tie", () => {
    const a = gradeClue("a", 2, 1, 0.5, [0, 1, 0, 0, 0]);
    const b = gradeClue("b", 2, 3, 0.9, [0, 0, 0, 1, 0]);
    const c = gradeClue("c", 2, 2, 0.2, [0, 0, 1, 0, 0]);
    expect(closestClue([a, b, c])?.clue).toBe("c");
    expect(closestClue([a, b])?.clue).toBe("a");
    expect(closestClue([])).toBeNull();
  });
});
