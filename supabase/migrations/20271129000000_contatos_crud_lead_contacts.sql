-- 20271129000000_contatos_crud_lead_contacts.sql
--
-- Chamado 33c5fd52 (Café Jurerê) · PR6 do plano "telefone N:N" —
-- "Poder editar (CRUD) contatos independente de relação com outra empresa ou lead".
--
-- ── DECISÕES DO CTO (19/10) ──────────────────────────────────────────────
-- (1) Contato é entidade própria e REAPROVEITA `public.contacts` (0 linhas em
--     prod, nenhum uso em src/ nem em edge functions). O vínculo com lead é
--     N:N novo: `lead_contacts(lead_id, contact_id, papel)`. `lead_phones` NÃO
--     é promovida (o sync do ERP Toth depende de erp_phone_id/label_locked).
-- (2) O mesmo número pode estar em mais de um contato/lead. Por isso o índice
--     ÚNICO (organization_id, normalized_phone) de `contacts` vira NÃO único.
--     Tabela vazia em prod (0 linhas): sem risco de lock nem de dado.
-- (3) Roteamento de mensagem por contato é outra frente (PR2). Esta migration
--     não toca resolve_message_lead_id nem índice de `leads`.
--
-- ── MODELO ───────────────────────────────────────────────────────────────
--   contacts        já existe; ganha RLS correta e escrita só por RPC.
--   contact_phones  NOVA — N telefones por contato (label, principal, posição).
--                   contacts.phone/normalized_phone espelham o principal (o
--                   índice e a busca existentes continuam valendo).
--   lead_contacts   NOVA — junção contato × lead, UNIQUE(lead_id, contact_id).
--
-- Exclusão de contato é SOFT (deleted_at/deleted_by, que a tabela já tem): um
-- DELETE físico dispararia ON DELETE SET NULL em leads.contact_id (UPDATE em
-- `leads` = 21 triggers) e CASCADE em deal_contacts. Os vínculos de
-- lead_contacts do contato excluído são apagados (o contato some do lead).
--
-- ── AUDITORIA DA RLS DE `contacts` (prod, 19/10, somente leitura) ────────
-- ACHADOS corrigidos aqui:
--  a) 4 policies (select/insert/update/delete) TO public usavam
--     get_user_organization_id() (singular = PRIMEIRA org): quebra multi-org.
--     Agora: get_my_organization_ids() (plural).
--  b) INSERT/UPDATE/DELETE liberados direto a `authenticated` (qualquer membro
--     escrevia sem RPC, inclusive organization_id arbitrário que bate com a
--     própria org). Agora: REVOKE de escrita; só as RPCs.
--  c) `anon` tinha SELECT/REFERENCES/TRIGGER/MAINTAIN por ACL nominal.
--     Agora: REVOKE ALL de anon.
--  d) `migrate_leads_to_contacts_companies(int)` (DEFINER, NUNCA rodou) estava
--     com EXECUTE para `authenticated`: qualquer logado a rodava, gravando
--     contacts/companies e UPDATE em `leads` em lote. Agora: sem EXECUTE para
--     PUBLIC/anon/authenticated (postgres e service_role mantêm).
-- MANTIDOS: master_select_all_contacts e a policy RESTRICTIVE
--  strict_owner_related_select (existem em prod, fora do repo; agem em
--  source_lead_id, que as RPCs nunca preenchem).
--
-- ── VISIBILIDADE ─────────────────────────────────────────────────────────
-- contacts SELECT: membro da org E não excluído E (contato sem vínculo OU
-- vínculo com lead que o usuário enxerga — a RLS de `leads` decide). Contato
-- SEM vínculo é visível a toda a org (agenda de contatos). Isso vale também
-- nas orgs com visibilidade estrita; é decisão de produto a confirmar.
-- lead_contacts / contact_phones SELECT herdam (EXISTS em leads / contacts),
-- no molde de lead_owners (20271116000000). Sem dependência de `private.*`.
--
-- ── ESCRITA ──────────────────────────────────────────────────────────────
-- Só RPC SECURITY DEFINER (search_path ''): contact_create, contact_update,
-- contact_delete, lead_contact_link, lead_contact_unlink. Org lida do
-- REGISTRO (contato/lead) + assert_org_access; master e service_role passam.
-- Vincular exige can_update_lead no lead (membro comum). Leitura em lote:
-- contact_list (SECURITY INVOKER: a RLS decide o que aparece).
-- Erros: 42501 sem sessão/sem permissão · PT404 não encontrado (inclui org
-- alheia) · PT422 dado inválido.
--
-- ── APLICAÇÃO ────────────────────────────────────────────────────────────
-- A FK para `leads` pega SHARE ROW EXCLUSIVE em `leads` (bloqueia escrita até
-- o COMMIT; a transação é curta). lock_timeout 3s: se não pegar, aborta limpo.
-- Ordem: migration ANTES do merge (o front sobe sozinho no merge).
-- ROLLBACK: supabase/migrations/rollback/20271129000000_contatos_crud_lead_contacts.sql

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Índice de telefone de `contacts`: único -> não único
-- ─────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_contacts_org_phone_unique;

