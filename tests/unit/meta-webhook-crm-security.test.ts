// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
const f = vi.hoisted(() => ({ handler: undefined as unknown as (req: Request) => Promise<Response>, db: undefined as unknown as ReturnType<typeof createMockSupabase> }));
vi.stubGlobal("Deno", { env: { get: (key: string) => ({ SUPABASE_URL: "https://edge.test", META_CRM_APP_ID: "123", META_CRM_APP_SECRET: "crm-secret", META_APP_SECRET: "legacy", CRON_SECRET: "cron-secret" })[key] }, serve: (fn: typeof f.handler) => { f.handler=fn; } });
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => f.db.sb }));
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({ withErrorBoundary: (_: string, fn: unknown) => fn }));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: vi.fn() }));
vi.mock("../../supabase/functions/_shared/meta-api.ts", () => ({ verifyWebhookSignature: (_: string, signature: string, secret = "legacy") => signature === secret, getLeadgenData: vi.fn() }));
vi.mock("../../supabase/functions/_shared/campaign-distribution.ts", () => ({ getCampaignResponsibleAssignment: vi.fn() }));
vi.mock("../../supabase/functions/_shared/meta-token-crypto.ts", () => ({ storedMetaToken: async () => "test-page-token" }));
const { getLeadgenData } = await import("../../supabase/functions/_shared/meta-api.ts");
await import("../../supabase/functions/meta-webhook/index.ts");
const post=(signature:string,payload:unknown={object:"page",entry:[]})=>f.handler(new Request("https://edge.test",{method:"POST",headers:{"x-hub-signature-256":signature},body:JSON.stringify(payload)}));
beforeEach(()=>{vi.clearAllMocks();f.db=createMockSupabase();f.db.mockTable("meta_webhook_receipts",[]);f.db.mockRpc("meta_claim_webhooks",[]);});
describe("CRM webhook durable acknowledgement",()=>{
 it("requires the signing app secret, never persists forged bodies",async()=>{expect((await post("forged")).status).toBe(401);expect(f.db.getInserted("meta_webhook_receipts")).toHaveLength(0);});
 it("acknowledges only a durable app-bound event, with retry-safe insert",async()=>{expect((await post("crm-secret")).status).toBe(200);expect(f.db.getInserted("meta_webhook_receipts")[0]).toEqual(expect.objectContaining({app_id:"123",id:expect.stringMatching(/^[a-f0-9]{64}$/)}));expect(f.db.getUpsertOpts("meta_webhook_receipts")[0]).toEqual({onConflict:"id",ignoreDuplicates:true});});
 it("returns retryable 503 if durable storage fails",async()=>{f.db.mockInsertError("meta_webhook_receipts",{code:"XX000",message:"db down"});expect((await post("crm-secret")).status).toBe(503);});
 it("does not route CRM credentials into WhatsApp Cloud",async()=>{expect((await post("crm-secret",{object:"whatsapp_business_account",entry:[]})).status).toBe(400);expect(f.db.getInserted("meta_webhook_receipts")).toHaveLength(0);});
 it("cron claims only this app and rejects unauthenticated drain attempts",async()=>{
  const drain=(secret:string)=>f.handler(new Request("https://edge.test",{method:"POST",headers:{"x-cron-secret":secret},body:"{}"}));
  expect((await drain("bad")).status).toBe(401);expect(f.db.getRpcCalls()).toHaveLength(0);expect((await drain("cron-secret")).status).toBe(200);expect(f.db.getRpcCalls()).toEqual([{name:"meta_claim_webhooks",params:{p_app_id:"123"}}]);
 });
});

 it("drains a lead using production columns and reuses its Meta identifier", async () => {
  f.db.mockRpc("meta_claim_webhooks", [{id:"receipt",attempts:1,payload:{object:"page",entry:[{id:"42",changes:[{field:"leadgen",value:{leadgen_id:"111"}}]}]}}]);
  f.db.mockTable("meta_pages", [{id:"page",page_id:"42",organization_id:"org",is_active:true,page_access_token:"cipher",meta_connections:{app_id:"123",status:"connected"}}]);
  f.db.mockTable("leads", [{id:"existing",organization_id:"org",meta_lead_id:"111"}]);
  f.db.mockTable("meta_leadgen_configs", []);
  f.db.mockRpc("meta_record_lead", "existing");
  vi.mocked(getLeadgenData).mockResolvedValue({id:"111",form_id:"222",field_data:[{name:"full_name",values:["Pilot"]}]} as never);
  const response=await f.handler(new Request("https://edge.test",{method:"POST",headers:{"x-cron-secret":"cron-secret"},body:"{}"}));
  expect(await response.json()).toEqual({completed:1,claimed:1});
  const call=f.db.getRpcCalls().find(c=>c.name==="meta_record_lead");
  expect(call?.params).toEqual(expect.objectContaining({p_existing:"existing",p_event:"111",p_fields:expect.objectContaining({meta_lead_id:"111"})}));
  expect((call?.params as {p_fields:object}).p_fields).not.toHaveProperty("metadata");
 });

 it("logs only an allowlisted failure stage and leaves the receipt retryable", async () => {
  const { logRuntime } = await import("../../supabase/functions/_shared/logger.ts");
  f.db.mockRpc("meta_claim_webhooks", [{id:"retry",attempts:1,payload:{object:"unsupported",entry:[{id:"42"}]}}]);
  const response=await f.handler(new Request("https://edge.test",{method:"POST",headers:{"x-cron-secret":"cron-secret"},body:"{}"}));
  expect(await response.json()).toEqual({completed:0,claimed:1});
  expect(logRuntime).toHaveBeenCalledWith(expect.objectContaining({errorMessage:"unsupported_crm_object"}));
  expect(f.db.getUpdated("meta_webhook_receipts")).toHaveLength(0);
 });
