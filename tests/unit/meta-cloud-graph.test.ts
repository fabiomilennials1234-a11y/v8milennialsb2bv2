/**
 * meta-cloud-graph — thin Graph HTTP client for the WhatsApp Cloud SEND surface.
 *
 * Verifies the exact request shapes Meta expects (text/media/template/upload/
 * media download/phone) and that the access token NEVER leaks into a thrown
 * error. No network — fetch is fully injected.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createMetaCloudGraph,
  MetaGraphError,
  GRAPH_VERSION,
  type FetchImpl,
} from "../../supabase/functions/_shared/whatsapp-providers/meta-cloud-graph.ts";

const TOKEN = "SECRET-WABA-TOKEN-xyz";
const PNID = "1112223334";
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeGraph(fetchImpl: FetchImpl) {
  return createMetaCloudGraph({ token: TOKEN, phoneNumberId: PNID, fetchImpl });
}

describe("meta-cloud-graph — sendText", () => {
  it("POSTs the canonical text body to /{phone_number_id}/messages and returns the wamid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ messages: [{ id: "wamid.HBgL123" }] }),
    );
    const graph = makeGraph(fetchImpl);

    const res = await graph.sendText("5511999998888", "olá mundo");

    expect(res.wamid).toBe("wamid.HBgL123");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/${PNID}/messages`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      to: "5511999998888",
      type: "text",
      text: { body: "olá mundo", preview_url: false },
    });
  });

  it("throws MetaGraphError (without the token) on a Graph error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: "Invalid parameter", code: 100 } }),
    );
    const graph = makeGraph(fetchImpl);

    const err = await graph.sendText("55119", "x").catch((e) => e);
    expect(err).toBeInstanceOf(MetaGraphError);
    expect((err as MetaGraphError).code).toBe(100);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("throws when the response carries no message id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ messages: [] }));
    const graph = makeGraph(fetchImpl);
    await expect(graph.sendText("55119", "x")).rejects.toThrow(/wamid|message id/i);
  });
});

describe("meta-cloud-graph — sendMediaByLink / sendMediaById", () => {
  it("sends image by link with caption (no filename)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "w1" }] }));
    const graph = makeGraph(fetchImpl);

    await graph.sendMediaByLink("55119", "image", {
      link: "https://cdn/x.jpg",
      caption: "legenda",
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.type).toBe("image");
    expect(body.image).toEqual({ link: "https://cdn/x.jpg", caption: "legenda" });
  });

  it("sends document by id with caption + filename", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "w2" }] }));
    const graph = makeGraph(fetchImpl);

    await graph.sendMediaById("55119", "document", {
      id: "MEDIA-1",
      caption: "doc",
      filename: "file.pdf",
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.document).toEqual({ id: "MEDIA-1", caption: "doc", filename: "file.pdf" });
  });
});

describe("meta-cloud-graph — sendTemplate", () => {
  it("sends a template with language + components", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wt" }] }));
    const graph = makeGraph(fetchImpl);

    const res = await graph.sendTemplate("55119", {
      name: "boas_vindas",
      language: { code: "pt_BR" },
      components: [{ type: "body", parameters: [] }],
    });

    expect(res.wamid).toBe("wt");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("boas_vindas");
    expect(body.template.language).toEqual({ code: "pt_BR" });
  });
});

describe("meta-cloud-graph — uploadMedia", () => {
  it("POSTs multipart to /media and returns the media id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "MEDIA-99" }));
    const graph = makeGraph(fetchImpl);

    const id = await graph.uploadMedia(new Uint8Array([1, 2, 3]), "image/png");

    expect(id).toBe("MEDIA-99");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/${PNID}/media`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    // No explicit Content-Type — fetch sets the multipart boundary.
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("throws on upload error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: "too big", code: 131009 } }),
    );
    const graph = makeGraph(fetchImpl);
    await expect(graph.uploadMedia(new Uint8Array([1]), "image/png")).rejects.toThrow(MetaGraphError);
  });
});

describe("meta-cloud-graph — getMedia", () => {
  it("resolves the media url then fetches bytes with the Bearer token", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ url: "https://lookaside/x", mime_type: "audio/ogg" }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(bytes.buffer),
      } as unknown as Response);
    const graph = makeGraph(fetchImpl);

    const out = await graph.getMedia("MID-1");

    expect(out.mimeType).toBe("audio/ogg");
    expect(Array.from(out.bytes)).toEqual([9, 8, 7]);
    // Both calls carry the Bearer token (CDN url is token-gated too).
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/MID-1`);
    expect(fetchImpl.mock.calls[1][0]).toBe("https://lookaside/x");
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("throws when the binary fetch fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ url: "https://lookaside/x", mime_type: "image/png" }))
      .mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);
    const graph = makeGraph(fetchImpl);
    await expect(graph.getMedia("MID-1")).rejects.toThrow(/download/i);
  });
});

describe("meta-cloud-graph — getPhoneNumber", () => {
  it("returns the phone node fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ display_phone_number: "+55 11 99999-8888", verified_name: "Loja", quality_rating: "GREEN" }),
    );
    const graph = makeGraph(fetchImpl);

    const out = await graph.getPhoneNumber();
    expect(out?.display_phone_number).toBe("+55 11 99999-8888");
    expect(out?.verified_name).toBe("Loja");
  });

  it("returns null on a Graph error (never throws — feeds 'unknown' status)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "bad", code: 190 } }));
    const graph = makeGraph(fetchImpl);
    expect(await graph.getPhoneNumber()).toBeNull();
  });

  it("returns null on a network failure (never throws)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const graph = makeGraph(fetchImpl);
    expect(await graph.getPhoneNumber()).toBeNull();
  });
});
