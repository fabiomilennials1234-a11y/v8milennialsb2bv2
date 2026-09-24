// Explicit bounded operator preview/apply. Never prints provider responses or IDs.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { loadConfig } from './config.ts';
import { runReceiptRecoveryBatch } from './recovery-runner.ts';

try {
  const args = Deno.args;
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== '--apply')) {
    throw new Error('Expected database instance UUID and optional --apply');
  }
  const config = loadConfig(key => Deno.env.get(key));
  if (!config.enabled || !config.instanceIds.has(args[0])) throw new Error('Instance not admitted by ingress configuration');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
  });
  const instance = await db.from('whatsapp_instances').select('organization_id').eq('id', args[0]).maybeSingle();
  if (instance.error || !instance.data) throw new Error('Instance unavailable');
  const result = await runReceiptRecoveryBatch(db, { organizationId: instance.data.organization_id,
    instanceId: args[0], providerBaseUrl: Deno.env.get('UAZAPI_BASE_URL')!, apply: args[1] === '--apply' });
  await Deno.stdout.write(new TextEncoder().encode(`${JSON.stringify(result)}\n`));
  if (result.state !== 'finished' || result.error || result.unscanned) Deno.exitCode = 1;
  else if (result.inconclusive || result.has_more) Deno.exitCode = 2; // Bounded/partial coverage, not a failed mutation.
} catch {
  console.error('[whatsapp-ingress] recovery command unconfirmed; inspect checkpoint before retry');
  Deno.exitCode = 1;
}
