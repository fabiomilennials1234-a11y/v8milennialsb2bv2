-- 20271116000000_lead_owners_n_donos.sql
--
-- Chamado 793f4b05 · PR1/5 — N donos por lead (Café Jurerê: Envase + Varejo).
-- Schema + RLS + backfill. COMPORTAMENTO NEUTRO: depois do backfill só existem
-- donos principais, que já eram visíveis pelas colunas; nenhuma leitura do
-- front muda nesta fatia.
--
-- ── GATE POR ORG (decisão do CTO 09/10) ─────────────────────────────────
-- Schema global; DADO e COMPORTAMENTO só em org com a flag
-- organizations.feature_flags ->> 'lead_owners_n_donos' = 'true' (booleano
-- jsonb, como as outras flags; o front lê com useFeatureFlag). Esta migration
-- liga a flag SÓ da Café Jurerê (4922638c-…), com merge `||`, ANTES do
-- backfill. Sem a flag: o trigger em `leads` sai antes de escrever, o
-- backfill não toca a org, as RPCs recusam (PT403, também para master) e a
-- guarda de lead_owners recusa qualquer linha. RLS de `leads`,
-- rls_lead_co_owned e can_update_lead ficam globais: sem linha em
-- lead_owners fora das orgs com flag, o ramo novo é sempre falso.
-- Ligar outra org depois, sem migration nova:
--   UPDATE organizations SET feature_flags = feature_flags || '{"lead_owners_n_donos": true}' WHERE id = '<org>';
--   SELECT public.lead_owners_backfill('<org>');
-- Desligar: tire a flag E apague as linhas da org
--   (DELETE FROM lead_owners WHERE organization_id = '<org>'); senão os
--   co-donos continuam vendo o lead e os principais deixam de sincronizar.
--
-- ── MODELO ───────────────────────────────────────────────────────────────
-- `lead_owners` é tabela de junção ADITIVA. As colunas canônicas de `leads`
-- (pre_sale_responsible_id, sale_responsible_id) continuam sendo o "dono
-- principal por papel"; os 81 consumidores SQL e os ~63 arquivos que leem as
-- colunas seguem corretos sem mudança. Co-donos (role='co') só existem aqui.
--
-- Por que junção e não uuid[] em `leads`: cada mudança no array seria UPDATE
-- em `leads` (24 triggers, webhook HTTP por linha, workflow de campo alterado,
-- auditoria), sem FK nem autoria. A junção não toca `leads` ao adicionar
-- co-dono e tem FK, autoria e índice nos dois sentidos.
--
-- INVARIANTE: toda coluna canônica não nula, com membro da MESMA org do lead,
-- tem uma linha is_primary=true com o mesmo papel; no máximo um principal por
-- papel (índice parcial único). Linhas 'co' nunca são principais (CHECK).
--
-- ── DECISÃO DE IMPLEMENTAÇÃO: UNIQUE (lead_id, team_member_id, role) ─────
-- Não (lead_id, team_member_id): a mesma pessoa é pré-venda E venda em
-- 339 leads só na Café Jurerê. Com uma linha por pessoa, um dos dois papéis
-- ficaria sem principal e a invariante cairia. As funções abaixo garantem que
-- uma pessoa nunca tem linha 'co' e linha principal ao mesmo tempo.
--
-- ── SINCRONIA (trigger AFTER em `leads`, sem HTTP e sem UPDATE em `leads`) ─
-- SEM lista de colunas, com WHEN sobre o valor final: `UPDATE OF col` olha o
-- SET, não o que um BEFORE trigger mudou. O ERP Toth grava `responsible_id` e
-- quem reescreve `sale_responsible_id` é `fn_sync_canonical_assignment`
-- (BEFORE); um `AFTER UPDATE OF sale_responsible_id` perderia exatamente essa
-- troca (3.952 leads da org).
-- Troca de principal: a linha principal anterior sai se veio de
-- canonical/backfill/erp/round_robin; se veio de manual/transfer vira 'co'
-- (decisão 6 do CTO: o ERP troca o principal sem apagar a dona transferida).
--
-- ── ESCRITA ──────────────────────────────────────────────────────────────
-- Só por RPC SECURITY DEFINER: lead_owner_add, lead_owner_remove,
-- lead_owner_transfer. Nenhum GRANT de escrita a authenticated/anon. Master e
-- service_role passam (master escreve em dado de tenant: lição do 82c50502).
--
-- ── RLS ──────────────────────────────────────────────────────────────────
-- lead_owners SELECT herda a visibilidade do lead (EXISTS em `leads`) + master.
-- Em `leads` SELECT e UPDATE entra UM ramo: rls_lead_co_owned (DEFINER, sem
-- recursão entre as duas policies), e o MESMO ramo em can_update_lead (espelho
-- da policy de UPDATE, 93027ffb). O resto das policies é cópia LITERAL de
-- pg_policies de prod (09/10), igual a 20271107150000.
-- rls_lead_co_owned só olha linhas role='co': o principal já é coberto pelas
-- colunas, e assim o WITH CHECK implícito do UPDATE continua recusando quem
-- tenta passar o próprio lead para outra pessoa sem permissão (como hoje).
--
-- ── BACKFILL ─────────────────────────────────────────────────────────────
-- public.lead_owners_backfill(p_org): INSERT ... SELECT ... ON CONFLICT DO
-- NOTHING a partir das colunas canônicas, source='backfill', SÓ em org com a
-- flag (p_org NULL = todas as orgs com a flag). Nunca UPDATE em `leads`.
-- Idempotente. Ignora lead com organization_id NULL e membro de OUTRA org.
-- Prod (09/10), só Café Jurerê: 4.452 linhas (4.087 venda + 365 pré-venda,
-- 4.092 leads).
--
-- ── LOCKS / APLICAÇÃO ────────────────────────────────────────────────────
-- A FK para `leads` pega SHARE ROW EXCLUSIVE em `leads` (bloqueia ESCRITA
-- até o COMMIT, inclusive durante o backfill de ~4,5 mil linhas); ALTER POLICY pega ACCESS
-- EXCLUSIVE (bloqueia leitura) e fica no FIM, para durar o mínimo.
-- lock_timeout 3s: se não pegar o lock, aborta limpo (rode de novo). Aplicar
-- fora do pico (08:00–11:00 BRT). Ordem: migration ANTES de qualquer merge
-- que dependa dela.
--
-- ROLLBACK: supabase/migrations/rollback/20271116000000_lead_owners_n_donos.sql

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Tabela
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.lead_owners (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id         uuid        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  team_member_id  uuid        NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('pre_venda', 'venda', 'co')),
  is_primary      boolean     NOT NULL,
  source          text        NOT NULL
                  CHECK (source IN ('canonical', 'manual', 'transfer', 'backfill', 'erp', 'round_robin')),
  added_by        uuid,
  added_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_owners_primary_iff_role CHECK (is_primary = (role <> 'co')),
  CONSTRAINT lead_owners_lead_member_role_key UNIQUE (lead_id, team_member_id, role)
);

