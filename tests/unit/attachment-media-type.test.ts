import { describe, it, expect } from "vitest";
import {
  deriveAttachmentMediaType,
  getAttachmentValidationError,
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
} from "@/modules/communication/lib/attachment-media-type";

describe("deriveAttachmentMediaType", () => {
  it("maps image/* to image", () => {
    expect(deriveAttachmentMediaType("image/png")).toBe("image");
    expect(deriveAttachmentMediaType("image/jpeg")).toBe("image");
    expect(deriveAttachmentMediaType("image/webp")).toBe("image");
  });

  it("maps video/* to video", () => {
    expect(deriveAttachmentMediaType("video/mp4")).toBe("video");
    expect(deriveAttachmentMediaType("video/quicktime")).toBe("video");
  });

  it("maps documents (pdf, office) to document", () => {
    expect(deriveAttachmentMediaType("application/pdf")).toBe("document");
    expect(deriveAttachmentMediaType("application/vnd.ms-excel")).toBe("document");
    expect(
      deriveAttachmentMediaType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("document");
  });

  it("maps audio to document (voice notes have their own flow)", () => {
    expect(deriveAttachmentMediaType("audio/mpeg")).toBe("document");
    expect(deriveAttachmentMediaType("audio/ogg")).toBe("document");
  });

  it("is case-insensitive on the MIME string", () => {
    expect(deriveAttachmentMediaType("IMAGE/PNG")).toBe("image");
    expect(deriveAttachmentMediaType("Video/MP4")).toBe("video");
  });

  it("defaults empty/unknown/null MIME to document", () => {
    expect(deriveAttachmentMediaType("")).toBe("document");
    expect(deriveAttachmentMediaType(null)).toBe("document");
    expect(deriveAttachmentMediaType(undefined)).toBe("document");
    expect(deriveAttachmentMediaType("application/octet-stream")).toBe("document");
  });
});

describe("shared attachment constants", () => {
  it("accept list covers image, video and business documents (PDF, NF-e XML, ZIP)", () => {
    for (const token of ["image/*", "video/*", "application/pdf", ".docx", ".xlsx", ".csv", ".xml", ".zip"]) {
      expect(ATTACHMENT_ACCEPT).toContain(token);
    }
  });

  it("accept list excludes audio (voice notes have their own flow)", () => {
    expect(ATTACHMENT_ACCEPT).not.toContain("audio");
  });

  it("size cap is 16MB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(16 * 1024 * 1024);
  });
});

describe("getAttachmentValidationError", () => {
  it("rejects empty files (0 bytes)", () => {
    expect(getAttachmentValidationError({ size: 0 })).toMatch(/vazio/);
  });

  it("rejects files above the 16MB cap", () => {
    expect(getAttachmentValidationError({ size: MAX_ATTACHMENT_BYTES + 1 })).toMatch(/16MB/);
  });

  it("accepts files within bounds (including exactly 16MB)", () => {
    expect(getAttachmentValidationError({ size: 1 })).toBeNull();
    expect(getAttachmentValidationError({ size: MAX_ATTACHMENT_BYTES })).toBeNull();
  });
});
