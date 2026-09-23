// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { receivedAfterSummary as checkReceipt } from '../../supabase/functions/_shared/quotes/presentation';
import { messageTimestamp } from '../../supabase/functions/whatsapp-webhook/message-timestamp';
const receipt={accepted_at:'2026-09-23T12:01:01Z',instance_id:'instance',quote_id:'quote',revision:1};
const receivedAfterSummary: typeof checkReceipt = (db,ctx,at,summary,evidence=receipt)=>checkReceipt(db,ctx,at,summary,evidence);

const ctx = {organizationId:'org',leadId:'lead',agentId:'agent',conversationId:'conversation',userMessage:'sim',inbound:{storage:'channel_messages' as const,messageIds:['incoming']}};
const revision = '2026-09-23T12:00:00Z';
const summary = 'Pedido A — Motor. Total: R$ 20,00. Confirma?';
const input = {id:'incoming',content:'sim',instance_id:'instance',created_at:'2026-09-23T12:02:00Z',timestamp:'2026-09-23T12:02:00Z'};
const output = {content:summary,status:'sent',created_at:'2026-09-23T12:01:00Z'};
function database(incoming = [input], outgoing = [output]) {
  const calls: Array<{table:string,filters:Array<[string,string,unknown]>}> = [];
  const db = {from(table:string) {
    const call = {table,filters:[] as Array<[string,string,unknown]>}; calls.push(call);
    let rows: any[] = table === 'channel_messages' ? incoming : outgoing;
    const chain: any = {
      select:()=>chain,order:()=>chain,limit:()=>chain,
      eq:(key:string,value:unknown)=>{call.filters.push(['eq',key,value]);return chain;},
      in:(key:string,value:unknown)=>{call.filters.push(['in',key,value]);return chain;},
      gte:(key:string,value:string)=>{rows=rows.filter(row=>Date.parse(row[key])>=Date.parse(value));return chain;},
      lt:(key:string,value:string)=>{rows=rows.filter(row=>Date.parse(row[key])<Date.parse(value));return chain;},
      then:(resolve:any)=>Promise.resolve({data:rows,error:null}).then(resolve),
    }; return chain;
  }};
  return {db:db as Parameters<typeof receivedAfterSummary>[0],calls};
}
describe('quote confirmation delivery evidence',()=>{
  it('requires durable acceptance evidence, not a pending row later promoted to sent',async()=>{
    const {db}=database();
    expect(await checkReceipt(db,ctx,revision,summary)).toBe(false);
    expect(await receivedAfterSummary(db,ctx,revision,summary,{...receipt,accepted_at:'2026-09-23T12:02:30Z'})).toBe(false);
  });
  it('preserves milliseconds and accepts a strictly later reply in the same second',async()=>{
    const timestamp=messageTimestamp(Date.parse('2026-09-23T12:01:01.900Z'));
    expect(timestamp).toBe('2026-09-23T12:01:01.900Z');
    const {db}=database([{...input,timestamp}]);
    expect(await receivedAfterSummary(db,ctx,revision,summary,{...receipt,accepted_at:'2026-09-23T12:01:01.100Z'})).toBe(true);
    expect(messageTimestamp(1790164861)).toMatch(/\.000Z$/);
  });
  it('does not invent ordering when the provider only supplies seconds',async()=>{
    const {db}=database([{...input,timestamp:'2026-09-23T12:01:01.000Z'}]);
    expect(await receivedAfterSummary(db,ctx,revision,summary,{...receipt,accepted_at:'2026-09-23T12:01:01.100Z'})).toBe(false);
  });
  it('accepts the actual received reply after the complete sent summary',async()=>{
    const {db,calls}=database();
    expect(await receivedAfterSummary(db,ctx,revision,summary)).toBe(true);
    for(const call of calls) {
      expect(call.filters).toContainEqual(['eq','organization_id','org']);
      expect(call.filters).toContainEqual(['eq','lead_id','lead']);
    }
    expect(calls[0].filters).toContainEqual(['in','id',['incoming']]);
    expect(calls[1].filters).toContainEqual(['eq','instance_id','instance']);
  });
  it.each(['2026-09-23T11:59:00Z','2026-09-23T12:00:30Z'])('rejects an absorbed or delayed reply received at %s',async timestamp=>{
    const {db}=database([{...input,timestamp}]);
    expect(await receivedAfterSummary(db,ctx,revision,summary)).toBe(false);
  });
  it.each(['pending','failed','error'])('rejects outbound status %s',async status=>{
    const {db}=database([input],[{...output,status}]);
    expect(await receivedAfterSummary(db,ctx,revision,summary)).toBe(false);
  });
  it('rejects a reply to an earlier revision',async()=>{
    const {db}=database();
    expect(await receivedAfterSummary(db,ctx,'2026-09-23T12:03:00Z',summary)).toBe(false);
  });
  it('rejects an unrelated subsequent question',async()=>{
    const {db}=database([input],[{...output,content:'Quer outro orçamento?',created_at:'2026-09-23T12:01:30Z'},output]);
    expect(await receivedAfterSummary(db,ctx,revision,summary)).toBe(false);
  });
  it('accepts a complete summary sent in separate chunks',async()=>{
    const {db}=database([input],[{...output,content:'Confirma?',created_at:'2026-09-23T12:01:30Z'},{...output,content:'Pedido A — Motor. Total: R$ 20,00.'}]);
    expect(await receivedAfterSummary(db,ctx,revision,summary)).toBe(true);
  });
  it('rejects fabricated input or missing original message identity',async()=>{
    const {db}=database();
    expect(await receivedAfterSummary(db,{...ctx,userMessage:'confirmo'},revision,summary)).toBe(false);
    expect(await receivedAfterSummary(db,{...ctx,inbound:undefined},revision,summary)).toBe(false);
  });
  it('validates every message of a combined confirmation',async()=>{
    const {db}=database([input,{...input,id:'second',content:'pode enviar',timestamp:'2026-09-23T12:02:01Z'}]);
    expect(await receivedAfterSummary(db,{...ctx,userMessage:'sim\npode enviar',inbound:{...ctx.inbound,messageIds:['incoming','second']}},revision,summary)).toBe(true);
    expect(await receivedAfterSummary(db,ctx,revision,summary)).toBe(false);
  });
});
