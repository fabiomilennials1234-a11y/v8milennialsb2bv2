// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createHandoffClient,
  main,
  parseArguments,
  readCredentials,
} from '../../scripts/whatsapp-ingress-handoff.mjs';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const origin = 'https://capacitytest.supabase.co';
const key = 'private-service-role-key-123456789';
const scriptPath = fileURLToPath(new URL('../../scripts/whatsapp-ingress-handoff.mjs', import.meta.url));
const snapshotRow = (overrides: Record<string, unknown> = {}) => ({
  paused: false,
  revision: 7,
  pending_count: 12,
  processing_count: 2,
  expired_count: 1,
  dead_letter_count: 3,
  completed_count: 42,
  ...overrides,
});
const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  json: async () => body,
}) as Response;
const scoped = {
  p_organization_id: organizationId,
  p_instance_id: instanceId,
};

let tempDirectories: string[] = [];
async function privateFile(contents: string, mode = 0o600) {
  const directory = await mkdtemp(join(tmpdir(), 'torque-handoff-test-'));
  tempDirectories.push(directory);
  const path = join(directory, 'credentials.json');
  await writeFile(path, contents, { mode });
  await chmod(path, mode);
  return { directory, path };
}
const validCredentials = () => JSON.stringify({ supabase_url: origin, service_role_key: key });
const options = (action: string, extra: string[] = []) => [
  action, '--credentials-file', '/private/credentials.json',
  '--organization', organizationId, '--instance', instanceId, ...extra,
];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirectories.map(directory => rm(directory, { recursive: true, force: true })));
  tempDirectories = [];
});

describe('operator arguments and credentials', () => {
  it('requires an explicit safe revision for pause and resume, and forbids it for snapshot', () => {
    for (const action of ['pause', 'resume']) {
      expect(() => parseArguments(options(action))).toThrow(/explicit nonnegative expected revision/);
      for (const invalid of ['-1', '1.0', '01', '1e2', '9007199254740992']) {
        expect(() => parseArguments(options(action, ['--expected-revision', invalid]))).toThrow();
      }
      expect(parseArguments(options(action, ['--expected-revision', '0']))).toMatchObject({
        action, organizationId, instanceId, expectedRevision: 0,
      });
    }
    expect(parseArguments(options('snapshot')).expectedRevision).toBeUndefined();
    expect(() => parseArguments(options('snapshot', ['--expected-revision', '7']))).toThrow();
    expect(() => parseArguments(options('delete'))).toThrow();
    expect(() => parseArguments(options('pause', ['--expected-revision', '7', '--expected-revision', '8']))).toThrow();
    expect(() => parseArguments(options('pause', ['--expected-revision', '7', '--unknown', 'x']))).toThrow();
    expect(() => parseArguments(options('pause', ['--expected-revision', '7', '--instance', instanceId]))).toThrow();
    expect(() => parseArguments(options('snapshot').map(value => value === organizationId ? 'not-a-uuid' : value))).toThrow();
  });

  it('reads an owned private regular file and refuses loose permissions and symlinks', async () => {
    const { directory, path } = await privateFile(validCredentials());
    await expect(readCredentials(path)).resolves.toEqual({ origin, key });
    await chmod(path, 0o644);
    await expect(readCredentials(path)).rejects.toThrow(/owned private regular file/);
    await chmod(path, 0o600);
    const link = join(directory, 'linked.json');
    await symlink(path, link);
    await expect(readCredentials(link)).rejects.toThrow();
    await expect(readCredentials(directory)).rejects.toThrow();
  });

  it('never echoes malformed JSON or a secret in the CLI error stream', async () => {
    const secret = 'SENSITIVE-KEY-MUST-STAY-PRIVATE';
    const { path } = await privateFile(`{"service_role_key":"${secret}",`);
    await expect(readCredentials(path)).rejects.toThrow('Unable to read private credentials configuration.');
    const run = spawnSync(process.execPath, [scriptPath, ...options('snapshot').map(value =>
      value === '/private/credentials.json' ? path : value)], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).not.toContain(secret);
    expect(run.stderr).not.toContain('service_role_key');
  });

  it('rejects untrusted credential hosts and malformed keys', async () => {
    for (const data of [
      { supabase_url: 'http://capacitytest.supabase.co', service_role_key: key },
      { supabase_url: 'https://capacitytest.supabase.co.evil.example', service_role_key: key },
      { supabase_url: 'https://capacitytest.supabase.co/path', service_role_key: key },
      { supabase_url: origin, service_role_key: 'short' },
    ]) {
      const { path } = await privateFile(JSON.stringify(data));
      await expect(readCredentials(path)).rejects.toThrow('Invalid Supabase credentials configuration.');
    }
  });
});

