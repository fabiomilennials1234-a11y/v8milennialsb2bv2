import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { WhatsAppWebhookOptions } from '../../supabase/functions/whatsapp-webhook/handler.ts';
import { BackgroundTasks } from './runtime.ts';
import { type InboxEvent, skipDisabledGroupUpdate } from './inbox.ts';

type HandlerFactory = (options: WhatsAppWebhookOptions) => (request: Request) => Promise<Response>;
export const eventTasks = new AsyncLocalStorage<BackgroundTasks>();

export async function processInboxEvent(db: SupabaseClient, event: InboxEvent, secret: string, factory: HandlerFactory, fatalTimeout: () => void): Promise<void> {
  const tasks = new BackgroundTasks();
  let errorCode: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    await Promise.race([
      eventTasks.run(tasks, async () => {
        if (await skipDisabledGroupUpdate(db, event.organization_id, event.payload)) return;
        const handler = factory({
          allowInstance: (id, org) => id === event.instance_id && org === event.organization_id,
          strictUpdateTargets: true, trustedQueuedReplay: true,
        });
        const pathHint = event.path_instance_id ? `/${encodeURIComponent(event.path_instance_id)}` : '';
        const response = await handler(new Request(`https://internal.invalid/whatsapp-webhook/${encodeURIComponent(secret)}${pathHint}/messages_update`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': 'ingress-worker' },
          body: JSON.stringify(event.payload),
        }));
        // Draining failures are part of the event outcome; the inbox remains
        // retryable even if a task failed after the synchronous response.
        await tasks.drain();
        if (!response.ok) throw new Error(`http_${response.status}`);
        if (tasks.failed) throw new Error('background_failed');
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        timedOut = true;
        // Never release a lease while the original task can still mutate data.
        // Production callback terminates this process; recovery waits 120s.
        fatalTimeout();
        reject(new Error('worker_timeout'));
      }, 45000); }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    errorCode = /^(http_[0-9]{3}|background_failed|worker_timeout|group_policy_unavailable)$/.test(message) ? message : 'processing_failed';
  } finally { if (timer !== undefined) clearTimeout(timer); }
  if (timedOut) throw new Error('worker_timeout_lease_retained');
  const { data, error } = await db.rpc('finish_whatsapp_ingress_event', { p_id: event.id, p_lease_token: event.lease_token, p_error_code: errorCode });
  // Losing completion leaves a lease for recovery. Never force-complete with a
  // stale lease token or delete an unconfirmed event.
  if (error || data !== true) throw new Error('inbox_finish_unconfirmed');
}

export function createInboxWorker(db: SupabaseClient, ids: string[], secret: string, factory: HandlerFactory, fatalTimeout: () => void) {
  let stopped = false;
  let lastSuccess = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let generation = 0;
  let order = [...ids];
  const loop = async () => {
    let nextCleanup = 0;
    while (!stopped) {
      const observedGeneration = generation;
      try {
        // One event per lease: a long prior event cannot expire later items in
        // a prefetched batch. Multiple replicas coordinate via SKIP LOCKED.
        const { data, error } = await db.rpc('claim_whatsapp_ingress_events', { p_instance_ids: order, p_batch_size: 1 });
        if (error) throw new Error('inbox_claim_failed');
        lastSuccess = Date.now();
        const rows = (data ?? []) as InboxEvent[];
        for (const row of rows) {
          await processInboxEvent(db, row, secret, factory, fatalTimeout);
          order = [...order.filter(id => id !== row.instance_id), row.instance_id];
        }
        if (Date.now() >= nextCleanup) {
          const cleanup = await db.rpc('cleanup_whatsapp_ingress_events', { p_instance_ids: ids, p_limit: 500 });
          if (cleanup.error) throw new Error('inbox_cleanup_failed');
          nextCleanup = Date.now() + 60_000;
        }
        if (rows.length) continue;
      } catch {
        lastSuccess = 0;
        console.error('[whatsapp-ingress] inbox worker requires recovery');
      }
      if (!stopped && observedGeneration === generation) await new Promise<void>(resolve => {
        wake = resolve; timer = setTimeout(resolve, 2000);
      });
    }
  };
  return {
    run: loop,
    healthy: () => lastSuccess > 0 && Date.now() - lastSuccess < 60000,
    notify: () => { generation++; if (timer !== undefined) clearTimeout(timer); wake?.(); },
    stop: () => { stopped = true; if (timer !== undefined) clearTimeout(timer); wake?.(); },
  };
}
