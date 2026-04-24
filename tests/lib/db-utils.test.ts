import { describe, it, expect } from "vitest";
import { asStringArray, asString, asNumber } from "@/lib/db-utils";

describe("asStringArray", () => {
  it("returns empty array for null/undefined/non-array", () => {
    expect(asStringArray(null)).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
    expect(asStringArray("not-an-array")).toEqual([]);
    expect(asStringArray(42)).toEqual([]);
    expect(asStringArray({})).toEqual([]);
  });

  it("filters out non-string elements", () => {
    expect(asStringArray(["a", 1, null, "b", undefined, { x: 1 }])).toEqual(["a", "b"]);
  });

  it("passes through a clean string array", () => {
    expect(asStringArray(["alpha", "beta", "gamma"])).toEqual(["alpha", "beta", "gamma"]);
  });

  it("handles empty array", () => {
    expect(asStringArray([])).toEqual([]);
  });
});

describe("asString", () => {
  it("returns empty string for null/undefined", () => {
    expect(asString(null)).toBe("");
    expect(asString(undefined)).toBe("");
  });

  it("passes through defined strings", () => {
    expect(asString("hello")).toBe("hello");
    expect(asString("")).toBe("");
  });
});

describe("asNumber", () => {
  it("returns fallback for null/undefined", () => {
    expect(asNumber(null)).toBe(0);
    expect(asNumber(undefined)).toBe(0);
    expect(asNumber(null, 42)).toBe(42);
  });

  it("passes through defined numbers, including 0", () => {
    expect(asNumber(0)).toBe(0);
    expect(asNumber(100)).toBe(100);
    expect(asNumber(-5)).toBe(-5);
  });
});
