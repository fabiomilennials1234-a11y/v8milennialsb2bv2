// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runQuoteTool } from '../../supabase/functions/_shared/quotes/tool';
import { sendQuoteDocument } from '../../supabase/functions/_shared/quotes/send';
const mocks = vi.hoisted(() => ({ service: vi.fn(), queue: vi.fn(), dispatch: vi.fn(), send: vi.fn() }));
vi.mock('../../supabase/functions/_shared/quotes/service', () => ({ documentService: mocks.service, sha256: async () => 'hash', base64: () => 'template' }));
vi.mock('../../supabase/functions/_shared/ai-queue', () => ({ enqueueAiAction: mocks.queue }));
vi.mock('../../supabase/functions/_shared/lead-service', () => ({ normalizePhoneForSearch: () => '41999999999' }));
vi.mock('../../supabase/functions/_shared/whatsapp-dispatch', () => ({ resolveDispatchContext: mocks.dispatch, sendMediaViaInstance: mocks.send }));
const templateId = '11111111-1111-4111-8111-111111111111';
const quoteId = '22222222-2222-4222-8222-222222222222';
const ctx = { organizationId: 'org', agentId: 'agent', leadId: 'lead', conversationId: 'conversation', userMessage: '' };
const data = { values: { customer: 'Cliente Teste' }, items: [{ code: 'A', description: 'Motor', unit: 'UN', quantity: '2', unit_price_cents: 1000 }], freight_cents: 0, discount_cents: 0, tax_cents: 0, extra_cents: 0 };
const quote = { id: quoteId, organization_id: 'org', agent_id: 'agent', lead_id: 'lead', conversation_id: 'conversation', revision: 1, status: 'awaiting_confirmation', updated_at: '2026-09-23T00:00:00Z', template_id: templateId, convert_to_pdf: false, confirmation_code: 'ABCDEF12', data, required_fields: ['customer'], confirmed_at: '2026-09-23T01:00:00Z', file_path: `org/agent/quotes/${quoteId}/1.docx`, file_name: 'quote.docx' };
function contextRows(pdf = false) { return [
  { is_active: true, can_generate_order_request: true, order_request_config: { template_document_id: templateId, convert_to_pdf: pdf, required_fields: ['customer'] }, whatsapp_instance_id: 'instance' },
  { id: 'conversation' }, { id: 'lead', name: 'Cliente Teste', phone: '41999999999', ai_disabled: false },
  { id: templateId, fields: ['customer','total'], sha256: 'hash', file_path: 'template.docx' },
]; }
function database(results: unknown[]) {
  const calls: { table: string; operations: [string, ...unknown[]][] }[] = [];
  const from = vi.fn((table: string) => {
    const entry = { table, operations: [] as [string, ...unknown[]][] }; calls.push(entry);
    if (!results.length) throw new Error(`Unexpected DB call ${table}`);
    const next: any = results.shift();
    const response = next?.error ? next : { data: next, error: null };
    const chain: any = { then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve,reject) };
    for (const method of ['select','eq','in','gte','order','limit','single','maybeSingle','update','insert','upsert']) chain[method] = (...args: unknown[]) => { entry.operations.push([method,...args]); return chain; };
    return chain;
  });
  const storage = { download: vi.fn(async () => ({ data: new Blob(['word']), error: null })), upload: vi.fn(async () => ({ error: null })), createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://private.example/signed' }, error: null })) };
  return { db: { from, storage: { from: () => storage } } as any, calls, storage };
}
beforeEach(() => { vi.stubGlobal('Deno', { env: { get: () => 'true' } }); vi.clearAllMocks(); mocks.queue.mockResolvedValue({ queued: true }); mocks.dispatch.mockResolvedValue({ instance: { id: 'instance' }, normalizedPhone: '5541999999999' }); });
describe('quote generation workflow', () => {
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
    expect(result.confirmation_instruction).toContain('CONFIRMO ABCDEF12');
    expect(calls.some(c=>c.operations.some(op=>op[0]==='update'))).toBe(false);
  });
  it.each([false,true])('generates exactly the configured format (PDF=%s)', async pdf => {
    const q = {...quote,convert_to_pdf:pdf};
    const {db,storage,calls} = database([...contextRows(pdf),q,[{content:'Resumo. CONFIRMO ABCDEF12'}],{...q,status:'generating'},{...q,status:'ready'}]);
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
    const {db,storage} = database([...contextRows(true),q,[{content:'CONFIRMO ABCDEF12'}],{...q,status:'generating'},{...q,status:'failed'}]);
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
});
describe('quote delivery safety',()=>{
  const action={id:'action',organization_id:'org',lead_id:'lead',conversation_id:'conversation',action_type:'send_quote_document',payload:{quote_id:quoteId,revision:1}};
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
