import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

test('bulk moves keep entry/deal identity and history; retries and failures are atomic', async () => {
  const db = new PGlite();
  try {
    await db.exec(read('./fixtures/deal-transfer-baseline.sql'));
    await db.exec(read('../../supabase/migrations/20271019000007_deal_transfer_history.sql'));
    // The live database still has this older constraint; equal stage keys in
    // different funnels are nevertheless a real transition.
    await db.exec(`ALTER TABLE pipeline_stage_events ADD CONSTRAINT pipeline_stage_events_real_transition
      CHECK (from_stage_key IS DISTINCT FROM to_stage_key)`);
    await db.exec(`CREATE ROLE service_role;
      ALTER TABLE pipelines ADD COLUMN is_active boolean DEFAULT true;
      ALTER TABLE pipeline_stages ADD COLUMN is_active boolean DEFAULT true;
      INSERT INTO pipelines(id,organization_id,type,name) VALUES
        ('${id(1)}','${id(100)}','system','Oportunidades'),
        ('${id(2)}','${id(100)}','custom','Representantes'),
        ('${id(3)}','${id(200)}','custom','Outra org');
      INSERT INTO pipeline_stages(id,organization_id,pipeline_id,stage_key,name,stage_role) VALUES
        ('${id(11)}','${id(100)}','${id(1)}','novo','Novo','open'),
        ('${id(12)}','${id(100)}','${id(2)}','novo','Novo','open'),
        ('${id(13)}','${id(200)}','${id(3)}','novo','Novo','open');
      INSERT INTO deals VALUES ('${id(21)}','open',NULL,NULL),('${id(22)}','open',NULL,NULL);
      INSERT INTO pipeline_entries(id,organization_id,lead_id,pipeline_id,stage_key,deal_id) VALUES
        ('${id(31)}','${id(100)}','${id(41)}','${id(1)}','novo','${id(21)}'),
        ('${id(32)}','${id(100)}','${id(41)}','${id(2)}','novo','${id(22)}'),
        ('${id(33)}','${id(100)}','${id(42)}','${id(1)}','novo',NULL);
      SET test.org='${id(100)}'; SET test.uid='${id(51)}';
    `);
    await db.exec(read('../../supabase/migrations/20260916163244_bulk_move_existing_pipeline_entries.sql'));
    const move = (ids, target = 2, stage = 12) => db.query(`SELECT bulk_move_pipeline_entries(
      ARRAY[${ids.map(n=>`'${id(n)}'::uuid`).join(',')}],'${id(1)}','${id(target)}','${id(stage)}') AS moved`);
    await db.exec('SET ROLE authenticated');
    assert.equal((await move([31,31])).rows[0].moved,1);
    assert.equal((await db.query(`SELECT count(*)::int n FROM pipeline_entries`)).rows[0].n,3);
    let original=(await db.query(`SELECT * FROM pipeline_entries WHERE id='${id(31)}'`)).rows[0];
    assert.equal(original.pipeline_id,id(2)); assert.equal(original.deal_id,id(21));
    await db.exec('RESET ROLE');
    const historyBefore=(await db.query(`SELECT count(*)::int n FROM pipeline_stage_events WHERE entry_id='${id(31)}'`)).rows[0].n;
    assert.equal((await db.query(`SELECT count(*)::int n FROM pipeline_stage_events WHERE entry_id='${id(31)}' AND from_pipeline_name='Oportunidades' AND to_pipeline_name='Representantes'`)).rows[0].n,1);
    await db.exec('SET ROLE authenticated');
    await move([31]);
    await assert.rejects(move([33,999]),/não encontrado|sem acesso/);
    assert.equal((await db.query(`SELECT pipeline_id FROM pipeline_entries WHERE id='${id(33)}'`)).rows[0].pipeline_id,id(1));
    await assert.rejects(move([33],3,13),/indisponível|organização|existe/);
    await db.exec(`SET test.org='${id(200)}'`);
    await assert.rejects(move([33]),/indisponível|sem acesso/);
    await db.exec('RESET ROLE');
    assert.equal((await db.query(`SELECT count(*)::int n FROM pipeline_stage_events WHERE entry_id='${id(31)}'`)).rows[0].n,historyBefore);
    assert.equal((await db.query(`SELECT deal_id FROM pipeline_entries WHERE id='${id(32)}'`)).rows[0].deal_id,id(22));
    assert.equal((await db.query(`SELECT has_function_privilege('anon','bulk_move_pipeline_entries(uuid[],uuid,uuid,uuid)','EXECUTE') AS allowed`)).rows[0].allowed,false);
    await db.exec(read('../../scripts/ops/rollback-bulk-pipeline-move.sql'));
    assert.equal((await db.query(`SELECT to_regprocedure('bulk_move_pipeline_entries(uuid[],uuid,uuid,uuid)') AS fn`)).rows[0].fn,null);
    assert.equal((await db.query(`SELECT count(*)::int n FROM pipeline_stage_events WHERE entry_id='${id(31)}'`)).rows[0].n,historyBefore);
  } finally { await db.close(); }
});