-- No máximo um principal por papel.
CREATE UNIQUE INDEX lead_owners_one_primary_per_role
  ON public.lead_owners (lead_id, role) WHERE is_primary;

COMMENT ON TABLE public.lead_owners IS
  'Donos do lead (N por lead). Principal por papel espelha leads.pre_sale_responsible_id/sale_responsible_id (trigger); role=co são co-donos. Escrita só por lead_owner_add/remove/transfer. Chamado 793f4b05.';
COMMENT ON COLUMN public.lead_owners.source IS
  'Origem da linha. Ao trocar o principal, linhas canonical/backfill/erp/round_robin saem; manual/transfer viram co-dono.';
COMMENT ON COLUMN public.lead_owners.added_by IS
  'auth.uid() de quem gravou (NULL para backend/ERP/backfill).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gate por org
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.lead_owners_enabled(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(
    (SELECT o.feature_flags ->> 'lead_owners_n_donos' = 'true'
       FROM public.organizations o
      WHERE o.id = p_org),
    false)
$fn$;

COMMENT ON FUNCTION public.lead_owners_enabled(uuid) IS
  'true quando a org tem feature_flags.lead_owners_n_donos = true. Gate de dado e comportamento de lead_owners (Chamado 793f4b05, CTO 09/10).';

-- Café Jurerê: liga ANTES do backfill; `||` preserva as outras flags.
UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"lead_owners_n_donos": true}'::jsonb
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Backfill (função reutilizável e idempotente; roda já aqui)
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.lead_owners_backfill(p_org uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  IF p_org IS NOT NULL AND NOT public.lead_owners_enabled(p_org) THEN
    RAISE EXCEPTION 'N donos por lead não está ativo nesta organização.'
      USING ERRCODE = 'PT403', DETAIL = 'lead_owners_desligado';
  END IF;

  INSERT INTO public.lead_owners
    (organization_id, lead_id, team_member_id, role, is_primary, source)
  SELECT l.organization_id, l.id, r.tm, r.role, true, 'backfill'
    FROM public.leads l
    CROSS JOIN LATERAL (VALUES
      ('pre_venda', l.pre_sale_responsible_id),
      ('venda',     l.sale_responsible_id)
    ) AS r(role, tm)
    JOIN public.team_members tm
      ON tm.id = r.tm
     AND tm.organization_id = l.organization_id
   WHERE l.organization_id IS NOT NULL
     AND (p_org IS NULL OR l.organization_id = p_org)
     AND l.organization_id IN (
           SELECT o.id FROM public.organizations o
            WHERE o.feature_flags ->> 'lead_owners_n_donos' = 'true')
     AND r.tm IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END
$fn$;

COMMENT ON FUNCTION public.lead_owners_backfill(uuid) IS
  'Grava o principal por papel a partir das colunas canônicas de leads, só em org com a flag lead_owners_n_donos (p_org NULL = todas com a flag; p_org sem a flag = PT403). Idempotente. Ignora org NULL e membro de outra org. Devolve as linhas gravadas.';

-- Sem argumento = só as orgs com a flag (hoje, só a Café Jurerê, ligada logo
-- acima). Com o id explícito, a migration quebraria num banco sem essa org
-- (CI aplica as migrations do zero).
SELECT public.lead_owners_backfill();

-- Índices de leitura depois do backfill (construção em lote).
CREATE INDEX lead_owners_member_lead_idx ON public.lead_owners (team_member_id, lead_id);
CREATE INDEX lead_owners_org_idx         ON public.lead_owners (organization_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Guarda da linha: org = org do lead, com a flag; membro da MESMA org
--    (mesma regra de fn_assert_member_same_org, que é trigger de `leads` e
--    não serve para esta tabela).
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_lead_owners_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_lead_org uuid;
BEGIN
  SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
   WHERE l.id = NEW.lead_id;

  IF v_lead_org IS NULL OR NEW.organization_id IS DISTINCT FROM v_lead_org THEN
    RAISE EXCEPTION 'access_denied: lead_owners.organization_id difere da org do lead %', NEW.lead_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.lead_owners_enabled(v_lead_org) THEN
    RAISE EXCEPTION 'N donos por lead não está ativo nesta organização.'
      USING ERRCODE = 'PT403', DETAIL = 'lead_owners_desligado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.team_members m
     WHERE m.id = NEW.team_member_id
       AND m.organization_id = v_lead_org
  ) THEN
    RAISE EXCEPTION 'access_denied: team_member_id aponta para team_member % de outra organização', NEW.team_member_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER trg_lead_owners_guard
  BEFORE INSERT OR UPDATE OF organization_id, lead_id, team_member_id ON public.lead_owners
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_owners_guard();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Sincronia do principal (AFTER em `leads`)
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_lead_owners_sync_primary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_role     text;
  v_old      uuid;
  v_new      uuid;
  v_prev_tm  uuid;
  v_prev_src text;
  v_old_pre  uuid;
  v_old_sale uuid;
BEGIN
  -- Lead mudou de org: os donos da org antiga deixam de valer, com ou sem
  -- flag na org nova.
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    DELETE FROM public.lead_owners WHERE lead_id = NEW.id;
  END IF;

  -- 13 leads legados em prod têm organization_id NULL; org sem a flag não
  -- ganha dado (gate do CTO 09/10). Sai ANTES de qualquer escrita.
  IF NEW.organization_id IS NULL OR NOT public.lead_owners_enabled(NEW.organization_id) THEN
    RETURN NULL;
  END IF;

  -- Recomeça pelas colunas (que trg_assert_member_same_org_leads já validou).
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    INSERT INTO public.lead_owners
      (organization_id, lead_id, team_member_id, role, is_primary, source, added_by)
    SELECT NEW.organization_id, NEW.id, r.tm, r.role, true, 'canonical', auth.uid()
      FROM (VALUES ('pre_venda', NEW.pre_sale_responsible_id),
                   ('venda',     NEW.sale_responsible_id)) AS r(role, tm)
      JOIN public.team_members m ON m.id = r.tm AND m.organization_id = NEW.organization_id
    ON CONFLICT DO NOTHING;
    RETURN NULL;
  END IF;

  -- OLD não existe no INSERT: lido só no UPDATE.
  IF TG_OP = 'UPDATE' THEN
    v_old_pre  := OLD.pre_sale_responsible_id;
    v_old_sale := OLD.sale_responsible_id;
  END IF;

  FOR v_role, v_old, v_new IN
    SELECT x.role, x.old_tm, x.new_tm
      FROM (VALUES
        ('pre_venda', v_old_pre,  NEW.pre_sale_responsible_id),
        ('venda',     v_old_sale, NEW.sale_responsible_id)
      ) AS x(role, old_tm, new_tm)
  LOOP
    CONTINUE WHEN v_old IS NOT DISTINCT FROM v_new;

    -- (a) sai o principal atual deste papel (quem quer que seja: robusto a drift)
    v_prev_tm := NULL;
    v_prev_src := NULL;
    DELETE FROM public.lead_owners o
     WHERE o.lead_id = NEW.id AND o.role = v_role AND o.is_primary
    RETURNING o.team_member_id, o.source INTO v_prev_tm, v_prev_src;

    -- (b) principal posto à mão ou por transferência continua como co-dono,
    --     salvo se é o próprio novo principal ou ainda tem outra linha.
    IF v_prev_tm IS NOT NULL
       AND v_prev_src IN ('manual', 'transfer')
       AND v_prev_tm IS DISTINCT FROM v_new
       AND NOT EXISTS (SELECT 1 FROM public.lead_owners o
                        WHERE o.lead_id = NEW.id AND o.team_member_id = v_prev_tm) THEN
      INSERT INTO public.lead_owners
        (organization_id, lead_id, team_member_id, role, is_primary, source, added_by)
      VALUES (NEW.organization_id, NEW.id, v_prev_tm, 'co', false, v_prev_src, auth.uid())
      ON CONFLICT DO NOTHING;
    END IF;

    -- (c) entra o novo principal; se era co-dono, a linha 'co' vira redundante.
    --     Membro de outra org não entra (o trigger de `leads` já recusa isso;
    --     aqui só não quebramos a escrita de um lead legado).
    IF v_new IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.team_members m
          WHERE m.id = v_new AND m.organization_id = NEW.organization_id) THEN
      DELETE FROM public.lead_owners o
       WHERE o.lead_id = NEW.id AND o.team_member_id = v_new AND o.role = 'co';
      INSERT INTO public.lead_owners
        (organization_id, lead_id, team_member_id, role, is_primary, source, added_by)
      VALUES (NEW.organization_id, NEW.id, v_new, v_role, true, 'canonical', auth.uid())
      ON CONFLICT DO NOTHING;
    END IF;

  END LOOP;

  RETURN NULL;