describe('scoped handoff RPC', () => {
  it('returns only approved snapshot fields even when the server adds secrets', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([snapshotRow({
      provider_token: 'PROVIDER-SECRET', lease_token: 'LEASE-SECRET', payload: { body: 'PRIVATE' },
    })]));
    const result = await createHandoffClient({ origin, key, fetcher }).snapshot(organizationId, instanceId);
    expect(result).toEqual(snapshotRow());
    expect(JSON.stringify(result)).not.toMatch(/PROVIDER-SECRET|LEASE-SECRET|PRIVATE/);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${origin}/rest/v1/rpc/get_whatsapp_ingress_handoff_snapshot`);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({ apikey: key, Authorization: `Bearer ${key}` });
    expect(JSON.parse(String(init.body))).toEqual(scoped);
  });

  it.each([
    ['missing count', { pending_count: undefined }],
    ['fractional count', { pending_count: 0.5 }],
    ['negative count', { dead_letter_count: -1 }],
    ['string count', { completed_count: '42' }],
    ['unsafe count', { processing_count: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid revision', { revision: -1 }],
    ['invalid pause state', { paused: 'false' }],
  ])('rejects %s in a snapshot', async (_description, change) => {
    const fetcher = vi.fn().mockResolvedValue(response([snapshotRow(change)]));
    await expect(createHandoffClient({ origin, key, fetcher }).snapshot(organizationId, instanceId))
      .rejects.toThrow('Invalid snapshot response.');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects empty, duplicate, and object snapshot shapes', async () => {
    for (const body of [[], [snapshotRow(), snapshotRow()], snapshotRow()]) {
      const fetcher = vi.fn().mockResolvedValue(response(body));
      await expect(createHandoffClient({ origin, key, fetcher }).snapshot(organizationId, instanceId))
        .rejects.toThrow('Invalid snapshot response.');
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it.each([['pause', true], ['resume', false]] as const)(
    '%s sends one mutation with exact scope and expected revision, then verifies readback',
    async (_action, paused) => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(response(8))
        .mockResolvedValueOnce(response([snapshotRow({ paused, revision: 8, provider_token: 'SECRET' })]));
      const result = await createHandoffClient({ origin, key, fetcher })
        .change(organizationId, instanceId, paused, 7);
      expect(result).toEqual(snapshotRow({ paused, revision: 8 }));
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        `${origin}/rest/v1/rpc/set_whatsapp_ingress_worker_pause`,
        `${origin}/rest/v1/rpc/get_whatsapp_ingress_handoff_snapshot`,
      ]);
      expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({
        ...scoped, p_paused: paused, p_expected_revision: 7,
      });
      expect(JSON.parse(String(fetcher.mock.calls[1][1].body))).toEqual(scoped);
    },
  );

  it.each([
    ['network failure', () => Promise.reject(new Error('PRIVATE-SERVER-ERROR'))],
    ['HTTP failure', () => Promise.resolve(response({ message: 'PRIVATE-SERVER-ERROR' }, 503))],
    ['ambiguous revision', () => Promise.resolve(response([8]))],
  ])('does not retry a mutation after %s', async (_description, outcome) => {
    const fetcher = vi.fn(outcome);
    const error = await createHandoffClient({ origin, key, fetcher })
      .change(organizationId, instanceId, true, 7).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('PRIVATE-SERVER-ERROR');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects readback state or revision mismatch without another mutation', async () => {
    for (const change of [{ revision: 9, paused: true }, { revision: 8, paused: false }]) {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(response(8))
        .mockResolvedValueOnce(response([snapshotRow(change)]));
      await expect(createHandoffClient({ origin, key, fetcher }).change(organizationId, instanceId, true, 7))
        .rejects.toThrow(/Configuration changed before readback/);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/set_whatsapp_ingress_worker_pause')))
        .toHaveLength(1);
    }
  });

  it('main emits only whitelisted counts and the worker-claim boundary', async () => {
    const { path } = await privateFile(validCredentials());
    const fetcher = vi.fn().mockResolvedValue(response([snapshotRow({ provider_token: 'SECRET' })]));
    vi.stubGlobal('fetch', fetcher);
    const result = await main(options('snapshot').map(value => value === '/private/credentials.json' ? path : value));
    expect(result).toEqual({
      action: 'snapshot', instance_id: instanceId, ...snapshotRow(),
      boundary: 'Worker claims only. Snapshot does not prove Edge quiescence or provider recovery.',
    });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});
