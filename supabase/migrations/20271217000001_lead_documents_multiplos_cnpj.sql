-- Um lead pode ter VÁRIOS CNPJ (um principal + extras com rótulo).
-- Evolui `lead_documents` (20271110000000, Chamado 93027ffb) de 1:1 para 1:N.
-- Molde: `lead_phones` (20271112000000, ADR-0039).
--
-- ── DECISÕES DO CTO (fixas) ──────────────────────────────────────────────
-- (a) O MESMO documento continua proibido em 2 leads da mesma org: UNIQUE
--     (organization_id, document), agora PARCIAL entre os ativos (soft delete
--     libera o número).
-- (b) CPF múltiplo NÃO entra. Um lead tem 1 CPF OU vários CNPJ. A regra mora no
--     banco (`tg_lead_documents_regras`, PT422 `cpf_exclusivo`): lead com CPF
--     não aceita nenhum outro documento e lead com CNPJ não aceita CPF.
-- (c) Write-back ao Toth leva só o documento PRINCIPAL. O CHECK
--     `lead_documents_writeback_so_no_principal` garante que extra nunca
--     fica 'pendente'. Extras vivem só no CRM e NUNCA entram em casamento do
--     Toth (cliente/pedido/cobrança): `upsell_clients.cnpj` segue a ÚNICA chave.
--     Decisão herdada do Chamado 93027ffb.
-- (d) NENHUMA coluna em `leads` (21 triggers por UPDATE) e NENHUM UPDATE em
--     massa em `leads`: o backfill escreve só em `lead_documents`.
--
-- ── MODELO ───────────────────────────────────────────────────────────────
-- `is_primary` (unique parcial: no máximo 1 principal ativo por lead).
-- O principal só existe se foi ESCOLHIDO: flag `is_primary` na lista, ou
-- `set_lead_document` com um documento; ou se é CPF (CPF sozinho é sempre o
-- principal). NADA é promovido automaticamente: apagar o principal não elege
-- outro, e salvar uma lista sem flag não elege o primeiro. Motivo: o write-back
-- ao Toth leva o principal, e um CNPJ que ninguém elegeu não pode virar
-- 'pendente' (decisão c).
-- Sem linha principal, o principal EFETIVO é o do ERP (`upsell_clients.cnpj`),
-- ou NENHUM. O lead pode ter extras e nenhum principal.
--
-- ── LEITURA (RLS) ────────────────────────────────────────────────────────
-- As policies de SELECT da 20271110000000 deixavam qualquer membro da org ler
-- todos os CNPJ, rótulos, apagados e a trilha, ignorando a visibilidade do
-- lead (e a busca por CNPJ virava oráculo CNPJ -> lead_id). Aqui elas são
-- recriadas: master vê tudo; os demais veem só o que pertence a lead que a RLS
-- de `leads` deixa ver (molde `lead_owners_select`); linhas apagadas (soft
-- delete) só para admin da org (`is_org_admin`, que já inclui master). As RPCs
-- são DEFINER e não passam por estas policies.
--
-- ── RETENÇÃO / ROLLBACK ──────────────────────────────────────────────────
-- Documento apagado (soft delete) FICA na tabela, com o CNPJ em claro, sem
-- prazo: é dado pessoal retido. Recomendação (NÃO implementada aqui): expurgo
-- futuro que apague de vez `lead_documents` com `deleted_at` antigo.
-- O rollback é DESTRUTIVO: apaga extras, apagados, rótulos e os eventos novos.
-- Depois que a feature teve uso, ele NÃO é reversível sem perda.
--
-- ── ESCRITA ──────────────────────────────────────────────────────────────
-- Só por RPC SECURITY DEFINER: `salvar_documentos_do_lead` (lista completa,
-- como `salvar_telefones_do_lead`) e `set_lead_document` (wrapper compatível
-- que define o principal). Sem policy de escrita; sem GRANT de escrita a
-- authenticated/anon/PUBLIC. A trilha continua append-only.
--
-- Migração idempotente: a evolução da tabela é guardada pela existência da
-- coluna `id`; índices/constraints usam IF NOT EXISTS / checagem de catálogo.
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. lead_documents: 1:1 -> 1:N
-- ─────────────────────────────────────────────────────────────────────────
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'lead_documents' AND column_name = 'id'
  ) THEN
    ALTER TABLE public.lead_documents
      ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
      ADD COLUMN label text NULL,
      -- DEFAULT true só para o backfill: cada linha atual vira a principal.
      ADD COLUMN is_primary boolean NOT NULL DEFAULT true,
      ADD COLUMN deleted_at timestamptz NULL,
      ADD COLUMN deleted_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;
    ALTER TABLE public.lead_documents ALTER COLUMN is_primary SET DEFAULT false;

    ALTER TABLE public.lead_documents DROP CONSTRAINT lead_documents_pkey;
    ALTER TABLE public.lead_documents ADD CONSTRAINT lead_documents_pkey PRIMARY KEY (id);

    -- Substituída pelo índice único parcial (só ativos).
    ALTER TABLE public.lead_documents DROP CONSTRAINT lead_documents_org_document_key;

    ALTER TABLE public.lead_documents DROP CONSTRAINT lead_documents_source_check;
    ALTER TABLE public.lead_documents ADD CONSTRAINT lead_documents_source_check
      CHECK (source IN ('manual', 'erp', 'import'));
  END IF;
