import { loadConfig } from './config.ts';
import { BackgroundTasks, createIngress } from './runtime.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { admitReceipt } from './inbox.ts';
import { createInboxWorker, eventTasks } from './worker.ts';
import { loadReceiptRecoveryConfig } from './recovery-config.ts';
import { createReceiptRecoveryLoop } from './recovery-runner.ts';

const config = loadConfig(key => Deno.env.get(key));
const recoveryConfig = loadReceiptRecoveryConfig(key => Deno.env.get(key), config);
const background = new BackgroundTasks();
// Same waitUntil contract used by Supabase Edge, installed before canonical
// handler modules load. No duplicate business logic or fallback proxy to Edge.
Object.defineProperty(globalThis, 'EdgeRuntime', {
  value: { waitUntil: (task: Promise<unknown>) => {
    background.waitUntil(task);
    eventTasks.getStore()?.waitUntil(task);
  } },
});
const { createWhatsAppWebhookHandler } = await import('../../supabase/functions/whatsapp-webhook/handler.ts');
const worker = config.enabled ? createInboxWorker(
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }), [...config.instanceIds], Deno.env.get('UAZAPI_WEBHOOK_SECRET')!, createWhatsAppWebhookHandler,
  () => { console.error('[whatsapp-ingress] event deadline exceeded; lease retained for recovery'); Deno.exit(1); },
) : null;
const workerFinished = worker?.run() ?? Promise.resolve();
const recovery = recoveryConfig.enabled ? createReceiptRecoveryLoop(
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => {
      const priorSignal = (init as RequestInit | undefined)?.signal;
      return fetch(input, { ...init, signal: priorSignal
        ? AbortSignal.any([priorSignal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    } },
  }), recoveryConfig.instanceIds, recoveryConfig.baseUrl,
) : null;
const recoveryFinished = recovery?.run() ?? Promise.resolve();
const ingress = createIngress(config, createWhatsAppWebhookHandler({
  allowInstance: id => config.instanceIds.has(id),
  strictUpdateTargets: true,
  admitEvent: async context => {
    const response = await admitReceipt(context);
    if (response.status === 200) worker?.notify();
    return response;
  },
}), background, () => worker?.healthy() ?? false);
const server = Deno.serve({ hostname: '0.0.0.0', port: config.port }, ingress.handle);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  ingress.stopAccepting();
  worker?.stop();
  recovery?.stop();
  const timer = setTimeout(() => {
    console.error('[whatsapp-ingress] shutdown deadline exceeded; unfinished work requires reconciliation');
    Deno.exit(1);
  }, config.shutdownTimeoutMs);
  try {
    await Promise.all([server.shutdown(), ingress.drain(), workerFinished, recoveryFinished]);
    clearTimeout(timer);
  } catch {
    console.error('[whatsapp-ingress] shutdown failed');
    Deno.exit(1);
  }
}
Deno.addSignalListener('SIGTERM', shutdown);
Deno.addSignalListener('SIGINT', shutdown);
await server.finished;
