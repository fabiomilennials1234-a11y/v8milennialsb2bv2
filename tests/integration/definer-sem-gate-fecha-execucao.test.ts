// @vitest-environment node
// Local Postgres engine (PGlite); no network, credentials or production writes.
//
// Prova da 20271215000000_definer_sem_gate_fecha_execucao.sql contra o estado
// de PROD capturado em tests/fixtures/definer-sem-gate/prod-state.sql:
//   - controle positivo: ANTES da migration, usuário da org B alcança dado e
//     escrita da org A (o vetor existe no fixture, logo o teste mede algo);
//   - DEPOIS: usuário de outra org recebe 42501 em todas as 25;
//   - o chamador legítimo (service_role, membro da org, master) continua;
//   - a guarda aborta com P0001 quando o corpo divergiu do medido em prod.
// Toda chamada roda como `authenticated` COM claims reais de JWT — SET ROLE
// sem claims faria get_my_organization_ids() voltar vazio e o teste passar por
// não ter exercitado nada.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATION = readFileSync('supabase/migrations/20271215000000_definer_sem_gate_fecha_execucao.sql', 'utf8');
const ROLLBACK = readFileSync('supabase/migrations/rollback/20271215000000_definer_sem_gate_fecha_execucao.sql', 'utf8');
const PROD_STATE = readFileSync('tests/fixtures/definer-sem-gate/prod-state.sql', 'utf8');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG_A = id(1);
const ORG_B = id(2);
const USER_A = id(11);
const USER_B = id(12);
const USER_MASTER = id(13);
const TM_A = id(21);
const TM_B = id(22);
const LEAD_A = id(31);
const INSTANCE_A = id(41);
const DOC_A = id(51);

const REVOKED = [
  'process_overdue_subscriptions(integer)',
  'save_document_content(uuid,text)',
  'claim_campaign_dispatch_batch(uuid,integer)',
  'claim_pipe_dispatch_batch(text,integer)',
  'convert_pipe_rule_to_workflow(uuid)',
  'convert_campaign_rule_to_workflow(uuid)',
  'increment_conversation_turn(uuid,text)',
  'recalc_upsell_client_metrics(uuid)',
  'increment(text,uuid,text)',
  'api_create_custom_field(uuid,text,text,jsonb,boolean)',
  'api_set_custom_fields_creating(uuid,uuid,jsonb)',
  'api_list_team_members(uuid)',
  'cleanup_copilot_message_queue()',
  'purge_expired_rate_limits()',
  'check_auth_rate_limit(text,text,integer,interval)',
  'claim_password_reset_token(text)',
  'try_provision_lock(text)',
  'has_concurrent_ai_action(uuid,text,uuid)',
  'fn_medicao_de_ruido(integer)',
  'fn_pico_de_avisos_quentes(integer)',
  'fn_preferencias_de_aviso(uuid,uuid)',
  'fn_dono_do_lead(uuid)',
  'carteira_erp_source(uuid,uuid,text,text)',
];
const GATED = ['create_default_pipelines(uuid)', 'get_lead_write_instance(uuid)'];

// Argumentos de exemplo por tipo, para chamar cada assinatura como atacante.
const sample: Record<string, string> = {
  uuid: `'${ORG_A}'::uuid`,
  text: `'x'`,
  integer: '1',
  jsonb: `'{}'::jsonb`,
  boolean: 'false',
  interval: `'1 minute'::interval`,
};
const callOf = (sig: string) => {
  const [name, rest] = sig.split('(');
  const args = rest.slice(0, -1).split(',').filter(Boolean).map((t) => sample[t]);
  return `SELECT public.${name}(${args.join(', ')})`;
};

