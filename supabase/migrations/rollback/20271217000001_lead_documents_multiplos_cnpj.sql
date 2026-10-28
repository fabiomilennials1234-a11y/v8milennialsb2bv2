-- Rollback de 20271217000001_lead_documents_multiplos_cnpj.sql
--
-- Volta `lead_documents` para 1 documento por lead e `set_lead_document` para o
-- corpo de 20271110000000.
--
-- ANTES de rodar: o frontend precisa estar numa versão que não chame
-- `salvar_documentos_do_lead` nem leia `lead_documents.id/label/is_primary`.
--
-- ⚠️ DESTRUTIVO E NÃO REVERSÍVEL SEM PERDA depois que a feature teve uso: apaga
-- os extras, os documentos apagados (soft delete), os rótulos e os eventos
-- add/remove/set_primary. Voltar a migrar para frente não os recupera.
-- (Documentos apagados retêm PII sem prazo; a recomendação é um expurgo futuro,
-- não implementado — este rollback não substitui esse expurgo.)
--
-- PERDE DADO: todo CNPJ extra (não principal), todo documento apagado (soft
-- delete) e os rótulos. Por lead fica UM documento: o principal ativo; lead
-- sem principal ativo (principal efetivo = ERP) perde os extras inteiros.
-- Os eventos add/remove/set_primary são apagados (a trilha antiga só conhece
-- set/clear). Exporte `lead_documents` e `lead_document_events` antes.
-- `upsell_clients.cnpj` não é tocado.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- Policies: volta às de 20271110000000 (qualquer membro da org lê).
DROP POLICY IF EXISTS lead_documents_select ON public.lead_documents;
DROP POLICY IF EXISTS lead_document_events_select ON public.lead_document_events;
CREATE POLICY lead_documents_select_org
  ON public.lead_documents FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );
CREATE POLICY lead_document_events_select_org
  ON public.lead_document_events FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

