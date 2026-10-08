// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareExecutionBridge, transformBridge, transformLiveMonolith } from '../../scripts/prepare-whatsapp-execution-bridge.mjs';

const live = '/tmp/torque-live-update-parity-20260924/functions';
const scratch: string[] = [];
afterEach(async () => { await Promise.all(scratch.splice(0).map(path => rm(path, { recursive:true, force:true }))); });

const list = async (dir: string, prefix = ''): Promise<string[]> => {
  const result: string[] = [];
  for (const item of await readdir(dir, { withFileTypes:true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) result.push(...await list(join(dir,item.name), name));
    else result.push(name);
  }
  return result.sort();
};

it('converts standalone bridge type dependency without changing runtime logic', () => {
  const source = "import type { WhatsAppWebhookOptions } from './handler.ts';\nexport function b(): NonNullable<WhatsAppWebhookOptions['admitEvent']> { return null as never; }";
  const result = transformBridge(source);
  expect(result).not.toContain("from './handler.ts'");
  expect(result).toContain('type Admission = (context:');
  expect(result).toContain('function b(): Admission');
});

describe.skipIf(!existsSync(live))('verified v119 patch', () => {
  it('adds admission after tenant resolution and settles the real business promise', async () => {
    const source = await readFile(join(live, 'whatsapp-webhook/index.ts'), 'utf8');
    const result = transformLiveMonolith(source);
    expect(result).toContain('const edgeAdmission = createEdgeInboxBridge(key => Deno.env.get(key));');
    expect(result.indexOf('const admitted = await edgeAdmission(')).toBeGreaterThan(result.indexOf('if (!instance) {'));
    expect(result).toContain('if (admitted instanceof Response) return admitted;');
    expect(result).toContain('inlineExecution !== null && !isPureReceiptUpdate(normalizedUpdate)');
    expect(result).toContain('const trackedWork = inlineExecution\n        ? businessWork.then(() => inlineExecution.complete())');
    expect(result).toContain('await withTimeout(trackedWork, PROCESSING_TIMEOUT_MS);');
    expect(result).not.toContain('await withTimeout(\n        (async () => {');
    expect(() => transformLiveMonolith(result)).toThrow(/Unexpected live anchor/);
  });

  it('preserves verified 56 files except narrow patch and new bridge files', async () => {
    const temp=await mkdtemp(join(tmpdir(),'torque-execution-')); scratch.push(temp);
    const output=join(temp,'output');
    const manifest=await prepareExecutionBridge(live,output);
    const sourceFiles=(await list(live)).filter(name=>name!=='update-parity-manifest.json');
    const outputFiles=(await list(output)).filter(name=>name!=='execution-bridge-manifest.json');
    expect(sourceFiles).toHaveLength(56);
    expect(outputFiles).toHaveLength(58);
    expect(outputFiles.filter(name=>!sourceFiles.includes(name))).toEqual([
      '_shared/whatsapp-ingress-inbox.ts','whatsapp-webhook/edge-inbox-bridge.ts',
    ]);
    for (const name of sourceFiles) {
      if (['whatsapp-webhook/index.ts','whatsapp-webhook/message-update.ts'].includes(name)) continue;
      expect(await readFile(join(output,name))).toEqual(await readFile(join(live,name)));
    }
    expect(manifest.defaultOff).toBe(true);
    expect(manifest.changedFiles).toEqual(['whatsapp-webhook/index.ts','whatsapp-webhook/message-update.ts']);
  });

  it('rejects any live drift before writing output', async () => {
    const temp=await mkdtemp(join(tmpdir(),'torque-execution-drift-')); scratch.push(temp);
    const copied=join(temp,'input'); await cp(live,copied,{recursive:true});
    const target=join(copied,'whatsapp-webhook/index.ts');
    await writeFile(target,`${await readFile(target,'utf8')}\n// drift\n`);
    await expect(prepareExecutionBridge(copied,join(temp,'output'))).rejects.toThrow('Live v119 drift: whatsapp-webhook/index.ts');
    expect(await readdir(temp)).not.toContain('output');
  });
});
