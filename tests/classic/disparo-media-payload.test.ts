// Cópia de tests/unit/disparo-media-payload.test.ts para a clássica (Chamado dac7e647).
// `@` resolve para classic/src (vitest.classic.config.ts).
/**
 * buildDisparoMediaPayload — the attachment part of the blast-plan-create body
 * (Chamado dac7e647).
 *
 * Before: only an uploaded image became `image_url`; a PDF was shown on screen
 * and dropped from the payload, so the Disparo went out as text and nobody was
 * told. Now every supported attachment travels as media_url/media_type/
 * media_name, an image also keeps `image_url` (older servers read only that),
 * and an attachment that has not finished uploading refuses the release instead
 * of silently sending text.
 */
import { describe, it, expect } from "vitest";
import { buildDisparoMediaPayload } from "@/modules/campaigns/components/disparo-wizard/disparo-media-payload";

const BASE = "https://ref.supabase.co/storage/v1/object/public/media/disparo";

describe("buildDisparoMediaPayload", () => {
  it("no attachment → empty payload", () => {
    expect(buildDisparoMediaPayload(null)).toEqual({ ok: true, payload: {} });
  });

  it("PDF → media_url/media_type document/media_name, no image_url", () => {
    const r = buildDisparoMediaPayload({
      type: "document",
      sizeBytes: 1_000,
      name: "Catálogo 2026.pdf",
      url: `${BASE}/u-Cat_logo_2026.pdf`,
    });
    expect(r).toEqual({
      ok: true,
      payload: {
        media_url: `${BASE}/u-Cat_logo_2026.pdf`,
        media_type: "document",
        media_name: "Catálogo 2026.pdf",
      },
    });
  });

  it("DOCX → media_url/media_type document/media_name, no image_url", () => {
    const r = buildDisparoMediaPayload({
      type: "document",
      sizeBytes: 2_000,
      name: "Proposta.docx",
      url: `${BASE}/u-Proposta.docx`,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload).toEqual({
        media_url: `${BASE}/u-Proposta.docx`,
        media_type: "document",
        media_name: "Proposta.docx",
      });
      expect(r.payload).not.toHaveProperty("image_url");
    }
  });

  it("image → media_* AND the legacy image_url", () => {
    const r = buildDisparoMediaPayload({
      type: "image",
      sizeBytes: 3_000,
      name: "promo.jpg",
      url: `${BASE}/u-promo.jpg`,
    });
    expect(r).toEqual({
      ok: true,
      payload: {
        image_url: `${BASE}/u-promo.jpg`,
        media_url: `${BASE}/u-promo.jpg`,
        media_type: "image",
        media_name: "promo.jpg",
      },
    });
  });

  it("attachment still uploading (no url) → refuses, never sends text-only in silence", () => {
    const r = buildDisparoMediaPayload({ type: "document", sizeBytes: 1, name: "a.pdf", url: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/anexo/i);
  });

  it("caps the file name at 255 characters (server limit) keeping the extension", () => {
    const longName = `${"a".repeat(300)}.docx`;
    const r = buildDisparoMediaPayload({ type: "document", sizeBytes: 1, name: longName, url: `${BASE}/u.docx` });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.media_name!.length).toBe(255);
      expect(r.payload.media_name!.endsWith(".docx")).toBe(true);
    }
  });
});
