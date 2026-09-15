import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20271021000012_meeting_historical_pipeline.sql");
const rollback = read("supabase/migrations/rollback/20271021000012_meeting_historical_pipeline.sql");
const canonical = read("supabase/migrations/20271021000005_canonical_pipeline_meetings.sql");
const org = "10000000-0000-0000-0000-000000000001";
const lead = "20000000-0000-0000-0000-000000000001";
const pipe = "30000000-0000-0000-0000-000000000001";
const next = "30000000-0000-0000-0000-000000000002";
const entry = "40000000-0000-0000-0000-000000000001";

test("attendance survives pipeline movement; new and foreign bindings remain rejected; rollback restores validation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      ${read("tests/sql/canonical_meetings_fixture.sql")}
      ALTER TABLE meetings ADD COLUMN booked_event_id uuid, ADD COLUMN pipeline_entry_id uuid;
      ${rollback}
      ${canonical.slice(canonical.indexOf("CREATE OR REPLACE FUNCTION public.fn_meeting_outcome_to_events()"), canonical.indexOf("DROP TRIGGER trg_meeting_outcome_to_events"))}
      CREATE TRIGGER bind BEFORE INSERT OR UPDATE ON meetings FOR EACH ROW EXECUTE FUNCTION fn_meeting_bind_booking();
      CREATE TRIGGER outcome AFTER INSERT OR UPDATE ON meetings FOR EACH ROW EXECUTE FUNCTION fn_meeting_outcome_to_events();
      INSERT INTO pipelines VALUES('${next}','${org}');`);
    const { rows: [meeting] } = await db.query(`INSERT INTO meetings(organization_id,lead_id,pipeline_id,pipeline_entry_id,start_at)
      VALUES('${org}','${lead}','${pipe}','${entry}','2026-09-02T18:00:00Z') RETURNING id,booked_event_id`);
    await db.exec(`UPDATE pipeline_entries SET pipeline_id='${next}' WHERE id='${entry}'`);
    const mark = () => db.query("UPDATE meetings SET status='completed' WHERE id=$1", [meeting.id]);
    await assert.rejects(mark, /Meeting references/);
    await db.exec(migration);
    await mark();
    await mark();
    assert.deepEqual((await db.query("SELECT pipeline_id,booked_event_id,status FROM meetings WHERE id=$1", [meeting.id])).rows,
      [{ pipeline_id: pipe, booked_event_id: meeting.booked_event_id, status: "completed" }]);
    assert.equal((await db.query("SELECT count(*)::int n FROM meeting_events WHERE booked_event_id=$1", [meeting.booked_event_id])).rows[0].n, 1);
    await db.query("UPDATE meetings SET status='no_show' WHERE id=$1", [meeting.id]);
    assert.equal((await db.query("SELECT event_type FROM meeting_events WHERE booked_event_id=$1", [meeting.booked_event_id])).rows[0].event_type, "meeting_no_show");
    await db.query("UPDATE meetings SET status='scheduled' WHERE id=$1", [meeting.id]);
    assert.equal((await db.query("SELECT count(*)::int n FROM meeting_events WHERE booked_event_id=$1", [meeting.booked_event_id])).rows[0].n, 0);
    await assert.rejects(() => db.exec(`INSERT INTO meetings(organization_id,lead_id,pipeline_id,pipeline_entry_id,start_at)
      VALUES('${org}','${lead}','${pipe}','${entry}',now())`), /Meeting references/);
    await assert.rejects(() => db.query("UPDATE meetings SET lead_id='20000000-0000-0000-0000-000000000002' WHERE id=$1", [meeting.id]), /Meeting references/);
    await assert.rejects(() => db.query("UPDATE meetings SET pipeline_id=NULL WHERE id=$1", [meeting.id]), /Meeting references/);
    await db.exec(`UPDATE pipeline_entries SET organization_id='10000000-0000-0000-0000-000000000002' WHERE id='${entry}'`);
    await assert.rejects(mark, /Meeting references/);
    await db.exec(`UPDATE pipeline_entries SET organization_id='${org}' WHERE id='${entry}'`);
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query(`SELECT has_function_privilege('${role}','fn_meeting_bind_booking()','EXECUTE') allowed`)).rows[0].allowed, false);
    }
    await db.exec(rollback);
    await assert.rejects(mark, /Meeting references/);
  } finally { await db.close(); }
});
