import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
const logRuntime = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./functions/_shared/logger.ts', () => ({ logRuntime, redactSecrets: (v: unknown) => v }));
let handler: (r: Request) => Promise<Response>;
let row: { id: string; message_id: string; status: string; direction: string; reactions: unknown[]; pinned_at: string|null };
let calls: Array<{url: URL; method: string; body: unknown}>;
let fail: string;
let found: boolean;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
beforeAll(async () => {
 const env: Record<string,string> = {SUPABASE_URL:'https://update.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',UAZAPI_WEBHOOK_SECRET:'fixture'};
 vi.stubGlobal('Deno',{env:{get:(key:string)=>env[key],toObject:()=>env},serve:(h:typeof handler)=>{handler=h;}});
 await import('./functions/whatsapp-webhook/index.ts');
});
afterAll(()=>vi.unstubAllGlobals());
beforeEach(()=>{
 row={id:'row',message_id:'MSG',status:'sent',direction:'outgoing',reactions:[],pinned_at:null}; calls=[];fail='';found=true;
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):null;
  calls.push({url,method,body});
  if(url.pathname.includes('check_rate_limit')) return json({allowed:true,remaining:100});
  if(url.pathname.includes('whatsapp_instance_secrets')) return json({instance_id:'instance',organization_id:'org'});
  if(url.pathname.includes('whatsapp_instances')) return json({id:'instance',organization_id:'org',provider:'uazapi'});
  if(url.pathname.endsWith('/whatsapp_messages')){
   if(fail===method) return json({code:'XX000',message:'fixture failure'},500);
   if(method==='GET') return json(found?[{...row}]:[]);
   const previous=url.searchParams.get('status');
   const matches=found&&(!previous||previous.slice(3,-1).split(',').includes(row.status));
   if(matches) Object.assign(row,body);
   return json(matches?[{id:row.id}]:[]);
  }
  throw new Error('Unexpected fixture endpoint');
 }));
});
const receive=(data:Record<string,unknown>,v2=false,secret='fixture')=>handler(new Request('https://edge.test/whatsapp-webhook/'+secret,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(v2?{instance:'vendor',EventType:'messages_update',event:{MessageIDs:['MSG'],...data}}:{instance:'vendor',event:'messages_update',data:{id:'MSG',...data}})}));
const writes=()=>calls.filter(c=>c.url.pathname.endsWith('/whatsapp_messages')&&c.method==='PATCH');
it('preserves read after later delivered and sent callbacks',async()=>{
 expect((await receive({status:'read'})).status).toBe(200);expect(row.status).toBe('read');
 expect((await receive({status:'delivered'})).status).toBe(200);expect(row.status).toBe('read');
 expect((await receive({status:'sent'})).status).toBe(200);expect(row.status).toBe('read');
 for(const c of calls.filter(c=>c.url.pathname.endsWith('/whatsapp_messages'))){expect(c.url.searchParams.get('organization_id')).toBe('eq.org');expect(c.url.searchParams.get('instance_id')).toBe('eq.instance');}
});
it('duplicate reaction does not increment count or write twice',async()=>{
 const data={reaction:{emoji:'👍',from:'them'}};
 expect((await receive(data)).status).toBe(200);expect((await receive(data)).status).toBe(200);
 expect(row.reactions).toEqual([{emoji:'👍',from:'them',count:1}]);expect(writes()).toHaveLength(1);
});
it('receipt DB failure is not acknowledged',async()=>{fail='PATCH';expect((await receive({status:'read'})).status).toBe(500);expect(row.status).toBe('sent');});
it('reaction read failure is not acknowledged',async()=>{fail='GET';expect((await receive({reaction:{emoji:'👍'}})).status).toBe(500);expect(writes()).toHaveLength(0);});
it('pin DB failure is not acknowledged',async()=>{fail='PATCH';expect((await receive({pinned:true})).status).toBe(500);});
it('unmatched historical receipt retains permissive handling',async()=>{found=false;expect((await receive({status:'read'})).status).toBe(200);});
it('V2 envelope preserves pin operation',async()=>{expect((await receive({pinned:true},true)).status).toBe(200);expect(row.pinned_at).not.toBeNull();});
it('wrong secret reaches no database',async()=>{expect((await receive({status:'read'},false,'wrong')).status).toBe(404);expect(calls).toHaveLength(0);});
it('fromMe receipt preserves incoming state',async()=>{row.direction='incoming';row.status='received';expect((await receive({status:'read',fromMe:true})).status).toBe(200);expect(writes()).toHaveLength(0);expect(row.status).toBe('received');});