const SCHEMA = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA private;
  GRANT USAGE ON SCHEMA public, auth, private TO anon, authenticated, service_role;

  CREATE TABLE public.organizations(id uuid PRIMARY KEY, name text, subscription_status text DEFAULT 'active',
    billing_override boolean DEFAULT false, updated_at timestamptz, default_reorder_cycle_days int);
  CREATE TABLE public.payment_history(organization_id uuid, status text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.team_members(id uuid PRIMARY KEY, organization_id uuid, user_id uuid, is_active boolean DEFAULT true,
    name text, email text, job_title text, role text);
  CREATE TABLE public.master_users(id uuid DEFAULT gen_random_uuid(), user_id uuid, is_active boolean DEFAULT true);
  CREATE TABLE public.gestores(id uuid PRIMARY KEY, user_id uuid, is_active boolean);
  CREATE TABLE public.gestor_organizations(gestor_id uuid, organization_id uuid);
  CREATE TABLE public.pipelines(organization_id uuid, name text, slug text, type text, display_order int, icon text, color text,
    UNIQUE (organization_id, slug));
  CREATE TABLE public.pipeline_display_config(organization_id uuid, pipe_type text);
  CREATE TABLE private.leads(id uuid PRIMARY KEY, organization_id uuid, responsible_user_id uuid);
  CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY, organization_id uuid, instance_name text, owner_team_member_id uuid);
  CREATE TABLE public.copilot_agent_documents(id uuid PRIMARY KEY, content text, updated_at timestamptz);
`;

const SEED = `
  INSERT INTO public.organizations(id, name) VALUES ('${ORG_A}', 'A'), ('${ORG_B}', 'B');
  INSERT INTO public.team_members(id, organization_id, user_id, name, email, role) VALUES
    ('${TM_A}', '${ORG_A}', '${USER_A}', 'Ana', 'ana@a.test', 'admin'),
    ('${TM_B}', '${ORG_B}', '${USER_B}', 'Beto', 'beto@b.test', 'admin');
  INSERT INTO public.master_users(user_id) VALUES ('${USER_MASTER}');
  INSERT INTO public.pipeline_display_config VALUES ('${ORG_A}', 'whatsapp'), ('${ORG_B}', 'whatsapp');
  INSERT INTO private.leads VALUES ('${LEAD_A}', '${ORG_A}', '${TM_A}'), ('${id(32)}', '${ORG_B}', '${TM_B}');
  INSERT INTO public.whatsapp_instances VALUES ('${INSTANCE_A}', '${ORG_A}', 'inst-a', '${TM_A}');
  INSERT INTO public.copilot_agent_documents VALUES ('${DOC_A}', 'original', now());
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  // Corpos SQL referenciam tabelas que este esqueleto não tem (notifications,
  // upsell_orders...). Só as que o teste executa precisam existir.
  await db.exec(`SET check_function_bodies = off; ${PROD_STATE} RESET check_function_bodies;`);
  await db.exec(SEED);
  return db;
}

type Who = { role: 'anon' | 'authenticated' | 'service_role'; sub?: string };
const B: Who = { role: 'authenticated', sub: USER_B };
const A: Who = { role: 'authenticated', sub: USER_A };
const MASTER: Who = { role: 'authenticated', sub: USER_MASTER };
const SERVICE: Who = { role: 'service_role' };
const ANON: Who = { role: 'anon' };

async function as(db: PGlite, who: Who, sql: string) {
  const claims = JSON.stringify({ role: who.role, ...(who.sub ? { sub: who.sub } : {}) });
  await db.exec(`SELECT set_config('request.jwt.claims', '${claims}', false); SET ROLE ${who.role};`);
  try {
    return await db.query<Record<string, unknown>>(sql);
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '', false);`);
  }
}

const can = async (db: PGlite, role: string, sig: string) =>
  (await db.query<{ ok: boolean }>(`SELECT has_function_privilege('${role}', 'public.${sig}', 'EXECUTE') AS ok`)).rows[0].ok;

describe('controle positivo: estado de prod antes da migration', () => {
  let db: PGlite;
  beforeAll(async () => { db = await freshDb(); }, 30000);
  afterAll(async () => { await db.close(); });

  it('authenticated executa as 25', async () => {
    for (const sig of [...REVOKED, ...GATED]) expect(await can(db, 'authenticated', sig), sig).toBe(true);
  });

  it('usuário da org B lê a equipe da org A (e-mail incluso)', async () => {
    const r = await as(db, B, `SELECT public.api_list_team_members('${ORG_A}') AS j`);
    expect(JSON.stringify(r.rows[0].j)).toContain('ana@a.test');
  });

  it('usuário da org B sobrescreve documento de Copilot da org A', async () => {
    await as(db, B, `SELECT public.save_document_content('${DOC_A}', 'pwned')`);
    const r = await db.query<{ content: string }>(`SELECT content FROM public.copilot_agent_documents WHERE id = '${DOC_A}'`);
    expect(r.rows[0].content).toBe('pwned');
    await db.exec(`UPDATE public.copilot_agent_documents SET content = 'original' WHERE id = '${DOC_A}'`);
  });

  it('usuário da org B cria funil na org A e lê a instância do lead da org A', async () => {
    await as(db, B, `SELECT public.create_default_pipelines('${ORG_A}')`);
    const n = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.pipelines WHERE organization_id = '${ORG_A}'`);
    expect(n.rows[0].n).toBe(1);
    const r = await as(db, B, `SELECT instance_name FROM public.get_lead_write_instance('${LEAD_A}')`);
    expect(r.rows[0].instance_name).toBe('inst-a');
  });
});