END
$mig$;

COMMENT ON TABLE public.lead_documents IS
  'CPF/CNPJ do lead editados no Torque: 1 CPF OU vários CNPJ, um principal opcional (sem principal vale o do ERP). '
  'Nunca entra em casamento com o ERP: upsell_clients.cnpj segue espelho do Toth e única chave. '
  'Write-back ao Toth só do principal. Escrita só por salvar_documentos_do_lead / set_lead_document. Chamado 93027ffb.';
COMMENT ON COLUMN public.lead_documents.is_primary IS
  'No máximo um por lead entre os ativos. É o único documento que o write-back ao Toth pode enviar.';
COMMENT ON COLUMN public.lead_documents.label IS
  'Rótulo livre do CNPJ ("Filial Sul"). NULL = sem rótulo.';

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_documents_label_check'
                  AND conrelid = 'public.lead_documents'::regclass) THEN
    ALTER TABLE public.lead_documents ADD CONSTRAINT lead_documents_label_check
      CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_documents_primary_ativo'
                  AND conrelid = 'public.lead_documents'::regclass) THEN
    -- Documento apagado não pode continuar principal.
    ALTER TABLE public.lead_documents ADD CONSTRAINT lead_documents_primary_ativo
      CHECK (NOT (is_primary AND deleted_at IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_documents_writeback_so_no_principal'
                  AND conrelid = 'public.lead_documents'::regclass) THEN
    -- Decisão (c): extra nunca entra na fila de write-back.
    ALTER TABLE public.lead_documents ADD CONSTRAINT lead_documents_writeback_so_no_principal
      CHECK (is_primary OR erp_writeback_status = 'nao_aplicavel');
  END IF;
END
$mig$;

-- (a) o mesmo documento em 2 leads da org: proibido, entre os ativos.
CREATE UNIQUE INDEX IF NOT EXISTS lead_documents_org_document_uq
  ON public.lead_documents (organization_id, document)
  WHERE deleted_at IS NULL;
-- No máximo um principal por lead.
CREATE UNIQUE INDEX IF NOT EXISTS lead_documents_lead_principal_uq
  ON public.lead_documents (lead_id)
  WHERE is_primary AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lead_documents_lead_ativos_idx
  ON public.lead_documents (lead_id)
  WHERE deleted_at IS NULL;

-- Fila do futuro worker de write-back: só o principal ativo.
DROP INDEX IF EXISTS public.lead_documents_writeback_pending_idx;
CREATE INDEX lead_documents_writeback_pending_idx
  ON public.lead_documents (organization_id)
  WHERE erp_writeback_status = 'pendente' AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Regras que a tabela garante sozinha (vale também para service_role):
--    org vem do LEAD; CPF não convive com outro documento; teto por lead.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_lead_documents_regras()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  SELECT l.organization_id INTO v_org FROM public.leads l WHERE l.id = NEW.lead_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.organization_id <> v_org THEN
    RAISE EXCEPTION 'lead_documents_org_mismatch' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- (b) 1 CPF OU vários CNPJ.
  IF length(NEW.document) = 11 THEN
    IF EXISTS (SELECT 1 FROM public.lead_documents d
                WHERE d.lead_id = NEW.lead_id AND d.deleted_at IS NULL AND d.id <> NEW.id) THEN
      RAISE EXCEPTION 'Um lead com CPF não aceita outros documentos.'
        USING ERRCODE = 'PT422', DETAIL = 'cpf_exclusivo';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.lead_documents d
                 WHERE d.lead_id = NEW.lead_id AND d.deleted_at IS NULL AND d.id <> NEW.id
                   AND length(d.document) = 11) THEN
    RAISE EXCEPTION 'Um lead com CPF não aceita outros documentos.'
      USING ERRCODE = 'PT422', DETAIL = 'cpf_exclusivo';
  END IF;

  IF TG_OP = 'INSERT' AND (
       SELECT count(*) FROM public.lead_documents d
        WHERE d.lead_id = NEW.lead_id AND d.deleted_at IS NULL) >= 50 THEN
    RAISE EXCEPTION 'Limite de 50 documentos por lead.'
      USING ERRCODE = 'PT422', DETAIL = 'limite_de_documentos';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tg_lead_documents_regras() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS lead_documents_regras ON public.lead_documents;
