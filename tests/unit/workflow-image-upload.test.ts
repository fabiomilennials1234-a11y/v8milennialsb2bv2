import { describe, it, expect } from "vitest";
import {
  validateWorkflowImageFile,
  buildWorkflowAssetPath,
} from "../../src/lib/workflow-image-upload";

const MB = 1024 * 1024;

function fakeFile(name: string, size: number, type: string): File {
  const buf = new ArrayBuffer(size);
  return new File([buf], name, { type });
}

describe("validateWorkflowImageFile", () => {
  it("rejects files larger than 16MB", () => {
    const file = fakeFile("huge.jpg", 17 * MB, "image/jpeg");
    const result = validateWorkflowImageFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/16/);
  });

  it("rejects non-image MIME types", () => {
    const file = fakeFile("doc.pdf", 1 * MB, "application/pdf");
    const result = validateWorkflowImageFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/imagem/i);
  });

  it("accepts valid JPEG under 16MB", () => {
    const file = fakeFile("photo.jpg", 2 * MB, "image/jpeg");
    const result = validateWorkflowImageFile(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts valid PNG under 16MB", () => {
    const file = fakeFile("logo.png", 5 * MB, "image/png");
    const result = validateWorkflowImageFile(file);
    expect(result.valid).toBe(true);
  });

  it("accepts valid WebP", () => {
    const file = fakeFile("img.webp", 1 * MB, "image/webp");
    const result = validateWorkflowImageFile(file);
    expect(result.valid).toBe(true);
  });
});

describe("buildWorkflowAssetPath", () => {
  it("generates path with org ID and file extension", () => {
    const path = buildWorkflowAssetPath("org-123", "photo.jpg");
    expect(path).toMatch(/^workflow-assets\/org-123\/[a-f0-9-]+\.jpg$/);
  });

  it("extracts extension from filename", () => {
    const path = buildWorkflowAssetPath("org-456", "image.png");
    expect(path.endsWith(".png")).toBe(true);
  });

  it("defaults to jpg when no extension", () => {
    const path = buildWorkflowAssetPath("org-789", "noext");
    expect(path.endsWith(".jpg")).toBe(true);
  });
});
