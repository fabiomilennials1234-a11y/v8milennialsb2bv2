import { describe, it, expect } from "vitest";
import {
  validateBlastMedia,
  BLAST_MEDIA_LIMITS_MB,
} from "../../src/modules/communication/lib/blast-media-validator";

const MB = 1024 * 1024;

describe("validateBlastMedia — accepting valid media", () => {
  it("accepts an image at/under its size limit", () => {
    expect(validateBlastMedia("image", 4 * MB)).toEqual({ ok: true });
    expect(validateBlastMedia("image", 5 * MB)).toEqual({ ok: true }); // boundary
  });
});

describe("validateBlastMedia — rejecting oversized media", () => {
  it("rejects a file over its limit, reporting the type's maxMb", () => {
    const r = validateBlastMedia("image", 6 * MB);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.maxMb).toBe(5);
  });

  it("applies each type's own limit", () => {
    expect(validateBlastMedia("audio", 16 * MB).ok).toBe(true);
    expect(validateBlastMedia("audio", 17 * MB).ok).toBe(false);
    expect(validateBlastMedia("video", 17 * MB).ok).toBe(false);
    expect(validateBlastMedia("pdf", 20 * MB).ok).toBe(true);
    expect(validateBlastMedia("pdf", 21 * MB).ok).toBe(false);
  });

  it("rejects an unknown media type instead of crashing", () => {
    // a stray type from JS callers (not type-checked at the boundary)
    const r = validateBlastMedia("gif" as unknown as "image", 1 * MB);
    expect(r.ok).toBe(false);
  });

  it("rejects an empty (zero-byte) file", () => {
    expect(validateBlastMedia("image", 0).ok).toBe(false);
  });
});