CREATE INDEX IF NOT EXISTS idx_contacts_org_normalized_phone
  ON public.contacts (organization_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_name_not_blank CHECK (length(btrim(name)) > 0);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. contact_phones
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.contact_phones (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id       uuid        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  phone            text        NOT NULL,
  normalized_phone text        NOT NULL,
  label            text,
  is_primary       boolean     NOT NULL DEFAULT false,
  sort_order       integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_phones_contact_phone_key UNIQUE (contact_id, normalized_phone),
  CONSTRAINT contact_phones_label_len CHECK (label IS NULL OR length(label) <= 40)
);

CREATE UNIQUE INDEX contact_phones_one_primary
  ON public.contact_phones (contact_id) WHERE is_primary;
-- Mesmo número em N contatos é permitido: índice de busca, NÃO único.
CREATE INDEX contact_phones_org_phone_idx
  ON public.contact_phones (organization_id, normalized_phone);

COMMENT ON TABLE public.contact_phones IS
  'Telefones do contato (N por contato; o mesmo número pode estar em vários contatos). Escrita só por contact_create/contact_update. Chamado 33c5fd52.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. lead_contacts
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.lead_contacts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id         uuid        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_id      uuid        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  papel           text,
  added_by        uuid,
  added_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_contacts_lead_contact_key UNIQUE (lead_id, contact_id),
  CONSTRAINT lead_contacts_papel_len CHECK (papel IS NULL OR length(papel) <= 60)
);

-- (lead_id, contact_id) já é coberto pela UNIQUE; falta o sentido contato -> lead.
CREATE INDEX lead_contacts_contact_lead_idx ON public.lead_contacts (contact_id, lead_id);
CREATE INDEX lead_contacts_org_idx          ON public.lead_contacts (organization_id);

COMMENT ON TABLE public.lead_contacts IS
  'Vínculo N:N contato × lead (papel livre, ex.: comprador, financeiro). Escrita só por lead_contact_link/unlink e contact_create. Chamado 33c5fd52.';

-- Guarda: a org da linha, a do lead e a do contato são a MESMA.
CREATE FUNCTION public.fn_lead_contacts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_lead_org    uuid;
  v_contact_org uuid;
BEGIN
  SELECT l.organization_id INTO v_lead_org    FROM public.leads    l WHERE l.id = NEW.lead_id;
  SELECT c.organization_id INTO v_contact_org FROM public.contacts c WHERE c.id = NEW.contact_id;

  IF v_lead_org IS DISTINCT FROM NEW.organization_id
     OR v_contact_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'lead_contacts: lead, contato e linha precisam ser da mesma organização'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER trg_lead_contacts_guard
  BEFORE INSERT OR UPDATE ON public.lead_contacts
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_contacts_guard();

