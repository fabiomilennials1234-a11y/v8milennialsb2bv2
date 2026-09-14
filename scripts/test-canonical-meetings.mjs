/** Exercise real migration/trigger bodies in an isolated preview schema; always roll back. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const ref = process.argv[2];
if (!ref || ref === 'jsjsmuncfkbsbzqzqhfq') throw new Error('Pass a Supabase preview ref');
const schema = 'canonical_meetings_test_' + Date.now();
const scope = (sql) => sql.replace(/^BEGIN;|^COMMIT;/gm,'').replace(/\bpublic\./g,`${schema}.`).replace(/search_path = public, pg_temp/g,`search_path = ${schema}, pg_temp`);
const projection = scope(readFileSync('supabase/migrations/20271017000000_meeting_date_unique_pipeline_entry.sql','utf8'));
const migration = scope(readFileSync('supabase/migrations/20271021000005_canonical_pipeline_meetings.sql','utf8'));
const fixture = readFileSync('tests/sql/canonical_meetings_fixture.sql','utf8');
const rollback = scope(readFileSync('supabase/migrations/rollback/20271021000005_canonical_pipeline_meetings.sql','utf8'));
const assertions = readFileSync('tests/sql/canonical_meetings.sql','utf8');
const query = `BEGIN; CREATE SCHEMA ${schema}; SET LOCAL search_path=${schema},public;
${fixture}
${projection}
CREATE FUNCTION placeholder() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_meeting_outcome_to_events AFTER INSERT ON meetings FOR EACH ROW EXECUTE FUNCTION placeholder();
CREATE FUNCTION fn_capture_meeting_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TEMP TABLE ledger_before AS SELECT * FROM meeting_events;
${migration}
CREATE TABLE workflow_context(meeting_id uuid, found boolean);
CREATE FUNCTION check_workflow_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.event_type IN ('meeting_held','meeting_no_show') THEN
   INSERT INTO workflow_context VALUES ((NEW.metadata->>'meeting_id')::uuid,
     EXISTS(SELECT 1 FROM meetings WHERE id::text=NEW.metadata->>'meeting_id'));
 END IF; RETURN NEW; END $$;
CREATE TRIGGER test_workflow_context AFTER INSERT ON meeting_events FOR EACH ROW EXECUTE FUNCTION check_workflow_context();
${assertions}
${rollback}
ROLLBACK;
SELECT 'canonical meetings: all assertions passed; schema and data rolled back' AS result;`;
const dir=mkdtempSync(join(tmpdir(),'canonical-meetings-'));
try {
 const file=join(dir,'test.sql');writeFileSync(file,query);
 const result=spawnSync(process.execPath,['scripts/branch-sql.mjs','--ref',ref,'--file',file],{stdio:'inherit'});
 process.exitCode=result.status ?? 1;
} finally {rmSync(dir,{recursive:true,force:true});}
