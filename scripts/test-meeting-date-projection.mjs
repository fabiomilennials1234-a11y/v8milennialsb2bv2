/** Runs real PostgreSQL trigger tests in a rollback-only schema on a preview branch. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const ref = process.argv[2];
if (!ref || ref === 'jsjsmuncfkbsbzqzqhfq') throw new Error('Pass an approved Supabase preview ref');
const schema = `meeting_projection_test_${Date.now()}`;
const migration = (readFileSync('supabase/migrations/20271017000000_meeting_date_unique_pipeline_entry.sql', 'utf8')
  + readFileSync('scripts/sql/recover-meeting-dates-20260908.sql', 'utf8'))
  .replace(/^BEGIN;|^COMMIT;/gm, '')
  .replace(/\bpublic\./g, `${schema}.`)
  .replace(/\bbackup\b/g, `${schema}_backup`)
  .replace(/search_path = public, pg_temp/g, `search_path = ${schema}, pg_temp`);
const assertions = readFileSync('tests/sql/meeting_date_projection.sql', 'utf8');
const query = `BEGIN;
CREATE SCHEMA ${schema};
SET LOCAL search_path = ${schema}, public;
CREATE TABLE pipeline_entries (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, pipeline_id uuid NOT NULL,
 lead_id uuid NOT NULL, deal_id uuid UNIQUE, closed_at timestamptz, metadata jsonb
);
CREATE TABLE meetings (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, pipeline_id uuid, lead_id uuid,
 deal_id uuid, start_at timestamptz NOT NULL, meet_link text,
 event_type text DEFAULT 'meeting', status text DEFAULT 'scheduled'
);
-- Seed a legacy card and a scheduled meeting before migration: recovery must work.
INSERT INTO pipeline_entries VALUES (
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000020',
 '00000000-0000-0000-0000-000000000030', NULL,NULL,'{"keep":"value"}');
INSERT INTO meetings (id,organization_id,pipeline_id,lead_id,start_at)
SELECT '00000000-0000-0000-0000-000000000040',organization_id,pipeline_id,lead_id,
 '2026-09-08 15:00:00+00' FROM pipeline_entries;
${migration}
${assertions}
ROLLBACK;
SELECT 'all meeting projection assertions passed; fixtures rolled back' AS result;`;
const dir = mkdtempSync(join(tmpdir(), 'meeting-projection-'));
try {
 const file = join(dir, 'test.sql'); writeFileSync(file, query);
 const result = spawnSync(process.execPath, ['scripts/branch-sql.mjs','--ref',ref,'--file',file], {stdio:'inherit'});
 process.exitCode = result.status ?? 1;
} finally { rmSync(dir, {recursive:true,force:true}); }
