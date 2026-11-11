// @vitest-environment node
// Local Postgres engine (PGlite); no network, credentials or production writes.
//
// Prova da 20271215000001_policies_admin_global_ganham_escopo_de_org.sql
// contra as policies, helpers e trigger de PROD capturados em
// tests/fixtures/admin-global-policies/prod-state.sql:
//   - controle positivo: ANTES, admin da org B lê/escreve comissão,
//     automação, user_roles e regra de disparo da org A;
//   - DEPOIS: o mesmo admin é recusado (42501 na escrita, 0 linhas na leitura
//     e no UPDATE/DELETE, dado intacto);
//   - o legítimo continua: admin A na própria org, membro vê a própria
//     comissão, master escreve user_roles, trigger mantém o espelho;
//   - guarda aborta com P0001; rollback devolve as policies exatas.
// Toda chamada roda como `authenticated` COM claims reais de JWT.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATION = readFileSync('supabase/migrations/20271215000001_policies_admin_global_ganham_escopo_de_org.sql', 'utf8');
const ROLLBACK = readFileSync('supabase/migrations/rollback/20271215000001_policies_admin_global_ganham_escopo_de_org.sql', 'utf8');
const PROD_STATE = readFileSync('tests/fixtures/admin-global-policies/prod-state.sql', 'utf8');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG_A = id(1);
const ORG_B = id(2);
const ADMIN_A = id(11);
const ADMIN_B = id(12);
const MEMBER_A = id(13);
const MASTER = id(14);
const TM_ADMIN_A = id(21);
const TM_ADMIN_B = id(22);
const TM_MEMBER_A = id(23);
const COMM_A = id(31);
const COMM_MEMBER_A = id(32);
const FUA_A = id(41);
const FUA_NULL = id(42);
const PDR_A = id(51);

const SCHEMA = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
`;

// Tabelas mínimas; o tipo app_role vem do fixture de prod.
const TABLES = `
  CREATE TABLE public.organizations(id uuid PRIMARY KEY, subscription_status text DEFAULT 'active', billing_override boolean DEFAULT false);
  CREATE TABLE public.team_members(id uuid PRIMARY KEY, organization_id uuid, user_id uuid, role public.app_role,
    is_active boolean DEFAULT true, created_at timestamptz DEFAULT now());
  CREATE TABLE public.master_users(user_id uuid, is_active boolean DEFAULT true);
  CREATE TABLE public.gestores(id uuid PRIMARY KEY, user_id uuid, is_active boolean);
  CREATE TABLE public.gestor_organizations(gestor_id uuid, organization_id uuid);
  CREATE TABLE public.commissions(id uuid PRIMARY KEY, team_member_id uuid NOT NULL, organization_id uuid, amount numeric NOT NULL);
  CREATE TABLE public.follow_up_automations(id uuid PRIMARY KEY, organization_id uuid, pipe_type text, stage text,
    title_template text, is_active boolean);
  CREATE TABLE public.user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL,
    UNIQUE (user_id, role));
  CREATE TABLE public.pipe_dispatch_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, pipe_type text);
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
`;

const SEED = `
  INSERT INTO public.organizations(id) VALUES ('${ORG_A}'), ('${ORG_B}');
  INSERT INTO public.master_users(user_id) VALUES ('${MASTER}');
  -- trg_sync_user_roles espelha estes em user_roles
  INSERT INTO public.team_members(id, organization_id, user_id, role) VALUES
    ('${TM_ADMIN_A}', '${ORG_A}', '${ADMIN_A}', 'admin'),
    ('${TM_ADMIN_B}', '${ORG_B}', '${ADMIN_B}', 'admin'),
    ('${TM_MEMBER_A}', '${ORG_A}', '${MEMBER_A}', 'member');
  INSERT INTO public.commissions VALUES ('${COMM_A}', '${TM_ADMIN_A}', '${ORG_A}', 100),
                                        ('${COMM_MEMBER_A}', '${TM_MEMBER_A}', '${ORG_A}', 50);
  INSERT INTO public.follow_up_automations VALUES ('${FUA_A}', '${ORG_A}', 'whatsapp', 'novo', 'regra A', true),
                                                  ('${FUA_NULL}', NULL, 'whatsapp', 'novo', 'regra sem org', true);
  INSERT INTO public.pipe_dispatch_rules VALUES ('${PDR_A}', '${ORG_A}', 'whatsapp');
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  // O fixture cria o enum antes das tabelas; helpers SQL referenciam tabelas.
  const [enumStmt, ...rest] = PROD_STATE.split('\n').reduce<string[]>((acc, line) => {
    if (acc.length === 0 && line.startsWith('CREATE TYPE')) return [line, ''];
    if (acc.length === 0) return acc;
    acc[1] += line + '\n';
    return acc;
  }, []);
  await db.exec(enumStmt);
  await db.exec(TABLES);
  await db.exec(`SET check_function_bodies = off; ${rest.join('\n')} RESET check_function_bodies;`);
  await db.exec(SEED);
  return db;
}

