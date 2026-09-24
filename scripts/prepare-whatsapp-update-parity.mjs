#!/usr/bin/env node
// Offline preparation only. Never deploys or changes the source bundle.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expected = Object.freeze({
  'whatsapp-webhook/index.ts': '92c199386327de537c5eec6e07c276a02152c6ccab1286b162bec0f79349c1d6',
  '_shared/quotes/presentation.ts': '7c21c0b1a7ff54f0d2cb53f3cf8d1593c223c1b1c7d91f661a2d6f9354534aee',
});
const canonical = Object.freeze({
  'whatsapp-webhook/message-update.ts': '47a4b06bf2fcf95581aa4f4ab835c4841676ab532e7c49dd7f4d43820759ab26',
  '_shared/quotes/presentation.ts': '4647c2691a1989e5a2a98ab814d84751e1a1672971c80165f98a543117231f7d',
});
const sha = value => createHash('sha256').update(value).digest('hex');
export function assertContentHash(name, content, expectedHash) {
  if (sha(content) !== expectedHash) throw new Error(`Live bundle drift: ${name}`);
}
function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) >= 0) throw new Error(`Unexpected ${label} anchor`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}

export function transformLiveHandler(source) {
  let output = replaceOnce(source,
    'import { uazapiEventMessage, uazapiMessageReaction, mergeUazapiReaction } from "../_shared/uazapi-event.ts";',
    'import { uazapiEventMessage, uazapiMessageReaction, mergeUazapiReaction } from "../_shared/uazapi-event.ts";\nimport { applyMessageUpdate } from "./message-update.ts";', 'import');
  const start = output.indexOf('async function handleMessagesUpdateEvent(');
  const end = output.indexOf('async function handleConnectionEvent(', start);
  if (start < 0 || end < 0 || output.indexOf('async function handleMessagesUpdateEvent(', start + 1) >= 0) {
    throw new Error('Unexpected messages_update handler anchors');
  }
  output = output.slice(0, start) +
    'async function handleMessagesUpdateEvent(supabase: SupabaseClient, instance: ResolvedInstance, data: any) {\n' +
    '  await applyMessageUpdate(supabase, instance, data);\n}\n\n' + output.slice(end);
  output = replaceOnce(output, 'updateData = {\n                  id: ev.MessageIDs?.[0]',
    'updateData = {\n                  ...ev,\n                  id: ev.MessageIDs?.[0]', 'V2 update normalization');
  return output;
}

async function filesUnder(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in input bundle: ${name}`);
    if (entry.isDirectory()) files.push(...await filesUnder(join(directory, entry.name), name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unsupported input bundle entry: ${name}`);
  }
  return files.sort();
}

export async function prepareBundle(inputPath, outputPath) {
  if (!inputPath || !outputPath) throw new Error('Usage: node scripts/prepare-whatsapp-update-parity.mjs <input-functions-dir> <new-output-dir>');
  const input = await realpath(inputPath);
  const inputStat = await lstat(input);
  if (!inputStat.isDirectory()) throw new Error('Input must be a functions directory');
  const output = resolve(outputPath);
  const outputParent = await realpath(dirname(output));
  const parentRelation = relative(input, outputParent);
  if (!parentRelation || (!parentRelation.startsWith(`..${sep}`) && parentRelation !== '..' && !isAbsolute(parentRelation))) {
    throw new Error('Output must be outside input bundle');
  }
  try { await lstat(output); throw new Error('Output directory already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const names = await filesUnder(input);
  if (names.length !== 55) throw new Error(`Unexpected live bundle file count: ${names.length}`);
  const content = new Map(await Promise.all(names.map(async name => [name, await readFile(join(input, name))])));
  for (const [name, hash] of Object.entries(expected)) {
    assertContentHash(name, content.get(name) ?? '', hash);
  }
  for (const [name, hash] of Object.entries(canonical)) {
    const path = join(projectRoot, 'supabase/functions', name);
    const data = await readFile(path);
    if (sha(data) !== hash) throw new Error(`Canonical source drift: ${name}`);
    content.set(name, data);
  }
  content.set('whatsapp-webhook/index.ts', Buffer.from(transformLiveHandler(content.get('whatsapp-webhook/index.ts').toString('utf8'))));
  const manifest = {
    sourceFileCount: names.length,
    outputFileCount: content.size,
    expectedInput: expected,
    files: Object.fromEntries([...content].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => [name, sha(data)])),
  };
  await mkdir(output);
  for (const [name, data] of content) {
    const target = join(output, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx' });
  }
  await writeFile(join(output, 'update-parity-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareBundle(process.argv[2], process.argv[3])
    .then(manifest => process.stdout.write(`Prepared ${manifest.outputFileCount} files in ${process.argv[3]}\n`))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
