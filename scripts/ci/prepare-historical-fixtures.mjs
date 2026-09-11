// Only ephemeral GitHub Actions checkouts: never a production migration.
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Historical fixtures are restricted to GitHub Actions CI');
}
if (existsSync('supabase/.temp/project-ref')) throw new Error('Refusing a linked Supabase project');
for (const key of ['SUPABASE_URL', 'VITE_SUPABASE_URL']) {
  const value = process.env[key];
  if (value && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
    throw new Error(`Refusing non-local ${key}`);
  }
}
const target = resolve('supabase/migrations/20270924235959_ci_historical_fixtures.sql');
if (existsSync(target)) throw new Error('Historical fixture version already exists');
copyFileSync(new URL('./historical-fixtures.sql', import.meta.url), target);
console.info('CI-only historical fixtures prepared; original migrations remain unchanged.');
