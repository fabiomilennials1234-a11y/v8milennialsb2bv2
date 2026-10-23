// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
import { encryptMetaToken } from "../../supabase/functions/_shared/meta-token-crypto";
const f=vi.hoisted(()=>({handler:undefined as unknown as (req:Request)=>Promise<Response>,db:undefined as unknown as ReturnType<typeof createMockSupabase>,graph:vi.fn()}));
vi.stubGlobal("Deno",{env:{get:(key:string)=>({META_CRM_ENCRYPTION_KEY_V1:"a".repeat(64)})[key]},serve:(handler:typeof f.handler)=>{f.handler=handler;}});
vi.mock("https://esm.sh/@supabase/supabase-js@2",()=>({createClient:()=>f.db.sb}));
vi.mock("../../supabase/functions/_shared/error-boundary.ts",()=>({withErrorBoundary:(_:string,fn:unknown)=>fn}));
vi.mock("../../supabase/functions/_shared/user-auth.ts",()=>({requireAdmin:async()=>({userId:"user",organizationId:"org-a"}),AuthError:class extends Error{},authErrorResponse:()=>new Response(null,{status:403})}));
vi.mock("../../supabase/functions/_shared/meta-graph-request.ts",()=>({metaGraphFetch:f.graph}));
await import("../../supabase/functions/meta-ad-insights/index.ts");
const request=(extra={})=>f.handler(new Request("https://edge.test",{method:"POST",body:JSON.stringify({organization_id:"org-a",action:"insights",accountId:"act_1",since:"2026-01-01",until:"2026-01-02",...extra})}));
beforeEach(async()=>{vi.clearAllMocks();f.db=createMockSupabase();f.db.mockTable("meta_ad_accounts",[{organization_id:"org-a",account_id:"act_1",name:"Ads",is_active:true,meta_connections:{app_id:"123",status:"connected",facebook_user_id:"789",access_token:await encryptMetaToken("raw-system-token",{appId:"123",organizationId:"org-a",asset:"connection:789"})}}]);f.graph.mockResolvedValue(new Response(JSON.stringify({data:[{campaign_id:"12",spend:"1.00"}]})));});
describe("tenant-bound Ads read API",()=>{
 it("never accepts an account outside the authenticated organization",async()=>{expect((await request({accountId:"act_999"})).status).toBe(404);f.db.mockTable("meta_ad_accounts",[{organization_id:"org-b",account_id:"act_1",is_active:true,meta_connections:{status:"connected"}}]);expect((await request()).status).toBe(404);expect(f.graph).not.toHaveBeenCalled();});
 it("uses a fixed Graph path/fields and decrypts only the selected tenant credential",async()=>{const response=await request();expect(response.status).toBe(200);const [url,options,appId]=f.graph.mock.calls[0];expect(new URL(url).pathname).toBe("/v26.0/act_1/insights");expect(options.headers.Authorization).toBe("Bearer raw-system-token");expect(appId).toBe("123");expect(JSON.stringify(await response.json())).not.toContain("token");});
 it("rejects unbounded dates and paths before any provider request",async()=>{expect((await request({until:"2027-12-31"})).status).toBe(400);expect((await request({accountId:"https://evil.test"})).status).toBe(400);expect(f.graph).not.toHaveBeenCalled();});
});
