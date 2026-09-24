#!/usr/bin/env node
// Offline patch of the verified live v119 monolith. Never deploys or changes env.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestHash = 'a0ca22e96efd649a302e47f12c1516912a9b77db179bef14c0562d6fa1477c03';
const canonicalHash = Object.freeze({
  'whatsapp-webhook/message-update.ts': 'c244015560d8552db7864bdaba15d6f1de32289a043e2e61c1ca9c5d12a11b51',
  'whatsapp-webhook/edge-inbox-bridge.ts': '45bd6fff2d5fd41f28a8001cd568ed5b137cf9b6accdcd8dcbe3e89c105254ca',
  '_shared/whatsapp-ingress-inbox.ts': 'f8a203dcdec04558fa1d25f1fac831c90e29763b307208928da2d7a8c9f8b033',
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function replaceOnce(source, oldText, newText, label) {
  const at = source.indexOf(oldText);
  if (at < 0 || source.indexOf(oldText, at + oldText.length) !== -1) throw new Error(`Unexpected live anchor: ${label}`);
  return source.slice(0, at) + newText + source.slice(at + oldText.length);
}

export function transformBridge(source) {
  return replaceOnce(source,
    "import type { WhatsAppWebhookOptions } from './handler.ts';",
    "import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';\n"
      + "type Admission = (context: { supabase: SupabaseClient; instance: { id: string; organization_id: string }; event: string; payload: Record<string, unknown>; pathInstanceId?: string }) => Promise<Response | { kind: 'inline'; complete: () => Promise<void> } | null>;",
    'standalone handler type import')
    .replace("NonNullable<WhatsAppWebhookOptions['admitEvent']>", 'Admission');
}

export function transformLiveMonolith(source) {
  let next = replaceOnce(source,
    'import { applyMessageUpdate } from "./message-update.ts";',
    'import { applyMessageUpdate, isPureReceiptUpdate } from "./message-update.ts";\nimport { createEdgeInboxBridge } from "./edge-inbox-bridge.ts";',
    'Edge admission import');
  next = replaceOnce(next,
    'const MEDIA_PERSIST_TIMEOUT_MS = 25_000;',
    'const MEDIA_PERSIST_TIMEOUT_MS = 25_000;\n// Default-off, scoped by database instance UUID. No provider URL change.\nconst edgeAdmission = createEdgeInboxBridge(key => Deno.env.get(key));',
    'default-off bridge configuration');
  next = replaceOnce(next,
    'async function handleMessagesUpdateEvent(supabase: SupabaseClient, instance: ResolvedInstance, data: any) {\n  await applyMessageUpdate(supabase, instance, data);\n}',
    'async function handleMessagesUpdateEvent(supabase: SupabaseClient, instance: ResolvedInstance, data: any, requireTarget = false) {\n  await applyMessageUpdate(supabase, instance, data, { requireTarget });\n}',
    'receipt target option');
  const admissionPoint = '    try {\n      await withTimeout(\n        (async () => {\n          switch (event) {';
  const admission = `    // Admission follows secret validation and tenant-bound instance resolution.
    // A queued response ends this request only after DB commit. Inline creates
    // durable metadata before effects; failed work leaves its ticket for review.
    let inlineExecution: { complete: () => Promise<void> } | null = null;
    try {
      const admitted = await edgeAdmission({ supabase, instance, event, payload, pathInstanceId });
      if (admitted instanceof Response) return admitted;
      inlineExecution = admitted;
    } catch {
      return genericResponse(503, { error: "admission_unavailable" });
    }

    try {
      const businessWork = (async () => {
          switch (event) {`;
  next = replaceOnce(next, admissionPoint, admission, 'post-resolution admission');
  next = replaceOnce(next,
    '              await handleMessagesUpdateEvent(supabase, instance, updateData ?? payload);',
    `              const normalizedUpdate = updateData ?? payload;
              // Pure receipts absent from local history were acknowledged by
              // v119. Shared classifier preserves that inline policy; all
              // other updates require a persisted target.
              await handleMessagesUpdateEvent(supabase, instance, normalizedUpdate,
                inlineExecution !== null && !isPureReceiptUpdate(normalizedUpdate));`,
    'pilot receipt target policy');
  next = replaceOnce(next,
    '        })(),\n        PROCESSING_TIMEOUT_MS\n      );',
    `        })();
      // Bind settlement to the actual business promise before the HTTP race.
      // Late success closes a ticket; failure or failed settlement retains it.
      const trackedWork = inlineExecution
        ? businessWork.then(() => inlineExecution.complete())
        : businessWork;
      await withTimeout(trackedWork, PROCESSING_TIMEOUT_MS);`,
    'business promise lifetime');
  return next;
}

async function filesUnder(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Input contains symlink: ${name}`);
    if (entry.isDirectory()) found.push(...await filesUnder(join(directory, entry.name), name));
    else if (entry.isFile()) found.push(name);
    else throw new Error(`Unsupported input entry: ${name}`);
  }
  return found.sort();
}

export async function prepareExecutionBridge(inputPath, outputPath) {
  if (!inputPath || !outputPath) throw new Error('Usage: node scripts/prepare-whatsapp-execution-bridge.mjs <verified-v119-functions-dir> <new-output-dir>');
  const input = await realpath(inputPath);
  if (!(await lstat(input)).isDirectory()) throw new Error('Input must be a functions directory');
  const output = resolve(outputPath);
  const parent = await realpath(dirname(output));
  const relation = relative(input, parent);
  if (!relation || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))) {
    throw new Error('Output must be outside input bundle');
  }
  try { await lstat(output); throw new Error('Output directory already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const names = await filesUnder(input);
  if (names.length !== 57 || !names.includes('update-parity-manifest.json')) throw new Error('Unexpected v119 bundle file list');
  const originalManifest = await readFile(join(input, 'update-parity-manifest.json'));
  if (hash(originalManifest) !== manifestHash) throw new Error('Live v119 manifest drift');
  const parsed = JSON.parse(originalManifest.toString('utf8'));
  const sources = names.filter(name => name !== 'update-parity-manifest.json');
  if (parsed.outputFileCount !== 56 || Object.keys(parsed.files).length !== 56
    || sources.some(name => parsed.files[name] === undefined)) throw new Error('Unexpected v119 manifest content');
  const content = new Map();
  for (const name of sources) {
    const bytes = await readFile(join(input, name));
    if (hash(bytes) !== parsed.files[name]) throw new Error(`Live v119 drift: ${name}`);
    content.set(name, bytes);
  }
  for (const [name, expected] of Object.entries(canonicalHash)) {
    if (content.has(name) && name !== 'whatsapp-webhook/message-update.ts') throw new Error(`Bridge already present in live bundle: ${name}`);
    // v121's verified bridge needs its original shared helper bytes. Current
    // VPS helpers evolve independently and must not rewrite that artifact.
    const frozen = {
      'whatsapp-webhook/message-update.ts': 'whatsapp-message-update-v121.ts',
      '_shared/whatsapp-ingress-inbox.ts': 'whatsapp-ingress-inbox-v121.ts',
    };
    const bytes = await readFile(frozen[name]
      ? join(root, 'scripts/fixtures', frozen[name])
      : join(root, 'supabase/functions', name));
    if (hash(bytes) !== expected) throw new Error(`Canonical bridge drift: ${name}`);
    content.set(name, name === 'whatsapp-webhook/edge-inbox-bridge.ts'
      ? Buffer.from(transformBridge(bytes.toString('utf8'))) : bytes);
  }
  content.set('whatsapp-webhook/index.ts', Buffer.from(transformLiveMonolith(
    content.get('whatsapp-webhook/index.ts').toString('utf8'))));
  const manifest = {
    verifiedInputManifestSha256: manifestHash,
    sourceFileCount: 56,
    outputFileCount: content.size,
    changedFiles: ['whatsapp-webhook/index.ts', 'whatsapp-webhook/message-update.ts'],
    addedFiles: Object.keys(canonicalHash).filter(name => name !== 'whatsapp-webhook/message-update.ts').sort(),
    defaultOff: true,
    files: Object.fromEntries([...content].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, hash(bytes)])),
  };
  await mkdir(output);
  for (const [name, bytes] of content) {
    const target = join(output, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  await writeFile(join(output, 'execution-bridge-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareExecutionBridge(process.argv[2], process.argv[3])
    .then(manifest => process.stdout.write(`Prepared ${manifest.outputFileCount} verified files in ${process.argv[3]}\n`))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