CREATE TRIGGER lead_documents_regras
  BEFORE INSERT OR UPDATE OF document, lead_id, organization_id, deleted_at ON public.lead_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_lead_documents_regras();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Trilha: document_id e ações add/remove/set_primary (append-only mantido).
--    Sem FK em document_id: um FK com ON DELETE SET NULL faria UPDATE na
--    trilha, que o trigger recusa. A trilha sai em cascata com o lead.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.lead_document_events ADD COLUMN IF NOT EXISTS document_id uuid NULL;

ALTER TABLE public.lead_document_events DROP CONSTRAINT IF EXISTS lead_document_events_action_check;
ALTER TABLE public.lead_document_events ADD CONSTRAINT lead_document_events_action_check
  CHECK (action IN ('set', 'clear', 'add', 'remove', 'set_primary'));

COMMENT ON COLUMN public.lead_document_events.document_id IS
  'lead_documents.id do documento afetado. Sem FK de propósito (trilha append-only).';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS e GRANTs.
--    GRANTs: nada muda (SELECT a authenticated; sem escrita pelo cliente).
--    Policies de SELECT: recriadas. Antes bastava ser da org; agora o lead tem
--    de ser visível a quem pergunta (a RLS de `leads` vale na subquery; `leads`
--    não referencia estas tabelas, então não há recursão), e documento apagado
--    só o admin da org (ou master) enxerga. Molde: lead_owners_select.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.lead_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_documents TO service_role;

DROP POLICY IF EXISTS lead_documents_select_org ON public.lead_documents;
DROP POLICY IF EXISTS lead_documents_select ON public.lead_documents;
CREATE POLICY lead_documents_select
  ON public.lead_documents FOR SELECT TO authenticated
  USING (
    (SELECT public.is_master_user())
    OR (
      EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_documents.lead_id)
      AND (deleted_at IS NULL OR public.is_org_admin(organization_id))
    )
  );

DROP POLICY IF EXISTS lead_document_events_select_org ON public.lead_document_events;
DROP POLICY IF EXISTS lead_document_events_select ON public.lead_document_events;
CREATE POLICY lead_document_events_select
  ON public.lead_document_events FOR SELECT TO authenticated
  USING (
    (SELECT public.is_master_user())
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_document_events.lead_id)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Helpers internos (DEFINER; nenhum chamador do cliente executa direto)
-- ─────────────────────────────────────────────────────────────────────────

-- Preâmbulo comum às duas RPCs: sessão, lead/org, can_update_lead,
-- leads.edit_document, serialização por lead e o documento do ERP.
-- Erros PT404 / 42501 idênticos aos de 20271110000000.
CREATE OR REPLACE FUNCTION public.fn_lead_documents_preflight(
  p_lead_id uuid,
  OUT o_org uuid,
  OUT o_uid uuid,
  OUT o_tm uuid,
  OUT o_origin text,
  OUT o_erp text,
  OUT o_has_erp boolean
)
RETURNS record
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_master boolean;
BEGIN
  o_uid := auth.uid();
  IF o_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada. Entre de novo para alterar o documento.'
      USING ERRCODE = '42501', DETAIL = 'sem_sessao';
  END IF;

  SELECT l.organization_id INTO o_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  v_master := COALESCE(public.is_master_user(), false);

  IF o_org IS NULL
     OR (NOT v_master AND o_org NOT IN (SELECT public.get_my_organization_ids())) THEN
    RAISE EXCEPTION 'Lead não encontrado.'
      USING ERRCODE = 'PT404', DETAIL = 'lead_nao_encontrado';
  END IF;

  IF NOT v_master AND NOT public.can_update_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Você não pode editar este lead.'
      USING ERRCODE = '42501', DETAIL = 'sem_permissao_lead';
  END IF;
  IF NOT public.has_feature_permission('leads.edit_document', o_org) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o documento.'
      USING ERRCODE = '42501', DETAIL = 'sem_permissao_documento';
  END IF;

  -- Serializa edições do MESMO lead; leads diferentes seguem em paralelo.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead_document:' || p_lead_id::text, 0));

  -- Documento do ERP deste lead (11/14 dígitos) e se há cliente do ERP.
  SELECT regexp_replace(COALESCE(uc.cnpj, ''), '\D', '', 'g') INTO o_erp
    FROM public.upsell_clients uc
   WHERE uc.organization_id = o_org
     AND uc.lead_id = p_lead_id
     AND uc.external_source IS NOT NULL
   ORDER BY (uc.cnpj IS NULL), uc.updated_at DESC NULLS LAST
   LIMIT 1;
  o_has_erp := FOUND;
  IF o_erp IS NOT NULL AND o_erp !~ '^([0-9]{11}|[0-9]{14})$' THEN
    o_erp := NULL;
  END IF;

  o_tm := (
    SELECT tm.id FROM public.team_members tm
     WHERE tm.user_id = o_uid AND tm.organization_id = o_org AND tm.is_active
     ORDER BY tm.created_at
     LIMIT 1
  );
  o_origin := CASE WHEN v_master AND o_tm IS NULL THEN 'master' ELSE 'lead_card' END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_lead_documents_preflight(uuid) FROM PUBLIC, anon, authenticated;