async function as(db: PGlite, sub: string, sql: string) {
  const claims = JSON.stringify({ role: 'authenticated', sub });
  await db.exec(`SELECT set_config('request.jwt.claims', '${claims}', false); SET ROLE authenticated;`);
  try {
    return await db.query<Record<string, unknown>>(sql);
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '', false);`);
  }
}
const count = async (db: PGlite, sub: string, sql: string) =>
  ((await as(db, sub, sql)).rows as unknown[]).length;
const affected = async (db: PGlite, sub: string, sql: string) => (await as(db, sub, sql)).affectedRows ?? 0;
const scalar = async (db: PGlite, sql: string) => Object.values((await db.query(sql)).rows[0] as object)[0];

const INSERT_COMM_A = `INSERT INTO public.commissions VALUES (gen_random_uuid(), '${TM_ADMIN_A}', '${ORG_A}', 999)`;
const INSERT_FUA_A = `INSERT INTO public.follow_up_automations VALUES (gen_random_uuid(), '${ORG_A}', 'whatsapp', 'novo', 'forjada', true)`;
const INSERT_PDR_A = `INSERT INTO public.pipe_dispatch_rules(organization_id, pipe_type) VALUES ('${ORG_A}', 'whatsapp')`;
const GRANT_ADMIN_TO_MEMBER = `INSERT INTO public.user_roles(user_id, role) VALUES ('${MEMBER_A}', 'admin')`;

describe('controle positivo: policies de prod antes da migration', () => {
  let db: PGlite;
  beforeAll(async () => { db = await freshDb(); }, 30000);
  afterAll(async () => { await db.close(); });

  it('o fixture espelhou team_members em user_roles pelo trigger de prod', async () => {
    expect(await scalar(db, 'SELECT count(*)::int FROM public.user_roles')).toBe(3);
  });

  it('controle do template global: hoje admin lê a linha sem org, membro não', async () => {
    expect(await count(db, ADMIN_B, `SELECT 1 FROM public.follow_up_automations WHERE id = '${FUA_NULL}'`)).toBe(1);
    expect(await count(db, MEMBER_A, `SELECT 1 FROM public.follow_up_automations WHERE id = '${FUA_NULL}'`)).toBe(0);
  });

  it('admin da org B lê as comissões da org A', async () => {
    expect(await count(db, ADMIN_B, `SELECT 1 FROM public.commissions WHERE organization_id = '${ORG_A}'`)).toBe(2);
  });

  it('admin da org B escreve comissão, automação e regra de disparo na org A', async () => {
    await as(db, ADMIN_B, INSERT_COMM_A);
    expect(await affected(db, ADMIN_B, `UPDATE public.follow_up_automations SET title_template = 'pwned' WHERE id = '${FUA_A}'`)).toBe(1);
    await as(db, ADMIN_B, INSERT_PDR_A);
  });

  it('admin da org B dá role admin a um membro da org A (escalada)', async () => {
    await as(db, ADMIN_B, GRANT_ADMIN_TO_MEMBER);
    expect(await count(db, MEMBER_A, `SELECT 1 WHERE public.is_user_admin()`)).toBe(1);
  });
});

describe('depois da migration', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
    await db.exec(MIGRATION);
  }, 30000);
  afterAll(async () => { await db.close(); });

  it('admin da org B não lê comissão da org A', async () => {
    expect(await count(db, ADMIN_B, `SELECT 1 FROM public.commissions WHERE organization_id = '${ORG_A}'`)).toBe(0);
  });

  it('admin da org B não cria nem altera comissão da org A', async () => {
    await expect(as(db, ADMIN_B, INSERT_COMM_A)).rejects.toMatchObject({ code: '42501' });
    expect(await affected(db, ADMIN_B, `UPDATE public.commissions SET amount = 0 WHERE id = '${COMM_A}'`)).toBe(0);
    expect(await affected(db, ADMIN_B, `DELETE FROM public.commissions WHERE id = '${COMM_A}'`)).toBe(0);
    expect(await scalar(db, `SELECT amount::int FROM public.commissions WHERE id = '${COMM_A}'`)).toBe(100);
  });

  it('admin da org B não lê nem escreve automação da org A', async () => {
    expect(await count(db, ADMIN_B, `SELECT 1 FROM public.follow_up_automations WHERE organization_id = '${ORG_A}'`)).toBe(0);
    await expect(as(db, ADMIN_B, INSERT_FUA_A)).rejects.toMatchObject({ code: '42501' });
    expect(await affected(db, ADMIN_B, `UPDATE public.follow_up_automations SET title_template = 'pwned'`)).toBe(0);
    expect(await scalar(db, `SELECT title_template FROM public.follow_up_automations WHERE id = '${FUA_A}'`)).toBe('regra A');
  });

  it('template global (org NULL): admin segue lendo, membro segue sem ler, ninguém além de master escreve', async () => {
    expect(await count(db, ADMIN_B, `SELECT 1 FROM public.follow_up_automations WHERE id = '${FUA_NULL}'`)).toBe(1);
    expect(await count(db, MEMBER_A, `SELECT 1 FROM public.follow_up_automations WHERE id = '${FUA_NULL}'`)).toBe(0);
    expect(await affected(db, ADMIN_B, `UPDATE public.follow_up_automations SET title_template = 'pwned' WHERE id = '${FUA_NULL}'`)).toBe(0);
    expect(await affected(db, ADMIN_B, `DELETE FROM public.follow_up_automations WHERE id = '${FUA_NULL}'`)).toBe(0);
    await expect(as(db, ADMIN_B, `INSERT INTO public.follow_up_automations VALUES (gen_random_uuid(), NULL, 'whatsapp', 'novo', 'global forjado', true)`))
      .rejects.toMatchObject({ code: '42501' });
    expect(await affected(db, MASTER, `UPDATE public.follow_up_automations SET title_template = 'regra sem org' WHERE id = '${FUA_NULL}'`)).toBe(1);
  });

  it('admin da org B não cria regra de disparo na org A', async () => {
    await expect(as(db, ADMIN_B, INSERT_PDR_A)).rejects.toMatchObject({ code: '42501' });
  });

  it('admin nenhum grava nem apaga user_roles direto (nem da própria org)', async () => {
    await expect(as(db, ADMIN_B, GRANT_ADMIN_TO_MEMBER)).rejects.toMatchObject({ code: '42501' });
    await expect(as(db, ADMIN_A, GRANT_ADMIN_TO_MEMBER)).rejects.toMatchObject({ code: '42501' });
    expect(await affected(db, ADMIN_B, `DELETE FROM public.user_roles WHERE user_id = '${ADMIN_A}'`)).toBe(0);
    expect(await count(db, MEMBER_A, `SELECT 1 WHERE public.is_user_admin()`)).toBe(0);
  });

  it('admin da org A gerencia comissão e automação da própria org', async () => {
    expect(await count(db, ADMIN_A, `SELECT 1 FROM public.commissions`)).toBe(2);
    await as(db, ADMIN_A, INSERT_COMM_A);
    expect(await affected(db, ADMIN_A, `UPDATE public.commissions SET amount = 101 WHERE id = '${COMM_A}'`)).toBe(1);
    await as(db, ADMIN_A, INSERT_FUA_A);
    expect(await affected(db, ADMIN_A, `UPDATE public.follow_up_automations SET title_template = 'regra A2' WHERE id = '${FUA_A}'`)).toBe(1);
    expect(await affected(db, ADMIN_A, `DELETE FROM public.follow_up_automations WHERE title_template = 'forjada'`)).toBe(1);
  });

  it('fluxo real da UI: admin A cria automação por etapa COM org A; sem org (como o front antigo) é recusado', async () => {
    await as(db, ADMIN_A, `INSERT INTO public.follow_up_automations VALUES (gen_random_uuid(), '${ORG_A}', 'whatsapp', 'agendado', 'por etapa', true)`);
    await expect(as(db, ADMIN_A, `INSERT INTO public.follow_up_automations VALUES (gen_random_uuid(), NULL, 'whatsapp', 'agendado', 'nasceria global', true)`))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('regra de disparo: membro desativado e org bloqueada não inserem', async () => {
    await db.exec(`UPDATE public.team_members SET is_active = false WHERE id = '${TM_MEMBER_A}'`);
    try {
      await expect(as(db, MEMBER_A, INSERT_PDR_A)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await db.exec(`UPDATE public.team_members SET is_active = true WHERE id = '${TM_MEMBER_A}'`);
    }
    await db.exec(`UPDATE public.organizations SET subscription_status = 'suspended' WHERE id = '${ORG_A}'`);
    try {
      await expect(as(db, ADMIN_A, INSERT_PDR_A)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await db.exec(`UPDATE public.organizations SET subscription_status = 'active' WHERE id = '${ORG_A}'`);
    }
  });

  it('membro da org A vê a própria comissão e cria regra de disparo na própria org', async () => {
    const r = await as(db, MEMBER_A, `SELECT id FROM public.commissions WHERE id = '${COMM_MEMBER_A}'`);
    expect(r.rows).toEqual([{ id: COMM_MEMBER_A }]);
    await as(db, MEMBER_A, INSERT_PDR_A);
  });

  it('master segue escrevendo user_roles e vendo a automação sem org', async () => {
    await as(db, MASTER, `INSERT INTO public.user_roles(user_id, role) VALUES ('${MEMBER_A}', 'sdr')`);
    expect(await affected(db, MASTER, `DELETE FROM public.user_roles WHERE user_id = '${MEMBER_A}' AND role = 'sdr'`)).toBe(1);
    expect(await count(db, MASTER, `SELECT 1 FROM public.follow_up_automations WHERE organization_id IS NULL`)).toBe(1);
  });

  it('o trigger de prod continua mantendo o espelho quando a role muda em team_members', async () => {
    await db.exec(`UPDATE public.team_members SET role = 'admin' WHERE id = '${TM_MEMBER_A}'`);
    expect(await count(db, MEMBER_A, `SELECT 1 WHERE public.is_user_admin()`)).toBe(1);
    await db.exec(`UPDATE public.team_members SET role = 'member' WHERE id = '${TM_MEMBER_A}'`);
    expect(await scalar(db, `SELECT count(*)::int FROM public.user_roles WHERE user_id = '${MEMBER_A}' AND role = 'admin'`)).toBe(0);
  });

  it('reaplicar a migration é inócuo', async () => {
    await db.exec(MIGRATION);
    await expect(as(db, ADMIN_B, INSERT_COMM_A)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('guarda', () => {
  it('aborta com P0001 quando a policy divergiu do medido em prod', async () => {
    const db = await freshDb();
    try {
      await db.exec(`ALTER POLICY "Apenas admins podem gerenciar comissões" ON public.commissions
        USING (has_role(auth.uid(), 'admin'::app_role) AND amount > 0)`);
      await expect(db.exec(`BEGIN; ${MIGRATION}`)).rejects.toMatchObject({ code: 'P0001' });
      await db.exec('ROLLBACK');
    } finally {
      await db.close();
    }
  }, 60000);

  it('aborta com P0001 quando o trigger de espelho está desligado', async () => {
    const db = await freshDb();
    try {
      await db.exec(`ALTER TABLE public.team_members DISABLE TRIGGER trg_sync_user_roles`);
      await expect(db.exec(`BEGIN; ${MIGRATION}`)).rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/trg_sync_user_roles/) });
      await db.exec('ROLLBACK');
    } finally {
      await db.close();
    }
  }, 60000);
});

describe('rollback', () => {
  it('devolve exatamente as policies de prod', async () => {
    const db = await freshDb();
    try {
      const snapshot = `SELECT c.relname, pol.polname, pol.polcmd, pol.polpermissive, pol.polroles::text,
                               pg_get_expr(pol.polqual, pol.polrelid) AS q, pg_get_expr(pol.polwithcheck, pol.polrelid) AS w
                          FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid ORDER BY 1, 2`;
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