CREATE FUNCTION public.fn_contact_phones_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_contact_org uuid;
BEGIN
  SELECT c.organization_id INTO v_contact_org FROM public.contacts c WHERE c.id = NEW.contact_id;
  IF v_contact_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'contact_phones: contato e linha precisam ser da mesma organização'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER trg_contact_phones_guard
  BEFORE INSERT OR UPDATE ON public.contact_phones
  FOR EACH ROW EXECUTE FUNCTION public.fn_contact_phones_guard();

REVOKE ALL ON FUNCTION public.fn_lead_contacts_guard()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_contact_phones_guard() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Grants e RLS
-- ─────────────────────────────────────────────────────────────────────────
-- Default privileges do projeto dão ALL a anon/authenticated/service_role POR
-- NOME; REVOKE FROM PUBLIC sozinho não alcança.
ALTER TABLE public.lead_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_phones ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lead_contacts  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.contact_phones FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.contacts       FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_contacts  TO authenticated;
GRANT SELECT ON public.contact_phones TO authenticated;
GRANT SELECT ON public.contacts       TO authenticated;

-- Existe algum vínculo (de QUALQUER lead)? DEFINER para não depender da RLS
-- da junção; devolve só um booleano e só é usada pela policy de contacts.
CREATE FUNCTION public.contact_has_links(p_contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.lead_contacts lc WHERE lc.contact_id = p_contact_id)
$fn$;

REVOKE ALL ON FUNCTION public.contact_has_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_has_links(uuid) TO authenticated;

-- contacts: as 4 policies TO public (get_user_organization_id() singular)
-- saem; entra SELECT plural para authenticated. master_select_all_contacts e
-- strict_owner_related_select (prod) ficam como estão.
DROP POLICY IF EXISTS contacts_select ON public.contacts;
DROP POLICY IF EXISTS contacts_insert ON public.contacts;
DROP POLICY IF EXISTS contacts_update ON public.contacts;
DROP POLICY IF EXISTS contacts_delete ON public.contacts;

CREATE POLICY contacts_select ON public.contacts
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND deleted_at IS NULL
    AND (
      NOT public.contact_has_links(id)
      OR EXISTS (SELECT 1 FROM public.lead_contacts lc WHERE lc.contact_id = contacts.id)
    )
  );

-- Master: o ramo existente em prod (master_select_all_contacts) cobre; em
-- banco novo não existe, então garante aqui sem duplicar o nome de prod.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'contacts'
                    AND policyname = 'master_select_all_contacts') THEN
    CREATE POLICY master_select_all_contacts ON public.contacts
      FOR SELECT TO authenticated
      USING ((SELECT public.is_master_user()));
  END IF;
END
$do$;

-- Herdam a visibilidade do lead / do contato (a RLS deles decide).
CREATE POLICY lead_contacts_select ON public.lead_contacts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_contacts.lead_id));

CREATE POLICY lead_contacts_select_master ON public.lead_contacts
  FOR SELECT TO authenticated
  USING ((SELECT public.is_master_user()));

CREATE POLICY contact_phones_select ON public.contact_phones
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_phones.contact_id));

CREATE POLICY contact_phones_select_master ON public.contact_phones
  FOR SELECT TO authenticated
  USING ((SELECT public.is_master_user()));

-- Função herdada, nunca executada, perigosa (ver cabeçalho, achado d).
REVOKE ALL ON FUNCTION public.migrate_leads_to_contacts_companies(integer)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Helpers internos (sem EXECUTE para clientes)
-- ─────────────────────────────────────────────────────────────────────────