-- Documento já pertence a OUTRO lead da org (override ativo ou documento do ERP)?
CREATE OR REPLACE FUNCTION public.fn_lead_documents_em_uso(p_org uuid, p_lead_id uuid, p_document text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
           SELECT 1 FROM public.lead_documents d
            WHERE d.organization_id = p_org AND d.document = p_document
              AND d.deleted_at IS NULL AND d.lead_id <> p_lead_id)
      OR EXISTS (
           SELECT 1 FROM public.upsell_clients uc
            WHERE uc.organization_id = p_org AND uc.cnpj = p_document
              AND uc.lead_id IS NOT NULL AND uc.lead_id <> p_lead_id)
$fn$;

REVOKE ALL ON FUNCTION public.fn_lead_documents_em_uso(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_lead_documents_log(
  p_org uuid, p_lead_id uuid, p_document_id uuid, p_action text,
  p_old text, p_new text, p_erp text, p_uid uuid, p_tm uuid, p_origin text
)
RETURNS void
LANGUAGE sql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
  INSERT INTO public.lead_document_events
    (organization_id, lead_id, document_id, action, old_document, new_document, erp_document,
     actor_user_id, actor_team_member_id, origin)
  VALUES
    (p_org, p_lead_id, p_document_id, p_action, p_old, p_new, p_erp, p_uid, p_tm, p_origin)
$fn$;

REVOKE ALL ON FUNCTION public.fn_lead_documents_log(uuid, uuid, uuid, text, text, text, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. salvar_documentos_do_lead — lista COMPLETA (como salvar_telefones_do_lead).
--
--    p_docs: [{ "document": "...", "label": "..."|null, "is_primary": bool }, ...]
--    - o que está na lista e não existe é criado ('add');
--    - o que existe e saiu da lista é apagado (soft delete, 'remove');
--    - troca de principal é 'set_primary';
--    - linha com documento vazio é ignorada (linha em branco da tela);
--    - documento igual ao do ERP do lead não é guardado: marcado principal
--      significa "o principal é o do ERP" (nenhuma linha principal); como extra
--      é redundante e é descartado.
--    Erros (SQLSTATE próprio; o PostgREST devolve PTxyz como HTTP xyz, e o
--    DETAIL identifica o motivo):
--      PT422 documento_invalido | cpf_exclusivo | documento_repetido |
--            principal_duplicado | rotulo_invalido | documentos_invalidos |
--            limite_de_documentos
--      PT409 documento_em_uso   (nunca devolve o outro lead)
--      42501 sem permissão / sem sessão     PT404 lead não encontrado
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.salvar_documentos_do_lead(p_lead_id uuid, p_docs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid; v_uid uuid; v_tm uuid; v_origin text; v_erp text; v_has_erp boolean;
  v_item jsonb;
  v_digits text;
  v_label text;
  v_flag boolean;
  v_seen text[] := '{}';
  v_docs text[] := '{}';
  v_labels text[] := '{}';
  v_primary text;
  v_primary_erp boolean := false;
  v_n_flags int := 0;
  v_cpfs int := 0;
  v_old_primary text;
  v_old_primary_id uuid;
  v_new_primary text;
  v_new_primary_id uuid;
  v_new_pre_existing boolean := false;
  v_status text;
  v_row record;
  v_id uuid;
  v_i int;
  v_changed boolean := false;
  v_c text;
BEGIN
  SELECT p.o_org, p.o_uid, p.o_tm, p.o_origin, p.o_erp, p.o_has_erp
    INTO v_org, v_uid, v_tm, v_origin, v_erp, v_has_erp
    FROM public.fn_lead_documents_preflight(p_lead_id) p;

  -- (1) a lista
  IF p_docs IS NULL OR jsonb_typeof(p_docs) <> 'array' THEN
    RAISE EXCEPTION 'Lista de documentos inválida.'
      USING ERRCODE = 'PT422', DETAIL = 'documentos_invalidos';
  END IF;
  IF jsonb_array_length(p_docs) > 50 THEN
    RAISE EXCEPTION 'Limite de 50 documentos por lead.'
      USING ERRCODE = 'PT422', DETAIL = 'limite_de_documentos';
  END IF;

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_docs) AS e LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Lista de documentos inválida.'
        USING ERRCODE = 'PT422', DETAIL = 'documentos_invalidos';
    END IF;
    IF btrim(COALESCE(v_item ->> 'document', '')) = '' THEN
      CONTINUE; -- linha em branco da tela
    END IF;

    v_digits := regexp_replace(v_item ->> 'document', '\D', '', 'g');
    IF NOT public.is_valid_br_document(v_digits) THEN
      RAISE EXCEPTION 'CPF/CNPJ inválido.'
        USING ERRCODE = 'PT422', DETAIL = 'documento_invalido';
    END IF;

    v_label := NULLIF(btrim(COALESCE(v_item ->> 'label', '')), '');
    IF length(v_label) > 120 THEN
      RAISE EXCEPTION 'Rótulo longo demais (máximo 120 caracteres).'
        USING ERRCODE = 'PT422', DETAIL = 'rotulo_invalido';
    END IF;

    IF v_digits = ANY (v_seen) THEN
      RAISE EXCEPTION 'Documento repetido na lista.'
        USING ERRCODE = 'PT422', DETAIL = 'documento_repetido';
    END IF;
    v_seen := v_seen || v_digits;

    v_flag := COALESCE(lower(v_item ->> 'is_primary') = 'true', false);
    IF v_flag THEN
      v_n_flags := v_n_flags + 1;
      IF v_n_flags > 1 THEN
        RAISE EXCEPTION 'Só pode haver um documento principal.'
          USING ERRCODE = 'PT422', DETAIL = 'principal_duplicado';
      END IF;
    END IF;

    IF v_erp IS NOT NULL AND v_digits = v_erp THEN
      IF v_flag THEN v_primary_erp := true; END IF;
      CONTINUE; -- o documento do ERP não é guardado como override
    END IF;

    IF length(v_digits) = 11 THEN v_cpfs := v_cpfs + 1; END IF;
    v_docs := v_docs || v_digits;
    v_labels := v_labels || COALESCE(v_label, '');
    IF v_flag THEN v_primary := v_digits; END IF;
  END LOOP;

  -- (2) regra do CPF (decisão b): sozinho, e sempre o principal.
  IF v_cpfs > 0 THEN
    IF cardinality(v_docs) > 1 OR v_primary_erp THEN
      RAISE EXCEPTION 'Um lead com CPF não aceita outros documentos.'
        USING ERRCODE = 'PT422', DETAIL = 'cpf_exclusivo';
    END IF;
    v_primary := v_docs[1];
  END IF;

  -- Principal final. NULL = vale o do ERP (ou nenhum). Só o ESCOLHIDO (flag) ou
  -- o CPF sozinho é principal; nunca se promove "o primeiro da lista".
  IF v_primary IS NOT NULL THEN
    v_new_primary := v_primary;
  ELSIF v_primary_erp THEN
    v_new_primary := NULL;
  ELSE
    -- Sem flag e sem CPF: nenhum principal. Nada é promovido sozinho.
    v_new_primary := NULL;
  END IF;

  -- ERP com CPF: o principal efetivo é um CPF e CPF não aceita extras.
  IF v_new_primary IS NULL AND v_erp IS NOT NULL AND length(v_erp) = 11 AND cardinality(v_docs) > 0 THEN
    RAISE EXCEPTION 'Um lead com CPF não aceita outros documentos.'
      USING ERRCODE = 'PT422', DETAIL = 'cpf_exclusivo';
  END IF;

  -- (3) unicidade na org (decisão a): outro lead (override) ou documento do ERP de outro lead.
  FOR v_i IN 1 .. COALESCE(cardinality(v_docs), 0) LOOP
    IF public.fn_lead_documents_em_uso(v_org, p_lead_id, v_docs[v_i]) THEN
      RAISE EXCEPTION 'Este documento já está em outro cliente da organização.'
        USING ERRCODE = 'PT409', DETAIL = 'documento_em_uso';
    END IF;
  END LOOP;

  v_status := CASE WHEN v_has_erp THEN 'pendente' ELSE 'nao_aplicavel' END;

  SELECT d.id, d.document INTO v_old_primary_id, v_old_primary
    FROM public.lead_documents d
   WHERE d.lead_id = p_lead_id AND d.is_primary AND d.deleted_at IS NULL;

  -- (4) diff
  BEGIN
    -- 4a. saiu da lista -> soft delete
    FOR v_row IN
      SELECT d.id, d.document FROM public.lead_documents d
       WHERE d.lead_id = p_lead_id AND d.deleted_at IS NULL
         AND NOT (d.document = ANY (v_docs))
    LOOP
      UPDATE public.lead_documents
         SET deleted_at = now(), deleted_by = v_uid, is_primary = false,
             erp_writeback_status = 'nao_aplicavel',
             updated_by = v_uid, updated_at = now()
       WHERE id = v_row.id;
      PERFORM public.fn_lead_documents_log(v_org, p_lead_id, v_row.id, 'remove',
                v_row.document, NULL, v_erp, v_uid, v_tm, v_origin);
      v_changed := true;
    END LOOP;

    -- 4b. rebaixa o principal que deixou de ser (antes de promover: unique parcial)
    UPDATE public.lead_documents
       SET is_primary = false, erp_writeback_status = 'nao_aplicavel',
           erp_writeback_attempted_at = NULL, erp_writeback_error = NULL,
           updated_by = v_uid, updated_at = now()
     WHERE lead_id = p_lead_id AND deleted_at IS NULL AND is_primary
       AND document IS DISTINCT FROM v_new_primary;
    IF FOUND THEN v_changed := true; END IF;

    -- 4c. promove um existente
    IF v_new_primary IS NOT NULL THEN
      UPDATE public.lead_documents
         SET is_primary = true, erp_document_at_set = v_erp,
             erp_writeback_status = v_status,
             erp_writeback_attempted_at = NULL, erp_writeback_error = NULL,
             updated_by = v_uid, updated_at = now()
       WHERE lead_id = p_lead_id AND deleted_at IS NULL AND NOT is_primary
         AND document = v_new_primary
       RETURNING id INTO v_new_primary_id;
      IF FOUND THEN
        v_new_pre_existing := true;
        v_changed := true;
      END IF;
    END IF;

    -- 4d. rótulos dos que ficaram
    FOR v_i IN 1 .. COALESCE(cardinality(v_docs), 0) LOOP
      UPDATE public.lead_documents d
         SET label = NULLIF(v_labels[v_i], ''), updated_by = v_uid, updated_at = now()
       WHERE d.lead_id = p_lead_id AND d.deleted_at IS NULL AND d.document = v_docs[v_i]
         AND d.label IS DISTINCT FROM NULLIF(v_labels[v_i], '');
      IF FOUND THEN v_changed := true; END IF;
    END LOOP;

    -- 4e. novos
    FOR v_i IN 1 .. COALESCE(cardinality(v_docs), 0) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.lead_documents d
                      WHERE d.lead_id = p_lead_id AND d.deleted_at IS NULL AND d.document = v_docs[v_i]) THEN
        INSERT INTO public.lead_documents
          (lead_id, organization_id, document, label, is_primary, erp_document_at_set, source,
           erp_writeback_status, updated_by)
        VALUES
          (p_lead_id, v_org, v_docs[v_i], NULLIF(v_labels[v_i], ''),
           v_docs[v_i] IS NOT DISTINCT FROM v_new_primary,
           CASE WHEN v_docs[v_i] IS NOT DISTINCT FROM v_new_primary THEN v_erp END,
           'manual',
           CASE WHEN v_docs[v_i] IS NOT DISTINCT FROM v_new_primary THEN v_status ELSE 'nao_aplicavel' END,
           v_uid)
        RETURNING id INTO v_id;
        IF v_docs[v_i] IS NOT DISTINCT FROM v_new_primary THEN v_new_primary_id := v_id; END IF;
        PERFORM public.fn_lead_documents_log(v_org, p_lead_id, v_id, 'add',
                  NULL, v_docs[v_i], v_erp, v_uid, v_tm, v_origin);
        v_changed := true;
      END IF;
    END LOOP;
  EXCEPTION WHEN unique_violation THEN
    -- Só a corrida com outro lead gravando o MESMO documento é PT409; qualquer
    -- outra unique (ex.: o principal único) sobe com o erro original.
    GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME;
    IF v_c = 'lead_documents_org_document_uq' THEN
      RAISE EXCEPTION 'Este documento já está em outro cliente da organização.'
        USING ERRCODE = 'PT409', DETAIL = 'documento_em_uso';
    END IF;
    RAISE;
  END;

  -- 4f. a troca de principal (uma linha de trilha só)
  IF v_old_primary IS DISTINCT FROM v_new_primary
     AND (v_old_primary = ANY (v_docs) OR v_new_pre_existing) THEN
    PERFORM public.fn_lead_documents_log(v_org, p_lead_id,
              COALESCE(v_new_primary_id, v_old_primary_id), 'set_primary',
              v_old_primary, v_new_primary, v_erp, v_uid, v_tm, v_origin);
  END IF;

  RETURN public.fn_lead_documents_snapshot(p_lead_id, v_erp);
END;
$fn$;

-- Estado atual do lead, no formato que a ficha consome. `document` = o principal
-- ou, sem principal, o do ERP; NULL se não há nenhum dos dois.
CREATE OR REPLACE FUNCTION public.fn_lead_documents_snapshot(p_lead_id uuid, p_erp text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'document', COALESCE((SELECT d.document FROM public.lead_documents d
                           WHERE d.lead_id = p_lead_id AND d.is_primary AND d.deleted_at IS NULL), p_erp),
    'erp_document', p_erp,
    'overridden', EXISTS (SELECT 1 FROM public.lead_documents d
                           WHERE d.lead_id = p_lead_id AND d.is_primary AND d.deleted_at IS NULL),
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id, 'document', d.document, 'label', d.label,
               'is_primary', d.is_primary, 'source', d.source)
             ORDER BY d.is_primary DESC, d.created_at, d.id)
        FROM public.lead_documents d
       WHERE d.lead_id = p_lead_id AND d.deleted_at IS NULL), '[]'::jsonb)
  )
