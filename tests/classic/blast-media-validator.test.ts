// Cópia de tests/unit/blast-media-validator.test.ts para a clássica (Chamado dac7e647).
// `@` resolve para classic/src (vitest.classic.config.ts).
import { describe, it, expect } from "vitest";
import {
  validateBlastMedia,
  classifyBlastMedia,
  BLAST_MEDIA_LIMITS_MB,
  BLAST_MEDIA_ACCEPT,
  BLAST_MEDIA_UNSUPPORTED,
} from "@/modules/communication/lib/blast-media-validator";

const MB = 1024 * 1024;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("validateBlastMedia — accepting valid media", () => {
  it("accepts an image at/under its size limit", () => {
    expect(validateBlastMedia("image", 4 * MB)).toEqual({ ok: true });
    expect(validateBlastMedia("image", 5 * MB)).toEqual({ ok: true }); // boundary
  });

  it("accepts a document (PDF/Word) up to 20 MB", () => {
    expect(BLAST_MEDIA_LIMITS_MB.document).toBe(20);
    expect(validateBlastMedia("document", 20 * MB)).toEqual({ ok: true });
  });
});

describe("validateBlastMedia — rejecting oversized media", () => {
  it("rejects a file over its limit, reporting the type's maxMb", () => {
    const r = validateBlastMedia("image", 6 * MB);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.maxMb).toBe(5);
  });

  it("applies each type's own limit", () => {
    expect(validateBlastMedia("document", 21 * MB).ok).toBe(false);
    expect(validateBlastMedia("image", 6 * MB).ok).toBe(false);
  });

  it("rejects audio and video — the blast only carries image or document", () => {
    for (const kind of ["audio", "video", "pdf"]) {
      const r = validateBlastMedia(kind as unknown as "image", 1 * MB);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(BLAST_MEDIA_UNSUPPORTED);
    }
  });

  it("rejects an empty (zero-byte) file", () => {
    expect(validateBlastMedia("image", 0).ok).toBe(false);
    expect(validateBlastMedia("document", 0).ok).toBe(false);
  });
});

describe("classifyBlastMedia — what the Disparo can carry", () => {
  it("classifies an image by MIME and keeps its MIME for the upload", () => {
    expect(classifyBlastMedia({ name: "promo.jpg", type: "image/jpeg" })).toEqual({
      ok: true,
      type: "image",
      contentType: "image/jpeg",
    });
  });

  it("classifies PDF, DOC and DOCX as document", () => {
    expect(classifyBlastMedia({ name: "catalogo.pdf", type: "application/pdf" })).toEqual({
      ok: true,
      type: "document",
      contentType: "application/pdf",
    });
    expect(classifyBlastMedia({ name: "proposta.doc", type: "application/msword" })).toEqual({
      ok: true,
      type: "document",
      contentType: "application/msword",
    });
    expect(classifyBlastMedia({ name: "proposta.docx", type: DOCX })).toEqual({
      ok: true,
      type: "document",
      contentType: DOCX,
    });
  });

  it("falls back to the extension when the browser reports no MIME (Word without Office)", () => {
    expect(classifyBlastMedia({ name: "Proposta Final.DOCX", type: "" })).toEqual({
      ok: true,
      type: "document",
      contentType: DOCX,
    });
    expect(classifyBlastMedia({ name: "tabela.doc", type: "application/octet-stream" })).toEqual({
      ok: true,
      type: "document",
      contentType: "application/msword",
    });
  });

  it("refuses audio and video with a clear message", () => {
    for (const f of [
      { name: "audio.mp3", type: "audio/mpeg" },
      { name: "video.mp4", type: "video/mp4" },
    ]) {
      expect(classifyBlastMedia(f)).toEqual({ ok: false, error: BLAST_MEDIA_UNSUPPORTED });
    }
    expect(BLAST_MEDIA_UNSUPPORTED).toBe("Por enquanto o disparo envia imagem, PDF ou Word.");
  });

  it("refuses anything else (spreadsheet, zip) with the same message", () => {
    expect(classifyBlastMedia({ name: "base.xlsx", type: "application/vnd.ms-excel" })).toEqual({
      ok: false,
      error: BLAST_MEDIA_UNSUPPORTED,
    });
    expect(classifyBlastMedia({ name: "x.zip", type: "" })).toEqual({
      ok: false,
      error: BLAST_MEDIA_UNSUPPORTED,
    });
  });

  it("the file picker offers images, PDF and Word — and no audio/video", () => {
    expect(BLAST_MEDIA_ACCEPT).toContain("image/*");
    expect(BLAST_MEDIA_ACCEPT).toContain(".pdf");
    expect(BLAST_MEDIA_ACCEPT).toContain(".doc");
    expect(BLAST_MEDIA_ACCEPT).toContain(".docx");
    expect(BLAST_MEDIA_ACCEPT).toContain(DOCX);
    expect(BLAST_MEDIA_ACCEPT).not.toMatch(/audio|video/);
  });
});
