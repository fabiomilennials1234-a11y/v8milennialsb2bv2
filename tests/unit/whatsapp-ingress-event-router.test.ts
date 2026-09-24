// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIngressEventHandler, createLegacyEventRouter, loadLegacyForwardEnabled } from '../../services/whatsapp-ingress/event-router.ts';
import type { WhatsAppWebhookOptions } from '../../supabase/functions/whatsapp-webhook/handler.ts';

vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ logRuntime: vi.fn(async () => {}), redactSecrets: (value: unknown) => value }));
const allowedId = '10000000-0000-0000-0000-000000000001';
const otherId = '20000000-0000-0000-0000-000000000002';
const env: Record<string,string> = {
  SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',
  UAZAPI_WEBHOOK_SECRET:'fixture-secret',
};
let factory: (options: WhatsAppWebhookOptions) => (req: Request) => Promise<Response>;
let resolvedId: string;
let backendCalls: string[];
const request = (path: string, body: string, headers: HeadersInit = {}) => new Request(`https://ingress.test${path}`, {
  method:'POST',headers:{'Content-Type':'application/json',...headers},body,
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value),{
  status,headers:{'Content-Type':'application/json'},
});

beforeAll(async()=>{
  vi.stubGlobal('Deno',{env:{get:(key:string)=>env[key],toObject:()=>env},serve:vi.fn()});
  factory=(await import('../../supabase/functions/whatsapp-webhook/handler.ts')).createWhatsAppWebhookHandler;
});
afterAll(()=>vi.unstubAllGlobals());
beforeEach(()=>{
  resolvedId=allowedId;backendCalls=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input);backendCalls.push(url);
    if(url.includes('check_rate_limit')) return json({allowed:true,remaining:100});
    if(url.includes('whatsapp_instance_secrets')) return json({instance_id:resolvedId,organization_id:'org'});
    if(url.includes('whatsapp_instances')) return json({id:resolvedId,organization_id:'org',provider:'uazapi'});
    throw new Error('Unexpected backend request');
  }));
});