$fn$;

REVOKE ALL ON FUNCTION public.fn_lead_documents_snapshot(uuid, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.salvar_documentos_do_lead(uuid, jsonb) IS
  'Grava a lista completa de CPF/CNPJ do lead (1 CPF OU vários CNPJ, principal opcional). Exige poder editar o lead e leads.edit_document. Nunca toca upsell_clients. Extras nunca vão ao write-back do Toth.';

REVOKE ALL ON FUNCTION public.salvar_documentos_do_lead(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_documentos_do_lead(uuid, jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. set_lead_document — WRAPPER COMPATÍVEL (mesma assinatura, mesmos erros e
--    mesmo formato de retorno de 20271110000000): define o documento PRINCIPAL.
--
--    - vazio, ou igual ao ERP = tira o principal (volta a valer o ERP, ou
--      nenhum). Os extras ficam e NADA é promovido no lugar;
--    - documento que já é extra DESTE lead = promove a principal;
--    - documento novo = substitui o principal (ou cria, se não há).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_lead_document(p_lead_id uuid, p_document text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid; v_uid uuid; v_tm uuid; v_origin text; v_erp text; v_has_erp boolean;
  v_digits text;
  v_old text;
  v_old_id uuid;
  v_old_status text;
  v_status text;
  v_ex_id uuid;
  v_next_id uuid;
  v_c text;
BEGIN
  SELECT p.o_org, p.o_uid, p.o_tm, p.o_origin, p.o_erp, p.o_has_erp
    INTO v_org, v_uid, v_tm, v_origin, v_erp, v_has_erp
    FROM public.fn_lead_documents_preflight(p_lead_id) p;

  -- Só o texto VAZIO é clear: texto sem nenhum dígito ("abc") é documento
  -- inválido, nunca um clear silencioso do override.
  IF btrim(COALESCE(p_document, '')) = '' THEN
    v_digits := '';
  ELSE
    v_digits := regexp_replace(p_document, '\D', '', 'g');
    IF v_digits = '' THEN
      RAISE EXCEPTION 'CPF/CNPJ inválido.'
        USING ERRCODE = 'PT422', DETAIL = 'documento_invalido';
    END IF;
  END IF;

  SELECT d.id, d.document, d.erp_writeback_status INTO v_old_id, v_old, v_old_status
    FROM public.lead_documents d
   WHERE d.lead_id = p_lead_id AND d.is_primary AND d.deleted_at IS NULL;

  v_status := CASE WHEN v_has_erp THEN 'pendente' ELSE 'nao_aplicavel' END;

  -- Clear: vazio, ou igual ao ERP (override redundante não é guardado).
  IF v_digits = '' OR v_digits = v_erp THEN
    IF v_old_id IS NOT NULL THEN
      UPDATE public.lead_documents
         SET deleted_at = now(), deleted_by = v_uid, is_primary = false,
             erp_writeback_status = 'nao_aplicavel', updated_by = v_uid, updated_at = now()
       WHERE id = v_old_id;
      PERFORM public.fn_lead_documents_log(v_org, p_lead_id, v_old_id, 'clear',
                v_old, NULL, v_erp, v_uid, v_tm, v_origin);

    END IF;
    RETURN jsonb_build_object(
      'document', v_erp,
      'erp_document', v_erp,
      'overridden', false,
      'erp_writeback_status', NULL
    );
  END IF;

  IF NOT public.is_valid_br_document(v_digits) THEN
    RAISE EXCEPTION 'CPF/CNPJ inválido.'
      USING ERRCODE = 'PT422', DETAIL = 'documento_invalido';
  END IF;

  IF v_digits IS NOT DISTINCT FROM v_old THEN
    RETURN jsonb_build_object(
      'document', v_old,
      'erp_document', v_erp,
      'overridden', true,
      'erp_writeback_status', v_old_status
    );
  END IF;

  IF public.fn_lead_documents_em_uso(v_org, p_lead_id, v_digits) THEN
    RAISE EXCEPTION 'Este documento já está em outro cliente da organização.'
      USING ERRCODE = 'PT409', DETAIL = 'documento_em_uso';
  END IF;

  SELECT d.id INTO v_ex_id
    FROM public.lead_documents d
   WHERE d.lead_id = p_lead_id AND d.deleted_at IS NULL AND d.document = v_digits AND NOT d.is_primary;

  BEGIN
    IF v_ex_id IS NOT NULL THEN
      -- Já é um extra deste lead: promove.
      IF v_old_id IS NOT NULL THEN
        UPDATE public.lead_documents
           SET is_primary = false, erp_writeback_status = 'nao_aplicavel',
               erp_writeback_attempted_at = NULL, erp_writeback_error = NULL,
               updated_by = v_uid, updated_at = now()
         WHERE id = v_old_id;
      END IF;
      UPDATE public.lead_documents
         SET is_primary = true, erp_document_at_set = v_erp, erp_writeback_status = v_status,
             erp_writeback_attempted_at = NULL, erp_writeback_error = NULL,
             updated_by = v_uid, updated_at = now()
       WHERE id = v_ex_id;
      PERFORM public.fn_lead_documents_log(v_org, p_lead_id, v_ex_id, 'set_primary',
                v_old, v_digits, v_erp, v_uid, v_tm, v_origin);
    ELSIF v_old_id IS NOT NULL THEN
      -- Substitui o principal no lugar. O rótulo era do documento antigo.
      UPDATE public.lead_documents
         SET document = v_digits, label = NULL, erp_document_at_set = v_erp, source = 'manual',
             erp_writeback_status = v_status, erp_writeback_attempted_at = NULL,
             erp_writeback_error = NULL, updated_by = v_uid, updated_at = now()
       WHERE id = v_old_id;
      PERFORM public.fn_lead_documents_log(v_org, p_lead_id, v_old_id, 'set',
                v_old, v_digits, v_erp, v_uid, v_tm, v_origin);
    ELSE
      INSERT INTO public.lead_documents
        (lead_id, organization_id, document, is_primary, erp_document_at_set, source,
         erp_writeback_status, updated_by)
      VALUES
        (p_lead_id, v_org, v_digits, true, v_erp, 'manual', v_status, v_uid)
      RETURNING id INTO v_next_id;
      PERFORM public.fn_lead_documents_log(v_org, p_lead_id, v_next_id, 'set',
                NULL, v_digits, v_erp, v_uid, v_tm, v_origin);
    END IF;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME;
    IF v_c = 'lead_documents_org_document_uq' THEN
      RAISE EXCEPTION 'Este documento já está em outro cliente da organização.'
        USING ERRCODE = 'PT409', DETAIL = 'documento_em_uso';
    END IF;
    RAISE;
  END;

  RETURN jsonb_build_object(
    'document', v_digits,
    'erp_document', v_erp,
    'overridden', true,
    'erp_writeback_status', v_status
  );
END;
$fn$;

COMMENT ON FUNCTION public.set_lead_document(uuid, text) IS
  'Wrapper compatível: define (ou limpa, com vazio) o documento PRINCIPAL do lead. Para vários CNPJ use salvar_documentos_do_lead. Nunca toca upsell_clients. Chamado 93027ffb.';

REVOKE ALL ON FUNCTION public.set_lead_document(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_document(uuid, text) TO authenticated;

COMMIT;
