// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAndPersistMedia } from "../../supabase/functions/_shared/whatsapp-media";

afterEach(() => vi.unstubAllGlobals());
describe("Uazapi download persistence", () => {
  it.each(["base64Data", "base64"])("stores the bytes from %s and scopes the message update", async (field) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ [field]: "AQID", mimetype: "image/webp" }))));
    const filters: unknown[] = [];
    type Query = { select: () => Query; eq: (...args: unknown[]) => Query; maybeSingle: () => Promise<{ data: { uazapi_token: string } }>; update: () => Query };
    const query: Query = { select: () => query, eq: (...args: unknown[]) => { filters.push(args); return query; }, maybeSingle: async () => ({ data: { uazapi_token: "test-token" } }), update: () => query };
    const upload = vi.fn().mockResolvedValue({ error: null });
    const sb = { from: () => query, storage: { from: () => ({ upload, getPublicUrl: () => ({ data: { publicUrl: "https://qa.example/media.webp" } }) }) } };
    const result = await downloadAndPersistMedia(sb as unknown as Parameters<typeof downloadAndPersistMedia>[0], "https://provider.example", { instanceId: "instance", organizationId: "org", messageId: "message", sourceUrl: "", messageType: "sticker" });
    expect(result.ok).toBe(true);
    expect([...upload.mock.calls[0][1]]).toEqual([1, 2, 3]);
    expect(filters).toContainEqual(["organization_id", "org"]);
  });
});
