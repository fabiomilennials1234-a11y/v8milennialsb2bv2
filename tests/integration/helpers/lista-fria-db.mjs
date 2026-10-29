// Setup compartilhado dos testes da Lista Fria que rodam num Postgres real (PGlite):
// fixture mínima + migration aplicada + papéis (usuário, worker, postgres) + atalhos.
// Os caminhos são relativos a tests/integration/.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const read = (path) => readFileSync(new URL(path, new URL('../', import.meta.url)), 'utf8');
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const TORQUE = 'b2ad1ffb-e136-4356-846b-9f210f902573';
export const OUTRA = id(900);
export const U_ADMIN = id(1);
export const U_MEMBRO = id(2);
export const U_LIBERADO = id(3);
export const U_MASTER = id(4);
export const U_OUTRA = id(5);
export const TM_ADMIN = id(11);
export const TM_MEMBRO = id(12);
export const TM_LIBERADO = id(13);
export const TM_OUTRA = id(15);

export const MIGRATION = '../../supabase/migrations/20271217000000_lista_fria_fundacao.sql';
export const ROLLBACK = '../../supabase/migrations/rollback/20271217000000_lista_fria_fundacao.sql';
export const MIGRATION_CNPJ = '../../supabase/migrations/20271219000000_lista_fria_fonte_cnpj.sql';
export const ROLLBACK_CNPJ = '../../supabase/migrations/rollback/20271219000000_lista_fria_fonte_cnpj.sql';
export const MIGRATION_META = '../../supabase/migrations/20271220000000_lista_fria_creditos_meta.sql';
export const ROLLBACK_META = '../../supabase/migrations/rollback/20271220000000_lista_fria_creditos_meta.sql';

// O que a Lista Fria toca em `leads` e nos gatilhos de lead criado. Os corpos
// das funções são os de PRODUÇÃO antes da migration — os mesmos que o rollback
// restaura, por isso saem dele.
export function fixtureDeLeads() {
  const rollback = read(ROLLBACK);
  const funcoesAntes = rollback.slice(
    rollback.indexOf('CREATE OR REPLACE FUNCTION public.trigger_workflow_lead_created'),
    rollback.indexOf('DROP TRIGGER IF EXISTS'),
  );
  return `
    ALTER TABLE public.leads
      ADD COLUMN name text NOT NULL,
      ADD COLUMN phone text,
      ADD COLUMN email text,
      ADD COLUMN company text,
      ADD COLUMN segment text,
      ADD COLUMN origin text,
      ADD COLUMN notes text,
      ADD COLUMN excluded_from_metrics boolean NOT NULL DEFAULT false,
      ADD COLUMN normalized_phone text,
      ADD COLUMN deleted_at timestamptz,
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

    -- Igual à de prod: tira o 55 se vier com 12+ dígitos e põe o 9 em número de 10.
    CREATE FUNCTION public.normalize_brazilian_phone(p text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE AS $f$
    DECLARE d text := regexp_replace(COALESCE(p, ''), '\\D', '', 'g');
    BEGIN
      IF d = '' THEN RETURN NULL; END IF;
      IF length(d) >= 12 AND left(d, 2) = '55' THEN d := substr(d, 3); END IF;
      IF length(d) = 10 THEN d := left(d, 2) || '9' || substr(d, 3); END IF;
      RETURN d;
    END $f$;
    CREATE FUNCTION public.trg_normalize_phone() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN NEW.normalized_phone := public.normalize_brazilian_phone(NEW.phone); RETURN NEW; END $f$;
    CREATE TRIGGER leads_normalize_phone_trigger BEFORE INSERT OR UPDATE OF phone ON public.leads
      FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_phone();
    CREATE UNIQUE INDEX idx_leads_org_phone_unique ON public.leads (organization_id, normalized_phone)
      WHERE deleted_at IS NULL;

    CREATE TABLE public.lead_origins (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid, name text NOT NULL, slug text NOT NULL,
      color text, is_active boolean NOT NULL DEFAULT true
    );

    CREATE TABLE public.webhooks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL, url text, events text[] NOT NULL, is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.webhook_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      webhook_id uuid, event text, payload jsonb, next_retry_at timestamptz
    );

    CREATE TABLE public.workflow_disparos (organization_id uuid, gatilho text, lead_id uuid);
    CREATE FUNCTION public.fire_workflow_trigger(p_org uuid, p_gatilho text, p_lead uuid, p_payload jsonb)
    RETURNS void LANGUAGE sql AS $f$
      INSERT INTO public.workflow_disparos VALUES (p_org, p_gatilho, p_lead);
    $f$;

    ${funcoesAntes}

    CREATE TRIGGER trg_workflow_lead_created AFTER INSERT ON public.leads
      FOR EACH ROW EXECUTE FUNCTION public.trigger_workflow_lead_created();
    CREATE TRIGGER trg_enqueue_lead_webhooks AFTER INSERT OR UPDATE ON public.leads
      FOR EACH ROW EXECUTE FUNCTION public.enqueue_lead_webhooks();
  `;
}