-- Normaliza e troca TODOS os telefones do contato; espelha o principal em
-- contacts.phone/normalized_phone. Telefone inválido: PT422.
CREATE FUNCTION public.contact_set_phones(p_contact_id uuid, p_org uuid, p_phones jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_el       jsonb;
  v_raw      text;
  v_norm     text;
  v_pos      integer := 0;
  v_primary_norm text;
  v_primary_raw  text;
  v_first_norm   text;
  v_first_raw    text;
BEGIN
  IF p_phones IS NULL THEN
    p_phones := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_phones) <> 'array' THEN
    RAISE EXCEPTION 'Telefones devem ser uma lista.'
      USING ERRCODE = 'PT422', DETAIL = 'telefones_formato';
  END IF;
  IF jsonb_array_length(p_phones) > 10 THEN
    RAISE EXCEPTION 'No máximo 10 telefones por contato.'
      USING ERRCODE = 'PT422', DETAIL = 'telefones_demais';
  END IF;

  DELETE FROM public.contact_phones WHERE contact_id = p_contact_id;

  FOR v_el IN SELECT e FROM jsonb_array_elements(p_phones) AS t(e) LOOP
    v_raw := NULLIF(btrim(v_el ->> 'phone'), '');
    CONTINUE WHEN v_raw IS NULL;

    v_norm := public.normalize_brazilian_phone(v_raw);
    IF v_norm IS NULL OR length(v_norm) < 8 OR length(v_norm) > 15 THEN
      RAISE EXCEPTION 'Telefone inválido: %', v_raw
        USING ERRCODE = 'PT422', DETAIL = 'telefone_invalido';
    END IF;

    -- Repetido no mesmo contato: ignora (UNIQUE contact_id+número).
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.contact_phones p
                           WHERE p.contact_id = p_contact_id AND p.normalized_phone = v_norm);

    v_pos := v_pos + 1;
    INSERT INTO public.contact_phones
      (organization_id, contact_id, phone, normalized_phone, label, is_primary, sort_order)
    VALUES
      (p_org, p_contact_id, v_raw, v_norm, NULLIF(btrim(v_el ->> 'label'), ''), false, v_pos);

    IF v_first_norm IS NULL THEN
      v_first_norm := v_norm;
      v_first_raw  := v_raw;
    END IF;
    IF v_primary_norm IS NULL AND (v_el -> 'is_primary') = 'true'::jsonb THEN
      v_primary_norm := v_norm;
      v_primary_raw  := v_raw;
    END IF;
  END LOOP;

  v_primary_norm := COALESCE(v_primary_norm, v_first_norm);
  v_primary_raw  := COALESCE(v_primary_raw,  v_first_raw);

  IF v_primary_norm IS NOT NULL THEN
    UPDATE public.contact_phones
       SET is_primary = true
     WHERE contact_id = p_contact_id AND normalized_phone = v_primary_norm;
  END IF;

  UPDATE public.contacts
     SET phone = v_primary_raw,
         normalized_phone = v_primary_norm
   WHERE id = p_contact_id;
END
$fn$;

