// @vitest-environment node
/**
 * parseBlastMediaInput — fail-closed validation of the attachment fields that
 * blast-plan-create receives (Chamado dac7e647).
 *
 * The URL goes straight to the provider, which downloads it and delivers it to
 * every lead of the Disparo. So only a public object of OUR `media` bucket is
 * accepted: any other host, bucket or path is refused before a plan exists.
 * The legacy `image_url` alone stays accepted exactly as before.
 */
import { describe, it, expect } from "vitest";

const { parseBlastMediaInput, BLAST_MEDIA_NAME_MAX } = await import(
  "../../supabase/functions/_shared/quick-blast/blast-media.ts"
);

const SUPABASE_URL = "https://ref.supabase.co";
const OWN = `${SUPABASE_URL}/storage/v1/object/public/media/disparo/u-catalogo.pdf`;

describe("parseBlastMediaInput — accepted", () => {
  it("no media fields → no media", () => {
    expect(parseBlastMediaInput({}, SUPABASE_URL)).toEqual({ ok: true, media: null });
  });

  it("legacy image_url alone → image, unchanged behaviour", () => {
    expect(parseBlastMediaInput({ image_url: "https://cdn/x.jpg" }, SUPABASE_URL)).toEqual({
      ok: true,
      media: { type: "image", url: "https://cdn/x.jpg", name: null },
    });
  });

  it("a document from our media bucket", () => {
    expect(
      parseBlastMediaInput({ media_url: OWN, media_type: "document", media_name: "Catálogo.pdf" }, SUPABASE_URL),
    ).toEqual({ ok: true, media: { type: "document", url: OWN, name: "Catálogo.pdf" } });
  });

  it("an image sent both ways (new client: media_* + image_url equal)", () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/media/disparo/u-promo.jpg`;
    expect(
      parseBlastMediaInput({ media_url: url, media_type: "image", media_name: "promo.jpg", image_url: url }, SUPABASE_URL),
    ).toEqual({ ok: true, media: { type: "image", url, name: "promo.jpg" } });
  });

  it("tolerates a trailing slash on SUPABASE_URL", () => {
    expect(
      parseBlastMediaInput({ media_url: OWN, media_type: "document", media_name: "c.pdf" }, `${SUPABASE_URL}/`).ok,
    ).toBe(true);
  });
});

describe("parseBlastMediaInput — refused (fail-closed)", () => {
  const doc = (over: Record<string, unknown>) => ({
    media_url: OWN,
    media_type: "document",
    media_name: "c.pdf",
    ...over,
  });

  it.each([
    ["another host", { media_url: "https://evil.example/storage/v1/object/public/media/x.pdf" }],
    ["a look-alike host", { media_url: "https://ref.supabase.co.evil.example/storage/v1/object/public/media/x.pdf" }],
    ["another bucket", { media_url: `${SUPABASE_URL}/storage/v1/object/public/avatars/x.pdf` }],
    ["a signed/private path", { media_url: `${SUPABASE_URL}/storage/v1/object/sign/media/x.pdf?token=t` }],
    ["path traversal", { media_url: `${SUPABASE_URL}/storage/v1/object/public/media/../avatars/x.pdf` }],
    ["encoded traversal", { media_url: `${SUPABASE_URL}/storage/v1/object/public/media/%2e%2e/avatars/x.pdf` }],
    ["not a URL", { media_url: "catalogo.pdf" }],
    ["no object after the bucket", { media_url: `${SUPABASE_URL}/storage/v1/object/public/media/` }],
    ["non-string url", { media_url: 42 }],
  ])("media_url: %s", (_label, over) => {
    expect(parseBlastMediaInput(doc(over), SUPABASE_URL)).toEqual({ ok: false, error: "media_url_invalida" });
  });

  it.each([["audio"], ["video"], ["pdf"], [""], [null]])("media_type %s is refused", (t) => {
    expect(parseBlastMediaInput(doc({ media_type: t }), SUPABASE_URL)).toEqual({ ok: false, error: "media_type_invalido" });
  });

  it("a document needs a name (it is what the lead sees)", () => {
    expect(parseBlastMediaInput(doc({ media_name: undefined }), SUPABASE_URL)).toEqual({
      ok: false,
      error: "media_name_invalido",
    });
    expect(parseBlastMediaInput(doc({ media_name: "   " }), SUPABASE_URL)).toEqual({
      ok: false,
      error: "media_name_invalido",
    });
  });

  it(`a name longer than ${BLAST_MEDIA_NAME_MAX} or with control characters is refused`, () => {
    expect(parseBlastMediaInput(doc({ media_name: `${"a".repeat(256)}` }), SUPABASE_URL).ok).toBe(false);
    expect(parseBlastMediaInput(doc({ media_name: "a\u0000b.pdf" }), SUPABASE_URL).ok).toBe(false);
    expect(parseBlastMediaInput(doc({ media_name: "a\nb.pdf" }), SUPABASE_URL).ok).toBe(false);
  });

  it("media fields without media_url are refused (no half-filled attachment)", () => {
    expect(parseBlastMediaInput({ media_type: "document", media_name: "c.pdf" }, SUPABASE_URL)).toEqual({
      ok: false,
      error: "media_url_invalida",
    });
  });

  it("image_url that contradicts media_* is refused", () => {
    expect(parseBlastMediaInput(doc({ image_url: "https://cdn/other.jpg" }), SUPABASE_URL)).toEqual({
      ok: false,
      error: "media_conflitante",
    });
  });

  it("no SUPABASE_URL configured → nothing can be validated → refused", () => {
    expect(parseBlastMediaInput(doc({}), "")).toEqual({ ok: false, error: "media_url_invalida" });
  });
});
