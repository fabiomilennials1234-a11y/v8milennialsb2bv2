// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runQuoteTool } from '../../supabase/functions/_shared/quotes/tool';
import { sendQuoteDocument } from '../../supabase/functions/_shared/quotes/send';
import { quoteSummary } from '../../supabase/functions/_shared/quotes/confirmation';
import { handleConfirmedQuote } from '../../supabase/functions/_shared/quotes/confirmed-turn';
const mocks = vi.hoisted(() => ({ service: vi.fn(), queue: vi.fn(), dispatch: vi.fn(), send: vi.fn() }));
vi.mock('../../supabase/functions/_shared/quotes/service', () => ({ documentService: mocks.service, sha256: async () => 'hash', base64: () => 'template' }));
vi.mock('../../supabase/functions/_shared/ai-queue', () => ({ enqueueAiAction: mocks.queue }));
vi.mock('../../supabase/functions/_shared/lead-service', () => ({ normalizePhoneForSearch: () => '41999999999' }));
vi.mock('../../supabase/functions/_shared/whatsapp-dispatch', () => ({ resolveDispatchContext: mocks.dispatch, sendMediaViaInstance: mocks.send }));
const templateId = '11111111-1111-4111-8111-111111111111';
const quoteId = '22222222-2222-4222-8222-222222222222';
const ctx = { organizationId: 'org', agentId: 'agent', leadId: 'lead', conversationId: 'conversation', userMessage: '', inbound: {storage:'whatsapp_messages' as const,messageIds:['inbound']} };
const data = { values: { customer: 'Cliente Teste' }, items: [{ code: 'A', description: 'Motor', unit: 'UN', quantity: '2', unit_price_cents: 1000 }], freight_cents: 0, discount_cents: 0, tax_cents: 0, extra_cents: 0 };
const quote = { id: quoteId, organization_id: 'org', agent_id: 'agent', lead_id: 'lead', conversation_id: 'conversation', revision: 1, status: 'awaiting_confirmation', updated_at: '2026-09-23T00:00:00Z', template_id: templateId, convert_to_pdf: false, confirmation_code: 'ABCDEF12', data, required_fields: ['customer'], confirmed_at: '2026-09-23T01:00:00Z', file_path: `org/agent/quotes/${quoteId}/1.docx`, file_name: 'quote.docx' };
function memory(content:string) {return [{content,metadata:{quote_presentation:{quote_id:quoteId,revision:1,instance_id:'instance',accepted_at:'2026-09-23T00:01:01Z'}}}];}
function contextRows(pdf = false) { return [
  { is_active: true, can_generate_order_request: true, order_request_config: { template_document_id: templateId, convert_to_pdf: pdf, required_fields: ['customer'] }, whatsapp_instance_id: 'instance' },
  { id: 'conversation' }, { id: 'lead', name: 'Cliente Teste', phone: '41999999999', ai_disabled: false },
  { id: templateId, fields: ['customer','total'], sha256: 'hash', file_path: 'template.docx' },
]; }
function presented(userMessage: string, summary = quoteSummary(data,['customer','total'],['customer'])) { return [
  [{id:'inbound',content:userMessage,instance_id:'instance',created_at:'2026-09-23T00:02:00Z',timestamp:'2026-09-23T00:02:00Z'}],
  [{content:summary,status:'sent',created_at:'2026-09-23T00:01:00Z'}],
]; }
function database(results: unknown[]) {
  const calls: { table: string; operations: [string, ...unknown[]][] }[] = [];
  const from = vi.fn((table: string) => {
    const entry = { table, operations: [] as [string, ...unknown[]][] }; calls.push(entry);
    if (!results.length) throw new Error(`Unexpected DB call ${table}`);
    const next = results.shift();
    const response = next && typeof next === 'object' && 'error' in next ? next : { data: next, error: null };
    const pending = Promise.resolve(response);
    const chain: Record<string, unknown> = { then: pending.then.bind(pending) };
    for (const method of ['select','eq','in','gte','lt','order','limit','single','maybeSingle','update','insert','upsert']) chain[method] = (...args: unknown[]) => { entry.operations.push([method,...args]); return chain; };
    return chain;
  });
  const storage = { download: vi.fn(async () => ({ data: new Blob(['word']), error: null })), upload: vi.fn(async () => ({ error: null })), createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://private.example/signed' }, error: null })) };
  return { db: { from, storage: { from: () => storage } } as unknown as Parameters<typeof runQuoteTool>[0], calls, storage };
}
beforeEach(() => { vi.stubGlobal('Deno', { env: { get: () => 'true' } }); vi.clearAllMocks(); mocks.queue.mockResolvedValue({ queued: true }); mocks.dispatch.mockResolvedValue({ instance: { id: 'instance' }, normalizedPhone: '5541999999999' }); });
describe('quote generation workflow', () => {
  it.each([undefined, null, '', '   '])('accepts absent quote id %s when starting a draft', async quote_id => {
    const {db,calls} = database([...contextRows(), null, {...quote,status:'draft'}]);
    const result = await runQuoteTool(db,ctx,{operation:'save',quote_id,data});
    expect(result).toMatchObject({success:true,status:'draft'});
    expect(calls.some(c=>c.operations.some(op=>op[0]==='insert'))).toBe(true);
  });
  it.each([null, '', '   '])('accepts absent quote id %s for status', async quote_id => {
    const {db} = database([...contextRows(), null]);
    expect(await runQuoteTool(db,ctx,{operation:'status',quote_id})).toMatchObject({success:true,quote:null});
  });
  it.each(['TESTE-001', 42, {}, 'not-a-uuid', quoteId])('never lets the model select a quote with %s', async quote_id => {
    const {db} = database([...contextRows(), null]);
    expect(await runQuoteTool(db,ctx,{operation:'status',quote_id})).toMatchObject({success:true,quote:null});
    for (const call of vi.mocked(db.from).mock.results) expect(call.type).toBe('return');
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it('does not generate without an actual customer confirmation', async () => {
    const {db} = database([...contextRows(), quote]);
    expect(await runQuoteTool(db,ctx,{operation:'generate',quote_id:null})).toMatchObject({success:false});
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('scopes resolution to the trusted conversation rather than model identifiers', async () => {
    const {db,calls} = database([...contextRows(), null]);
    await runQuoteTool(db,ctx,{operation:'status',quote_id:quoteId});
    const operations=calls.find(c=>c.table==='copilot_quotes')!.operations;
    expect(operations).toContainEqual(['eq','organization_id','org']);
    expect(operations).toContainEqual(['eq','agent_id','agent']);
    expect(operations).toContainEqual(['eq','lead_id','lead']);
    expect(operations).toContainEqual(['eq','conversation_id','conversation']);
    expect(operations).not.toContainEqual(['eq','id',quoteId]);
  });
  it.each([undefined, '', 'false', 'TRUE'])('blocks enqueue and delivery with release gate %s', async value => {
    vi.stubGlobal('Deno', { env: { get: () => value } });
    const {db} = database([]);
    expect(await runQuoteTool(db,ctx,{operation:'send'})).toMatchObject({success:false,error:'quote_live_send_disabled'});
    expect(await sendQuoteDocument(db, {} as Parameters<typeof sendQuoteDocument>[1])).toMatchObject({success:false,error:'quote_live_send_disabled'});
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('denies a mismatched trusted conversation before storage or render', async () => {
    const rows: unknown[] = contextRows(); rows[1] = { error: { message: 'not found' } };
    const {db} = database(rows);
    expect((await runQuoteTool(db,ctx,{operation:'status'})).success).toBe(false);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('does not authorize generation with an LLM boolean', async () => {
    const {db} = database([...contextRows(), quote]);
    expect((await runQuoteTool(db,ctx,{operation:'generate',confirmed:true})).success).toBe(false);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('prepare is idempotent and preserves the original presentation timestamp', async () => {
    const {db,calls} = database([...contextRows(), quote]);
    const result = await runQuoteTool(db,ctx,{operation:'prepare'});
    expect(result.success).toBe(true);
    expect(result.customer_message).toContain('Pode responder sim, confirmo ou pode fechar');
    expect(result.customer_message).not.toContain('ABCDEF12');
    expect(calls.some(c=>c.operations.some(op=>op[0]==='update'))).toBe(false);
  });
  it.each(['sim','confirmo','pode fechar'])('generates on natural confirmation %s of the exact latest summary', async userMessage => {
    const q={...quote,confirmation_code:null};
    const {db}=database([...contextRows(),q,memory(quoteSummary(data,['customer','total'],['customer'])),...presented(userMessage),{...q,status:'generating'},{...q,status:'ready'}]);
    mocks.service.mockResolvedValue({format:'docx',file:btoa('PKtest')});
    expect(await runQuoteTool(db,{...ctx,userMessage},{operation:'generate'})).toMatchObject({success:true,status:'ready'});
  });
  it('does not treat agreement with another question as quote approval', async()=>{
    const {db}=database([...contextRows(),{...quote,confirmation_code:null},[{content:'O telefone está correto?'}]]);
    expect(await runQuoteTool(db,{...ctx,userMessage:'sim'},{operation:'generate'})).toMatchObject({success:false,error_code:'quote_summary_required'});
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('does not save a new revision in a confirmation turn',async()=>{
    const {db,calls}=database([...contextRows(),quote]);
    expect(await runQuoteTool(db,{...ctx,userMessage:'pode fechar'},{operation:'save',data})).toMatchObject({success:false,error_code:'confirmation_must_not_resave'});
    expect(calls.some(c=>c.operations.some(op=>op[0]==='update'))).toBe(false);
  });
  it('does not invalidate confirmation for unchanged data',async()=>{
    const {db,calls}=database([...contextRows(),quote]);
    expect(await runQuoteTool(db,ctx,{operation:'save',data})).toMatchObject({success:true,unchanged:true,revision:1,status:'awaiting_confirmation'});
    expect(calls.some(c=>c.operations.some(op=>op[0]==='update'))).toBe(false);
  });
  it('requires a new revision when the price changes',async()=>{
    const changed={...data,items:[{...data.items[0],unit_price_cents:1100}]};
    const {db,calls}=database([...contextRows(),quote,{...quote,status:'draft',revision:2}]);
    expect(await runQuoteTool(db,ctx,{operation:'save',data:changed})).toMatchObject({status:'draft',revision:2});
    expect(calls.at(-1)?.operations).toContainEqual(['update',expect.objectContaining({confirmation_code:null,confirmed_at:null,revision:2})]);
  });
  it.each([false,true])('generates exactly the configured format (PDF=%s)', async pdf => {
    const q = {...quote,convert_to_pdf:pdf};
    const {db,storage,calls} = database([...contextRows(pdf),q,memory('Resumo. CONFIRMO ABCDEF12'),...presented('CONFIRMO ABCDEF12','Resumo. CONFIRMO ABCDEF12'),{...q,status:'generating'},{...q,status:'ready'}]);
    mocks.service.mockResolvedValue({ format:pdf?'pdf':'docx', file: btoa(pdf?'%PDF-test':'PKtest') });
    const result = await runQuoteTool(db,{...ctx,userMessage:'CONFIRMO ABCDEF12'},{operation:'generate'});
    expect(result.status).toBe('ready');
    expect(mocks.service).toHaveBeenCalledWith('render',expect.objectContaining({convert_to_pdf:pdf, total_cents:2000}));
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(mocks.queue).not.toHaveBeenCalled();
    for (const c of calls.filter(c=>c.table==='copilot_quotes')) expect(c.operations).toContainEqual(['eq','organization_id','org']);
  });
  it('never falls back to DOCX after a PDF conversion failure', async () => {
    const q={...quote,convert_to_pdf:true};
    const {db,storage} = database([...contextRows(true),q,memory('CONFIRMO ABCDEF12'),...presented('CONFIRMO ABCDEF12','CONFIRMO ABCDEF12'),{...q,status:'generating'},{...q,status:'failed'}]);
    mocks.service.mockRejectedValueOnce(new Error('timeout'));
    expect((await runQuoteTool(db,{...ctx,userMessage:'CONFIRMO ABCDEF12'},{operation:'generate'})).success).toBe(false);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it('enqueues only the scoped generated revision using a stable key', async () => {
    const {db} = database([...contextRows(),{...quote,status:'ready'}]);
    expect((await runQuoteTool(db,ctx,{operation:'send'})).status).toBe('queued');
    expect(mocks.queue).toHaveBeenCalledWith(db,expect.objectContaining({organizationId:'org', leadId:'lead', idempotencyKey:`quote:${quoteId}:1`}));
  });
  it.each(['dead_letter','failed','completed'])('does not claim a failed/finished queue entry is queued (%s)',async status=>{
    const {db}=database([...contextRows(),{...quote,status:'ready'},{status}]);
    mocks.queue.mockResolvedValue({queued:false,reason:'duplicate_idempotency_key'});
    expect(await runQuoteTool(db,ctx,{operation:'send'})).toMatchObject({success:false,error_code:'quote_queue_requires_review'});
  });
  it('retries a failed render without another save or confirmation code',async()=>{
    const q={...quote,status:'failed',confirmation_code:null};
    const {db}=database([...contextRows(),q,{...q,status:'generating'},{...q,status:'ready'}]);
    mocks.service.mockResolvedValue({format:'docx',file:btoa('PKtest')});
    expect(await runQuoteTool(db,{...ctx,userMessage:'pode gerar'},{operation:'generate'})).toMatchObject({success:true,status:'ready'});
  });
  it('recovers an abandoned renderer through CAS before retrying',async()=>{
    const q={...quote,status:'generating',updated_at:'2020-01-01T00:00:00Z'};
    const {db,calls}=database([...contextRows(),q,{...q,status:'failed'},{...q,status:'generating'},{...q,status:'ready'}]);
    mocks.service.mockResolvedValue({format:'docx',file:btoa('PKtest')});
    expect(await runQuoteTool(db,{...ctx,userMessage:'confirmo'},{operation:'generate'})).toMatchObject({success:true,status:'ready'});
    expect(calls.some(c=>c.operations.some(op=>op[0]==='update'&&(op[1] as any).error_code==='generation_interrupted'))).toBe(true);
  });
  it.each([false,true])('runs natural confirmation through render, queue and provider, preserving format %s',async pdf=>{
    const q={...quote,confirmation_code:null,convert_to_pdf:pdf};
    const ready={...q,status:'ready'};
    const {db}=database([
      ...contextRows(pdf),q, // status
      ...contextRows(pdf),q,memory(quoteSummary(data,['customer','total'],['customer'])),...presented('sim'),{...q,status:'generating'},ready,
      ...contextRows(pdf),ready, // enqueue
      ready,...contextRows(pdf),null,{id:quoteId},null,null,null, // worker
      {...ready,status:'sent'}, // duplicate worker
    ]);
    mocks.service.mockResolvedValue({format:pdf?'pdf':'docx',file:btoa(pdf?'%PDF-test':'PKtest')});
    const confirmation=await handleConfirmedQuote(db,{...ctx,userMessage:'sim'});
    expect(confirmation?.result).toMatchObject({success:true,status:'queued'});
    mocks.send.mockResolvedValue({success:true,messageId:'provider-id',status:'sent'});
    const action={id:'action',organization_id:'org',lead_id:'lead',conversation_id:'conversation',action_type:'send_quote_document',payload:{quote_id:quoteId,revision:1}};
    expect(await sendQuoteDocument(db,action)).toMatchObject({success:true});
    expect(await sendQuoteDocument(db,action)).toMatchObject({success:true,data:{skipped:true}});
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
describe('quote delivery safety',()=>{
  const action={id:'action',organization_id:'org',lead_id:'lead',conversation_id:'conversation',action_type:'send_quote_document',payload:{quote_id:quoteId,revision:1}};
  it('enforces the organization allowlist in both enqueue and delivery',async()=>{
    vi.stubGlobal('Deno',{env:{get:(key:string)=>key==='COPILOT_QUOTE_LIVE_SEND_ORG_IDS'?'org': 'false'}});
    const allowed=database([...contextRows(),{...quote,status:'ready'}]);
    expect(await runQuoteTool(allowed.db,ctx,{operation:'send'})).toMatchObject({status:'queued'});
    const worker=database([{...quote,status:'ready'},...contextRows(),null,{id:quoteId},null,null,null]);
    mocks.send.mockResolvedValue({success:true,messageId:'provider-id',status:'sent'});
    expect(await sendQuoteDocument(worker.db,action)).toMatchObject({success:true});
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const denied=database([]);
    expect(await runQuoteTool(denied.db,{...ctx,organizationId:'another-org'},{operation:'send'})).toMatchObject({error:'quote_live_send_disabled'});
    expect(await sendQuoteDocument(denied.db,{...action,organization_id:'another-org'})).toMatchObject({error:'quote_live_send_disabled'});
    expect(denied.db.from).not.toHaveBeenCalled();
  });
  it('two competing workers atomically claim one revision and send only once',async()=>{
    let state={...quote,status:'ready'};
    const rows=contextRows();
    const tables:Record<string,unknown>={copilot_agents:rows[0],conversations:rows[1],leads:rows[2],copilot_quote_templates:rows[3],phone_ai_preferences:null};
    const db={from(table:string){
      let patch:Record<string,unknown>|undefined;
      const filters:Array<[string,unknown]>=[];
      const chain:any={select:()=>chain,update:(value:Record<string,unknown>)=>{patch=value;return chain;},eq:(key:string,value:unknown)=>{filters.push([key,value]);return chain;},in:()=>chain,limit:()=>chain,single:()=>chain,maybeSingle:()=>chain,upsert:()=>chain,insert:()=>chain,
        then:(resolve:any)=>Promise.resolve().then(()=>{
          if(table!=='copilot_quotes')return {data:tables[table]??null,error:null};
          if(!filters.every(([key,value])=>(state as any)[key]===value))return {data:null,error:null};
          if(patch) state={...state,...patch};
          return {data:{...state},error:null};
        }).then(resolve)};return chain;
    },storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://private.example/signed'},error:null})})}} as unknown as Parameters<typeof sendQuoteDocument>[0];
    mocks.send.mockResolvedValue({success:true,messageId:'provider-id',status:'sent'});
    const results=await Promise.all([sendQuoteDocument(db,action),sendQuoteDocument(db,action)]);
    expect(results.filter(r=>r.success)).toHaveLength(1);
    expect(results.some(r=>r.error==='quote_send_claim_failed')).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('sent');
  });
  it.each(['sending','reconcile','sent'])('does not resend an already claimed revision (%s)',async status=>{
    const {db}=database([{...quote,status}]);
    await sendQuoteDocument(db,action);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('fails closed when the pause gate cannot be read',async()=>{
    const {db}=database([{...quote,status:'ready'},...contextRows(),{error:{message:'db down'}}]);
    expect((await sendQuoteDocument(db,action)).error).toBe('quote_copilot_paused');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('records ambiguous provider results for reconciliation instead of retrying delivery',async()=>{
    const {db,calls}=database([{...quote,status:'ready'},...contextRows(),null,{id:quoteId},null]);
    mocks.send.mockResolvedValue({success:false,error:'timeout'});
    expect((await sendQuoteDocument(db,action)).error).toBe('quote_requires_reconciliation');
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(calls.at(-1)?.operations).toContainEqual(['update',expect.objectContaining({status:'reconcile'})]);
  });
});
