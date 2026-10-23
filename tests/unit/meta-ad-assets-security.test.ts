// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { insightDateRange, listBusinessAdAccounts } from "../../supabase/functions/_shared/meta-ad-assets";
import { readMetaWebhookBody } from "../../supabase/functions/_shared/meta-bounded-body";
describe("bounded Meta inputs",()=>{
 it("accepts only real calendar ranges up to 93 inclusive days",()=>{
  expect(insightDateRange("2026-01-01","2026-01-02")).toEqual({since:"2026-01-01",until:"2026-01-02"});
  for(const range of [["2026-02-30","2026-03-01"],["2026-01-02","2026-01-01"],["2026-01-01","2026-12-31"],[null,"2026-01-01"],["2026-01-01T00:00Z","2026-01-02"]]) expect(()=>insightDateRange(range[0],range[1])).toThrow("invalid_date_range");
 });
 it("bounds bytes even with absent or dishonest Content-Length",async()=>{
  const request=new Request("https://edge.test",{method:"POST",headers:{"Content-Length":"1"},body:"0123456789"});
  await expect(readMetaWebhookBody(request,5)).rejects.toThrow("body_too_large");
  expect(await readMetaWebhookBody(new Request("https://edge.test",{method:"POST",body:"ç"}),2)).toBe("ç");
 });
});


it("uses the system-user assigned_ad_accounts edge for Business tokens", async () => {
  vi.stubGlobal("Deno", { env: { get: (key: string) => ({ META_CRM_APP_ID: "123", META_CRM_APP_SECRET: "crm-secret" })[key] } });
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "act_1", name: "Ads" }] })));
  vi.stubGlobal("fetch", fetcher);
  expect(await listBusinessAdAccounts("system-token", "123", "789")).toHaveLength(1);
  expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe("/v26.0/789/assigned_ad_accounts");
});
