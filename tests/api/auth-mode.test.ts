import { describe, expect, it } from "../test-deps.ts";
import { normalizeAuthMode } from "../../server/lib/auth.ts";

describe("normalizeAuthMode", () => {
  it("trims whitespace around none mode values", () => {
    expect(normalizeAuthMode("none\n")).toBe("none");
    expect(normalizeAuthMode("  none  ")).toBe("none");
  });

  it("trims whitespace around smart-backend mode values", () => {
    expect(normalizeAuthMode("smart-backend\n")).toBe("smart-backend");
  });

  it("falls back to none for unknown values", () => {
    expect(normalizeAuthMode("")).toBe("none");
    expect(normalizeAuthMode("unexpected")).toBe("none");
    expect(normalizeAuthMode(undefined)).toBe("none");
  });
});
