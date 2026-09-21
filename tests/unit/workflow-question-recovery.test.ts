import { afterEach, expect, it, vi } from "vitest";
import { clearDenoEnv, setDenoEnv } from "../helpers/deno-mock";
afterEach(() => { vi.unstubAllGlobals(); clearDenoEnv(); });
it.each(["Sent", "missing", "Failed", "queued"])("worker reconcilia %s sem reenviar", async (providerStatus) => {
  vi.resetModules();
  setDenoEnv("SUPABASE_URL", "https://db.test"); setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service");
  setDenoEnv("CRON_SECRET", "test-cron"); setDenoEnv("UAZAPI_BASE_URL", "https://uazapi.test");
  let handler: (request: Request) => Promise<Response>;
  vi.stubGlobal("Deno", { ...globalThis.Deno, serve: (callback: typeof handler) => { handler = callback; } });
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url=String(input);
    const json=(data: unknown) => new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}});
    if(url.includes("claim_workflow_button_send_checks"))return json(providerStatus==="queued"?[]:[{id:"q",organization_id:"org",instance_id:"instance",phone:"5511999999999"}]);
    if(url.includes("claim_workflow_button_queue"))return json(providerStatus==="queued"?[{id:"q",organization_id:"org",instance_id:"instance",phone:"5511999999999",content:{text:"Pergunta da fila",buttons:[{id:"a",label:"A"}]}}]:[]);
    if(url.endsWith("/send/menu"))return json({id:"internal",messageid:"wa-queued",status:"Pending",messageTimestamp:1700000000123});
    if(url.includes("org_access_blocked"))return json(false);
    if(url.includes("whatsapp_instances"))return json({id:"instance",organization_id:"org",provider:"uazapi",status:"connected"});
    if(url.includes("organizations"))return json({whatsapp_provider_override:null});
    if(url.includes("get_uazapi_credentials"))return json([{uazapi_token:"test-instance"}]);
    if(url.includes("check_rate_limit"))return json({allowed:true});
    if(url.includes("accept_workflow_button_question"))return json(true);
    if(url.endsWith("/message/find"))return json({messages:providerStatus === "missing" ? [] : [{messageid:"wa-original",fromMe:true,chatid:"5511999999999@s.whatsapp.net",track_id:"q",track_source:"workflow-question-buttons",status:providerStatus,messageTimestamp:1700000000123}],hasMore:false});
    return json([]);
  });
  vi.stubGlobal("fetch",request);
  await import("../../supabase/functions/process-workflow-executions/index.ts");
  expect((await handler!(new Request("https://edge.test/process-workflow-executions",{method:"POST",headers:{"x-cron-secret":"test-cron","Content-Type":"application/json"},body:"{}"}))).status).toBe(200);
  const accept=request.mock.calls.find(([url])=>String(url).includes("accept_workflow_button_question"));
  if (providerStatus === "queued") {
    expect(accept).toBeDefined();
    const sent=request.mock.calls.find(([url])=>String(url).endsWith("/send/menu"));
    expect(JSON.parse(String(sent![1]?.body))).toMatchObject({text:"Pergunta da fila",choices:["A|q:a"]});
  } else if (providerStatus === "Sent") {
    expect(accept).toBeDefined();
    expect(JSON.parse(String(accept![1]?.body))).toMatchObject({p_id:"q",p_organization_id:"org",p_message_id:"wa-original",p_accepted_at:"2023-11-14T22:13:20.123Z"});
  } else {
    expect(accept).toBeUndefined();
    expect(request.mock.calls.some(([url])=>String(url).includes("fail_workflow_button_question"))).toBe(providerStatus === "Failed");
  }
  expect(request.mock.calls.some(([url])=>String(url).includes("/send/"))).toBe(providerStatus==="queued");
});
