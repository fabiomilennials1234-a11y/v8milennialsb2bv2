import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import ts from 'typescript';

// No CRM credentials, database or production connection. Exercise the actual
// audio engine in Chromium with autoplay requiring a user gesture.
test('a click unlocks real browser audio for a later agenda reminder', { timeout: 60_000 }, async () => {
  const source = readFileSync(new URL('../../src/modules/platform/lib/motor-de-som.ts', import.meta.url), 'utf8');
  const module = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/motor.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/motor.js' ? module : `<!doctype html><html lang="pt-BR"><button>Ativar som</button><script type="module">
      import { MotorDeSom } from '/motor.js';
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser(); analyser.connect(ctx.destination);
      const compressor = ctx.createDynamicsCompressor.bind(ctx);
      ctx.createDynamicsCompressor = () => { const node = compressor(); node.connect(analyser); return node; };
      const motor = new MotorDeSom(() => ctx);
      window.prova = { ctx, motor, analyser, estadoInicial: ctx.state };
      document.querySelector('button').onclick = async () => { window.prova.desbloqueou = await motor.destravar(); };
    </script></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--autoplay-policy=document-user-activation-required'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(10_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => !!window.prova, null, { timeout: 10_000 });
    assert.equal(await page.evaluate(() => window.prova.estadoInicial), 'suspended');
    await page.getByRole('button', { name: 'Ativar som' }).click();
    await page.waitForFunction(() => window.prova.desbloqueou === true, null, { timeout: 10_000 });
    // Let the click finish, then deliver a notification as a server event would.
    const signal = await page.evaluate(async () => {
      const { ctx, motor, analyser } = window.prova;
      await new Promise(resolve => setTimeout(resolve, 250));
      const tocou = await motor.tocar('reuniao', 55);
      await new Promise(resolve => setTimeout(resolve, 100));
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      return { tocou, state: ctx.state, peak: Math.max(...samples.map(Math.abs)) };
    });
    assert.equal(signal.state, 'running'); assert.equal(signal.tocou, true);
    assert.ok(signal.peak > 0.001, `expected an audio signal, got ${signal.peak}`);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
