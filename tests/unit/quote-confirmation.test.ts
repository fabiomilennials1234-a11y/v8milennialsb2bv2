import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isQuoteConfirmation, sameQuoteData, quoteSummary } from '../../supabase/functions/_shared/quotes/confirmation';
import { buildQuoteTool } from '../../src/contracts/copilot/quote-tool';
import { handleConfirmedQuote } from '../../supabase/functions/_shared/quotes/confirmed-turn';
import { runQuoteTool } from '../../supabase/functions/_shared/quotes/tool';
vi.mock('../../supabase/functions/_shared/quotes/tool',()=>({runQuoteTool:vi.fn()}));
const call=vi.mocked(runQuoteTool);
const ctx={organizationId:'org',agentId:'agent',leadId:'lead',conversationId:'conversation',userMessage:'sim'};
const db={} as Parameters<typeof handleConfirmedQuote>[0];
const data={values:{cliente:'Cliente'},items:[{code:'P',description:'Palheta preta ventilada',unit:'UN',quantity:'160',unit_price_cents:2990}],freight_cents:1000,discount_cents:0,tax_cents:0,extra_cents:0};
beforeEach(()=>vi.resetAllMocks());
describe('natural quote confirmation',()=>{
  it.each(['sim','Confirmo!','pode fechar','pode seguir','sim, pode enviar.','de acordo','está correto'])('accepts %s',s=>expect(isQuoteConfirmation(s)).toBe(true));
  it.each(['não','não confirmo','sim, mas quero 3 caixas','pode fechar se tiver desconto','quanto custa?','confirmo 123','sim?'])('does not accept %s',s=>expect(isQuoteConfirmation(s)).toBe(false));
  it('does not expose an ID input',()=>expect(buildQuoteTool(['cliente'],['cliente']).input_schema.properties).not.toHaveProperty('quote_id'));
  it('ignores plural but preserves product variants and amounts',()=>{
    expect(sameQuoteData(data,{...data,items:[{...data.items[0],description:'Palhetas pretas ventiladas'}]})).toBe(true);
    for(const patch of [{description:'Palheta preta cega'},{quantity:'120'},{unit_price_cents:1000},{code:'OUTRO'}]) expect(sameQuoteData(data,{...data,items:[{...data.items[0],...patch}]})).toBe(false);
    expect(sameQuoteData(data,{...data,freight_cents:0})).toBe(false);
  });
  it('presents backend totals even when the Word has no total slots',()=>{
    const text=quoteSummary(data,['cliente'],['cliente']);
    expect(text).toContain('Subtotal: R$ 4.784,00');
    expect(text).toContain('Frete: R$ 10,00');
    expect(text).toContain('Total: R$ 4.794,00');
    expect(text).toContain('P — Palheta preta ventilada');
    expect(quoteSummary({...data,items:[{...data.items[0],code:'OUTRO'}]},['cliente'],['cliente'])).not.toBe(text);
    expect(text).not.toMatch(/CONFIRMO [A-F0-9]{8}/);
  });
  it('resolves, generates and enqueues without save or LLM identifiers',async()=>{
    call.mockResolvedValueOnce({success:true,quote:{status:'awaiting_confirmation'}}).mockResolvedValueOnce({success:true,status:'ready'}).mockResolvedValueOnce({success:true,status:'queued'});
    const result=await handleConfirmedQuote(db,ctx);
    expect(call.mock.calls.map(c=>c[2])).toEqual([{operation:'status'},{operation:'generate'},{operation:'send'}]);
    expect(result?.message).toContain('fila de envio');
    expect(result?.message).not.toContain('já foi enviado');
  });
  it.each(['sending','sent','reconcile','generating','ready','failed'])('does not capture an unrelated yes when %s',async status=>{
    call.mockResolvedValueOnce({success:true,quote:{status}}).mockResolvedValueOnce({success:true,status});
    expect(await handleConfirmedQuote(db,ctx)).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('reports a blocked send without restarting confirmation',async()=>{
    call.mockResolvedValueOnce({success:true,quote:{status:'awaiting_confirmation'}}).mockResolvedValueOnce({success:true,status:'ready'}).mockResolvedValueOnce({success:false,error:'quote_live_send_disabled'});
    expect((await handleConfirmedQuote(db,ctx))?.message).toContain('envio está bloqueado');
    expect(call.mock.calls.some(c=>c[2].operation==='save')).toBe(false);
  });
  it('leaves messages with order changes to the regular collection flow',async()=>{
    expect(await handleConfirmedQuote(db,{...ctx,userMessage:'sim, mas quero 3 caixas'})).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
});