END
$fn$;

COMMENT ON FUNCTION public.fn_lead_owners_sync_primary() IS
  'Mantém o principal por papel de lead_owners igual às colunas canônicas de leads. Preserva co-donos; principal manual/transfer substituído vira co-dono. Chamado 793f4b05.';

-- Sem lista de colunas (ver cabeçalho): o WHEN olha o valor FINAL da linha.
CREATE TRIGGER trg_lead_owners_sync_primary_ins
  AFTER INSERT ON public.leads
  FOR EACH ROW
  WHEN (NEW.pre_sale_responsible_id IS NOT NULL OR NEW.sale_responsible_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_lead_owners_sync_primary();

CREATE TRIGGER trg_lead_owners_sync_primary_upd
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  WHEN (OLD.pre_sale_responsible_id IS DISTINCT FROM NEW.pre_sale_responsible_id
     OR OLD.sale_responsible_id     IS DISTINCT FROM NEW.sale_responsible_id
     OR OLD.organization_id         IS DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION public.fn_lead_owners_sync_primary();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RLS de lead_owners e grants
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.lead_owners ENABLE ROW LEVEL SECURITY;

-- Default privileges do projeto dão ALL a anon/authenticated/service_role POR
-- NOME; REVOKE FROM PUBLIC sozinho não alcança. Escrita só pelas RPCs.
REVOKE ALL ON public.lead_owners FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_owners TO authenticated;

-- Herda a visibilidade do lead (a RLS de `leads` decide, inclusive master).
CREATE POLICY lead_owners_select ON public.lead_owners
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_owners.lead_id));