describe('legacy event forwarding',()=>{
  it('is opt-in and validates only a fixed Supabase project origin',()=>{
    expect(loadLegacyForwardEnabled(()=>undefined)).toBe(false);
    expect(loadLegacyForwardEnabled(()=> 'true')).toBe(true);
    expect(()=>loadLegacyForwardEnabled(()=> 'yes')).toThrow(/INGRESS_FORWARD_LEGACY_EVENTS/);
    for(const supabaseUrl of ['http://fixture.supabase.co','https://example.com',
      'https://fixture.supabase.co.attacker.test','https://fixture.supabase.co@attacker.test',
      'https://fixture.supabase.co/redirect','https://fixture.supabase.co?next=evil']) {
      expect(()=>createLegacyEventRouter({enabled:true,supabaseUrl})).toThrow(/Supabase HTTPS project origin/);
    }
    expect(()=>createLegacyEventRouter({enabled:true,supabaseUrl:env.SUPABASE_URL,timeoutMs:20001})).toThrow(/timeout/);
    expect(createLegacyEventRouter({enabled:false}).enabled).toBe(false);
  });

  it('authenticates and checks database-resolved instance before forwarding',async()=>{
    const upstream=vi.fn(async()=>new Response('accepted',{status:202}));
    const router=createLegacyEventRouter({enabled:true,supabaseUrl:env.SUPABASE_URL,fetchImpl:upstream});
    const handler=createIngressEventHandler(factory,{allowInstance:id=>id===allowedId,
      admitReceipt:async()=>json({queued:true}),router});
    const body=' { "instance": "provider-id", "EventType": "messages" } ';
    expect((await handler(request('/whatsapp-webhook/wrong-secret',body))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
    expect(backendCalls).toHaveLength(0);
    resolvedId=otherId;
    expect((await handler(request('/whatsapp-webhook/fixture-secret',body))).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    resolvedId=allowedId;
    expect((await handler(request('/whatsapp-webhook/fixture-secret/provider-id/messages',body))).status).toBe(202);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [target,init]=upstream.mock.calls[0] as unknown as [URL,RequestInit];
    expect(String(target)).toBe('https://fixture.supabase.co/functions/v1/whatsapp-webhook/fixture-secret/provider-id/messages');
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(body);
    expect(init.redirect).toBe('manual');
    expect(init.credentials).toBe('omit');
  });

  it('keeps receipts local and unsupported events unavailable even when enabled',async()=>{
    const upstream=vi.fn(async()=>new Response('unexpected',{status:200}));
    const router=createLegacyEventRouter({enabled:true,supabaseUrl:env.SUPABASE_URL,fetchImpl:upstream});
    const receipt=vi.fn(async()=>json({queued:true}));
    const handler=createIngressEventHandler(factory,{allowInstance:id=>id===allowedId,admitReceipt:receipt,router});
    expect((await handler(request('/whatsapp-webhook/fixture-secret',JSON.stringify({instance:'provider-id',EventType:'messages_update'})))).status).toBe(200);
    expect(receipt).toHaveBeenCalledOnce();
    expect(upstream).not.toHaveBeenCalled();
    expect((await handler(request('/whatsapp-webhook/fixture-secret',JSON.stringify({instance:'provider-id',EventType:'payment'})))).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('strips untrusted headers/query, preserves original bytes and upstream statuses',async()=>{
    const calls: Array<{url:string;init:RequestInit}> = [];
    let status=200;
    const upstream=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      calls.push({url:String(input),init:init!});
      return new Response('upstream', {status,headers:{'Content-Type':'text/plain','Retry-After':'12',
        'Location':'https://evil.test'}});
    });
    const router=createLegacyEventRouter({enabled:true,supabaseUrl:env.SUPABASE_URL,fetchImpl:upstream});
    const body=new TextEncoder().encode(' {"EventType":"messages", "note":"á"} ');
    const req=request('/functions/v1/whatsapp-webhook/fixture-secret/provider-id/messages?next=https://evil.test',
      new TextDecoder().decode(body),{'Authorization':'Bearer forged','Cookie':'session=forged',
        'x-replay-source':'dlq-replay','x-service-role':'forged'});
    for(status of [201,404,500,503]) {
      const response=await router.forward('messages',req,body);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe('upstream');
      expect(response.headers.get('Retry-After')).toBe(status===503?'12':null);
    }
    expect(calls[0].url).toBe('https://fixture.supabase.co/functions/v1/whatsapp-webhook/fixture-secret/provider-id/messages');
    expect(calls[0].init.headers).toEqual({'Content-Type':'application/json'});
    expect(new Uint8Array(calls[0].init.body as ArrayBuffer)).toEqual(body);
  });

  it('fails closed on redirect, oversize response, network failure and timeout',async()=>{
    const req=request('/whatsapp-webhook/fixture-secret', '{}');
    const response=(handler:typeof fetch)=>createLegacyEventRouter({enabled:true,supabaseUrl:env.SUPABASE_URL,
      fetchImpl:handler,timeoutMs:20}).forward('connection',req,new TextEncoder().encode('{}'));
    const redirectCancel=vi.fn();
    expect((await response(async()=>new Response(new ReadableStream({cancel:redirectCancel}),
      {status:302,headers:{Location:'https://evil.test'}}))).status).toBe(503);
    expect(redirectCancel).toHaveBeenCalledOnce();
    const oversizedCancel=vi.fn();
    expect((await response(async()=>new Response(new ReadableStream({cancel:oversizedCancel}),
      {status:200,headers:{'Content-Length':'65537'}}))).status).toBe(503);
    expect(oversizedCancel).toHaveBeenCalledOnce();
    expect((await response(async()=>new Response(new Uint8Array(65537),{status:200}))).status).toBe(503);
    expect((await response(async()=>{throw new Error('offline');})).status).toBe(503);
    expect((await response((()=>new Promise<Response>(()=>{})) as typeof fetch)).status).toBe(503);
    const stalledCancel=vi.fn();
    expect((await response(async()=>new Response(new ReadableStream({cancel:stalledCancel}),{status:200}))).status).toBe(503);
    expect(stalledCancel).toHaveBeenCalledOnce();
  });

  it('waits for delayed Edge admission within the bounded total deadline',async()=>{
    const router=createLegacyEventRouter({enabled:true,supabaseUrl:env.SUPABASE_URL,timeoutMs:100,
      fetchImpl:async()=>{
        await new Promise(resolve=>setTimeout(resolve,35));
        return new Response(new ReadableStream({
          async start(controller) {
            await new Promise(resolve=>setTimeout(resolve,35));
            controller.enqueue(new TextEncoder().encode('accepted'));
            controller.close();
          },
        }),{status:202});
      }});
    const result=await router.forward('messages',request('/whatsapp-webhook/fixture-secret','{}'),
      new TextEncoder().encode('{}'));
    expect(result.status).toBe(202);
    expect(await result.text()).toBe('accepted');
  });

  it('defaults legacy events to 503 with no network call',async()=>{
    const router=createLegacyEventRouter({enabled:false});
    const handler=createIngressEventHandler(factory,{allowInstance:id=>id===allowedId,
      admitReceipt:async()=>json({queued:true}),router});
    expect((await handler(request('/whatsapp-webhook/fixture-secret',JSON.stringify({instance:'provider-id',EventType:'messages'})))).status).toBe(503);
    expect(backendCalls.some(url=>url.includes('/functions/v1/whatsapp-webhook'))).toBe(false);
  });
});
