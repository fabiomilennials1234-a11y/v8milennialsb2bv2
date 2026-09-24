// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { admitReceipt, type InboxEvent } from '../../services/whatsapp-ingress/inbox.ts';
import { eventTasks, processInboxEvent } from '../../services/whatsapp-ingress/worker.ts';
import type { WhatsAppWebhookOptions } from '../../supabase/functions/whatsapp-webhook/handler.ts';

afterEach(() => vi.useRealTimers());
const row: InboxEvent = {
  id:'event-id',organization_id:'org',instance_id:'instance',event_name:'messages_update',
  payload:{id:'receipt',status:'read'},path_instance_id:'provider-instance',lease_token:'lease',created_at:'2026-09-23T10:00:00Z',
};
const context = (rpc: ReturnType<typeof vi.fn>) => ({ supabase: { rpc } as never,
  instance:{id:'instance',organization_id:'org'},event:'messages_update',payload:row.payload });

it('acknowledges only after successful durable enqueue; failure and unsupported events remain non-2xx', async () => {
  let resolve!: (value: unknown) => void;
  const rpc=vi.fn(() => new Promise(r => { resolve=r; }));
  let acknowledged=false;
  const pending=admitReceipt(context(rpc)).then(response => { acknowledged=true; return response; });
  await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
  expect(acknowledged).toBe(false);
  resolve({data:'durable-id',error:null});
  expect((await pending).status).toBe(200);
  rpc.mockResolvedValue({data:null,error:{message:'database unavailable'}});
  expect((await admitReceipt(context(rpc))).status).toBe(503);
  rpc.mockClear();
  expect((await admitReceipt({...context(rpc),event:'messages'})).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});

it('does not complete durable work before its background task settles', async () => {
  let completeBackground!: () => void;
  const rpc=vi.fn(async () => ({data:true,error:null}));
  const factory=vi.fn((_options: WhatsAppWebhookOptions) => async () => {
    eventTasks.getStore()!.waitUntil(new Promise<void>(resolve => {completeBackground=resolve;}));
    return new Response(JSON.stringify({ok:true}),{status:200});
  });
  const work=processInboxEvent({rpc} as never,row,'secret',factory,vi.fn());
  await vi.waitFor(() => expect(completeBackground).toBeTypeOf('function'));
  expect(rpc).not.toHaveBeenCalled();
  completeBackground(); await work;
  expect(rpc).toHaveBeenCalledWith('finish_whatsapp_ingress_event_with_outcome',{
    p_id:'event-id',p_lease_token:'lease',p_error_code:null,p_outcome:'processed',p_unmatched_count:0,
  });
  const options=factory.mock.calls[0][0];
  expect(options.trustedQueuedReplay).toBe(true);
  expect(options.queuedEventCreatedAt).toBe(row.created_at);
  expect(options.unmatchedReceiptGraceMs).toBe(300_000);
  expect(options.allowInstance!('instance','other-org')).toBe(false);
});

it.each([500,503])('retains HTTP %i as retryable work, not completion', async status => {
  const rpc=vi.fn(async () => ({data:true,error:null}));
  await processInboxEvent({rpc} as never,row,'secret',() => async () => new Response(null,{status}),vi.fn());
  expect(rpc).toHaveBeenCalledWith('finish_whatsapp_ingress_event_with_outcome',expect.objectContaining({p_error_code:`http_${status}`}));
});

it('retains lease on fatal timeout instead of racing a still-running task with a retry', async () => {
  vi.useFakeTimers();
  const rpc=vi.fn(); const fatal=vi.fn();
  const work=processInboxEvent({rpc} as never,row,'secret',() => () => new Promise<Response>(() => {}),fatal);
  const assertion=expect(work).rejects.toThrow('worker_timeout_lease_retained');
  await vi.advanceTimersByTimeAsync(45000);
  await assertion;
  expect(fatal).toHaveBeenCalledOnce();
  expect(rpc).not.toHaveBeenCalled();
});

it('marks rejected background work retryable even if synchronous handler returned 200', async () => {
  const rpc=vi.fn(async () => ({data:true,error:null}));
  await processInboxEvent({rpc} as never,row,'secret',() => async () => {
    eventTasks.getStore()!.waitUntil(Promise.reject(new Error('background failed')));
    return new Response(JSON.stringify({ok:true}),{status:200});
  },vi.fn());
  expect(rpc).toHaveBeenCalledWith('finish_whatsapp_ingress_event_with_outcome',expect.objectContaining({p_error_code:'background_failed'}));
});

it('records an explicit unmatched outcome after the handler processes matched IDs', async () => {
  const rpc=vi.fn(async () => ({data:true,error:null}));
  await processInboxEvent({rpc} as never,row,'secret',() => async () =>
    new Response(JSON.stringify({ok:true,outcome:'unmatched_receipt',unmatched_count:2}),{status:200}),vi.fn());
  expect(rpc).toHaveBeenCalledWith('finish_whatsapp_ingress_event_with_outcome',{
    p_id:'event-id',p_lease_token:'lease',p_error_code:null,p_outcome:'unmatched_receipt',p_unmatched_count:2,
  });
});

it('passes deferred receipt outcome for SQL to requeue without holding the FIFO', async () => {
  const rpc=vi.fn(async () => ({data:true,error:null}));
  await processInboxEvent({rpc} as never,row,'secret',() => async () =>
    new Response(JSON.stringify({ok:true,outcome:'deferred_receipt',unmatched_count:1}),{status:200}),vi.fn());
  expect(rpc).toHaveBeenCalledWith('finish_whatsapp_ingress_event_with_outcome',{
    p_id:'event-id',p_lease_token:'lease',p_error_code:null,p_outcome:'deferred_receipt',p_unmatched_count:1,
  });
});

it('keeps malformed successful HTTP bodies retryable instead of inventing an audit outcome', async () => {
  const rpc=vi.fn(async () => ({data:true,error:null}));
  await processInboxEvent({rpc} as never,row,'secret',() => async () =>
    new Response(JSON.stringify({ok:true,outcome:'unmatched_receipt',unmatched_count:0}),{status:200}),vi.fn());
  expect(rpc).toHaveBeenCalledWith('finish_whatsapp_ingress_event_with_outcome',expect.objectContaining({
    p_error_code:'processing_failed',p_outcome:'processed',p_unmatched_count:0,
  }));
});