describe('depois da migration', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
    await db.exec(MIGRATION);
  }, 30000);
  afterAll(async () => { await db.close(); });

  it.each(REVOKED)('%s: só service_role executa', async (sig) => {
    expect(await can(db, 'anon', sig)).toBe(false);
    expect(await can(db, 'authenticated', sig)).toBe(false);
    expect(await can(db, 'service_role', sig)).toBe(true);
  });

  it.each(REVOKED)('%s: usuário de outra org recebe 42501', async (sig) => {
    await expect(as(db, B, callOf(sig))).rejects.toMatchObject({ code: '42501' });
    await expect(as(db, ANON, callOf(sig))).rejects.toMatchObject({ code: '42501' });
  });

  it('service_role continua lendo a equipe e salvando o documento', async () => {
    const r = await as(db, SERVICE, `SELECT public.api_list_team_members('${ORG_A}') AS j`);
    expect(JSON.stringify(r.rows[0].j)).toContain('ana@a.test');
    await as(db, SERVICE, `SELECT public.save_document_content('${DOC_A}', 'novo')`);
    const d = await db.query<{ content: string }>(`SELECT content FROM public.copilot_agent_documents WHERE id = '${DOC_A}'`);
    expect(d.rows[0].content).toBe('novo');
  });

  it('as duas com gate seguem executáveis por authenticated, nunca por anon', async () => {
    for (const sig of GATED) {
      expect(await can(db, 'authenticated', sig), sig).toBe(true);
      expect(await can(db, 'service_role', sig), sig).toBe(true);
      expect(await can(db, 'anon', sig), sig).toBe(false);
    }
  });

  it('create_default_pipelines: outra org → 42501 e nada escrito', async () => {
    await expect(as(db, B, `SELECT public.create_default_pipelines('${ORG_A}')`)).rejects.toMatchObject({ code: '42501' });
    const n = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.pipelines WHERE organization_id = '${ORG_A}'`);
    expect(n.rows[0].n).toBe(0);
  });

  it('create_default_pipelines: membro, master e service_role passam', async () => {
    await as(db, A, `SELECT public.create_default_pipelines('${ORG_A}')`);
    const n = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.pipelines WHERE organization_id = '${ORG_A}'`);
    expect(n.rows[0].n).toBe(1);
    await as(db, MASTER, `SELECT public.create_default_pipelines('${ORG_B}')`);
    await as(db, SERVICE, `SELECT public.create_default_pipelines('${ORG_B}')`);
    const m = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.pipelines WHERE organization_id = '${ORG_B}'`);
    expect(m.rows[0].n).toBe(1);
  });

  it('create_default_pipelines: org suspensa deixa de passar (get_my_organization_ids)', async () => {
    await db.exec(`UPDATE public.organizations SET subscription_status = 'suspended' WHERE id = '${ORG_A}'`);
    try {
      await expect(as(db, A, `SELECT public.create_default_pipelines('${ORG_A}')`)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await db.exec(`UPDATE public.organizations SET subscription_status = 'active' WHERE id = '${ORG_A}'`);
    }
  });

  it('get_lead_write_instance: outra org → 42501', async () => {
    await expect(as(db, B, `SELECT * FROM public.get_lead_write_instance('${LEAD_A}')`)).rejects.toMatchObject({ code: '42501' });
  });

  it('get_lead_write_instance: membro, master e service_role recebem a instância', async () => {
    for (const who of [A, MASTER, SERVICE]) {
      const r = await as(db, who, `SELECT instance_id, instance_name, error_code FROM public.get_lead_write_instance('${LEAD_A}')`);
      expect(r.rows, who.sub ?? who.role).toEqual([{ instance_id: INSTANCE_A, instance_name: 'inst-a', error_code: null }]);
    }
  });

  it('get_lead_write_instance: lead inexistente segue LEAD_NOT_FOUND', async () => {
    const r = await as(db, B, `SELECT error_code FROM public.get_lead_write_instance('${id(999)}')`);
    expect(r.rows).toEqual([{ error_code: 'LEAD_NOT_FOUND' }]);
  });

  it('reaplicar a migration é inócuo', async () => {
    await db.exec(MIGRATION);
    expect(await can(db, 'authenticated', 'api_list_team_members(uuid)')).toBe(false);
    expect(await can(db, 'authenticated', 'create_default_pipelines(uuid)')).toBe(true);
  });
});

describe('guarda', () => {
  it('aborta com P0001 quando o corpo divergiu do medido em prod, sem mudar nada', async () => {
    const db = await freshDb();
    try {
      await db.exec(`CREATE OR REPLACE FUNCTION public.save_document_content(p_doc_id uuid, p_content text)
        RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT 1 $$;`);
      await expect(db.exec(`BEGIN; ${MIGRATION}`)).rejects.toMatchObject({ code: 'P0001' });
      await db.exec('ROLLBACK');
      expect(await can(db, 'authenticated', 'api_list_team_members(uuid)')).toBe(true);
    } finally {
      await db.close();
    }
  }, 60000);

  it('aborta com P0001 quando o proacl tem grantee desconhecido', async () => {
    const db = await freshDb();
    try {
      await db.exec(`CREATE ROLE intruso; GRANT EXECUTE ON FUNCTION public.increment(text,uuid,text) TO intruso;`);
      await expect(db.exec(`BEGIN; ${MIGRATION}`)).rejects.toMatchObject({ code: 'P0001' });
      await db.exec('ROLLBACK');
    } finally {
      await db.close();
    }
  }, 60000);
});

describe('sonda do roteiro de apply (scripts/ensaio-definer-sem-gate-sonda.sql)', () => {
  const SONDA = readFileSync('scripts/ensaio-definer-sem-gate-sonda.sql', 'utf8');

  it('passa depois da migration e reprova no estado de prod', async () => {
    const db = await freshDb();
    try {
      // reprova pelo motivo certo: o vetor, não falta de dado para impersonar
      await expect(db.exec(`BEGIN; ${SONDA}`)).rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/aceitou/) });
      await db.exec('ROLLBACK');
      const r = await db.exec(`BEGIN; ${MIGRATION} ${SONDA} ROLLBACK;`);
      expect(r.at(-2)?.rows).toEqual([{ resultado: 'sonda ok' }]);
    } finally {
      await db.close();
    }
  }, 60000);
});

describe('rollback', () => {
  it('devolve exatamente o proacl e o corpo de prod', async () => {
    const db = await freshDb();
    try {
      // proacl como conjunto: a ordem dos itens depende da ordem dos GRANTs.
      const snapshot = `SELECT p.oid::regprocedure::text AS sig, md5(p.prosrc) AS src,
                               (SELECT array_agg(x::text ORDER BY x::text) FROM unnest(p.proacl) AS x) AS acl
                          FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef ORDER BY 1`;
      const before = (await db.query(snapshot)).rows;
      await db.exec(MIGRATION);
      expect((await db.query(snapshot)).rows).not.toEqual(before);
      await db.exec(ROLLBACK);
      expect((await db.query(snapshot)).rows).toEqual(before);
    } finally {
      await db.close();
    }
  }, 60000);
});
