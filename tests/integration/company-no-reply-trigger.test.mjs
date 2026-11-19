// Gatilho "Cliente aguardando resposta" (company_no_reply) — RPC
// find_leads_company_no_reply exercitada no PGlite com o SQL real da migration.
//
// Cobre: cliente esperando → candidato; empresa respondeu → não; resposta só de
// automação/IA/falha → continua esperando; dedup por espera (chave) e por
// execução em voo; nova mensagem do cliente depois da resposta abre nova
// espera; isolamento de org; filtro de funil; janela de olhar para trás;
// paginação; canal oficial; ACL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../supabase/migrations/20280120010000_gatilho_cliente_aguardando_resposta.sql');
const rollback = read('../../supabase/migrations/rollback/20280120010000_gatilho_cliente_aguardando_resposta.sql');

const ORG = id(10);
const OTHER_ORG = id(20);
const WF = id(70);
const WF_OTHER_TYPE = id(71);
const WF_OTHER_ORG = id(72);
const BLOCKED_ORG = id(30);
const WF_BLOCKED = id(73);
const LEAD = id(1);
const PHONE = '5511999990001';

// Corte = agora − 3h. Âncoras "velhas" ficam antes do corte.
const CUTOFF = '2026-11-18T12:00:00Z';
const SINCE = '2026-11-11T12:00:00Z';

