// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
import { encryptMetaToken } from "../../supabase/functions/_shared/meta-token-crypto";
const f=vi.hoisted(()=>({handler:undefined as unknown as (req:Request)=>Promise<Response>,db:undefined as unknown as ReturnType<typeof createMockSupabase>,send:vi.fn(),allowed:true}));
vi.stubGlobal("Deno",{env:{get:(key:string)=>({META_CRM_ENCRYPTION_KEY_V1:"a".repeat(64)})[key]},serve:(handler:typeof f.handler)=>{f.handler=handler;}});
vi.mock("https://esm.sh/@supabase/supabase-js@2",()=>({createClient:()=>f.db.sb}));
vi.mock("../../supabase/functions/_shared/error-boundary.ts",()=>({withErrorBoundary:(_:string,fn:unknown)=>fn}));
vi.mock("../../supabase/functions/_shared/logger.ts",()=>({logRuntime:vi.fn()}));
vi.mock("../../supabase/functions/_shared/user-auth.ts",()=>({requireAuth:async()=>({userId:"user",organizationId:"org-a",teamMemberId:"member"}),AuthError:class extends Error{},authErrorResponse:()=>new Response(null,{status:401})}));
vi.mock("../../supabase/functions/_shared/permission_engine.ts",()=>({canUserPerformAction:async()=>({allowed:f.allowed})}));
vi.mock("../../supabase/functions/_shared/meta-api.ts",()=>({sendMessage:f.send,sendMediaMessage:f.send}));
await import("../../supabase/functions/send-meta-message/index.ts");
const conversation={id:"conv",organization_id:"org-a",meta_page_id:"page",external_user_id:"human",channel:"messenger",last_inbound_at:new Date().toISOString()};
const send=(extra={})=>f.handler(new Request("https://edge.test",{method:"POST",body:JSON.stringify({organization_id:"org-a",conversationId:"conv",recipientId:"human",channel:"messenger",pageId:"42",message:"hello",...extra})}));
beforeEach(async()=>{vi.clearAllMocks();f.allowed=true;f.db=createMockSupabase();f.db.mockTable("meta_conversations",[conversation]);f.db.mockTable("meta_pages",[{id:"page",organization_id:"org-a",page_id:"42",is_active:true,page_access_token:await encryptMetaToken("raw-page-token",{appId:"123",organizationId:"org-a",asset:"page:42"}),meta_connections:{app_id:"123",status:"connected"}}]);f.send.mockResolvedValue({message_id:"mid"});});
describe("Meta message server authorization",()=>{
 it("decrypts only this tenant's page token and sends to its persisted conversation",async()=>{expect((await send()).status).toBe(200);expect(f.send).toHaveBeenCalledWith("raw-page-token","human","hello","messenger","42",undefined,"123");expect(f.db.getInserted("channel_messages")).toHaveLength(1);});
 it("rejects cross-tenant conversations and arbitrary recipients before Graph",async()=>{expect((await send({recipientId:"other"})).status).toBe(404);f.db.mockTable("meta_conversations",[{...conversation,organization_id:"org-b"}]);expect((await send()).status).toBe(404);expect(f.send).not.toHaveBeenCalled();});
 it("enforces send permission and the inbound window on the backend",async()=>{f.allowed=false;expect((await send()).status).toBe(403);f.allowed=true;f.db.mockTable("meta_conversations",[{...conversation,last_inbound_at:"2020-01-01T00:00:00Z"}]);expect((await send()).status).toBe(409);expect(f.send).not.toHaveBeenCalled();});
});