DROP FUNCTION IF EXISTS public.salvar_documentos_do_lead(uuid, jsonb);
DROP FUNCTION IF EXISTS public.fn_lead_documents_snapshot(uuid, text);
DROP FUNCTION IF EXISTS public.fn_lead_documents_log(uuid, uuid, uuid, text, text, text, text, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.fn_lead_documents_em_uso(uuid, uuid, text);

-- Só o principal ativo sobrevive.
DELETE FROM public.lead_documents WHERE deleted_at IS NOT NULL OR NOT is_primary;

DROP TRIGGER IF EXISTS lead_documents_regras ON public.lead_documents;
DROP FUNCTION IF EXISTS public.tg_lead_documents_regras();

DROP INDEX IF EXISTS public.lead_documents_org_document_uq;
DROP INDEX IF EXISTS public.lead_documents_lead_principal_uq;
DROP INDEX IF EXISTS public.lead_documents_lead_ativos_idx;
DROP INDEX IF EXISTS public.lead_documents_writeback_pending_idx;

ALTER TABLE public.lead_documents DROP CONSTRAINT IF EXISTS lead_documents_label_check;
ALTER TABLE public.lead_documents DROP CONSTRAINT IF EXISTS lead_documents_primary_ativo;
ALTER TABLE public.lead_documents DROP CONSTRAINT IF EXISTS lead_documents_writeback_so_no_principal;
ALTER TABLE public.lead_documents DROP CONSTRAINT IF EXISTS lead_documents_source_check;
DELETE FROM public.lead_documents WHERE source <> 'manual';
ALTER TABLE public.lead_documents ADD CONSTRAINT lead_documents_source_check CHECK (source IN ('manual'));

ALTER TABLE public.lead_documents DROP CONSTRAINT IF EXISTS lead_documents_pkey;
ALTER TABLE public.lead_documents
  DROP COLUMN IF EXISTS id,
  DROP COLUMN IF EXISTS label,
  DROP COLUMN IF EXISTS is_primary,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE public.lead_documents ADD CONSTRAINT lead_documents_pkey PRIMARY KEY (lead_id);
ALTER TABLE public.lead_documents ADD CONSTRAINT lead_documents_org_document_key UNIQUE (organization_id, document);
CREATE INDEX lead_documents_writeback_pending_idx
  ON public.lead_documents (organization_id)
  WHERE erp_writeback_status = 'pendente';

-- Trilha: a tabela é append-only por trigger de UPDATE; DELETE é permitido ao dono.
DELETE FROM public.lead_document_events WHERE action NOT IN ('set', 'clear');
ALTER TABLE public.lead_document_events DROP CONSTRAINT IF EXISTS lead_document_events_action_check;
ALTER TABLE public.lead_document_events ADD CONSTRAINT lead_document_events_action_check
  CHECK (action IN ('set', 'clear'));
ALTER TABLE public.lead_document_events DROP COLUMN IF EXISTS document_id;

-- set_lead_document: corpo original (20271110000000).
CREATE OR REPLACE FUNCTION public.set_lead_document(p_lead_id uuid, p_document text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_master  boolean;
  v_digits  text;
  v_erp     text;
  v_has_erp boolean := false;
  v_old     text;
  v_status  text;
  v_tm      uuid;
  v_origin  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada. Entre de novo para alterar o documento.'
      USING ERRCODE = '42501', DETAIL = 'sem_sessao';
  END IF;

  -- (1) o lead e a org DELE; o caller precisa estar nela (plural) ou ser master.
  SELECT l.organization_id INTO v_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  v_master := COALESCE(public.is_master_user(), false);

  IF v_org IS NULL
     OR (NOT v_master AND v_org NOT IN (SELECT public.get_my_organization_ids())) THEN
    RAISE EXCEPTION 'Lead não encontrado.'
      USING ERRCODE = 'PT404', DETAIL = 'lead_nao_encontrado';
  END IF;

  -- (2) editar o lead (mesma regra da policy de UPDATE) E a permissão nova.
  IF NOT v_master AND NOT public.can_update_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Você não pode editar este lead.'
      USING ERRCODE = '42501', DETAIL = 'sem_permissao_lead';
  END IF;
  IF NOT public.has_feature_permission('leads.edit_document', v_org) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o documento.'
      USING ERRCODE = '42501', DETAIL = 'sem_permissao_documento';
  END IF;

  -- Serializa edições do MESMO lead; leads diferentes seguem em paralelo.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead_document:' || p_lead_id::text, 0));

  -- (3) normaliza. Só o texto VAZIO é clear: texto sem nenhum dígito ("abc")
  -- é documento inválido, nunca um clear silencioso do override.
  IF btrim(COALESCE(p_document, '')) = '' THEN
    v_digits := '';
  ELSE
    v_digits := regexp_replace(p_document, '\D', '', 'g');
    IF v_digits = '' THEN
      RAISE EXCEPTION 'CPF/CNPJ inválido.'
        USING ERRCODE = 'PT422', DETAIL = 'documento_invalido';
    END IF;
  END IF;

  -- (5) o documento do ERP para este lead. Lido antes da validação: digitar
  -- exatamente o que o ERP tem é "voltar ao ERP" (clear), mesmo quando o ERP
  -- guarda um documento com DV inválido.
  SELECT uc.cnpj INTO v_erp
    FROM public.upsell_clients uc
   WHERE uc.organization_id = v_org
     AND uc.lead_id = p_lead_id
     AND uc.external_source IS NOT NULL
   ORDER BY (uc.cnpj IS NULL), uc.updated_at DESC NULLS LAST
   LIMIT 1;
  v_has_erp := FOUND;

  SELECT d.document INTO v_old
    FROM public.lead_documents d
   WHERE d.lead_id = p_lead_id;

  v_tm := (
    SELECT tm.id FROM public.team_members tm
     WHERE tm.user_id = v_uid AND tm.organization_id = v_org AND tm.is_active
     ORDER BY tm.created_at
     LIMIT 1
  );
  v_origin := CASE WHEN v_master AND v_tm IS NULL THEN 'master' ELSE 'lead_card' END;

  -- Clear: vazio, ou igual ao ERP (override redundante não é guardado).
  IF v_digits = '' OR v_digits = v_erp THEN
    IF v_old IS NOT NULL THEN
      DELETE FROM public.lead_documents WHERE lead_id = p_lead_id;
      INSERT INTO public.lead_document_events
        (organization_id, lead_id, action, old_document, new_document, erp_document,
         actor_user_id, actor_team_member_id, origin)
      VALUES
        (v_org, p_lead_id, 'clear', v_old, NULL, v_erp, v_uid, v_tm, v_origin);
    END IF;
    RETURN jsonb_build_object(
      'document', v_erp,
      'erp_document', v_erp,
      'overridden', false,
      'erp_writeback_status', NULL
    );
  END IF;

  -- (4) valida.
  IF NOT public.is_valid_br_document(v_digits) THEN
    RAISE EXCEPTION 'CPF/CNPJ inválido.'
      USING ERRCODE = 'PT422', DETAIL = 'documento_invalido';
  END IF;

  v_status := CASE WHEN v_has_erp THEN 'pendente' ELSE 'nao_aplicavel' END;

  IF v_digits IS NOT DISTINCT FROM v_old THEN
    RETURN jsonb_build_object(
      'document', v_old,
      'erp_document', v_erp,
      'overridden', true,
      'erp_writeback_status', (SELECT d.erp_writeback_status FROM public.lead_documents d WHERE d.lead_id = p_lead_id)
    );
  END IF;

  -- (6) unicidade na org: override de outro lead OU documento do ERP de outro lead.
  IF EXISTS (
       SELECT 1 FROM public.lead_documents d
        WHERE d.organization_id = v_org AND d.document = v_digits AND d.lead_id <> p_lead_id
     )
     OR EXISTS (
       SELECT 1 FROM public.upsell_clients uc
        WHERE uc.organization_id = v_org AND uc.cnpj = v_digits
          AND uc.lead_id IS NOT NULL AND uc.lead_id <> p_lead_id
     ) THEN
    RAISE EXCEPTION 'Este documento já está em outro cliente da organização.'
      USING ERRCODE = 'PT409', DETAIL = 'documento_em_uso';
  END IF;

  -- (7) grava o override.
  BEGIN
    INSERT INTO public.lead_documents AS d
      (lead_id, organization_id, document, erp_document_at_set, source,
       erp_writeback_status, erp_writeback_attempted_at, erp_writeback_error, updated_by)
    VALUES
      (p_lead_id, v_org, v_digits, v_erp, 'manual', v_status, NULL, NULL, v_uid)
    ON CONFLICT (lead_id) DO UPDATE SET
      document                   = EXCLUDED.document,
      erp_document_at_set        = EXCLUDED.erp_document_at_set,
      source                     = EXCLUDED.source,
      erp_writeback_status       = EXCLUDED.erp_writeback_status,
      erp_writeback_attempted_at = NULL,
      erp_writeback_error        = NULL,
      updated_by                 = EXCLUDED.updated_by,
      updated_at                 = now();
  EXCEPTION WHEN unique_violation THEN
    -- Corrida com outro lead gravando o mesmo documento.
    RAISE EXCEPTION 'Este documento já está em outro cliente da organização.'
      USING ERRCODE = 'PT409', DETAIL = 'documento_em_uso';
  END;

  -- (8) trilha.
  INSERT INTO public.lead_document_events
    (organization_id, lead_id, action, old_document, new_document, erp_document,
     actor_user_id, actor_team_member_id, origin)
  VALUES
    (v_org, p_lead_id, 'set', v_old, v_digits, v_erp, v_uid, v_tm, v_origin);

  RETURN jsonb_build_object(
    'document', v_digits,
    'erp_document', v_erp,
    'overridden', true,
    'erp_writeback_status', v_status
  );
END;
$fn$;

COMMENT ON FUNCTION public.set_lead_document(uuid, text) IS
  'Grava (ou limpa, com vazio) o CPF/CNPJ do lead como override local com trilha. Exige poder editar o lead e leads.edit_document. Nunca toca upsell_clients. Chamado 93027ffb.';

REVOKE ALL ON FUNCTION public.set_lead_document(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_document(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.fn_lead_documents_preflight(uuid);

COMMENT ON TABLE public.lead_documents IS
  'CPF/CNPJ editado no Torque (override local). Nunca entra em casamento com o ERP: upsell_clients.cnpj segue espelho do Toth. Escrita só por set_lead_document. Chamado 93027ffb.';

COMMIT;
