// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertContentHash, prepareBundle, transformLiveHandler } from '../../scripts/prepare-whatsapp-update-parity.mjs';

const live = '/tmp/torque-ingress-live-group-fix/functions';
const scratch: string[] = [];
afterEach(async () => { await Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const list = async (dir: string, prefix = ''): Promise<string[]> => {
  const files: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) files.push(...await list(join(dir, item.name), name));
    else files.push(name);
  }
  return files.sort();
};

it('replaces only the receipt handler and preserves V2 mutation fields', () => {
  const source = 'import { uazapiEventMessage, uazapiMessageReaction, mergeUazapiReaction } from "../_shared/uazapi-event.ts";\n'
    + 'async function handleMessagesUpdateEvent(x) { OLD_BODY }\n'
    + 'async function handleConnectionEvent(x) {}\n'
    + 'updateData = {\n                  id: ev.MessageIDs?.[0]';
  const output = transformLiveHandler(source);
  expect(output).toContain('import { applyMessageUpdate } from "./message-update.ts";');
  expect(output).toContain('await applyMessageUpdate(supabase, instance, data);');
  expect(output).toContain('updateData = {\n                  ...ev,\n                  id: ev.MessageIDs?.[0]');
  expect(output).not.toContain('OLD_BODY');
  expect(output).toContain('async function handleConnectionEvent(x) {}');
});

it('rejects a one-byte change to a trusted baseline before patching', () => {
  const original = Buffer.from('trusted live handler');
  const expectedHash = createHash('sha256').update(original).digest('hex');
  expect(() => assertContentHash('whatsapp-webhook/index.ts', original, expectedHash)).not.toThrow();
  expect(() => assertContentHash('whatsapp-webhook/index.ts', Buffer.from('trusted live handler!'), expectedHash))
    .toThrow('Live bundle drift: whatsapp-webhook/index.ts');
});

it('keeps the published v119 quote helper byte-for-byte while the current helper evolves', async () => {
  const frozen = await readFile(new URL('../../scripts/fixtures/quote-presentation-v119.ts.txt', import.meta.url));
  expect(() => assertContentHash('_shared/quotes/presentation.ts', frozen,
    '4647c2691a1989e5a2a98ab814d84751e1a1672971c80165f98a543117231f7d')).not.toThrow();
});

it('preserves every published manifest value when labelling its digests as sha256', async () => {
  const source = await readFile(new URL('../../docs/operations/whatsapp-live-update-parity-2026-09-24.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(source, (_key, value: unknown) =>
    typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value) ? value.slice(7) : value);
  // Digest of the complete original manifest, before adding algorithm labels.
  expect(createHash('sha256').update(JSON.stringify(manifest)).digest('hex'))
    .toBe('843a8a8149b765b083f06a0156f8f45aadf38a4bc02b8601d550c5671dd883c0');
});

describe.skipIf(!process.env.TORQUE_LIVE_BUNDLE_TEST_DIR && !existsSync(live))('live bundle', () => {
  const input = process.env.TORQUE_LIVE_BUNDLE_TEST_DIR ?? live;
  it('preserves every original file except index and quotes, adding only canonical message-update', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'torque-parity-')); scratch.push(temp);
    const output = join(temp, 'output');
    const manifest = await prepareBundle(input, output);
    const originals = await list(input);
    const result = (await list(output)).filter(name => name !== 'update-parity-manifest.json');
    expect(originals).toHaveLength(55);
    expect(result).toHaveLength(56);
    expect(result.filter(name => !originals.includes(name))).toEqual(['whatsapp-webhook/message-update.ts']);
    for (const name of originals) {
      if (name === 'whatsapp-webhook/index.ts' || name === '_shared/quotes/presentation.ts') continue;
      expect(await readFile(join(output, name))).toEqual(await readFile(join(input, name)));
    }
    expect(manifest.files['whatsapp-webhook/message-update.ts']).toMatch(/^[a-f0-9]{64}$/);
    expect((await readFile(join(output, 'whatsapp-webhook/index.ts'), 'utf8'))).not.toContain('const rawIds = extractRawMessageIds(data);\n  if (rawIds.length === 0) return;');
  });

  it('rejects drift before creating output', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'torque-parity-')); scratch.push(temp);
    const copied = join(temp, 'input');
    await cp(input, copied, { recursive: true });
    const index = join(copied, 'whatsapp-webhook/index.ts');
    await writeFile(index, `${await readFile(index, 'utf8')}\n// drift\n`);
    await expect(prepareBundle(copied, join(temp, 'output'))).rejects.toThrow('Live bundle drift: whatsapp-webhook/index.ts');
    await expect(readdir(temp)).resolves.toEqual(expect.not.arrayContaining(['output']));
  });

  it('rejects a changed quote helper before creating output', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'torque-parity-')); scratch.push(temp);
    const copied = join(temp, 'input');
    await cp(input, copied, { recursive: true });
    const quote = join(copied, '_shared/quotes/presentation.ts');
    await writeFile(quote, `${await readFile(quote, 'utf8')}\n// drift\n`);
    await expect(prepareBundle(copied, join(temp, 'output'))).rejects.toThrow('Live bundle drift: _shared/quotes/presentation.ts');
    expect(await readdir(temp)).not.toContain('output');
  });
});
