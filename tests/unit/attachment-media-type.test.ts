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
  it("only offers formats accepted by media storage", () => {
    for (const token of ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm", "application/pdf"]) {
      expect(ATTACHMENT_ACCEPT.split(',')).toContain(token);
    }
    for (const token of ["image/*", "video/*", ".docx", ".xlsx", ".csv", ".txt", ".xml", ".zip"]) {
      expect(ATTACHMENT_ACCEPT).not.toContain(token);
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
  it.each(['text/plain', 'application/zip', 'image/svg+xml', 'video/quicktime', 'audio/mpeg', ''])('rejects unsupported MIME %s before upload', type => {
    expect(getAttachmentValidationError({ size: 100, type })).toMatch(/Formato não aceito/);
  });

  it.each(['application/pdf', 'IMAGE/PNG', 'video/mp4'])('accepts supported MIME %s', type => {
    expect(getAttachmentValidationError({ size: 100, type })).toBeNull();
  });
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
