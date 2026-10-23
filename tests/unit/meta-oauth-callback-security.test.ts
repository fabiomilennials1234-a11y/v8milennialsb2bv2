// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signMetaState } from "../../supabase/functions/_shared/meta-oauth-state";
const f = vi.hoisted(() => ({ handler: undefined as unknown as (req: Request) => Promise<Response>, rpc: vi.fn(), exchange: vi.fn(), inspect: vi.fn(), pages: vi.fn(), ads: vi.fn(), subscribe: vi.fn() }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => ({ rpc: f.rpc }) }));
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({ withErrorBoundary: (_: string, fn: unknown) => fn }));
vi.mock("../../supabase/functions/_shared/meta-business.ts", async (original) => ({ ...await original<object>(), metaBusinessConfig: () => ({ appId: "123", secret: "crm-secret", configId: "456" }), exchangeBusinessCode: f.exchange, inspectBusinessToken: f.inspect }));
vi.mock("../../supabase/functions/_shared/meta-api.ts", () => ({ getMe: async () => ({ id: "789", name: "System" }), listPages: f.pages, subscribePageWebhook: f.subscribe }));
vi.mock("../../supabase/functions/_shared/meta-ad-assets.ts", () => ({ listBusinessAdAccounts: f.ads }));
vi.stubGlobal("Deno", { env: { get: (key: string) => ({ APP_URL: "https://torquecrm.com.br", META_CRM_OAUTH_ENABLED: "true", META_CRM_ENCRYPTION_KEY_V1: "a".repeat(64) })[key] }, serve: (fn: typeof f.handler) => { f.handler = fn; } });
await import("../../supabase/functions/meta-oauth-callback/index.ts");
const state = (extra = {}) => signMetaState({ userId: "u", orgId: "org", connectionType: "facebook", nonce: "nonce", exp: Date.now() + 60000, appId: "123", configId: "456", ...extra }, "crm-secret");
const callback = (token: string, suffix = "&code=provider-code") => f.handler(new Request(`https://edge.test?state=${encodeURIComponent(token)}${suffix}`));
beforeEach(() => {
 vi.clearAllMocks(); f.rpc.mockImplementation(async (name: string) => ({ data: name === "meta_consume_oauth_nonce" ? true : "id", error: null }));
 f.exchange.mockResolvedValue("never-leak-this-token"); f.inspect.mockResolvedValue({ app_id: "123", user_id: "789", type: "SYSTEM_USER", is_valid: true, expires_at: 0, scopes: ["pages_show_list", "ads_read"] });
 f.pages.mockResolvedValue([{ id: "42", name: "Page", access_token: "never-leak-page-token" }]); f.ads.mockResolvedValue([{ id: "act_1", name: "Ads" }]); f.subscribe.mockResolvedValue(true);
});
describe("Business callback", () => {
 it("consumes state before Graph, persists real expiry and backend-only tokens atomically", async () => {
  const response=await callback(await state()); expect(response.status).toBe(302); expect(response.headers.get("Location")).toContain("meta=connected");expect(response.headers.get("Location")).toContain("tab=integracoes");
  expect(f.rpc.mock.calls[0][0]).toBe("meta_consume_oauth_nonce"); expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.exchange.mock.invocationCallOrder[0]);
  expect(f.rpc.mock.calls[1]).toEqual(["meta_save_business_connection", expect.objectContaining({ p_org_id: "org", p_app_id: "123", p_expires: null, p_token: expect.stringMatching(/^crm1\./), p_ad_accounts: [{ id: "act_1", name: "Ads" }] })]);
  expect(response.headers.get("Location")).not.toContain("token"); expect(response.headers.get("Cache-Control")).toBe("no-store");
 });
 it("rejects unsigned, other-app/config, expired and replayed states without exchanging a code", async () => {
  for(const token of ["forged",await state({ appId: "999" }),await state({configId:"999"}),await state({exp:1})]) expect((await callback(token)).headers.get("Location")).toContain("state_invalido");
  f.rpc.mockResolvedValue({data:false,error:null}); expect((await callback(await state())).headers.get("Location")).toContain("state_invalido"); expect(f.exchange).not.toHaveBeenCalled();
 });
 it("never saves wrong-app, user, expired tokens or failed subscriptions", async () => {
  for(const delta of [{app_id:"999"},{type:"USER"},{expires_at:1}]) {f.inspect.mockResolvedValue({app_id:"123",user_id:"789",type:"SYSTEM_USER",is_valid:true,expires_at:0,...delta});await callback(await state());}
  expect(f.rpc.mock.calls.filter(([name])=>name==="meta_save_business_connection")).toHaveLength(0);
  f.inspect.mockResolvedValue({app_id:"123",user_id:"789",type:"SYSTEM_USER",is_valid:true,expires_at:0,scopes:["pages_show_list"]}); f.subscribe.mockResolvedValue(false);await callback(await state());expect(f.rpc.mock.calls.filter(([name])=>name==="meta_save_business_connection")).toHaveLength(0);
 });
 it("denial consumes state and returns a fixed error without reflecting upstream text", async () => {
  const response=await callback(await state(),"&error=untrusted-secret-data");expect(response.headers.get("Location")).toContain("autorizacao_recusada");expect(response.headers.get("Location")).not.toContain("untrusted");expect(f.exchange).not.toHaveBeenCalled();
 });
});
