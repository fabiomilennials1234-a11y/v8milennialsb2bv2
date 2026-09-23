// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuotePresentation, recordQuotePresentation, completeQuotePresentations } from '../../supabase/functions/_shared/quotes/presentation';

function database() {
  const tables:Record<string,any[]>={
    copilot_quotes:[{id:'q',organization_id:'org',conversation_id:'conv',revision:1,status:'awaiting_confirmation'}],
    conversation_messages:[],
    whatsapp_messages:[{message_id:'chunk',organization_id:'org',instance_id:'instance',direction:'outgoing',status:'pending'}],
  };
  const get=(row:any,key:string)=>key.split('->').reduce((value,part)=>value?.[part],row);
  const contains=(row:any,expected:any):boolean=>Array.isArray(expected)?expected.every(v=>row?.includes(v)):expected&&typeof expected==='object'?Object.entries(expected).every(([k,v])=>contains(row?.[k],v)):row===expected;
  const db={from(table:string){
    const filters:Array<(row:any)=>boolean>=[];let update:any,insert:any,single=false;
    const chain:any={
      select:()=>chain,order:()=>chain,limit:()=>chain,
      single:()=>{single=true;return chain;},maybeSingle:()=>{single=true;return chain;},
      eq:(key:string,value:any)=>{filters.push(row=>get(row,key)===value);return chain;},
      is:(key:string,value:any)=>{filters.push(row=>(get(row,key)??null)===value);return chain;},
      in:(key:string,values:any[])=>{filters.push(row=>values.includes(get(row,key)));return chain;},
      contains:(key:string,value:any)=>{filters.push(row=>contains(get(row,key),value));return chain;},
      update:(value:any)=>{update=value;return chain;},insert:(value:any)=>{insert=value;return chain;},
      then:(resolve:any)=>Promise.resolve().then(()=>{
        if(insert)tables[table].push({...insert,id:`message-${tables[table].length+1}`});
        const rows=tables[table].filter(row=>filters.every(f=>f(row)));
        if(update)for(const row of rows)Object.assign(row,update);
        const result=insert?tables[table].at(-1):single?rows[0]??null:rows;
        return {data:structuredClone(result),error:null};
      }).then(resolve),
    };return chain;
  }};
  return {db:db as Parameters<typeof recordQuotePresentation>[0],tables};
}
const summary={conversation_id:'conv',quote_id:'q',revision:1,summary:'Resumo idêntico'};
beforeEach(()=>vi.stubGlobal('Deno',{env:{get:()=> 'true'}}));
afterEach(()=>vi.useRealTimers());
describe('durable presentation occurrences and asynchronous receipts',()=>{
  it('creates separate occurrences for the same summary, without text dedup',async()=>{
    const {db}=database();
    const a=await createQuotePresentation(db,summary);
    const b=await createQuotePresentation(db,summary);
    expect(a.message_id).not.toBe(b.message_id);
  });
  it('completes queued → sent, then preserves first receipt across concurrent duplicate callbacks',async()=>{
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-23T12:01:00Z'));
    const {db,tables}=database();
    const presentation=await createQuotePresentation(db,summary);
    await recordQuotePresentation(db,'org','instance',presentation,['chunk']);
    const row=tables.conversation_messages[0];
    expect(row.metadata.quote_delivery.message_ids).toEqual(['chunk']);
    expect(row.metadata.quote_presentation).toBeUndefined();
    tables.whatsapp_messages[0].status='sent';
    await Promise.all([completeQuotePresentations(db,'org','instance',['chunk']),completeQuotePresentations(db,'org','instance',['chunk'])]);
    const receipt=structuredClone(row.metadata.quote_presentation);
    expect(receipt).toMatchObject({quote_id:'q',revision:1,instance_id:'instance'});
    expect(Number.isFinite(Date.parse(receipt.accepted_at))).toBe(true);
    vi.setSystemTime(new Date('2026-09-23T12:03:00Z'));
    await recordQuotePresentation(db,'org','instance',presentation,['chunk']);
    await completeQuotePresentations(db,'org','instance',['chunk']);
    expect(row.metadata.quote_presentation).toEqual(receipt);
  });
  it('handles a provider callback arriving before chunk association',async()=>{
    const {db,tables}=database();
    const presentation=await createQuotePresentation(db,summary);
    tables.whatsapp_messages[0].status='delivered';
    await completeQuotePresentations(db,'org','instance',['chunk']);
    expect(tables.conversation_messages[0].metadata.quote_presentation).toBeUndefined();
    await recordQuotePresentation(db,'org','instance',presentation,['chunk']);
    expect(tables.conversation_messages[0].metadata.quote_presentation).toBeDefined();
  });
  it('ignores callback identity from a different tenant or instance',async()=>{
    const {db,tables}=database();
    const presentation=await createQuotePresentation(db,summary);
    await recordQuotePresentation(db,'org','instance',presentation,['chunk']);
    tables.whatsapp_messages[0].status='sent';
    await completeQuotePresentations(db,'wrong-org','instance',['chunk']);
    await completeQuotePresentations(db,'org','wrong-instance',['chunk']);
    expect(tables.conversation_messages[0].metadata.quote_presentation).toBeUndefined();
    await completeQuotePresentations(db,'org','instance',['chunk']);
    expect(tables.conversation_messages[0].metadata.quote_presentation).toBeDefined();
  });
  it('does not complete until every chunk is accepted',async()=>{
    const {db,tables}=database();
    tables.whatsapp_messages.push({...tables.whatsapp_messages[0],message_id:'second',status:'sent'});
    const presentation=await createQuotePresentation(db,summary);
    await recordQuotePresentation(db,'org','instance',presentation,['chunk','second']);
    expect(tables.conversation_messages[0].metadata.quote_presentation).toBeUndefined();
    tables.whatsapp_messages[0].status='delivered';
    await completeQuotePresentations(db,'org','instance',['chunk']);
    expect(tables.conversation_messages[0].metadata.quote_presentation).toBeDefined();
  });
  it('rejects wrong tenant and a callback for a superseded revision',async()=>{
    const {db,tables}=database();
    const presentation=await createQuotePresentation(db,summary);
    await recordQuotePresentation(db,'another-org','instance',presentation,['chunk']);
    expect(tables.conversation_messages[0].metadata.quote_delivery).toBeUndefined();
    await recordQuotePresentation(db,'org','instance',presentation,['chunk']);
    tables.whatsapp_messages[0].status='sent';
    tables.copilot_quotes[0].revision=2;
    await completeQuotePresentations(db,'org','instance',['chunk']);
    expect(tables.conversation_messages[0].metadata.quote_presentation).toBeUndefined();
  });
});
