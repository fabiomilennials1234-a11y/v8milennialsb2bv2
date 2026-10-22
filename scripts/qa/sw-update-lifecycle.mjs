// Run with: node scripts/qa/sw-update-lifecycle.mjs [--busy]
// Uses the real hook, toast, PWA registration client, and service worker.
// The worker holds a test event to model an in-flight request during activation.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'torque-sw-update-test-'));
const busy = process.argv.includes('--busy');
const holdMs = busy ? 8000 : 0;
const bundledClient = path.join(root, 'node_modules/vite-plugin-pwa/dist/client/build/register.js');
await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {Toaster} from 'sonner';import {ServiceWorkerUpdater} from './src/modules/platform/components/ServiceWorkerUpdater';createRoot(document.getElementById('root')).render(<><Toaster/><ServiceWorkerUpdater/></>);`,
    loader: 'tsx', resolveDir: root,
  },
  outfile: path.join(output, 'app.js'), bundle: true, format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': path.join(root, 'src') },
  plugins: [{ name: 'production-pwa-registration', setup(builder) {
    builder.onResolve({ filter: /^virtual:pwa-register$/ }, () => ({ path: bundledClient }));
    builder.onLoad({ filter: /vite-plugin-pwa[\\/]dist[\\/]client[\\/]build[\\/]register\.js$/ }, async () => ({
      contents: (await fs.readFile(bundledClient, 'utf8'))
        .replaceAll('__SW_AUTO_UPDATE__', 'false').replaceAll('__SW_SELF_DESTROYING__', 'false')
        .replaceAll('__SW__', '/sw.js').replaceAll('__SCOPE__', '/').replaceAll('__TYPE__', 'classic'),
      loader: 'js', resolveDir: path.dirname(bundledClient),
    }));
  } }],
});
await build({
  entryPoints: [path.join(root, 'src/sw.ts')], outfile: path.join(output, 'sw.js'),
  bundle: true, format: 'iife', define: { 'self.__WB_MANIFEST': '[]', 'process.env.NODE_ENV': '"production"' },
});
const app = await fs.readFile(path.join(output, 'app.js'));
const worker = await fs.readFile(path.join(output, 'sw.js'), 'utf8');
let revision = 'old';
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'text/javascript');
  if (req.url === '/') return res.end('<div id="root"></div><script type="module" src="/app.js"></script>');
  if (req.url === '/app.js') return res.end(app);
  if (req.url === '/sw.js') return res.end(`${worker}\n// ${revision}\nself.addEventListener('message',e=>{if(e.data?.type==='TEST_HOLD')e.waitUntil(new Promise(r=>setTimeout(r,${holdMs})))});`);
  res.writeHead(404);res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  context.setDefaultTimeout(20_000);
  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  revision = 'new';
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await page.getByRole('button', { name: 'Atualizar página', exact: true }).waitFor();
  if (busy) await page.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'TEST_HOLD' }));
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  const started = Date.now();
  const navigation = page.waitForEvent('domcontentloaded');
  await page.getByRole('button', { name: 'Atualizar página', exact: true }).click();
  if (busy) {
    await page.waitForTimeout(4000);
    assert.equal(navigations, 0, 'Must not reload the old worker while activation is pending');
    await page.getByText('Atualizando o Torque…', { exact: true }).waitFor();
  }
  await navigation;
  await page.waitForTimeout(500);
  const state = await page.evaluate(async () => ({
    waiting: !!(await navigator.serviceWorker.getRegistration())?.waiting,
    toast: document.body.innerText.includes('Nova versão disponível'),
  }));
  assert.deepEqual(state, { waiting: false, toast: false });
  assert.equal(navigations, 1);
  console.log(JSON.stringify({ result: 'PASS', busy, elapsedMs: Date.now() - started, navigations, ...state }));
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
  // Only the unique fixture directory created by mkdtemp is removed.
  if (path.dirname(path.resolve(output)) !== path.resolve(os.tmpdir()) ||
      !path.basename(output).startsWith('torque-sw-update-test-')) {
    throw new Error('Unexpected fixture cleanup path');
  }
  await fs.rm(output, { recursive: true, force: true });
}
