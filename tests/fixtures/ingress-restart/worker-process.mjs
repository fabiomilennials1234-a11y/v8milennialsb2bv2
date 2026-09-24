// Real production worker, fixture business handler, real SQL behind a local
// transport. This intentionally does not exercise the canonical webhook.
import { createInboxWorker } from '../../../services/whatsapp-ingress/worker.ts';

const [endpoint, instanceId, crashAfterEffect] = process.argv.slice(2);
const db = {
  async rpc(name, args) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, args }),
    });
    return response.json();
  },
};
const worker = createInboxWorker(db, [instanceId], 'fixture-only-secret', options => async request => {
  if (!options.strictUpdateTargets || !options.trustedQueuedReplay) throw new Error('Missing replay restrictions');
  const payload = await request.json();
  const result = await db.rpc('fixture_effect', payload);
  if (result.error) return new Response(null, { status: 503 });
  if (crashAfterEffect === 'true') {
    process.send({ phase: 'effect_committed', sequence: payload.sequence });
    await new Promise(() => {}); // Parent SIGKILLs us before finish.
  }
  return new Response(null, { status: 200 });
}, () => process.exit(73));
process.on('message', message => { if (message === 'stop') worker.stop(); });
await worker.run();
process.disconnect();