-- Vincula contato a lead (idempotente: reaplica o papel). Autoriza o LEAD.
CREATE FUNCTION public.contact_link_lead_internal(
  p_lead_id uuid, p_contact_id uuid, p_org uuid, p_papel text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_master  boolean := COALESCE(public.is_master_user(), false);
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_lead_org uuid;
BEGIN
  SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  IF v_lead_org IS NULL
     OR v_lead_org IS DISTINCT FROM p_org
     OR (NOT v_master AND NOT v_service
         AND v_lead_org NOT IN (SELECT public.get_my_organization_ids())) THEN
    RAISE EXCEPTION 'Lead não encontrado.'
      USING ERRCODE = 'PT404', DETAIL = 'lead_nao_encontrado';
  END IF;

  IF NOT v_master AND NOT v_service AND NOT public.can_update_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Você não pode alterar este lead.'
      USING ERRCODE = '42501', DETAIL = 'sem_permissao_lead';
  END IF;

  INSERT INTO public.lead_contacts (organization_id, lead_id, contact_id, papel, added_by)
  VALUES (p_org, p_lead_id, p_contact_id, NULLIF(btrim(p_papel), ''), auth.uid())
  ON CONFLICT (lead_id, contact_id) DO UPDATE SET papel = EXCLUDED.papel;
END
$fn$;

REVOKE ALL ON FUNCTION public.contact_set_phones(uuid, uuid, jsonb)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contact_link_lead_internal(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RPCs
-- ─────────────────────────────────────────────────────────────────────────

-- Cria contato SEM exigir lead nem empresa. p_phones: [{phone,label?,is_primary?}].
CREATE FUNCTION public.contact_create(
  p_org       uuid,
  p_name      text,
  p_email     text    DEFAULT NULL,
  p_phones    jsonb   DEFAULT '[]'::jsonb,
  p_job_title text    DEFAULT NULL,
  p_lead_ids  uuid[]  DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_id      uuid;
  v_lead    uuid;
  v_email   text := NULLIF(lower(btrim(p_email)), '');
BEGIN
  IF auth.uid() IS NULL AND NOT v_service THEN
    RAISE EXCEPTION 'Sessão expirada. Entre de novo para salvar o contato.'
      USING ERRCODE = '42501', DETAIL = 'sem_sessao';
  END IF;
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'Organização obrigatória.'
      USING ERRCODE = 'PT422', DETAIL = 'org_obrigatoria';
  END IF;
  PERFORM public.assert_org_access(p_org);

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Informe o nome do contato.'
      USING ERRCODE = 'PT422', DETAIL = 'nome_obrigatorio';
  END IF;
  IF v_email IS NOT NULL AND (position('@' IN v_email) < 2 OR length(v_email) > 254) THEN
    RAISE EXCEPTION 'E-mail inválido.'
      USING ERRCODE = 'PT422', DETAIL = 'email_invalido';
  END IF;

  INSERT INTO public.contacts (organization_id, name, email, job_title, source, created_by)
  VALUES (p_org, btrim(p_name), v_email, NULLIF(btrim(p_job_title), ''), 'manual', auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.contact_set_phones(v_id, p_org, p_phones);

  FOREACH v_lead IN ARRAY COALESCE(p_lead_ids, '{}'::uuid[]) LOOP
    PERFORM public.contact_link_lead_internal(v_lead, v_id, p_org, NULL);
  END LOOP;

  RETURN v_id;
END
$fn$;

-- Edita (substitui) nome, e-mail, cargo e a lista de telefones.
CREATE FUNCTION public.contact_update(
  p_contact_id uuid,
  p_name       text,
  p_email      text   DEFAULT NULL,
  p_phones     jsonb  DEFAULT '[]'::jsonb,
  p_job_title  text   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_master  boolean := COALESCE(public.is_master_user(), false);
  v_org     uuid;
  v_email   text := NULLIF(lower(btrim(p_email)), '');
BEGIN
  IF auth.uid() IS NULL AND NOT v_service THEN
    RAISE EXCEPTION 'Sessão expirada. Entre de novo para salvar o contato.'
      USING ERRCODE = '42501', DETAIL = 'sem_sessao';
  END IF;

  SELECT c.organization_id INTO v_org
    FROM public.contacts c
   WHERE c.id = p_contact_id AND c.deleted_at IS NULL
   FOR NO KEY UPDATE;

  IF v_org IS NULL
     OR (NOT v_master AND NOT v_service
         AND v_org NOT IN (SELECT public.get_my_organization_ids())) THEN
    RAISE EXCEPTION 'Contato não encontrado.'
      USING ERRCODE = 'PT404', DETAIL = 'contato_nao_encontrado';
  END IF;
  PERFORM public.assert_org_access(v_org);

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Informe o nome do contato.'
      USING ERRCODE = 'PT422', DETAIL = 'nome_obrigatorio';
  END IF;
  IF v_email IS NOT NULL AND (position('@' IN v_email) < 2 OR length(v_email) > 254) THEN
    RAISE EXCEPTION 'E-mail inválido.'
      USING ERRCODE = 'PT422', DETAIL = 'email_invalido';
  END IF;

  UPDATE public.contacts
     SET name = btrim(p_name),
         email = v_email,
         job_title = NULLIF(btrim(p_job_title), '')
   WHERE id = p_contact_id;

  PERFORM public.contact_set_phones(p_contact_id, v_org, p_phones);

  RETURN p_contact_id;
END
$fn$;

-- Exclusão SOFT; apaga os vínculos com leads (ver cabeçalho).
CREATE FUNCTION public.contact_delete(p_contact_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_master  boolean := COALESCE(public.is_master_user(), false);
  v_org     uuid;
BEGIN
  IF auth.uid() IS NULL AND NOT v_service THEN
    RAISE EXCEPTION 'Sessão expirada. Entre de novo para excluir o contato.'
      USING ERRCODE = '42501', DETAIL = 'sem_sessao';
  END IF;

  SELECT c.organization_id INTO v_org
    FROM public.contacts c
   WHERE c.id = p_contact_id AND c.deleted_at IS NULL
   FOR NO KEY UPDATE;

  IF v_org IS NULL
     OR (NOT v_master AND NOT v_service
         AND v_org NOT IN (SELECT public.get_my_organization_ids())) THEN
    RAISE EXCEPTION 'Contato não encontrado.'
      USING ERRCODE = 'PT404', DETAIL = 'contato_nao_encontrado';
  END IF;
  PERFORM public.assert_org_access(v_org);

  DELETE FROM public.lead_contacts WHERE contact_id = p_contact_id;

  UPDATE public.contacts
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE id = p_contact_id;

  RETURN p_contact_id;
END
$fn$;

CREATE FUNCTION public.lead_contact_link(
  p_lead_id    uuid,
  p_contact_id uuid,
  p_papel      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_master  boolean := COALESCE(public.is_master_user(), false);
  v_org     uuid;
BEGIN
  IF auth.uid() IS NULL AND NOT v_service THEN
    RAISE EXCEPTION 'Sessão expirada. Entre de novo para vincular o contato.'
      USING ERRCODE = '42501', DETAIL = 'sem_sessao';
  END IF;

  -- Org do REGISTRO (contato); a do lead é conferida no helper.
  SELECT c.organization_id INTO v_org
    FROM public.contacts c
   WHERE c.id = p_contact_id AND c.deleted_at IS NULL
   FOR NO KEY UPDATE;

  IF v_org IS NULL
     OR (NOT v_master AND NOT v_service
         AND v_org NOT IN (SELECT public.get_my_organization_ids())) THEN
    RAISE EXCEPTION 'Contato não encontrado.'
      USING ERRCODE = 'PT404', DETAIL = 'contato_nao_encontrado';
  END IF;
  PERFORM public.assert_org_access(v_org);

  PERFORM public.contact_link_lead_internal(p_lead_id, p_contact_id, v_org, p_papel);
  RETURN p_contact_id;
END
$fn$;

CREATE FUNCTION public.lead_contact_unlink(p_lead_id uuid, p_contact_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_master  boolean := COALESCE(public.is_master_user(), false);
  v_org     uuid;
BEGIN
  IF auth.uid() IS NULL AND NOT v_service THEN
    RAISE EXCEPTION 'Sessão expirada. Entre de novo para desvincular o contato.'
      USING ERRCODE = '42501', DETAIL = 'sem_sessao';
  END IF;

  SELECT lc.organization_id INTO v_org
    FROM public.lead_contacts lc
   WHERE lc.lead_id = p_lead_id AND lc.contact_id = p_contact_id;

  IF v_org IS NULL
     OR (NOT v_master AND NOT v_service
         AND v_org NOT IN (SELECT public.get_my_organization_ids())) THEN
    RAISE EXCEPTION 'Vínculo não encontrado.'
      USING ERRCODE = 'PT404', DETAIL = 'vinculo_nao_encontrado';
  END IF;
  PERFORM public.assert_org_access(v_org);

  IF NOT v_master AND NOT v_service AND NOT public.can_update_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Você não pode alterar este lead.'
      USING ERRCODE = '42501', DETAIL = 'sem_permissao_lead';
  END IF;

  DELETE FROM public.lead_contacts
   WHERE lead_id = p_lead_id AND contact_id = p_contact_id;

  RETURN p_contact_id;
END
$fn$;

-- Lista paginada com busca. SECURITY INVOKER: a RLS decide o que o usuário vê
-- (inclusive os leads listados em cada contato). Página <= 100 (< teto de 1000
-- do PostgREST). Busca: nome, e-mail, cargo e dígitos do telefone.
CREATE FUNCTION public.contact_list(
  p_org    uuid,
  p_search text    DEFAULT NULL,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_q      text    := NULLIF(btrim(p_search), '');
  v_like   text;
  v_digits text;
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_result jsonb;
BEGIN
  IF v_q IS NOT NULL THEN
    v_like   := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := regexp_replace(v_q, '\D', '', 'g');
  END IF;

  WITH base AS (
    SELECT c.*
      FROM public.contacts c
     WHERE c.organization_id = p_org
       AND c.deleted_at IS NULL
       AND (
         v_q IS NULL
         OR c.name      ILIKE v_like ESCAPE '\'
         OR c.email     ILIKE v_like ESCAPE '\'
         OR c.job_title ILIKE v_like ESCAPE '\'
         OR (length(v_digits) >= 3 AND (
               c.normalized_phone LIKE '%' || v_digits || '%'
               OR EXISTS (SELECT 1 FROM public.contact_phones p
                           WHERE p.contact_id = c.id
                             AND p.normalized_phone LIKE '%' || v_digits || '%')))
       )
  ),
  page AS (
    SELECT b.* FROM base b ORDER BY lower(b.name), b.id LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM base),
           'rows', COALESCE((
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', pg.id,
                 'organization_id', pg.organization_id,
                 'name', pg.name,
                 'email', pg.email,
                 'job_title', pg.job_title,
                 'created_at', pg.created_at,
                 'updated_at', pg.updated_at,
                 'phones', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'id', p.id, 'phone', p.phone, 'label', p.label,
                            'is_primary', p.is_primary) ORDER BY p.sort_order)
                     FROM public.contact_phones p WHERE p.contact_id = pg.id), '[]'::jsonb),
                 'leads', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'lead_id', l.id, 'name', l.name, 'papel', lc.papel)
                            ORDER BY l.name, l.id)
                     FROM public.lead_contacts lc
                     JOIN public.leads l ON l.id = lc.lead_id AND l.deleted_at IS NULL
                    WHERE lc.contact_id = pg.id), '[]'::jsonb)
               ) ORDER BY lower(pg.name), pg.id)
             FROM page pg), '[]'::jsonb)
         )
    INTO v_result;

  RETURN v_result;
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. EXECUTE: nunca PUBLIC/anon (default privileges dão anon POR NOME)
-- ─────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.contact_create(uuid, text, text, jsonb, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contact_update(uuid, text, text, jsonb, text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contact_delete(uuid)                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_contact_link(uuid, uuid, text)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_contact_unlink(uuid, uuid)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contact_list(uuid, text, integer, integer)            FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.contact_create(uuid, text, text, jsonb, text, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contact_update(uuid, text, text, jsonb, text)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contact_delete(uuid)                                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_contact_link(uuid, uuid, text)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_contact_unlink(uuid, uuid)                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contact_list(uuid, text, integer, integer)            TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