export async function setup() {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  // Em prod o service_role tem BYPASSRLS; sem isso a RLS esconderia as linhas do worker.
  await db.exec(`ALTER ROLE service_role BYPASSRLS`);
  await db.exec(fixtureDeLeads());
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${TORQUE}', 'TorqueCRM', 'torquecrm'),
      ('${OUTRA}', 'Outra', 'outra');
    INSERT INTO team_members (id, organization_id, user_id, name, role) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin'),
      ('${TM_MEMBRO}', '${TORQUE}', '${U_MEMBRO}', 'Membro', 'member'),
      ('${TM_LIBERADO}', '${TORQUE}', '${U_LIBERADO}', 'Operadora', 'member'),
      ('${TM_OUTRA}', '${OUTRA}', '${U_OUTRA}', 'Admin Outra', 'admin');
    INSERT INTO master_users (user_id) VALUES ('${U_MASTER}');
    -- Um webhook ativo na TorqueCRM: lead frio não pode virar evento de saída.
    INSERT INTO webhooks (organization_id, url, events) VALUES ('${TORQUE}', 'https://example.invalid/h', ARRAY['lead.created']);
  `);
  await db.exec(read(MIGRATION));
  await db.exec(read(MIGRATION_CNPJ));
  await db.exec(read(MIGRATION_META));
  await db.exec(`
    INSERT INTO member_feature_permissions (team_member_id, feature_key, enabled) VALUES
      ('${TM_LIBERADO}', 'lista_fria.view', true),
      ('${TM_LIBERADO}', 'lista_fria.edit', true);
  `);
  return db;
}

export async function as(db, uid) {
  await db.exec(`RESET ROLE; SET test.uid = '${uid}'; SET test.role = 'authenticated'; SET ROLE authenticated;`);
}
export async function asWorker(db) {
  await db.exec(`RESET ROLE; SET test.uid = ''; SET test.role = 'service_role'; SET ROLE service_role;`);
}
export async function asPostgres(db) {
  await db.exec(`RESET ROLE; SET test.uid = ''; SET test.role = 'service_role';`);
}
export const one = async (db, sql) => (await db.query(sql)).rows[0];
export const val = async (db, sql) => Object.values(await one(db, sql))[0];
export const json = (o) => JSON.stringify(o).replace(/'/g, "''");

export const maps = { nicho: 'Dentistas', cidade: 'São Paulo - SP' };
export const criarBusca = (db, fonte, params, creditos, org = TORQUE) =>
  val(db, `SELECT lista_fria_busca_criar('${org}', '${fonte}', '${json(params)}'::jsonb, ${creditos})`);
export const item = (ref, extra = {}) => ({ ref_externa: ref, nome: `Negócio ${ref}`, ...extra });
export const registrar = (db, busca, worker, itens) =>
  val(db, `SELECT lista_fria_worker_registrar('${busca}', '${worker}', '${json(itens)}'::jsonb)`);

/** Concede crédito pelo master. `tipo`: 'normal' (Maps, CNPJ) ou 'meta' (Instagram). */
export async function comSaldo(db, qtd, tipo = 'normal') {
  await as(db, U_MASTER);
  await db.query(`SELECT lista_fria_creditos_conceder('${TORQUE}', ${qtd}, 'teste', '${tipo}')`);
}

