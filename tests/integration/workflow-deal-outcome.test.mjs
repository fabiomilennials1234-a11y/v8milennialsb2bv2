// Gatilho "Negócio ganho/perdido" (deal_won/deal_lost) nasce na transição de
// `deals.outcome` — migration 20271115000000.
//
// PGlite executa as funções REAIS do repo (fire_workflow_trigger, matcher,
// espelho de outcome, ida para a etapa won, captura de venda pela etapa, RPC do
// botão e as duas admissões de stage_changed). Só a ponte entrada → evento de
// etapa e o transporte HTTP são fixtures. Nada toca Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const pick = (path, re) => {
  const sql = read(path).match(re)?.[0];
  assert.ok(sql, `trecho não encontrado em ${path}: ${re}`);
  return sql;
};

const MIGRATION = read('supabase/migrations/20271115000000_negocio_ganho_dispara_automacao.sql');
const ROLLBACK = read('supabase/migrations/rollback/20271115000000_negocio_ganho_dispara_automacao.sql');

// Estado vivo em prod antes deste fix (2026-10-09).
const LIVE = [
  pick('supabase/migrations/20271007000000_deal_created_nasce_na_posicao.sql',
    /CREATE OR REPLACE FUNCTION public\.fire_workflow_trigger\([\s\S]*?\n\$\$;/),
  pick('supabase/migrations/20271016001000_workflows_usam_funis_canonicos.sql',
    /CREATE OR REPLACE FUNCTION public\.matches_workflow_trigger_config\([\s\S]*?\n\$\$;/),
  pick('supabase/migrations/20270904000000_desfecho_do_negocio.sql',
    /CREATE OR REPLACE FUNCTION public\.fn_deals_espelha_outcome\(\)[\s\S]*?\n\$\$;/),
  pick('supabase/migrations/20271019000007_deal_transfer_history.sql',
    /CREATE OR REPLACE FUNCTION public\.fn_capture_sale_event\(\)[\s\S]*?\n\$\$;/),
  pick('supabase/migrations/20270919000020_leitoras_pela_projecao_canonica.sql',
    /CREATE OR REPLACE FUNCTION public\.metric_stage_role\([\s\S]*?\$function\$;/),
  pick('supabase/migrations/20270918000070_o_botao_pode_informar_o_valor.sql',
    /CREATE OR REPLACE FUNCTION public\.definir_desfecho_da_entrada\([\s\S]*?\$function\$\n;/),
  pick('supabase/migrations/20271021000039_negocio_ganho_vai_para_etapa_won.sql',
    /CREATE OR REPLACE FUNCTION public\.fn_negocio_ganho_vai_para_etapa_won\(\)[\s\S]*?EXECUTE FUNCTION public\.fn_negocio_ganho_vai_para_etapa_won\(\);/),
  pick('supabase/migrations/20270908006000_contexto_unico_dos_gatilhos_de_workflow.sql',
    /CREATE OR REPLACE FUNCTION public\.trigger_workflow_pipeline_custom_stage_change\(\)[\s\S]*?\n\$\$;/),
  read('supabase/migrations/20271021000030_workflow_stage_http_admission.sql'),
].join('\n\n');

const ORG = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000b2';
const RIOFIX = '36971ff5-fd73-4f30-a733-04bf8c90e5b6';
const MUSTANG = 'a9a2f3cb-63fe-4ca1-a453-f27002cc4944';
const RIOFIX_WON_WF = '0d60af90-3407-400f-8000-e0f59aa65068';
const RIOFIX_LOST_WF = '5ce6255d-59ed-4f22-9340-91ab688c8515';

const CUSTOM = '10000000-0000-4000-8000-000000000001';
const SYSTEM = '10000000-0000-4000-8000-000000000002';
const OTHER_PIPE = '10000000-0000-4000-8000-000000000003';
const ST_OPEN = '20000000-0000-4000-8000-000000000001';
const ST_WON = '20000000-0000-4000-8000-000000000002';
const ST_LOST = '20000000-0000-4000-8000-000000000003';
const SYS_OPEN = '20000000-0000-4000-8000-000000000011';
const SYS_WON = '20000000-0000-4000-8000-000000000012';
const OTHER_OPEN = '20000000-0000-4000-8000-000000000021';
const LEAD = '30000000-0000-4000-8000-000000000001';
const DEAL = '40000000-0000-4000-8000-000000000001';
const ENTRY = '50000000-0000-4000-8000-000000000001';

const SCHEMA = `
CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA net;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE TYPE public.stage_role AS ENUM ('open','won','lost','meeting_booked','meeting_held');
CREATE TABLE public.http_calls(url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
  BEGIN INSERT INTO public.http_calls VALUES(url, headers, body); RETURN 1; END $$;
CREATE TABLE public.cron_config(key text, value text);
INSERT INTO public.cron_config VALUES
  ('campaign_rule_dispatch_url','https://fixture.example/functions/v1/campaign-rule-dispatch'),
  ('cron_secret','test-secret');
CREATE TABLE public.team_members(id uuid, user_id uuid, organization_id uuid, is_active boolean);
CREATE TABLE public.leads(id uuid PRIMARY KEY, organization_id uuid NOT NULL, deleted_at timestamptz);
CREATE TABLE public.pipelines(id uuid PRIMARY KEY, organization_id uuid, slug text, type text);
CREATE TABLE public.pipeline_stages(id uuid PRIMARY KEY, organization_id uuid, pipeline_id uuid, pipeline_type text,
  stage_key text, stage_role public.stage_role, is_final_positive boolean DEFAULT false, is_active boolean DEFAULT true, position int);
CREATE TABLE public.pipeline_entries(id uuid PRIMARY KEY, organization_id uuid, pipeline_id uuid, lead_id uuid, deal_id uuid,
  stage_id uuid, stage_key text, metadata jsonb DEFAULT '{}', closed_at timestamptz, entered_at timestamptz DEFAULT now());
CREATE TABLE public.deals(id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text, value numeric, owner_id uuid,
  source_lead_id uuid, source text, created_by uuid, won boolean, closed_at timestamptz, loss_reason text,
  metadata jsonb DEFAULT '{}', deleted_at timestamptz, updated_at timestamptz DEFAULT now(),
  outcome text NOT NULL DEFAULT 'open' CHECK (outcome IN ('open','won','lost')), outcome_at timestamptz,
  outcome_source text CHECK (outcome_source IS NULL OR outcome_source IN ('stage','workflow','ui','backfill','api')));
CREATE TABLE public.workflows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, trigger_type text,
  is_active boolean, trigger_config jsonb DEFAULT '{}', definition jsonb);
CREATE TABLE public.workflow_executions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid, organization_id uuid,
  lead_id uuid, pipeline_entry_id uuid, deal_id uuid, status text, context jsonb, triggered_by_execution_id uuid,
  chain_depth smallint DEFAULT 0, trigger_dedup_key text, UNIQUE (workflow_id, lead_id, trigger_dedup_key));
CREATE TABLE public.pipeline_stage_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, entry_id uuid,
  lead_id uuid, pipeline_id uuid, from_pipeline_id uuid, from_stage_key text, to_stage_key text, actor uuid);
CREATE TABLE public.caderno(entry_id uuid, deal_id uuid);
CREATE FUNCTION public.assert_org_access(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.garantir_negocio_da_entrada(uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public._registrar_desfecho_no_caderno(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,text) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.caderno VALUES ($5, $6) $$;
`;

// Ponte fixture: no real, `fn_capture_pipeline_stage_event` grava o evento de
// etapa; aqui uma linha basta para levar o movimento até `fn_capture_sale_event`.
const WIRING = `
CREATE FUNCTION public.fixture_stage_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.pipeline_stage_events(organization_id, entry_id, lead_id, pipeline_id, from_pipeline_id, from_stage_key, to_stage_key)
  VALUES (NEW.organization_id, NEW.id, NEW.lead_id, NEW.pipeline_id, OLD.pipeline_id, OLD.stage_key, NEW.stage_key);
  RETURN NULL;
END $$;
CREATE TRIGGER fixture_stage_event AFTER UPDATE OF stage_key, stage_id ON public.pipeline_entries
  FOR EACH ROW WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key) EXECUTE FUNCTION public.fixture_stage_event();
CREATE TRIGGER trg_capture_sale_event AFTER INSERT ON public.pipeline_stage_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_capture_sale_event();
CREATE TRIGGER trg_deals_espelha_outcome BEFORE UPDATE OF outcome ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.fn_deals_espelha_outcome();
CREATE TRIGGER trg_workflow_pipeline_custom_stage_change AFTER UPDATE OF stage_key, stage_id ON public.pipeline_entries
  FOR EACH ROW WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key) EXECUTE FUNCTION public.trigger_workflow_pipeline_custom_stage_change();
CREATE TRIGGER trg_workflow_pipeline_stage_changed AFTER UPDATE OF stage_key, stage_id ON public.pipeline_entries
  FOR EACH ROW WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key) EXECUTE FUNCTION public.trigger_workflow_pipeline_stage_changed();
REVOKE ALL ON FUNCTION public.trigger_workflow_pipeline_stage_changed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trigger_workflow_pipeline_stage_changed() TO authenticated, service_role;
`;

const SEED = `
INSERT INTO public.pipelines VALUES
  ('${CUSTOM}','${ORG}','vendas','custom'),
  ('${SYSTEM}','${ORG}','propostas','system'),
  ('${OTHER_PIPE}','${ORG}','pos','custom');
INSERT INTO public.pipeline_stages(id, organization_id, pipeline_id, pipeline_type, stage_key, stage_role, position) VALUES
  ('${ST_OPEN}','${ORG}','${CUSTOM}',NULL,'negociacao','open',0),
  ('${ST_WON}','${ORG}','${CUSTOM}',NULL,'ganho','won',1),
  ('${ST_LOST}','${ORG}','${CUSTOM}',NULL,'perdido','lost',2),
  ('${SYS_OPEN}','${ORG}','${SYSTEM}','propostas','enviada','open',0),
  ('${SYS_WON}','${ORG}','${SYSTEM}','propostas','vendido','won',1),
  ('${OTHER_OPEN}','${ORG}','${OTHER_PIPE}',NULL,'inicio','open',0);
INSERT INTO public.leads VALUES ('${LEAD}','${ORG}',NULL);
INSERT INTO public.deals(id, organization_id, title, value, source_lead_id, owner_id, source)
  VALUES ('${DEAL}','${ORG}','Venda X',1500,'${LEAD}','60000000-0000-4000-8000-000000000001','human');
INSERT INTO public.pipeline_entries(id, organization_id, pipeline_id, lead_id, deal_id, stage_id, stage_key)
  VALUES ('${ENTRY}','${ORG}','${CUSTOM}','${LEAD}','${DEAL}','${ST_OPEN}','negociacao');
`;

async function database({ migrated = true } = {}) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(LIVE);
  await db.exec(WIRING);
  await db.exec(SEED);
  if (migrated) await db.exec(MIGRATION);
  return db;
}

const rows = async (db, sql) => (await db.query(sql)).rows;
const execs = (db, type) => rows(db, `SELECT * FROM public.workflow_executions
  WHERE context->>'trigger_type' = '${type}' ORDER BY chain_depth, context->>'outcome_at'`);
const workflow = (db, type, { org = ORG, config = {}, active = true } = {}) =>
  db.query(`INSERT INTO public.workflows(organization_id, trigger_type, is_active, trigger_config)
            VALUES ($1, $2, $3, $4) RETURNING id`, [org, type, active, JSON.stringify(config)])
    .then(r => r.rows[0].id);
const ui = (db, outcome, entry = ENTRY) =>
  db.query(`SELECT public.definir_desfecho_da_entrada($1, $2, NULL, NULL) AS r`, [entry, outcome]);
const byWorkflow = (db, outcome, parentId = null) => db.exec(`
  UPDATE public.deals
     SET outcome = '${outcome}', outcome_source = 'workflow', outcome_at = clock_timestamp(),
         metadata = COALESCE(metadata, '{}'::jsonb) ${parentId ? `|| jsonb_build_object('outcome_execution_id', '${parentId}')` : ''}
   WHERE id = '${DEAL}' AND organization_id = '${ORG}' AND outcome = (SELECT outcome FROM public.deals WHERE id = '${DEAL}');`);
const dragTo = (db, stageId, stageKey) =>
  db.exec(`UPDATE public.pipeline_entries SET stage_id = '${stageId}', stage_key = '${stageKey}' WHERE id = '${ENTRY}';`);

test('baseline (prod antes do fix): ganhar pelo botão não cria execução de deal_won', async () => {
  const db = await database({ migrated: false });
  try {
    await workflow(db, 'deal_won');
    await ui(db, 'won');
    assert.equal((await rows(db, `SELECT outcome FROM public.deals`))[0].outcome, 'won');
    assert.equal((await execs(db, 'deal_won')).length, 0, 'vermelho reproduzido: o gatilho nunca dispara');
  } finally { await db.close(); }
});

test('os três escritores disparam UMA vez cada, com o contexto do Negócio', async () => {
  for (const caminho of ['ui', 'workflow', 'stage']) {
    const db = await database();
    try {
      const wf = await workflow(db, 'deal_won');
      if (caminho === 'ui') await ui(db, 'won');
      if (caminho === 'workflow') await byWorkflow(db, 'won');
      if (caminho === 'stage') await dragTo(db, ST_WON, 'ganho');

      const deal = (await rows(db, `SELECT outcome, outcome_source FROM public.deals`))[0];
      assert.deepEqual(deal, { outcome: 'won', outcome_source: caminho }, caminho);

      const ex = await execs(db, 'deal_won');
      assert.equal(ex.length, 1, `${caminho}: exatamente um disparo`);
      assert.equal(ex[0].workflow_id, wf);
      assert.equal(ex[0].organization_id, ORG);
      assert.equal(ex[0].lead_id, LEAD);
      assert.equal(ex[0].deal_id, DEAL);
      assert.equal(ex[0].pipeline_entry_id, ENTRY);
      assert.equal(ex[0].chain_depth, 1);
      assert.equal(ex[0].triggered_by_execution_id, null);
      assert.partialDeepStrictEqual(ex[0].context, {
        trigger: 'deal_won', trigger_type: 'deal_won', lead_id: LEAD, deal_id: DEAL, negocio_id: DEAL,
        pipeline_entry_id: ENTRY, pipeline_id: CUSTOM,
        // Etapa FINAL: o card já foi para a etapa won antes deste trigger rodar.
        stage_id: ST_WON, stage_key: 'ganho',
        outcome: 'won', from_outcome: 'open', outcome_source: caminho,
        deal_value: 1500, negocio_valor: 1500, deal_title: 'Venda X', negocio_titulo: 'Venda X',
        owner_id: '60000000-0000-4000-8000-000000000001',
      });
      assert.ok(ex[0].context.outcome_at, 'outcome_at viaja no contexto (chave de dedup por transição)');
      assert.equal((await rows(db, `SELECT * FROM public.pipeline_entries`))[0].stage_key, 'ganho');
    } finally { await db.close(); }
  }
});

test('ganho + movimentação para a etapa won: 1 deal_won; stage_changed segue sendo só stage_changed', async () => {
  // Funil custom: o movimento dispara stage_changed em SQL. Com workflow de
  // etapa ativo, ele dispara o PRÓPRIO — e nunca um segundo deal_won.
  const db = await database();
  try {
    await workflow(db, 'deal_won');
    await workflow(db, 'stage_changed');
    await ui(db, 'won');
    assert.equal((await execs(db, 'deal_won')).length, 1);
    assert.equal((await execs(db, 'stage_changed')).length, 1);
    assert.equal((await rows(db, `SELECT count(*)::int n FROM public.workflow_executions`))[0].n, 2);
  } finally { await db.close(); }

  // Funil de sistema: só deal_won ativo → a admissão HTTP não chama a edge
  // function (antes chamava, e o TS derivaria o segundo disparo).
  const sys = await database();
  try {
    await sys.exec(`UPDATE public.pipeline_entries SET pipeline_id='${SYSTEM}', stage_id='${SYS_OPEN}', stage_key='enviada' WHERE id='${ENTRY}';
                    TRUNCATE public.http_calls;`);
    await workflow(sys, 'deal_won');
    await ui(sys, 'won');
    assert.equal((await rows(sys, `SELECT stage_key FROM public.pipeline_entries`))[0].stage_key, 'vendido');
    assert.equal((await rows(sys, `SELECT count(*)::int n FROM public.http_calls`))[0].n, 0, 'sem stage_changed ativo, sem HTTP');
    const ex = await execs(sys, 'deal_won');
    assert.equal(ex.length, 1);
    assert.equal(ex[0].context.stage_id, SYS_WON);

    await workflow(sys, 'stage_changed');
    await sys.exec(`UPDATE public.pipeline_entries SET stage_id='${SYS_OPEN}', stage_key='enviada' WHERE id='${ENTRY}';`);
    const calls = await rows(sys, `SELECT body FROM public.http_calls`);
    assert.equal(calls.length, 1, 'stage_changed ativo continua admitindo');
    assert.equal(calls[0].body.trigger_type, 'stage_changed');
  } finally { await sys.close(); }
});

test('isolamento: workflow de outra org não dispara; inativo não dispara', async () => {
  const db = await database();
  try {
    await workflow(db, 'deal_won', { org: OTHER_ORG });
    await workflow(db, 'deal_won', { active: false });
    await ui(db, 'won');
    assert.equal((await rows(db, `SELECT count(*)::int n FROM public.workflow_executions`))[0].n, 0);
  } finally { await db.close(); }
});

test('lead de outra org ou apagado não dispara (org só de NEW.organization_id)', async () => {
  const db = await database();
  try {
    await workflow(db, 'deal_won');
    await db.exec(`UPDATE public.leads SET organization_id='${OTHER_ORG}'`);
    await ui(db, 'won');
    assert.equal((await execs(db, 'deal_won')).length, 0);
    await ui(db, 'open');
    await db.exec(`UPDATE public.leads SET organization_id='${ORG}', deleted_at=now()`);
    await ui(db, 'won');
    assert.equal((await execs(db, 'deal_won')).length, 0);
  } finally { await db.close(); }
});

test('pipeline_ids filtra pelo funil do negócio; stage_ids pela etapa final', async () => {
  const db = await database();
  try {
    await workflow(db, 'deal_won', { config: { pipeline_ids: [OTHER_PIPE] } });
    const certo = await workflow(db, 'deal_won', { config: { pipeline_ids: [CUSTOM] } });
    const etapa = await workflow(db, 'deal_won', { config: { pipeline_ids: [CUSTOM], stage_ids: [ST_WON] } });
    await workflow(db, 'deal_won', { config: { pipeline_ids: [CUSTOM], stage_ids: [ST_OPEN] } });
    await workflow(db, 'deal_won', { config: { pipeline_ids: CUSTOM } }); // forma inválida: fail-closed
    await ui(db, 'won');
    const ex = await execs(db, 'deal_won');
    assert.deepEqual(ex.map(e => e.workflow_id).sort(), [certo, etapa].sort());
  } finally { await db.close(); }
});

test('negócio sem entrada dispara com posição nula; com filtro de funil, não', async () => {
  const db = await database();
  try {
    await db.exec(`DELETE FROM public.pipeline_entries`);
    const livre = await workflow(db, 'deal_won');
    await workflow(db, 'deal_won', { config: { pipeline_ids: [CUSTOM] } });
    await db.exec(`UPDATE public.deals SET outcome='won', outcome_source='api', outcome_at=now() WHERE id='${DEAL}'`);
    const ex = await execs(db, 'deal_won');
    assert.equal(ex.length, 1);
    assert.equal(ex[0].workflow_id, livre);
    assert.equal(ex[0].pipeline_entry_id, null);
    assert.equal(ex[0].context.pipeline_id, null);
    assert.equal(ex[0].context.outcome_source, 'api');
  } finally { await db.close(); }
});

test('reabrir não dispara; ganho → perda → ganho são três transições', async () => {
  const db = await database();
  try {
    await workflow(db, 'deal_won');
    await workflow(db, 'deal_lost');
    await ui(db, 'won');
    await ui(db, 'won'); // idempotente: a RPC não reescreve
    assert.equal((await rows(db, `SELECT count(*)::int n FROM public.workflow_executions`))[0].n, 1);

    await db.exec(`UPDATE public.deals SET outcome='lost', outcome_source='ui', outcome_at=clock_timestamp(), loss_reason='Preço' WHERE id='${DEAL}'`);
    await db.exec(`UPDATE public.deals SET outcome='won', outcome_source='ui', outcome_at=clock_timestamp() WHERE id='${DEAL}'`);
    const won = await execs(db, 'deal_won');
    const lost = await execs(db, 'deal_lost');
    assert.equal(won.length, 2);
    assert.equal(lost.length, 1);
    assert.equal(lost[0].context.loss_reason, 'Preço');
    assert.equal(lost[0].context.from_outcome, 'won');
    assert.equal((await rows(db, `SELECT count(*)::int n FROM public.workflow_executions`))[0].n, 3);

    await ui(db, 'open');
    assert.equal((await rows(db, `SELECT count(*)::int n FROM public.workflow_executions`))[0].n, 3, 'reabrir não dispara');
  } finally { await db.close(); }
});

test('negócio apagado (soft delete) não dispara', async () => {
  const db = await database();
  try {
    await workflow(db, 'deal_won');
    await db.exec(`UPDATE public.deals SET deleted_at=now(), outcome='won', outcome_source='api' WHERE id='${DEAL}'`);
    assert.equal((await execs(db, 'deal_won')).length, 0);
  } finally { await db.close(); }
});

test('desfecho por workflow encadeia chain_depth só com execução da MESMA org', async () => {
  const db = await database();
  try {
    await workflow(db, 'deal_won');
    const parentWf = await workflow(db, 'stage_changed', { active: false });
    const [{ id: parent }] = await rows(db, `INSERT INTO public.workflow_executions(workflow_id, organization_id, lead_id, status, chain_depth, trigger_dedup_key)
      VALUES ('${parentWf}','${ORG}','${LEAD}','running',2,'p') RETURNING id`);
    const [{ id: foreign }] = await rows(db, `INSERT INTO public.workflow_executions(workflow_id, organization_id, lead_id, status, chain_depth, trigger_dedup_key)
      VALUES ('${parentWf}','${OTHER_ORG}','${LEAD}','running',5,'f') RETURNING id`);

    await byWorkflow(db, 'won', parent);
    let ex = await execs(db, 'deal_won');
    assert.equal(ex.length, 1);
    assert.equal(ex[0].triggered_by_execution_id, parent);
    assert.equal(ex[0].chain_depth, 3);

    await db.exec(`UPDATE public.deals SET outcome='open', outcome_source='ui' WHERE id='${DEAL}'`);
    await byWorkflow(db, 'won', foreign);
    ex = await execs(db, 'deal_won');
    assert.equal(ex.length, 2, 'execução de outra org não bloqueia nem vira pai');
    assert.equal(ex.filter(e => e.triggered_by_execution_id === foreign).length, 0);

    // Teto de profundidade: pai no limite corta o laço.
    await db.exec(`UPDATE public.workflow_executions SET chain_depth=5 WHERE id='${parent}';
                   UPDATE public.deals SET outcome='open', outcome_source='ui' WHERE id='${DEAL}';`);
    await byWorkflow(db, 'won', parent);
    assert.equal((await execs(db, 'deal_won')).length, 2, 'chain_depth > 5 não cria execução');

    // Lixo no metadata não derruba nada.
    await db.exec(`UPDATE public.deals SET outcome='open', outcome_source='ui' WHERE id='${DEAL}';
      UPDATE public.deals SET outcome='won', outcome_source='workflow', outcome_at=clock_timestamp(),
        metadata = jsonb_build_object('outcome_execution_id','nao-e-uuid') WHERE id='${DEAL}';`);
    assert.equal((await execs(db, 'deal_won')).length, 3);
  } finally { await db.close(); }
});

test('falha da automação nunca derruba o fechamento da venda', async () => {
  const db = await database();
  try {
    await workflow(db, 'deal_won');
    await db.exec(`CREATE OR REPLACE FUNCTION public.fire_workflow_trigger(p_organization_id uuid, p_trigger_type text, p_lead_id uuid,
        p_context jsonb DEFAULT '{}', p_triggered_by_execution_id uuid DEFAULT NULL)
      RETURNS integer LANGUAGE plpgsql AS $$
      BEGIN
        -- Só o disparo de desfecho quebra: o stage_changed custom (pré-existente)
        -- não tem subbloco próprio e não é objeto deste teste.
        IF p_trigger_type IN ('deal_won','deal_lost') THEN RAISE EXCEPTION 'boom'; END IF;
        RETURN 0;
      END $$;`);
    await ui(db, 'won');
    assert.equal((await rows(db, `SELECT outcome FROM public.deals`))[0].outcome, 'won');
    assert.equal((await rows(db, `SELECT stage_key FROM public.pipeline_entries`))[0].stage_key, 'ganho');
    assert.equal((await rows(db, `SELECT count(*)::int n FROM public.workflow_executions`))[0].n, 0);
  } finally { await db.close(); }
});

test('segurança: função de trigger fechada; trigger ordenado após a ida para etapa won', async () => {
  const db = await database();
  try {
    const [p] = await rows(db, `SELECT prosecdef, proconfig,
        has_function_privilege('anon', oid, 'EXECUTE') anon,
        has_function_privilege('authenticated', oid, 'EXECUTE') auth,
        has_function_privilege('service_role', oid, 'EXECUTE') svc
      FROM pg_proc WHERE oid = 'public.trigger_workflow_deal_outcome()'::regprocedure`);
    assert.deepEqual(p, { prosecdef: true, proconfig: ['search_path=""'], anon: false, auth: false, svc: false });
    const names = (await rows(db, `SELECT tgname FROM pg_trigger WHERE tgrelid='public.deals'::regclass AND NOT tgisinternal ORDER BY tgname`))
      .map(r => r.tgname);
    assert.ok(names.indexOf('trg_workflow_deal_outcome') > names.indexOf('trg_negocio_ganho_vai_para_etapa_won'));
    const [stage] = await rows(db, `SELECT pg_get_functiondef('public.trigger_workflow_pipeline_stage_changed()'::regprocedure) d,
        prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') anon
      FROM pg_proc WHERE oid = 'public.trigger_workflow_pipeline_stage_changed()'::regprocedure`);
    assert.doesNotMatch(stage.d, /'deal_won'|'deal_lost'/);
    assert.equal(stage.prosecdef, true);
    assert.deepEqual(stage.proconfig, ['search_path=public, extensions']);
    assert.equal(stage.anon, false);
    // Reaplicar é no-op.
    await db.exec(MIGRATION);
  } finally { await db.close(); }
});

test('Riofix: adaptador sai, semântica "só Funil Mustang" vai para a config; rollback devolve', async () => {
  const db = new PGlite();
  try {
    await db.exec(SCHEMA);
    await db.exec(LIVE);
    await db.exec(WIRING);
    const definition = JSON.stringify({ nodes: [
      { id: 'trigger', type: 'trigger', data: { type: 'trigger', label: 'Negócio ganho no Funil Mustang', config: {}, triggerType: 'deal_won' } },
      { id: 'a1', type: 'action', data: { actionType: 'duplicate_to_pipe' } },
    ], edges: [] });
    await db.query(`INSERT INTO public.workflows(id, organization_id, trigger_type, is_active, trigger_config, definition) VALUES
      ($1,$3,'deal_won',true,'{}',$4), ($2,$3,'deal_lost',false,'{}',$4)`, [RIOFIX_WON_WF, RIOFIX_LOST_WF, RIOFIX, definition]);
    await db.exec(`
      INSERT INTO public.pipelines VALUES ('${MUSTANG}','${RIOFIX}','mustang','custom'), ('${OTHER_PIPE}','${RIOFIX}','outro','custom');
      INSERT INTO public.pipeline_stages(id, organization_id, pipeline_id, stage_key, stage_role, position) VALUES
        ('${ST_OPEN}','${RIOFIX}','${MUSTANG}','neg','open',0), ('${OTHER_OPEN}','${RIOFIX}','${OTHER_PIPE}','neg','open',0);
      INSERT INTO public.leads VALUES ('${LEAD}','${RIOFIX}',NULL);
      INSERT INTO public.deals(id, organization_id, title, value, source_lead_id, source)
        VALUES ('${DEAL}','${RIOFIX}','Mustang',10,'${LEAD}','human');
      INSERT INTO public.pipeline_entries(id, organization_id, pipeline_id, lead_id, deal_id, stage_id, stage_key)
        VALUES ('${ENTRY}','${RIOFIX}','${MUSTANG}','${LEAD}','${DEAL}','${ST_OPEN}','neg');
      CREATE SCHEMA private;`);
    // Corpo vivo em prod (2026-10-09) do enfileirador, que FICA.
    await db.exec(`CREATE FUNCTION private.riofix_enqueue_workflow(p_workflow uuid, p_lead uuid, p_entry uuid, p_deal uuid, p_context jsonb, p_event text)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
      DECLARE w public.workflows%ROWTYPE; inserted_id uuid;
      BEGIN
        SELECT * INTO w FROM public.workflows WHERE id=p_workflow AND organization_id='${RIOFIX}' AND is_active;
        IF NOT FOUND OR p_lead IS NULL THEN RETURN false; END IF;
        IF NOT public.matches_workflow_trigger_config(w.trigger_type,w.trigger_config,p_context) THEN RETURN false; END IF;
        INSERT INTO public.workflow_executions(workflow_id,organization_id,lead_id,pipeline_entry_id,deal_id,status,context,trigger_dedup_key)
        VALUES(w.id,w.organization_id,p_lead,p_entry,p_deal,'running',p_context||jsonb_build_object('trigger_type',w.trigger_type,'trigger_config',w.trigger_config,'riofix_adapter',true),'riofix:'||p_event)
        ON CONFLICT(workflow_id,lead_id,trigger_dedup_key) DO NOTHING RETURNING id INTO inserted_id;
        RETURN inserted_id IS NOT NULL;
      END $function$;`);
    // O rollback instala o adaptador exatamente como está em prod.
    await db.exec(ROLLBACK);
    const adapter = async () => (await rows(db, `SELECT count(*)::int n FROM pg_trigger WHERE tgname='riofix_deal_outcome_event'`))[0].n;
    assert.equal(await adapter(), 1);

    const winLose = async () => {
      await db.exec(`DELETE FROM public.workflow_executions;
        UPDATE public.deals SET outcome='won', outcome_source='ui', outcome_at=clock_timestamp() WHERE id='${DEAL}';`);
      const ganhoMustang = await rows(db, `SELECT context FROM public.workflow_executions`);
      await db.exec(`DELETE FROM public.workflow_executions;
        UPDATE public.deals SET outcome='open', outcome_source='ui' WHERE id='${DEAL}';
        UPDATE public.pipeline_entries SET pipeline_id='${OTHER_PIPE}', stage_id='${OTHER_OPEN}' WHERE id='${ENTRY}';
        UPDATE public.deals SET outcome='won', outcome_source='ui', outcome_at=clock_timestamp() WHERE id='${DEAL}';`);
      const ganhoOutro = await rows(db, `SELECT context FROM public.workflow_executions`);
      await db.exec(`UPDATE public.deals SET outcome='open', outcome_source='ui' WHERE id='${DEAL}';
        UPDATE public.pipeline_entries SET pipeline_id='${MUSTANG}', stage_id='${ST_OPEN}' WHERE id='${ENTRY}';`);
      return { ganhoMustang, ganhoOutro };
    };

    const antes = await winLose();
    assert.equal(antes.ganhoMustang.length, 1);
    assert.equal(antes.ganhoMustang[0].context.riofix_adapter, true);
    assert.equal(antes.ganhoOutro.length, 0);

    await db.exec(MIGRATION);
    assert.equal(await adapter(), 0, 'adaptador removido no mesmo ato');
    assert.equal((await rows(db, `SELECT to_regprocedure('private.riofix_deal_outcome_event()') f`))[0].f, null);
    assert.notEqual((await rows(db, `SELECT to_regprocedure('private.riofix_enqueue_workflow(uuid,uuid,uuid,uuid,jsonb,text)') f`))[0].f, null,
      'enfileirador fica');
    const [wf] = await rows(db, `SELECT trigger_config, definition FROM public.workflows WHERE id='${RIOFIX_WON_WF}'`);
    assert.deepEqual(wf.trigger_config, { pipeline_ids: [MUSTANG] });
    assert.deepEqual(wf.definition.nodes[0].data.config, { pipeline_ids: [MUSTANG] });
    assert.deepEqual(wf.definition.nodes[1], JSON.parse(definition).nodes[1], 'outros nós intactos');
    assert.deepEqual((await rows(db, `SELECT trigger_config FROM public.workflows WHERE id='${RIOFIX_LOST_WF}'`))[0].trigger_config, {});

    const depois = await winLose();
    assert.equal(depois.ganhoMustang.length, 1, 'Mustang: um disparo, nativo');
    assert.equal(depois.ganhoMustang[0].context.riofix_adapter, undefined);
    assert.equal(depois.ganhoOutro.length, 0, 'fora do Mustang: nada, como antes');

    await db.exec(ROLLBACK);
    assert.equal(await adapter(), 1);
    assert.deepEqual((await rows(db, `SELECT trigger_config FROM public.workflows WHERE id='${RIOFIX_WON_WF}'`))[0].trigger_config, {});
    assert.equal((await rows(db, `SELECT count(*)::int n FROM pg_trigger WHERE tgname='trg_workflow_deal_outcome'`))[0].n, 0);
    const rolled = await winLose();
    assert.equal(rolled.ganhoMustang.length, 1);
    assert.equal(rolled.ganhoMustang[0].context.riofix_adapter, true, 'rollback: volta o adaptador, sem duplo');

    await db.exec(MIGRATION);
    assert.equal(await adapter(), 0, 'reaplicar depois do rollback funciona');
  } finally { await db.close(); }
});

test('rollback sem objetos Riofix (dev) é seguro e idempotente', async () => {
  const db = await database();
  try {
    await db.exec(ROLLBACK);
    await db.exec(ROLLBACK);
    await workflow(db, 'deal_won');
    await ui(db, 'won');
    assert.equal((await execs(db, 'deal_won')).length, 0, 'rollback volta ao estado anterior');
    await db.exec(MIGRATION);
  } finally { await db.close(); }
});
