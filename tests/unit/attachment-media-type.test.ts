import { describe, it, expect } from "vitest";
import { deriveAttachmentMediaType } from "@/modules/communication/lib/attachment-media-type";

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
