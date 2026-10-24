import { describe, expect, it } from "vitest";
import { isStaleChunkError } from "@/core/stale-build-recovery";

describe("isStaleChunkError (clássica)", () => {
  it("reconhece chunk velho", () => {
    expect(isStaleChunkError(new Error("Failed to fetch dynamically imported module: /assets/X-abc.js"))).toBe(true);
    expect(isStaleChunkError(new Error("Unexpected token '<'"))).toBe(true);
  });

  it("não confunde JSON.parse de página HTML (API 502/504) com chunk velho", () => {
    expect(
      isStaleChunkError(new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`)),
    ).toBe(false);
  });
});