CREATE POLICY lead_owners_select_master ON public.lead_owners
  FOR SELECT TO authenticated
  USING ((SELECT public.is_master_user()));

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Ramo novo da RLS de `leads`
--    Mesmo molde de rls_lead_in_my_pipes: p_tm_ids INTERSECTADO com os
--    team_members do caller (sem isso a função DEFINER seria um oráculo de
--    "X é co-dono do lead Y?").
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.rls_lead_co_owned(p_lead_id uuid, p_tm_ids uuid[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.lead_owners o
      JOIN public.team_members tm ON tm.id = o.team_member_id
     WHERE o.lead_id = p_lead_id
       AND o.role = 'co'
       AND o.team_member_id = ANY (p_tm_ids)
       AND tm.user_id = auth.uid()
  )
$fn$;

COMMENT ON FUNCTION public.rls_lead_co_owned(uuid, uuid[]) IS
  'RLS helper (leads). Caller é co-dono (lead_owners.role=co) do lead, sobre p_tm_ids ∩ team_members do caller. Chamado 793f4b05.';

REVOKE ALL ON FUNCTION public.rls_lead_co_owned(uuid, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rls_lead_co_owned(uuid, uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. can_update_lead — espelho do USING da policy de UPDATE, com o MESMO
--    ramo novo. O pgTAP lead_documents_test.sql (DR) e lead_owners_test.sql
--    (CO) comparam os dois.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_update_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.leads
     WHERE leads.id = p_lead_id
       AND deleted_at IS NULL
       AND organization_id IN (SELECT public.get_my_organization_ids())
       AND (
         (SELECT public.is_user_admin())
         OR (SELECT public.has_feature_permission('leads.view_all'))
         OR organization_id = ANY ((SELECT public.rls_my_orgs_with_feature('leads.view_all'))::uuid[])
         OR pre_sale_responsible_id = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
         OR sale_responsible_id     = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
         OR sdr_id                  = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
         OR closer_id               = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
         OR (
           sdr_id IS NULL AND closer_id IS NULL
           AND (SELECT public.user_has_org_permission('see_unassigned_cards'))
         )
         OR (
           (SELECT public.user_has_org_permission('see_subordinates_cards'))
           AND (
             sdr_id    = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
             OR closer_id = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
           )
         )
         OR (
           cardinality((SELECT public.rls_my_team_member_ids(false))) > 0
           AND public.rls_lead_co_owned(leads.id, (SELECT public.rls_my_team_member_ids(false))::uuid[])
         )
         OR (
           cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
           AND public.rls_lead_in_my_pipes(leads.id, (SELECT public.rls_my_team_member_ids(true)))
         )
       )
  )
$fn$;

COMMENT ON FUNCTION public.can_update_lead(uuid) IS
  'Espelho literal do USING de leads_update_by_responsibility_and_permissions, para RPCs SECURITY DEFINER. Divergência é pega pelo pgTAP lead_documents_test.sql e lead_owners_test.sql.';

REVOKE ALL ON FUNCTION public.can_update_lead(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9. RPCs — os únicos escritores
--    Erros (o PostgREST devolve PTxyz como HTTP xyz):
--      42501  sem sessão / sem permissão no lead
--      PT404  lead não encontrado (também lead de outra org: não revela)
--      PT422  papel ou membro inválido
--      PT409  tentar remover o dono principal (use a transferência)
--      PT403  org sem a flag lead_owners_n_donos (vale para master também)
-- ─────────────────────────────────────────────────────────────────────────

-- Autoriza e devolve a org DO LEAD. Só as RPCs abaixo chamam.
CREATE FUNCTION public.lead_owner_authorize(p_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org     uuid;
  v_master  boolean := COALESCE(public.is_master_user(), false);
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF auth.uid() IS NULL AND NOT v_service THEN
    RAISE EXCEPTION 'Sessão expirada. Entre de novo para alterar os responsáveis.'
      USING ERRCODE = '42501', DETAIL = 'sem_sessao';
  END IF;

  SELECT l.organization_id INTO v_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  IF v_org IS NULL
     OR (NOT v_master AND NOT v_service
         AND v_org NOT IN (SELECT public.get_my_organization_ids())) THEN
    RAISE EXCEPTION 'Lead não encontrado.'
      USING ERRCODE = 'PT404', DETAIL = 'lead_nao_encontrado';
  END IF;

  -- Plural e multi-org; master e service_role passam.
  PERFORM public.assert_org_access(v_org);

  -- Gate por org: ninguém escreve donos em org sem a flag, nem master.
  -- Depois do 404, para não revelar a flag de org alheia.
  IF NOT public.lead_owners_enabled(v_org) THEN
    RAISE EXCEPTION 'N donos por lead não está ativo nesta organização.'
      USING ERRCODE = 'PT403', DETAIL = 'lead_owners_desligado';
  END IF;

  IF NOT v_master AND NOT v_service AND NOT public.can_update_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Você não pode alterar os responsáveis deste lead.'
      USING ERRCODE = '42501', DETAIL = 'sem_permissao_lead';
  END IF;

  RETURN v_org;
END
$fn$;

-- Membro ativo da org do lead.
CREATE FUNCTION public.lead_owner_assert_member(p_org uuid, p_team_member_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF p_team_member_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.team_members m
     WHERE m.id = p_team_member_id
       AND m.organization_id = p_org
       AND m.is_active
  ) THEN
    RAISE EXCEPTION 'Responsável inválido para este lead.'
      USING ERRCODE = 'PT422', DETAIL = 'membro_invalido';
  END IF;
END
$fn$;

-- Donos atuais, principal primeiro (venda, pré-venda), depois co-donos.
CREATE FUNCTION public.lead_owner_list(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'lead_id', p_lead_id,
    'owners', COALESCE(jsonb_agg(
      jsonb_build_object(
        'team_member_id', o.team_member_id,
        'role', o.role,
        'is_primary', o.is_primary,
        'source', o.source
      )
      ORDER BY o.is_primary DESC,
               CASE o.role WHEN 'venda' THEN 0 WHEN 'pre_venda' THEN 1 ELSE 2 END,
               o.added_at, o.team_member_id
    ), '[]'::jsonb)
  )
  FROM public.lead_owners o
  WHERE o.lead_id = p_lead_id
$fn$;

CREATE FUNCTION public.lead_owner_add(p_lead_id uuid, p_team_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid := public.lead_owner_authorize(p_lead_id);
BEGIN
  -- Redundante com lead_owner_authorize, e de propósito: o gate fica visível
  -- no corpo (detector INV-6 de supabase/tests/_rls_invariants_detectors.sql).
  PERFORM public.assert_org_access(v_org);
  PERFORM public.lead_owner_assert_member(v_org, p_team_member_id);

  -- Serializa com qualquer escrita no mesmo lead (inclusive o trigger de
  -- sincronia, que roda dentro de um UPDATE em `leads`). Não dispara trigger.
  PERFORM 1 FROM public.leads l WHERE l.id = p_lead_id FOR NO KEY UPDATE;

  -- Já é dono (principal ou co): nada a fazer.
  IF NOT EXISTS (SELECT 1 FROM public.lead_owners o
                  WHERE o.lead_id = p_lead_id AND o.team_member_id = p_team_member_id) THEN
    INSERT INTO public.lead_owners
      (organization_id, lead_id, team_member_id, role, is_primary, source, added_by)
    VALUES (v_org, p_lead_id, p_team_member_id, 'co', false, 'manual', auth.uid());
  END IF;

  RETURN public.lead_owner_list(p_lead_id);
END
$fn$;

CREATE FUNCTION public.lead_owner_remove(p_lead_id uuid, p_team_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid := public.lead_owner_authorize(p_lead_id);
BEGIN
  -- Redundante com lead_owner_authorize, e de propósito: o gate fica visível
  -- no corpo (detector INV-6 de supabase/tests/_rls_invariants_detectors.sql).
  PERFORM public.assert_org_access(v_org);
  PERFORM 1 FROM public.leads l WHERE l.id = p_lead_id FOR NO KEY UPDATE;

  IF EXISTS (SELECT 1 FROM public.lead_owners o
              WHERE o.lead_id = p_lead_id
                AND o.team_member_id = p_team_member_id
                AND o.is_primary) THEN
    RAISE EXCEPTION 'Para tirar o responsável principal, transfira o lead para outra pessoa.'
      USING ERRCODE = 'PT409', DETAIL = 'dono_principal';
  END IF;

  -- Idempotente: remover quem não é co-dono não é erro.
  DELETE FROM public.lead_owners o
   WHERE o.lead_id = p_lead_id
     AND o.team_member_id = p_team_member_id
     AND o.role = 'co';

  RETURN public.lead_owner_list(p_lead_id);
END
$fn$;

-- Troca o principal de um papel. p_keep_previous (padrão true, decisão 3 do
-- CTO) mantém o principal anterior como co-dono. O co-dono é gravado ANTES de
-- mudar a coluna: o trigger encontra a linha e só tira a principal.
CREATE FUNCTION public.lead_owner_transfer(
  p_lead_id uuid,
  p_to_member uuid,
  p_role text,
  p_keep_previous boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org  uuid := public.lead_owner_authorize(p_lead_id);
  v_prev uuid;
BEGIN
  -- Redundante com lead_owner_authorize, e de propósito: o gate fica visível
  -- no corpo (detector INV-6 de supabase/tests/_rls_invariants_detectors.sql).
  PERFORM public.assert_org_access(v_org);
  IF p_role IS NULL OR p_role NOT IN ('pre_venda', 'venda') THEN
    RAISE EXCEPTION 'Papel inválido: use pre_venda ou venda.'
      USING ERRCODE = 'PT422', DETAIL = 'papel_invalido';
  END IF;
  PERFORM public.lead_owner_assert_member(v_org, p_to_member);

  SELECT CASE p_role WHEN 'venda' THEN l.sale_responsible_id ELSE l.pre_sale_responsible_id END
    INTO v_prev
    FROM public.leads l
   WHERE l.id = p_lead_id
     FOR NO KEY UPDATE;

  IF v_prev IS NOT DISTINCT FROM p_to_member THEN
    RETURN public.lead_owner_list(p_lead_id);
  END IF;

  IF v_prev IS NOT NULL
     AND COALESCE(p_keep_previous, true)
     AND NOT EXISTS (SELECT 1 FROM public.lead_owners o
                      WHERE o.lead_id = p_lead_id
                        AND o.team_member_id = v_prev
                        AND o.role <> p_role) THEN
    INSERT INTO public.lead_owners
      (organization_id, lead_id, team_member_id, role, is_primary, source, added_by)
    SELECT v_org, p_lead_id, v_prev, 'co', false, 'transfer', auth.uid()
     WHERE EXISTS (SELECT 1 FROM public.team_members m
                    WHERE m.id = v_prev AND m.organization_id = v_org)
    ON CONFLICT DO NOTHING;
  END IF;

  -- fn_sync_canonical_assignment espelha closer_id/sdr_id; o trigger de
  -- lead_owners troca o principal e preserva a linha 'co' gravada acima.
  IF p_role = 'venda' THEN
    UPDATE public.leads SET sale_responsible_id = p_to_member WHERE id = p_lead_id;
  ELSE
    UPDATE public.leads SET pre_sale_responsible_id = p_to_member WHERE id = p_lead_id;
  END IF;

  UPDATE public.lead_owners o
     SET source = 'transfer', added_by = auth.uid()
   WHERE o.lead_id = p_lead_id
     AND o.team_member_id = p_to_member
     AND o.role = p_role
     AND o.is_primary;

  -- Sem manter: o anterior sai por completo, mesmo que o trigger o tenha
  -- rebaixado a co-dono (principal manual/transfer).
  IF v_prev IS NOT NULL AND NOT COALESCE(p_keep_previous, true) THEN
    DELETE FROM public.lead_owners o
     WHERE o.lead_id = p_lead_id
       AND o.team_member_id = v_prev
       AND o.role = 'co';
  END IF;

  RETURN public.lead_owner_list(p_lead_id);
END
$fn$;

COMMENT ON FUNCTION public.lead_owner_add(uuid, uuid) IS
  'Adiciona co-dono (role=co, source=manual) ao lead. Exige poder editar o lead (can_update_lead) ou master/service_role. Idempotente. Chamado 793f4b05.';
COMMENT ON FUNCTION public.lead_owner_remove(uuid, uuid) IS
  'Remove co-dono do lead. Dono principal só sai por lead_owner_transfer (PT409). Idempotente. Chamado 793f4b05.';
COMMENT ON FUNCTION public.lead_owner_transfer(uuid, uuid, text, boolean) IS
  'Troca o dono principal de um papel (pre_venda|venda). p_keep_previous=true (padrão) mantém o anterior como co-dono. Comissão/métricas seguem o principal. Chamado 793f4b05.';

-- Grants: default privileges dão EXECUTE a anon por nome.
REVOKE ALL ON FUNCTION public.lead_owners_enabled(uuid)                      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lead_owners_backfill(uuid)                     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_lead_owners_guard()                         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_lead_owners_sync_primary()                  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lead_owner_authorize(uuid)                     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lead_owner_assert_member(uuid, uuid)           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lead_owner_list(uuid)                          FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lead_owner_add(uuid, uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_owner_remove(uuid, uuid)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_owner_transfer(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_owner_add(uuid, uuid)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_owner_remove(uuid, uuid)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_owner_transfer(uuid, uuid, text, boolean) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Policies de `leads` — por ÚLTIMO (ACCESS EXCLUSIVE dura o mínimo).
--    Cópia literal de pg_policies (prod, 09/10) = 20271107150000, mais o ramo
--    rls_lead_co_owned antes da sonda de pipeline_entries (as duas são as
--    únicas sondas por linha; a de co-dono é uma busca de índice).
--    Tenant sempre por get_my_organization_ids() (plural).
-- ─────────────────────────────────────────────────────────────────────────
ALTER POLICY "leads_select_by_responsibility_and_permissions"
ON public.leads
TO authenticated
USING (
  deleted_at IS NULL
  AND organization_id IN (SELECT public.get_my_organization_ids())
  AND (
    (SELECT public.is_user_admin())
    OR organization_id IN (SELECT public.get_my_gestor_organization_ids())
    OR (SELECT public.has_feature_permission('leads.view_all'))
    OR organization_id = ANY ((SELECT public.rls_my_orgs_with_feature('leads.view_all'))::uuid[])
    OR pre_sale_responsible_id = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR sale_responsible_id     = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR sdr_id                  = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR closer_id               = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR (
      sdr_id IS NULL AND closer_id IS NULL
      AND (SELECT public.user_has_org_permission('see_unassigned_cards'))
    )
    OR (
      (SELECT public.user_has_org_permission('see_subordinates_cards'))
      AND (
        sdr_id    = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
        OR closer_id = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
      )
    )
    OR (
      cardinality((SELECT public.rls_my_team_member_ids(false))) > 0
      AND public.rls_lead_co_owned(id, (SELECT public.rls_my_team_member_ids(false))::uuid[])
    )
    OR (
      cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
      AND public.rls_lead_in_my_pipes(id, (SELECT public.rls_my_team_member_ids(true)))
    )
  )
);

-- WITH CHECK continua NULL (o USING vale para a linha nova), como em prod.
ALTER POLICY "leads_update_by_responsibility_and_permissions"
ON public.leads
TO authenticated
USING (
  deleted_at IS NULL
  AND organization_id IN (SELECT public.get_my_organization_ids())
  AND (
    (SELECT public.is_user_admin())
    OR (SELECT public.has_feature_permission('leads.view_all'))
    OR organization_id = ANY ((SELECT public.rls_my_orgs_with_feature('leads.view_all'))::uuid[])
    OR pre_sale_responsible_id = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR sale_responsible_id     = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR sdr_id                  = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR closer_id               = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR (
      sdr_id IS NULL AND closer_id IS NULL
      AND (SELECT public.user_has_org_permission('see_unassigned_cards'))
    )
    OR (
      (SELECT public.user_has_org_permission('see_subordinates_cards'))
      AND (
        sdr_id    = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
        OR closer_id = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
      )
    )
    OR (
      cardinality((SELECT public.rls_my_team_member_ids(false))) > 0
      AND public.rls_lead_co_owned(id, (SELECT public.rls_my_team_member_ids(false))::uuid[])
    )
    OR (
      cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
      AND public.rls_lead_in_my_pipes(id, (SELECT public.rls_my_team_member_ids(true)))
    )
  )
);

COMMIT;
