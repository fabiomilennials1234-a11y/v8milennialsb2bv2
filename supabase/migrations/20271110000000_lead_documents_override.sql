-- CPF/CNPJ editável na ficha do lead: override local com trilha.
-- Chamado 93027ffb (Café Jurerê). Decisão do CTO 07/10, opção B.
--
-- ── POR QUE NÃO EM `upsell_clients.cnpj` ─────────────────────────────────
-- Na sincronização em modo `canonical` (`upsert-client.ts`), a coluna é
-- reescrita com o documento do Toth a cada volta, então a edição seria desfeita
-- na próxima sincronização. A coluna também é a CHAVE que casa clientes,
-- pedidos (`findClientIdByCnpj`) e cobranças do Toth. Um override ali faria o
-- pedido do Toth deixar de casar, ou cair no cliente errado quando o valor
-- digitado coincidisse com o documento de outro cliente.
-- Por isso o override fica em tabela própria e NUNCA entra em casamento:
-- `upsell_clients.cnpj` continua espelho do ERP e única chave.
--
-- ── POR QUE NÃO EM `leads` ───────────────────────────────────────────────
-- `leads` tem 21 triggers, com webhook por UPDATE. Um documento lá seria mais
-- uma coluna de cliente atravessando todos eles.
--
-- ── WRITE-BACK AO TOTH (FORA DESTA MIGRATION) ────────────────────────────
-- Fica pronto para ele: o valor do ERP no momento da edição
-- (`erp_document_at_set`), o estado `erp_writeback_status` ('pendente' quando o
-- lead tem cliente do ERP) e o índice parcial dos pendentes. Nenhum escritor
-- de 'enviado'/'confirmado'/'rejeitado' existe ainda.
--
-- ── ESCRITA ──────────────────────────────────────────────────────────────
-- Só pela RPC `set_lead_document` (SECURITY DEFINER). Nenhuma policy de
-- escrita e nenhum GRANT de escrita a `authenticated`/`anon`/PUBLIC. A trilha
-- `lead_document_events` é append-only: um trigger recusa UPDATE para todos;
-- DELETE só acontece em cascata, quando o lead é purgado (dado pessoal sai
-- junto com o lead).
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Regra do documento: só dígitos, 11 (CPF) ou 14 (CNPJ), não uniforme,
--    dígitos verificadores válidos. Mesma regra de `isValidBrDocument`
--    (src/modules/leads/lib/document.ts).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_valid_br_document(p_document text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  v_len int;
  v_sum int;
  v_dv  int;
  v_w1  int[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  v_w2  int[] := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
BEGIN
  IF p_document IS NULL OR p_document !~ '^([0-9]{11}|[0-9]{14})$' THEN
    RETURN false;
  END IF;
  -- Placeholder do ERP ("00000000000000", "11111111111"): DV fecha, mas não é documento.
  IF p_document ~ '^(.)\1*$' THEN
    RETURN false;
  END IF;

  v_len := length(p_document);
  IF v_len = 11 THEN
    v_sum := 0;
    FOR i IN 1..9 LOOP
      v_sum := v_sum + substr(p_document, i, 1)::int * (11 - i);
    END LOOP;
    v_dv := (v_sum * 10) % 11;
    IF v_dv = 10 THEN v_dv := 0; END IF;
    IF v_dv <> substr(p_document, 10, 1)::int THEN RETURN false; END IF;

    v_sum := 0;
    FOR i IN 1..10 LOOP
      v_sum := v_sum + substr(p_document, i, 1)::int * (12 - i);
    END LOOP;
    v_dv := (v_sum * 10) % 11;
    IF v_dv = 10 THEN v_dv := 0; END IF;
    RETURN v_dv = substr(p_document, 11, 1)::int;
  END IF;

  v_sum := 0;
  FOR i IN 1..12 LOOP
    v_sum := v_sum + substr(p_document, i, 1)::int * v_w1[i];
  END LOOP;
  v_dv := CASE WHEN v_sum % 11 < 2 THEN 0 ELSE 11 - v_sum % 11 END;
  IF v_dv <> substr(p_document, 13, 1)::int THEN RETURN false; END IF;

  v_sum := 0;
  FOR i IN 1..13 LOOP
    v_sum := v_sum + substr(p_document, i, 1)::int * v_w2[i];
  END LOOP;
  v_dv := CASE WHEN v_sum % 11 < 2 THEN 0 ELSE 11 - v_sum % 11 END;
  RETURN v_dv = substr(p_document, 14, 1)::int;
END;
$fn$;

COMMENT ON FUNCTION public.is_valid_br_document(text) IS
  'CPF (11) ou CNPJ (14) só com dígitos, não uniforme e com DV válido. Espelho de isValidBrDocument no front (src/modules/leads/lib/document.ts).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. O override (no máximo um por lead).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.lead_documents (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document text NOT NULL
    CONSTRAINT lead_documents_document_valid CHECK (public.is_valid_br_document(document)),
  document_kind text GENERATED ALWAYS AS (
    CASE WHEN length(document) = 11 THEN 'cpf' ELSE 'cnpj' END
  ) STORED,
  -- Documento do ERP no momento da edição. O ERP vivo continua em
  -- `upsell_clients.cnpj`; este é o "de" que o write-back vai precisar.
  erp_document_at_set text,
  source text NOT NULL DEFAULT 'manual'
    CONSTRAINT lead_documents_source_check CHECK (source IN ('manual')),
  erp_writeback_status text NOT NULL
    CONSTRAINT lead_documents_erp_writeback_status_check
    CHECK (erp_writeback_status IN ('nao_aplicavel','pendente','enviado','confirmado','rejeitado')),
  erp_writeback_attempted_at timestamptz,
  erp_writeback_error text,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Um documento identifica um cliente só na org. A RPC também confere contra
  -- `upsell_clients.cnpj` de outros leads; esta constraint fecha a corrida
  -- entre dois overrides iguais gravados ao mesmo tempo.
  CONSTRAINT lead_documents_org_document_key UNIQUE (organization_id, document)
);

COMMENT ON TABLE public.lead_documents IS
  'CPF/CNPJ editado no Torque (override local). Nunca entra em casamento com o ERP: upsell_clients.cnpj segue espelho do Toth. Escrita só por set_lead_document. Chamado 93027ffb.';

-- Fila do futuro worker de write-back.
CREATE INDEX lead_documents_writeback_pending_idx
  ON public.lead_documents (organization_id)
  WHERE erp_writeback_status = 'pendente';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. A trilha (append-only).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.lead_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  action text NOT NULL CONSTRAINT lead_document_events_action_check CHECK (action IN ('set','clear')),
  old_document text,
  new_document text,
  erp_document text,
  actor_user_id uuid NOT NULL,
  actor_team_member_id uuid,
  origin text NOT NULL CONSTRAINT lead_document_events_origin_check CHECK (origin IN ('lead_card','master','api')),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_document_events IS
  'Trilha append-only das alterações de CPF/CNPJ do lead: quem, quando, valor anterior, novo, valor do ERP e origem. Escrita só por set_lead_document.';

CREATE INDEX lead_document_events_lead_idx
  ON public.lead_document_events (lead_id, created_at DESC);
CREATE INDEX lead_document_events_org_idx
  ON public.lead_document_events (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_lead_document_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION 'A trilha de documentos do lead não pode ser alterada.'
    USING ERRCODE = '42501';
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_lead_document_events_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_lead_document_events_append_only
  BEFORE UPDATE ON public.lead_document_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_document_events_append_only();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS e GRANTs: leitura pela org, escrita por ninguém do lado do cliente.
--    O Supabase dá ALL a anon/authenticated em tabela nova por default
--    privileges, então o REVOKE aqui NÃO é no-op. Prova: pg_class.relacl.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.lead_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_document_events ENABLE ROW LEVEL SECURITY;

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

REVOKE ALL ON public.lead_documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lead_document_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_documents TO authenticated;
GRANT SELECT ON public.lead_document_events TO authenticated;
-- service_role: o futuro worker de write-back atualiza o estado do override;
-- a trilha só recebe INSERT.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_documents TO service_role;
REVOKE ALL ON public.lead_document_events FROM service_role;
GRANT SELECT, INSERT ON public.lead_document_events TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Permissão nova, semeada ANTES de qualquer gate que a leia.
--    default false: admin e master passam por has_feature_permission; a org
--    libera para membros no painel de permissões.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  ('leads.edit_document', 'Leads', 'Alterar CPF/CNPJ do lead',
   'Altera o CPF/CNPJ na ficha do lead. O valor do ERP fica preservado e cada alteração entra na trilha.',
   false, false, 35)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. can_update_lead — ESPELHO LITERAL do USING da policy
--    `leads_update_by_responsibility_and_permissions` (20271107150000).
--
--    A RPC é SECURITY DEFINER e DEFINER ignora a RLS de `leads`; sem este
--    predicado, qualquer membro da org alteraria o documento de lead que ele
--    não pode editar. Usa as MESMAS funções da policy, na mesma forma; a
--    regra não é reescrita. Se a policy mudar, este corpo muda junto: o pgTAP
--    `lead_documents_test.sql` compara os dois (FOR KEY SHARE como
--    authenticated aplica o USING da policy de UPDATE) e falha na divergência.
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
           cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
           AND public.rls_lead_in_my_pipes(leads.id, (SELECT public.rls_my_team_member_ids(true)))
         )
       )
  )
$fn$;

COMMENT ON FUNCTION public.can_update_lead(uuid) IS
  'Espelho literal do USING de leads_update_by_responsibility_and_permissions, para RPCs SECURITY DEFINER. Divergência é pega pelo pgTAP lead_documents_test.sql.';

-- Só as RPCs DEFINER (dono) chamam; ninguém do cliente precisa.
REVOKE ALL ON FUNCTION public.can_update_lead(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. set_lead_document — o único escritor.
--
--    Vazio (ou igual ao ERP) = clear: apaga o override e volta a valer o ERP.
--    Erros com SQLSTATE próprio (o PostgREST devolve PTxyz como HTTP xyz) e
--    mensagem pt-BR estável que o front mapeia:
--      PT422  documento_invalido  "CPF/CNPJ inválido."
--      PT409  documento_em_uso    "Este documento já está em outro cliente da organização."
--      42501  sem permissão / sem sessão
--      PT404  lead não encontrado (também para lead de outra org: não revela que existe)
--    `documento_em_uso` nunca devolve o outro lead: a mensagem não pode vazar
--    lead que quem chama não vê.
-- ─────────────────────────────────────────────────────────────────────────
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

COMMIT;
