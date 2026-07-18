import { describe, expect, it } from "vitest";
import { defaultStyle, learnStyleFromText } from "../src/persist.js";

describe("learnStyleFromText", () => {
  it("captures preferences", () => {
    const style = defaultStyle();
    learnStyleFromText(
      style,
      "Blake prefers Svelte and SQLite with no unnecessary abstractions",
    );
    expect(style.prefers.some((p) => /Svelte/i.test(p))).toBe(true);
    expect(style.prefers.some((p) => /SQLite/i.test(p))).toBe(true);
    expect(style.prefers.some((p) => /unnecessary abstractions/i.test(p))).toBe(
      true,
    );
  });
});