test('find_leads_company_no_reply', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
      CREATE FUNCTION public.org_access_blocked(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT p = '${BLOCKED_ORG}'::uuid $$;
      -- Normalização simplificada: só dígitos (o teste usa telefones já canônicos).
      CREATE FUNCTION public.normalize_brazilian_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
        $$ SELECT NULLIF(regexp_replace(COALESCE(p,''), '[^0-9]', '', 'g'), '') $$;
      CREATE TABLE public.workflows(id uuid PRIMARY KEY, organization_id uuid, trigger_type text);
      CREATE TABLE public.leads(id uuid PRIMARY KEY, organization_id uuid, normalized_phone text, deleted_at timestamptz);
      CREATE TABLE public.pipeline_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, lead_id uuid, pipeline_id uuid);
      CREATE TABLE public.whatsapp_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
        lead_id uuid, normalized_phone text, direction text, status text, sent_source text DEFAULT 'manual',
        sent_by_ai boolean DEFAULT false, is_group boolean DEFAULT false, deleted_at timestamptz,
        message_type text DEFAULT 'text', "timestamp" timestamptz);
      CREATE TABLE public.channel_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
        channel text DEFAULT 'whatsapp', lead_id uuid, phone_number text, direction text, status text,
        sent_by_team_member_id uuid, message_type text DEFAULT 'text', "timestamp" timestamptz);
      CREATE TABLE public.workflow_executions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid,
        lead_id uuid, status text, trigger_dedup_key text, started_at timestamptz DEFAULT now(),
        UNIQUE (workflow_id, lead_id, trigger_dedup_key));
      INSERT INTO public.workflows VALUES
        ('${WF}','${ORG}','company_no_reply'),
        ('${WF_OTHER_TYPE}','${ORG}','lead_no_reply'),
        ('${WF_OTHER_ORG}','${OTHER_ORG}','company_no_reply'),
        ('${WF_BLOCKED}','${BLOCKED_ORG}','company_no_reply');
      INSERT INTO public.leads VALUES
        ('${LEAD}','${ORG}','${PHONE}',NULL),
        ('${id(2)}','${ORG}','5511999990002',NULL),
        ('${id(3)}','${ORG}','5511999990003',NULL),
        ('${id(4)}','${OTHER_ORG}','${PHONE}',NULL),
        ('${id(5)}','${BLOCKED_ORG}','${PHONE}',NULL);
    `);
    await db.exec(migration);

    const find = async (opts = {}) => {
      const { org = ORG, wf = WF, cutoff = CUTOFF, since = SINCE, pipelines = null, after = null, limit = 50 } = opts;
      const { rows } = await db.query(
        'SELECT * FROM public.find_leads_company_no_reply($1,$2,$3,$4,$5,$6,$7)',
        [org, wf, cutoff, since, pipelines, after, limit]);
      return rows;
    };
    const ids = rows => rows.map(r => r.lead_id);
    const wa = (patch) => {
      const row = { organization_id: ORG, lead_id: null, normalized_phone: PHONE, direction: 'incoming',
        status: 'received', sent_source: 'manual', sent_by_ai: false, timestamp: '2026-11-18T08:00:00Z', ...patch };
      if (row.direction === 'outgoing' && patch.status === undefined) row.status = 'sent';
      const keys = Object.keys(row);
      return db.query(`INSERT INTO public.whatsapp_messages(${keys.map(k => `"${k}"`).join(',')})
        VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
    };
    const official = (patch) => {
      const row = { organization_id: ORG, channel: 'whatsapp', lead_id: null, phone_number: `+${PHONE}`,
        direction: 'incoming', status: 'received', timestamp: '2026-11-18T08:00:00Z', ...patch };
      const keys = Object.keys(row);
      return db.query(`INSERT INTO public.channel_messages(${keys.map(k => `"${k}"`).join(',')})
        VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
    };
    const scenario = (name, fn) => t.test(name, async () => {
      await db.exec('BEGIN');
      try { await fn(); } finally { await db.exec('ROLLBACK'); }
    });

    await scenario('cliente esperando além do corte → candidato com âncora na PRIMEIRA mensagem sem resposta', async () => {
      await wa({ direction: 'outgoing', timestamp: '2026-11-18T06:00:00Z' });          // humano respondeu antes
      await wa({ timestamp: '2026-11-18T07:00:00Z' });                                  // âncora
      await wa({ timestamp: '2026-11-18T08:00:00Z' });                                  // insistência
      const rows = await find();
      assert.deepEqual(ids(rows), [LEAD]);
      assert.equal(new Date(rows[0].waiting_since).toISOString(), '2026-11-18T07:00:00.000Z');
      assert.equal(rows[0].dedup_key, 'company_no_reply:2026-11-18T07:00:00.000000Z');
    });

    await scenario('cliente esperando ainda dentro do prazo → não dispara', async () => {
      await wa({ timestamp: '2026-11-18T12:30:00Z' });
      assert.deepEqual(await find(), []);
    });

    await scenario('âncora antes do corte mas insistência depois → dispara (relógio é da primeira)', async () => {
      await wa({ timestamp: '2026-11-18T11:00:00Z' });
      await wa({ timestamp: '2026-11-18T14:00:00Z' });
      assert.deepEqual(ids(await find()), [LEAD]);
    });

    await scenario('empresa respondeu (humano) → não dispara, inclusive resposta depois do corte', async () => {
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      await wa({ direction: 'outgoing', timestamp: '2026-11-18T09:00:00Z' });
      assert.deepEqual(await find(), []);
      await db.exec(`DELETE FROM public.whatsapp_messages WHERE direction='outgoing'`);
      await wa({ direction: 'outgoing', timestamp: '2026-11-18T12:59:00Z' });
      assert.deepEqual(await find(), [], 'resposta humana recente encerra a espera');
    });

    for (const [name, patch] of [
      ['automação (workflow)', { sent_source: 'workflow', sent_by_ai: true }],
      ['Copilot/IA', { sent_source: 'copilot', sent_by_ai: true }],
      ['régua de cobrança', { sent_source: 'cobranca' }],
      ['manual marcado como IA', { sent_by_ai: true }],
      ['envio que falhou', { status: 'failed' }],
      ['envio pendente', { status: 'pending' }],
      ['mensagem apagada', { deleted_at: '2026-11-18T09:01:00Z' }],
      ['mensagem em grupo', { is_group: true }],
    ]) await scenario(`resposta só de ${name} → continua esperando`, async () => {
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      await wa({ direction: 'outgoing', timestamp: '2026-11-18T09:00:00Z', ...patch });
      assert.deepEqual(ids(await find()), [LEAD]);
    });

    await scenario('cliente escreve de novo depois da resposta humana → espera NOVA, chave nova', async () => {
      await wa({ timestamp: '2026-11-17T07:00:00Z' });
      await wa({ direction: 'outgoing', timestamp: '2026-11-17T08:00:00Z' });
      await wa({ timestamp: '2026-11-18T09:00:00Z' });
      const rows = await find();
      assert.deepEqual(ids(rows), [LEAD]);
      assert.equal(rows[0].dedup_key, 'company_no_reply:2026-11-18T09:00:00.000000Z');
    });

    await scenario('dedup: espera já disparada não volta; espera nova volta', async () => {
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      const [first] = await find();
      await db.query(`INSERT INTO public.workflow_executions(workflow_id,lead_id,status,trigger_dedup_key)
        VALUES($1,$2,'completed',$3)`, [WF, LEAD, first.dedup_key]);
      assert.deepEqual(await find(), [], 'mesma espera não dispara de novo');
      // Mesma chave de novo colide no índice único: atomicidade contra cron concorrente.
      await assert.rejects(db.query(`INSERT INTO public.workflow_executions(workflow_id,lead_id,status,trigger_dedup_key)
        VALUES($1,$2,'running',$3)`, [WF, LEAD, first.dedup_key]));
      await db.exec('ROLLBACK; BEGIN;');
      await wa({ timestamp: '2026-11-17T07:00:00Z' });
      await db.query(`INSERT INTO public.workflow_executions(workflow_id,lead_id,status,trigger_dedup_key)
        VALUES($1,$2,'completed','company_no_reply:2026-11-17T07:00:00.000000Z')`, [WF, LEAD]);
      await wa({ direction: 'outgoing', timestamp: '2026-11-17T08:00:00Z' });
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      assert.deepEqual(ids(await find()), [LEAD], 'execução da espera anterior não bloqueia a nova');
    });

    await scenario('execução em voo do mesmo workflow para o lead → pula (mesma regra do fireTrigger)', async () => {
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      await db.query(`INSERT INTO public.workflow_executions(workflow_id,lead_id,status,trigger_dedup_key)
        VALUES($1,$2,'waiting_response',NULL)`, [WF, LEAD]);
      assert.deepEqual(await find(), []);
    });

    await scenario('casa por lead_id quando a mensagem não tem telefone normalizado', async () => {
      await wa({ normalized_phone: null, lead_id: id(2), timestamp: '2026-11-18T07:00:00Z' });
      assert.deepEqual(ids(await find()), [id(2)]);
      await wa({ normalized_phone: null, lead_id: id(2), direction: 'outgoing', timestamp: '2026-11-18T08:00:00Z' });
      assert.deepEqual(await find(), []);
    });

    await scenario('isolamento de org: mensagem de outra org e workflow de outra org não vazam', async () => {
      await wa({ organization_id: OTHER_ORG, timestamp: '2026-11-18T07:00:00Z' });
      assert.deepEqual(await find(), [], 'mensagem da outra org não cria candidato aqui');
      assert.deepEqual(await find({ wf: WF_OTHER_ORG }), [], 'workflow de outra org com a org daqui → nada');
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      assert.deepEqual(await find({ org: OTHER_ORG, wf: WF }), [], 'org errada para o workflow → nada');
      assert.deepEqual(ids(await find({ org: OTHER_ORG, wf: WF_OTHER_ORG })), [id(4)], 'cada org vê só o seu lead');
      // Resposta humana dada na OUTRA org não encerra a espera daqui.
      await wa({ organization_id: OTHER_ORG, direction: 'outgoing', timestamp: '2026-11-18T09:00:00Z' });
      assert.deepEqual(ids(await find()), [LEAD]);
    });

    await scenario('workflow de outro tipo ou org bloqueada → nada', async () => {
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      assert.deepEqual(await find({ wf: WF_OTHER_TYPE }), []);
      await wa({ organization_id: BLOCKED_ORG, timestamp: '2026-11-18T07:00:00Z' });
      assert.deepEqual(await find({ org: BLOCKED_ORG, wf: WF_BLOCKED }), []);
    });

    await scenario('filtro de funil: só leads com card em um dos funis; devolve os funis do lead', async () => {
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      await db.query(`INSERT INTO public.pipeline_entries(organization_id,lead_id,pipeline_id) VALUES($1,$2,$3)`, [ORG, LEAD, id(40)]);
      assert.deepEqual(await find({ pipelines: [id(41)] }), []);
      const rows = await find({ pipelines: [id(40), id(41)] });
      assert.deepEqual(ids(rows), [LEAD]);
      assert.deepEqual(rows[0].pipeline_ids, [id(40)]);
      assert.deepEqual(ids(await find({ pipelines: [] })), [LEAD], 'lista vazia = qualquer funil');
    });

    await scenario('janela de olhar para trás: espera aberta antes de p_since não dispara', async () => {
      await wa({ timestamp: '2026-11-01T07:00:00Z' });
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      assert.deepEqual(await find(), [], 'âncora velha, sem resposta desde então → fora da janela');
    });

    await scenario('paginação por p_after e limite', async () => {
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      await wa({ normalized_phone: '5511999990002', timestamp: '2026-11-18T07:00:00Z' });
      await wa({ normalized_phone: '5511999990003', timestamp: '2026-11-18T07:00:00Z' });
      const page1 = await find({ limit: 2 });
      assert.deepEqual(ids(page1), [LEAD, id(2)]);
      assert.deepEqual(ids(await find({ limit: 2, after: id(2) })), [id(3)]);
    });

    await scenario('canal oficial: entrada por telefone sem vínculo; resposta só conta com autor da equipe', async () => {
      await official({ timestamp: '2026-11-18T07:00:00Z' });
      assert.deepEqual(ids(await find()), [LEAD]);
      await official({ direction: 'outgoing', status: 'sent', timestamp: '2026-11-18T08:00:00Z' });
      assert.deepEqual(ids(await find()), [LEAD], 'envio sem autor (robô/disparo) não é resposta');
      await official({ direction: 'outgoing', status: 'failed', sent_by_team_member_id: id(90), timestamp: '2026-11-18T08:30:00Z' });
      assert.deepEqual(ids(await find()), [LEAD], 'envio humano que falhou não é resposta');
      await official({ direction: 'outgoing', status: 'sent', sent_by_team_member_id: id(90), timestamp: '2026-11-18T09:00:00Z' });
      assert.deepEqual(await find(), []);
    });

    await scenario('canal oficial por lead_id (Instagram) e resposta cruzada chip↔oficial', async () => {
      await official({ channel: 'instagram', phone_number: null, lead_id: id(3), timestamp: '2026-11-18T07:00:00Z' });
      assert.deepEqual(ids(await find()), [id(3)]);
      await wa({ normalized_phone: '5511999990003', direction: 'outgoing', timestamp: '2026-11-18T08:00:00Z' });
      assert.deepEqual(await find(), [], 'humano respondeu pelo chip: a empresa respondeu');
    });

    await scenario('lead apagado não é candidato', async () => {
      await wa({ timestamp: '2026-11-18T07:00:00Z' });
      await db.exec(`UPDATE public.leads SET deleted_at=now() WHERE id='${LEAD}'`);
      assert.deepEqual(await find(), []);
    });

    await t.test('ACL: só service_role executa; função DEFINER com search_path vazio', async () => {
      const { rows } = await db.query(`
        SELECT p.prosecdef, p.proconfig,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
          has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
        FROM pg_proc p WHERE p.proname = 'find_leads_company_no_reply'`);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].prosecdef, true);
      assert.deepEqual(rows[0].proconfig, ['search_path=""']);
      assert.equal(rows[0].anon, false);
      assert.equal(rows[0].auth, false);
      assert.equal(rows[0].svc, true);
    });

    await t.test('rollback remove a função', async () => {
      await db.exec(rollback);
      const { rows } = await db.query(`SELECT 1 FROM pg_proc WHERE proname='find_leads_company_no_reply'`);
      assert.equal(rows.length, 0);
    });
  } finally {
    await db.close();
  }
});
