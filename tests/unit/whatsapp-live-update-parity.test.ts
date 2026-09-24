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
