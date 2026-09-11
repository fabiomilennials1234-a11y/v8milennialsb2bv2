// PostgreSQL isolado, sem conexão com produção. Mesmo runtime do teste de etapas.
// PGLITE_MODULE=file:///.../@electric-sql/pglite/dist/index.js node scripts/test-cafe-jurere-leads-tabs.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const org = '4922638c-4909-494e-ba10-12282ec0b161';
const foreignOrg = '10000000-0000-0000-0000-000000000001';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    -- Reproduz grants implícitos do ambiente real, para testar os REVOKEs.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
    CREATE TABLE leads (id uuid PRIMARY KEY, organization_id uuid, erp_code text, relacao_negocios text DEFAULT 'lead');
    CREATE TABLE deals (id uuid PRIMARY KEY, organization_id uuid, source_lead_id uuid, outcome text, deleted_at timestamptz, visible boolean DEFAULT true);
    CREATE TABLE pipelines (id uuid PRIMARY KEY, organization_id uuid, is_active boolean);
    CREATE TABLE pipeline_stages (id uuid PRIMARY KEY, organization_id uuid, pipeline_id uuid, is_active boolean, stage_key text, stage_role text);
    CREATE TABLE pipeline_entries (id uuid PRIMARY KEY, organization_id uuid, pipeline_id uuid, lead_id uuid, deal_id uuid, stage_key text);
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    CREATE INDEX ON deals (organization_id, source_lead_id);
    CREATE INDEX ON pipeline_entries (organization_id, lead_id);
  `);
  for (let n = 1; n <= 13; n++) {
    await db.query('INSERT INTO leads(id,organization_id,erp_code) VALUES ($1,$2,$3)', [id(n), org, n <= 3 ? String(n) : n === 13 ? '   ' : null]);
  }
  await db.query('INSERT INTO leads(id,organization_id,erp_code) VALUES ($1,$2,$3)', [id(14), foreignOrg, '14']);
  let dealId = 100;
  const deal = (lead, outcome, tenant = org, deleted = null, visible = true) => db.query(
    'INSERT INTO deals VALUES ($1,$2,$3,$4,$5,$6)', [id(dealId++), tenant, id(lead), outcome, deleted, visible]);
  await deal(2, 'lost'); await deal(3, 'won');
  await deal(5, 'lost'); await deal(6, 'lost'); await deal(6, 'open');
  await deal(7, 'lost'); await deal(7, 'won'); await deal(8, 'won');
  await deal(9, 'lost', org, '2026-01-01'); await deal(10, 'lost', foreignOrg);
  await deal(11, 'lost', org, null, false); await deal(13, 'lost');
  // Card legado sem deal: desfecho pela etapa. Card aberto não anula a perda.
  await db.query('INSERT INTO pipelines VALUES ($1,$2,true)', [id(200), org]);
  await db.query('INSERT INTO pipeline_stages VALUES ($1,$2,$3,true,$4,$5)', [id(201), org, id(200), 'perdeu', 'lost']);
  await db.query('INSERT INTO pipeline_entries VALUES ($1,$2,$3,$4,null,$5)', [id(202), org, id(200), id(12), 'perdeu']);
  for (const table of ['leads', 'deals', 'pipelines', 'pipeline_stages', 'pipeline_entries']) {
    await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON ${table} FOR SELECT TO authenticated USING (
        organization_id = current_setting('test.org')::uuid ${table === 'deals' ? 'AND visible' : ''});`);
  }
  await db.exec(await readFile(new URL('../supabase/migrations/20271019000004_leads_cafe_jurere_cadastro_erp.sql', import.meta.url), 'utf8'));
  const grants = await db.query(`SELECT has_function_privilege('anon','classificacao_cafe_jurere(leads)','EXECUTE') AS anon,
    has_function_privilege('authenticated','classificacao_cafe_jurere(leads)','EXECUTE') AS authenticated,
    has_function_privilege('service_role','classificacao_cafe_jurere(leads)','EXECUTE') AS service_role`);
  eq(grants.rows[0], { anon: false, authenticated: true, service_role: true }, 'EXECUTE explícito, anon bloqueado');
  eq((await db.query("SELECT prosecdef FROM pg_proc WHERE proname='classificacao_cafe_jurere'")).rows[0].prosecdef, false, 'não contorna RLS');
  await db.query("SELECT set_config('test.org',$1,false)", [org]);
  await db.exec('SET ROLE authenticated');
  const expected = ['cliente','cliente','cliente','lead','perdido','perdido','lead','lead','lead','lead','lead','perdido','perdido'];
  const rows = (await db.query('SELECT id,classificacao_cafe_jurere(leads) AS aba FROM leads ORDER BY id')).rows;
  eq(rows.map(r => r.aba), expected, 'cadastro, perdas+aberto, perdas+ganho, exclusão, outro tenant, RLS e código vazio');
  const filtered = (await db.query("SELECT id FROM leads WHERE classificacao_cafe_jurere(leads)='perdido' ORDER BY id")).rows;
  eq(filtered.map(r => r.id), [5,6,12,13].map(id), 'filtro no banco antes de paginar/exportar');
  eq((await db.query("SELECT count(*)::int AS total FROM leads WHERE classificacao_cafe_jurere(leads)='perdido'")).rows[0].total, filtered.length, 'contagem corresponde à lista');
  const page = (await db.query("SELECT id FROM leads WHERE classificacao_cafe_jurere(leads)='perdido' ORDER BY id LIMIT 2 OFFSET 2")).rows;
  eq(page.map(r => r.id), [12,13].map(id), 'segunda página correta');
  await db.exec('RESET ROLE');
  eq((await db.query('SELECT classificacao_cafe_jurere(leads) AS aba FROM leads WHERE id=$1', [id(14)])).rows[0].aba, null, 'nem service_role aplica piloto a outra org');
  eq((await db.query("SELECT count(*)::int AS n FROM leads WHERE relacao_negocios <> 'lead'")).rows[0].n, 0, 'projeção original intacta');
  await db.query("SELECT set_config('test.org',$1,false)", [foreignOrg]);
  await db.exec('SET ROLE authenticated');
  eq((await db.query('SELECT id,classificacao_cafe_jurere(leads) AS aba FROM leads')).rows, [{ id: id(14), aba: null }], 'troca de tenant preserva isolamento');
  await db.exec(`RESET ROLE;
    CREATE TABLE upsell_clients (organization_id uuid, lead_id uuid, external_source text,
      erp_company text, erp_status text, erp_owner_external_id text);
    CREATE TABLE erp_owner_map (organization_id uuid, provider text, erp_owner_external_id text, team_member_id uuid);
    CREATE TABLE team_members (id uuid, organization_id uuid);
    GRANT SELECT ON upsell_clients, erp_owner_map, team_members TO authenticated, service_role;`);
  for (const table of ['upsell_clients','erp_owner_map','team_members']) {
    await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON ${table} FOR SELECT TO authenticated
      USING (organization_id = current_setting('test.org')::uuid);`);
  }
  await db.query('INSERT INTO team_members VALUES ($1,$2),($3,$4)', [id(300),org,id(301),foreignOrg]);
  await db.query("INSERT INTO erp_owner_map VALUES ($1,'toth','rep',$2)", [org,id(300)]);
  for (const [n,status,rep] of [[1,'0','rep'],[2,'1','rep'],[3,'3','missing']]) {
    await db.query("INSERT INTO upsell_clients VALUES ($1,$2,'toth','CAFE JURERE',$3,$4)", [org,id(n),status,rep]);
  }
  await db.exec(await readFile(new URL('../supabase/migrations/20271019000005_leads_cafe_jurere_visibilidade.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20271019000006_cafe_jurere_visibility_cache.sql', import.meta.url), 'utf8'));
  await db.exec('UPDATE leads SET cafe_jurere_erp_elegivel=cafe_jurere_erp_elegivel');
  eq((await db.query("SELECT proconfig FROM pg_proc WHERE proname='visivel_lista_cafe_jurere'")).rows[0].proconfig,null,'campo calculado permite inline, sem configuração por linha');
  const plan = await db.query('EXPLAIN (FORMAT JSON) SELECT id FROM leads WHERE visivel_lista_cafe_jurere(leads)');
  eq(JSON.stringify(plan.rows).includes('visivel_lista_cafe_jurere'),false,'plano não executa função nem consultas correlacionadas por lead');
  eq((await db.query("SELECT has_function_privilege('anon','visivel_lista_cafe_jurere(leads)','EXECUTE') AS allowed")).rows[0].allowed,false,'visibilidade bloqueia anon');
  await db.query("SELECT set_config('test.org',$1,false)", [org]);
  await db.exec('SET ROLE authenticated');
  eq((await db.query('SELECT id FROM leads WHERE visivel_lista_cafe_jurere(leads) ORDER BY id')).rows.map(r=>r.id),
    [1,4,5,6,7,8,9,10,11,12,13].map(id),'mantém CRM e ativo mapeado; oculta inativo e sem mapa');
  await db.exec('RESET ROLE');
  await db.query("UPDATE upsell_clients SET erp_status='3' WHERE lead_id=$1",[id(1)]);
  eq((await db.query('SELECT visivel_lista_cafe_jurere(leads) AS v FROM leads WHERE id=$1',[id(1)])).rows[0].v,true,'inconsistente mapeado visível');
  await db.query('UPDATE erp_owner_map SET team_member_id=$1',[id(301)]);
  eq((await db.query('SELECT visivel_lista_cafe_jurere(leads) AS v FROM leads WHERE id=$1',[id(1)])).rows[0].v,false,'membro de outro tenant rejeitado mesmo com bypass RLS');
  eq((await db.query('SELECT visivel_lista_cafe_jurere(leads) AS v FROM leads WHERE id=$1',[id(14)])).rows[0].v,true,'outra organização intacta');
  eq((await db.query('SELECT count(*)::int AS n FROM leads')).rows[0].n,14,'nenhum registro excluído');
  await db.query('UPDATE leads SET cafe_jurere_erp_elegivel=true WHERE id=$1',[id(1)]);
  eq((await db.query('SELECT cafe_jurere_erp_elegivel AS v FROM leads WHERE id=$1',[id(1)])).rows[0].v,false,'cache não aceita elegibilidade forjada');
  await db.query('UPDATE erp_owner_map SET team_member_id=$1',[id(300)]);
  eq((await db.query('SELECT visivel_lista_cafe_jurere(leads) AS v FROM leads WHERE id=$1',[id(1)])).rows[0].v,true,'mapa restaura elegibilidade automaticamente');
  await db.query("UPDATE upsell_clients SET erp_status='2' WHERE lead_id=$1",[id(1)]);
  eq((await db.query('SELECT visivel_lista_cafe_jurere(leads) AS v FROM leads WHERE id=$1',[id(1)])).rows[0].v,false,'bloqueio no ERP atualiza projeção');
  console.log(`PASS: ${checks} verificações SQL, 14 cenários de lead; nenhuma conexão externa.`);
} finally {
  await db.close();
}
