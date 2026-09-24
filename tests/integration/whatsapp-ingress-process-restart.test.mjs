import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { admitReceipt } from '../../services/whatsapp-ingress/inbox.ts';

const org = '10000000-0000-0000-0000-000000000001';
const instance = 'a0000000-0000-0000-0000-000000000001';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const withDeadline = async (promise, milliseconds, message) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
};
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

// Explicit operational check (~125 seconds): production lease duration is not
// shortened and lease timestamps are never edited to simulate expiration.
// Run: node --test tests/integration/whatsapp-ingress-process-restart.test.mjs
test('acknowledged receipts survive worker SIGKILL and database reopen; real lease recovery preserves FIFO', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'torque-ingress-restart-'));
  let db = new PGlite(directory);
  const children = [];
  const claimedTokens = [];
  const staleCompletions = [];
  let server;
  const rpc = async (name, args) => {
    try {
      let result;
      switch (name) {
        case 'enqueue_whatsapp_ingress_event':
          result = await db.query('SELECT public.enqueue_whatsapp_ingress_event($1,$2,$3,$4::jsonb,$5) AS value',
            [args.p_organization_id, args.p_instance_id, args.p_event_name, JSON.stringify(args.p_payload), args.p_path_instance_id]);
          return { data: result.rows[0].value, error: null };
        case 'claim_whatsapp_ingress_events':
          result = await db.query('SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],$2)', [args.p_instance_ids, args.p_batch_size]);
          for (const row of result.rows) {
            const previous = claimedTokens.find(claim => claim.id === row.id);
            if (previous) staleCompletions.push((await db.query(
              'SELECT public.finish_whatsapp_ingress_event($1,$2,NULL) AS value', [row.id, previous.token],
            )).rows[0].value);
          }
          claimedTokens.push(...result.rows.map(row => ({ id: row.id, token: row.lease_token })));
          return { data: result.rows, error: null };
        case 'finish_whatsapp_ingress_event':
          result = await db.query('SELECT public.finish_whatsapp_ingress_event($1,$2,$3) AS value', [args.p_id, args.p_lease_token, args.p_error_code]);
          return { data: result.rows[0].value, error: null };
        case 'cleanup_whatsapp_ingress_events':
          result = await db.query('SELECT public.cleanup_whatsapp_ingress_events($1::uuid[],$2) AS value', [args.p_instance_ids, args.p_limit]);
          return { data: result.rows[0].value, error: null };
        case 'fixture_effect':
          // A real committed, replay-safe effect. Audit preserves each attempt
          // so the assertions can distinguish replay from exactly-once claims.
          await db.transaction(async tx => {
            await tx.query('INSERT INTO fixture_effect_attempts(sequence) VALUES($1)', [args.sequence]);
            await tx.query('INSERT INTO fixture_effects(sequence) VALUES($1) ON CONFLICT DO NOTHING', [args.sequence]);
          });
          return { data: true, error: null };
        default: throw new Error(`Unexpected RPC: ${name}`);
      }
    } catch (error) { return { data: null, error: { message: error.message } }; }
  };
  try {
    await db.exec(await read('tests/fixtures/whatsapp-ingress-inbox-schema.sql'));
    await db.exec(await read('supabase/migrations/20271021000029_whatsapp_ingress_durable_inbox.sql'));
    await db.exec('CREATE TABLE fixture_effects(sequence integer PRIMARY KEY); CREATE TABLE fixture_effect_attempts(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,sequence integer NOT NULL)');
    for (const sequence of [1, 2]) {
      const response = await admitReceipt({
        supabase: { rpc }, instance: { id: instance, organization_id: org },
        event: 'messages_update', payload: { sequence },
      });
      assert.equal(response.status, 200, 'real admission acknowledges only after enqueue SQL returns');
    }
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM whatsapp_ingress_events')).rows[0].n, 2);
    server = createServer(async (request, response) => {
      try {
        let body = '';
        for await (const chunk of request) body += chunk;
        const { name, args } = JSON.parse(body);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(await rpc(name, args)));
      } catch { response.writeHead(500); response.end(); }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const start = crash => {
      const child = fork(new URL('../fixtures/ingress-restart/worker-process.mjs', import.meta.url), [endpoint, instance, String(crash)], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      children.push(child);
      return child;
    };
    const first = start(true);
    const crashedPhase = await Promise.race([
      once(first, 'message').then(([message]) => message),
      once(first, 'exit').then(([code, signal]) => { throw new Error(`Worker exited early: ${code}/${signal}`); }),
      sleep(20_000).then(() => { throw new Error('Worker did not commit fixture effect'); }),
    ]);
    assert.deepEqual(crashedPhase, { phase: 'effect_committed', sequence: 1 });
    const firstExit = once(first, 'exit');
    first.kill('SIGKILL');
    assert.equal((await firstExit)[1], 'SIGKILL');
    // Database process remains healthy; clean reopen proves disk persistence,
    // not database power-loss durability. No production resources involved.
    await db.close();
    db = new PGlite(directory);
    const retained = (await db.query('SELECT id,status,lease_token,lease_until,attempts FROM whatsapp_ingress_events ORDER BY enqueue_sequence')).rows;
    assert.deepEqual(retained.map(row => row.status), ['processing', 'pending']);
    assert.equal(retained[0].attempts, 1);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM fixture_effects')).rows[0].n, 1);
    const second = start(false);
    await sleep(3_000);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM fixture_effect_attempts')).rows[0].n, 1, 'restart cannot steal unexpired lease or process later FIFO event');
    const deadline = Date.now() + 140_000;
    let rows;
    do {
      rows = (await db.query('SELECT id,status,attempts FROM whatsapp_ingress_events ORDER BY enqueue_sequence')).rows;
      if (rows.every(row => row.status === 'completed')) break;
      assert.equal(second.exitCode, null, 'replacement worker remains running');
      assert.ok(Date.now() < deadline, 'replacement must recover within lease plus polling allowance');
      await sleep(1_000);
    } while (true);
    assert.deepEqual(rows.map(row => row.attempts), [2, 1]);
    assert.deepEqual((await db.query('SELECT sequence FROM fixture_effect_attempts ORDER BY id')).rows.map(row => row.sequence), [1, 1, 2]);
    assert.deepEqual((await db.query('SELECT sequence FROM fixture_effects ORDER BY sequence')).rows.map(row => row.sequence), [1, 2]);
    assert.notEqual(claimedTokens[0].token, claimedTokens[1].token);
    assert.deepEqual(staleCompletions, [false], 'stale token cannot finish while replacement holds its active lease');
    assert.equal((await rpc('finish_whatsapp_ingress_event', { p_id: retained[0].id, p_lease_token: retained[0].lease_token, p_error_code: null })).data, false, 'dead worker cannot finish with stale token');
    const secondExit = once(second, 'exit');
    second.send('stop');
    assert.equal((await withDeadline(secondExit, 5_000, 'Replacement worker did not stop; force cleanup required'))[0], 0);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    }
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
