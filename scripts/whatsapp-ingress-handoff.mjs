#!/usr/bin/env node
// Explicit operator actions only. No provider writes, automatic retries or polling.
import { open, constants } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const counts = ['revision', 'pending_count', 'processing_count', 'expired_count', 'dead_letter_count', 'completed_count'];
class HandoffError extends Error {}
const fail = message => { throw new HandoffError(message); };

export function parseArguments(args) {
  const [action, ...flags] = args;
  if (!['snapshot', 'pause', 'resume'].includes(action)) fail('Expected snapshot, pause or resume.');
  const values = {};
  const allowed = ['--credentials-file', '--organization', '--instance', '--expected-revision'];
  for (let i = 0; i < flags.length; i += 2) {
    if (!allowed.includes(flags[i]) || values[flags[i]] !== undefined || !flags[i + 1] || flags[i + 1].startsWith('--')) {
      fail('Invalid or duplicate command option.');
    }
    values[flags[i]] = flags[i + 1];
  }
  if (!values['--credentials-file'] || !uuid.test(values['--organization'] ?? '') || !uuid.test(values['--instance'] ?? '')) {
    fail('Credentials file and database organization/instance UUIDs are required.');
  }
  const rawRevision = values['--expected-revision'];
  const expectedRevision = rawRevision === undefined ? undefined : Number(rawRevision);
  if (action === 'snapshot' ? rawRevision !== undefined :
    rawRevision === undefined || !/^(0|[1-9][0-9]*)$/.test(rawRevision) || !Number.isSafeInteger(expectedRevision)) {
    fail('Pause/resume requires an explicit nonnegative expected revision; snapshot does not accept one.');
  }
  return { action, credentialsFile: values['--credentials-file'], organizationId: values['--organization'],
    instanceId: values['--instance'], expectedRevision };
}

export async function readCredentials(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail('Credentials must be an owned private regular file (0600).');
    const value = JSON.parse(await file.readFile('utf8'));
    const url = new URL(value.supabase_url);
    if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      typeof value.service_role_key !== 'string' || value.service_role_key.length < 20 || /\s/.test(value.service_role_key)) {
      fail('Invalid Supabase credentials configuration.');
    }
    return { origin: url.origin, key: value.service_role_key };
  } catch (error) {
    if (error instanceof HandoffError) throw error;
    // JSON/URL errors can include the input: never print the original exception.
    fail('Unable to read private credentials configuration.');
  } finally { await file?.close(); }
}

export function createHandoffClient({ origin, key, fetcher = fetch }) {
  const rpc = async (name, parameters, mutation = false) => {
    try {
      const response = await fetcher(`${origin}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(parameters), signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      if (!response.ok) fail(mutation
        ? 'Change not confirmed. Read a fresh snapshot before another attempt.'
        : 'Snapshot unavailable. No transition is authorized by this result.');
      return await response.json();
    } catch (error) {
      if (error instanceof HandoffError) throw error;
      fail(mutation ? 'Change outcome unknown. Do not retry automatically; read a fresh snapshot.' : 'Snapshot unavailable.');
    }
  };
  const snapshot = async (organizationId, instanceId) => {
    const result = await rpc('get_whatsapp_ingress_handoff_snapshot', {
      p_organization_id: organizationId, p_instance_id: instanceId,
    });
    const row = Array.isArray(result) && result.length === 1 ? result[0] : null;
    if (!row || typeof row.paused !== 'boolean' || counts.some(name => !Number.isSafeInteger(row[name]) || row[name] < 0)) {
      fail('Invalid snapshot response.');
    }
    // Whitelist the output. No payload, provider token, lease token or unknown key.
    return Object.fromEntries(['paused', ...counts].map(name => [name, row[name]]));
  };
  return {
    snapshot,
    async change(organizationId, instanceId, paused, expectedRevision) {
      const revision = await rpc('set_whatsapp_ingress_worker_pause', {
        p_organization_id: organizationId, p_instance_id: instanceId,
        p_paused: paused, p_expected_revision: expectedRevision,
      }, true);
      if (!Number.isSafeInteger(revision) || revision !== expectedRevision + 1) {
        fail('Change response unconfirmed. Read a fresh snapshot.');
      }
      const observed = await snapshot(organizationId, instanceId);
      if (observed.revision !== revision || observed.paused !== paused) {
        fail('Configuration changed before readback. Read a fresh snapshot; do not retry blindly.');
      }
      return observed;
    },
  };
}

export async function main(args) {
  const options = parseArguments(args);
  const credentials = await readCredentials(options.credentialsFile);
  const client = createHandoffClient(credentials);
  const result = options.action === 'snapshot'
    ? await client.snapshot(options.organizationId, options.instanceId)
    : await client.change(options.organizationId, options.instanceId, options.action === 'pause', options.expectedRevision);
  return { action: options.action, instance_id: options.instanceId, ...result,
    boundary: 'Worker claims only. Snapshot does not prove Edge quiescence or provider recovery.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(result => { process.stdout.write(`${JSON.stringify(result)}\n`); }).catch(error => {
    process.stderr.write(`${error instanceof HandoffError ? error.message : 'Handoff command failed.'}\n`);
    process.exitCode = 1;
  });
}
