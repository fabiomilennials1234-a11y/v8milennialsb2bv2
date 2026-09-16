import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
// A private, disposable PostgreSQL cluster. No application credentials consumed.
const bin = process.env.PG_BIN ?? (existsSync('/opt/homebrew/opt/postgresql@16/bin/initdb') ? '/opt/homebrew/opt/postgresql@16/bin' : '');
const dir = mkdtempSync(join(tmpdir(), 'torque-portfolio-pg-'));
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
function run(name, args, options = {}) {
  const result = spawnSync(bin ? join(bin, name) : name, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} failed (${result.status})`);
}
let started = false;
try {
  run('initdb', ['-D', dir, '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', dir, '-l', join(dir, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${dir}`, '-w', 'start']);
  started = true;
  const result = spawnSync(process.execPath, ['--test', 'tests/integration/client-portfolio.test.mjs'], { stdio: 'inherit', env: { ...process.env, PORTFOLIO_PG_PORT: String(port) } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (started) run('pg_ctl', ['-D', dir, '-m', 'fast', '-w', 'stop']);
  rmSync(dir, { recursive: true, force: true });
}
