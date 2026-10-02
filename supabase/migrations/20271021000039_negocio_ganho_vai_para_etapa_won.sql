-- Negócio ganho vai para a etapa de ganho do funil — quando ela existe.
--
-- ── O que o usuário via ──────────────────────────────────────────────────
-- ADR-0023 Emenda 1 fez do desfecho um fato do NEGÓCIO (`deals.outcome`), e
-- não mais uma posição: o botão "Ganhou" passou a gravar `outcome = 'won'` na
-- etapa em que o card estivesse, e o card ficava parado em "Proposta enviada",
-- misturado aos abertos. O funil deixou de mostrar que a venda aconteceu.
--
-- ── Qual é "a etapa de ganho" (medido em prod, 2026-09-30) ───────────────
-- De 436 funis ativos, só 7 têm etapa com `stage_role = 'won'` — e desde
-- 3ceed8b52 a UI não atribui mais esse papel. O que as orgs de fato configuram
-- é a etapa de SUCESSO (`is_final_positive`, o selo verde "Sucesso" no modal
-- de etapas): 400 funis têm uma. Decisão de produto (2026-09-30): etapa de
-- sucesso conta como etapa de ganho.
--
-- EXCETO etapa de sucesso com papel de REUNIÃO (`meeting_booked`/`meeting_held`,
-- 150 funis só têm essa). As métricas de reunião contam EVENTO de etapa
-- (ADR-0007/0017): mover um negócio ganho para "Orçamento Gerado ✓ · Reunião
-- marcada" registraria uma reunião que não aconteceu. Nesses funis nada se move.
--
-- ── A regra ──────────────────────────────────────────────────────────────
-- Quando `deals.outcome` TRANSITA para `won`, a posição do negócio vai, no
-- MESMO funil, para a primeira etapa ATIVA que responder, nesta ordem:
--   1. `stage_role = 'won'` (menor `position`) — o papel canônico;
--   2. `is_final_positive` com `stage_role = 'open'` (MAIOR `position` — em
--      funil com mais de uma etapa de sucesso, 50 hoje, a mais adiantada).
-- Sem nenhuma, nada se move — o desfecho continua valendo sozinho.
--
-- A etapa de ganho (1) é o inverso do caminho que já existia (etapa `won` →
-- `outcome = 'won'`, em `fn_capture_sale_event`). A etapa de sucesso (2) NÃO
-- marca ganho ao receber card arrastado — continua como sempre foi; só recebe
-- o card que JÁ foi ganho.
--
-- O encaminhamento "→ outro funil" de etapa de sucesso (`target_pipeline_id`)
-- é executado pelo FRONT ao arrastar (`useFunilMoveFlow`), não pelo banco: o
-- card movido por aqui fica na etapa de sucesso e não é empurrado adiante.
--
-- ── Por que TRIGGER em `deals`, e não dentro da RPC do botão ──────────────
-- Há três escritores de `outcome`: a RPC do botão (`definir_desfecho_da_entrada`,
-- source 'ui'), a ação `win_deal` do workflow (source 'workflow', UPDATE direto
-- pela edge function) e a API. "Ao negócio ser ganho" é o evento; quem o causou
-- não importa. Pôr a regra só na RPC deixaria o card do workflow parado.
--
-- ── Por que não há receita dobrada nem recursão ──────────────────────────
-- A movimentação é um UPDATE em `pipeline_entries`, que dispara
-- `fn_capture_pipeline_stage_event` → `pipeline_stage_events` →
-- `fn_capture_sale_event`. Esta última lê `deals.outcome`, encontra `won` (este
-- trigger é AFTER: a linha já está escrita) e NÃO escreve — é a guarda
-- "IS DISTINCT FROM v_novo" que já existia. `sale_events` recebe exatamente um
-- evento: o da transição de `outcome`, gravado por `trg_deal_outcome_para_caderno`.
--
-- Quando a origem é a própria etapa (source 'stage'), o card já está numa etapa
-- `won`; a verificação da etapa atual sai sem escrever. Idem para card que já
-- está numa etapa de sucesso elegível.
--
-- ── A trava de valor da etapa ────────────────────────────────────────────
-- `trg_zz_exige_valor_na_venda` (BEFORE em `pipeline_entries`) recusa ENTRAR em
-- etapa `won` com `requires_sale_value` sem `metadata.sale_value`. O valor
-- canônico hoje é `deals.value` (o modal grava lá; `get_pipeline_page` projeta
-- de lá). Então a movimentação leva `deals.value` para `metadata.sale_value`
-- quando ele falta ali — o mesmo número, no lugar onde a trava da etapa olha.
--
-- Se ainda assim a trava recusar (org poupada do rollout ganhando SEM valor
-- nenhum), só a MOVIMENTAÇÃO é desfeita, num subbloco: o ganho fica. Derrubar o
-- fechamento de uma venda por causa da posição do card seria trocar o fato pela
-- decoração. Só `check_violation` é engolido — qualquer outro erro é defeito e
-- tem de aparecer.
--
-- ── Efeitos colaterais que são o comportamento esperado ───────────────────
-- Mover dispara o que qualquer movimentação dispara: evento de etapa, webhook
-- `negocio.stage_changed`, workflows de "mudou de etapa", checklist da etapa.
-- Era exatamente o que acontecia antes da Emenda 1, quando o botão movia o card.
--
-- Reaplicar é no-op.

-- ===========================================================================
-- 1 — A movimentação
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_negocio_ganho_vai_para_etapa_won()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry        record;
  v_ja_no_alvo   boolean;
  v_etapa_ganho  uuid;
  v_chave_ganho  text;
BEGIN
  -- `pipeline_entries.deal_id` é único (ADR-0023 decisão 5), mas o laço não
  -- custa nada e não quebra se a unicidade um dia afrouxar.
  FOR v_entry IN
    SELECT pe.id, pe.pipeline_id, pe.stage_id, pe.stage_key, pe.metadata
      FROM public.pipeline_entries pe
     WHERE pe.deal_id = NEW.id
       AND pe.organization_id = NEW.organization_id
  LOOP
    -- Já está numa etapa de ganho ou de sucesso elegível (inclui o caso em
    -- que foi a própria etapa que ganhou o negócio): nada a fazer. Mover de
    -- uma etapa de sucesso para outra seria gerar evento de etapa à toa.
    SELECT (ps.stage_role IS NOT DISTINCT FROM 'won'
            OR (COALESCE(ps.is_final_positive, false) AND COALESCE(ps.stage_role, 'open') = 'open'))
      INTO v_ja_no_alvo
      FROM public.pipeline_stages ps
     WHERE ps.organization_id = NEW.organization_id
       AND ps.pipeline_id = v_entry.pipeline_id
       AND ((v_entry.stage_id IS NOT NULL AND ps.id = v_entry.stage_id)
         OR (v_entry.stage_id IS NULL AND ps.stage_key = v_entry.stage_key))
     LIMIT 1;

    CONTINUE WHEN COALESCE(v_ja_no_alvo, false);

    SELECT ps.id, ps.stage_key INTO v_etapa_ganho, v_chave_ganho
      FROM public.pipeline_stages ps
     WHERE ps.organization_id = NEW.organization_id
       AND ps.pipeline_id = v_entry.pipeline_id
       -- Estrito, como a trava de valor e o board (`is_active = true`): etapa
       -- com NULL não aparece no kanban, e o card sumiria da tela.
       AND ps.is_active
       AND (ps.stage_role = 'won'
            -- Sucesso SEM papel de reunião: ver o cabeçalho — mover para etapa
            -- de reunião contaria uma reunião que não aconteceu.
            OR (ps.is_final_positive AND COALESCE(ps.stage_role, 'open') = 'open'))
     ORDER BY
       -- IS NOT DISTINCT FROM, não `=`: papel NULL em DESC viria antes do won
       -- (NULLS FIRST).
       (ps.stage_role IS NOT DISTINCT FROM 'won') DESC,
       -- Ganho: a primeira. Sucesso: a mais adiantada.
       CASE WHEN ps.stage_role IS NOT DISTINCT FROM 'won' THEN ps.position ELSE -ps.position END,
       ps.id
     LIMIT 1;

    -- Funil sem etapa de ganho nem de sucesso elegível: o desfecho vale sozinho.
    CONTINUE WHEN v_etapa_ganho IS NULL;

    BEGIN
      -- `stage_key` vai no SET junto com `stage_id`, embora `trg_pe_stage_mirror`
      -- o derivasse: `AFTER UPDATE OF col` dispara pela lista do SET, não pelo
      -- que um BEFORE muda em NEW. Só com `stage_id` aqui, o evento de etapa
      -- (`trg_pipeline_entries_stage_event_update`, OF stage_key, pipeline_id),
      -- o histórico e `trg_enforce_closed_at` NÃO disparariam — o card mudaria
      -- de coluna sem deixar rastro nas métricas de funil.
      UPDATE public.pipeline_entries pe
         SET stage_id = v_etapa_ganho,
             stage_key = v_chave_ganho,
             metadata = CASE
               WHEN NEW.value IS NOT NULL
                AND NULLIF(btrim(COALESCE(pe.metadata->>'sale_value', '')), '') IS NULL
                 THEN jsonb_set(COALESCE(pe.metadata, '{}'::jsonb), '{sale_value}', to_jsonb(NEW.value), true)
               ELSE pe.metadata
             END
       WHERE pe.id = v_entry.id;
    EXCEPTION WHEN check_violation THEN
      -- A trava de valor da etapa recusou. O ganho fica; a posição, não.
      RAISE LOG 'fn_negocio_ganho_vai_para_etapa_won: entrada % ficou na etapa atual (%)',
        v_entry.id, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_negocio_ganho_vai_para_etapa_won() IS
  'Negócio ganho (deals.outcome → won) vai para a etapa ativa de ganho (stage_role=won) do seu funil, ou para a etapa de sucesso (is_final_positive) sem papel de reunião. Sem nenhuma, fica. Ver 20271021000039.';

-- Função de trigger não é porta de ninguém.
REVOKE ALL ON FUNCTION public.fn_negocio_ganho_vai_para_etapa_won() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_negocio_ganho_vai_para_etapa_won() FROM anon;
REVOKE ALL ON FUNCTION public.fn_negocio_ganho_vai_para_etapa_won() FROM authenticated;

DROP TRIGGER IF EXISTS trg_negocio_ganho_vai_para_etapa_won ON public.deals;
CREATE TRIGGER trg_negocio_ganho_vai_para_etapa_won
  AFTER UPDATE OF outcome ON public.deals
  FOR EACH ROW
  WHEN (NEW.outcome = 'won' AND OLD.outcome IS DISTINCT FROM 'won' AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.fn_negocio_ganho_vai_para_etapa_won();

-- ===========================================================================
-- 2 — O kanban precisa SABER que o card foi ganho
-- ===========================================================================
-- `get_pipeline_page` já faz LEFT JOIN em `deals` para projetar `value` sobre
-- `metadata.sale_value` (20271019000008). O desfecho vai pelo mesmo caminho,
-- como `metadata.deal_outcome` — mesma assinatura, mesmo RETURNS, nenhum grant
-- tocado. Card sem negócio (`deals` ausente) não recebe a chave: o front
-- resolve pelo papel da etapa, que é como o caderno o trata.
--
-- Corpo idêntico ao vivo em prod em 2026-09-30 (md5 conferido contra o
-- 20271019000008), mais a projeção do desfecho.
CREATE OR REPLACE FUNCTION public.get_pipeline_page(
  p_pipeline_slug text DEFAULT NULL::text,
  p_stage_id text DEFAULT NULL::text,
  p_org_id uuid DEFAULT NULL::uuid,
  p_page_size integer DEFAULT 20,
  p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_search text DEFAULT NULL::text,
  p_responsible_id uuid DEFAULT NULL::uuid,
  p_tag_ids uuid[] DEFAULT NULL::uuid[],
  p_origins text[] DEFAULT NULL::text[],
  p_rating_min integer DEFAULT NULL::integer,
  p_rating_max integer DEFAULT NULL::integer,
  p_calor_min integer DEFAULT NULL::integer,
  p_calor_max integer DEFAULT NULL::integer,
  p_urgency text DEFAULT NULL::text,
  p_product_type text DEFAULT NULL::text,
  p_meeting_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_meeting_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_period_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_period_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_closed_status_keys text[] DEFAULT NULL::text[],
  p_updated_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_overdue_exclude_status_keys text[] DEFAULT NULL::text[],
  p_status_keys text[] DEFAULT NULL::text[],
  p_scheduled boolean DEFAULT NULL::boolean,
  p_qualification_tier text[] DEFAULT NULL::text[],
  p_pre_qualification_tier text[] DEFAULT NULL::text[],
  p_stalled_min_days integer DEFAULT NULL::integer,
  p_stalled_max_days integer DEFAULT NULL::integer,
  p_pipeline_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, pipeline_id uuid, lead_id uuid, stage_key text, assigned_to uuid, notes text, metadata jsonb, entered_at timestamp with time zone, stage_changed_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, lead jsonb)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE v_pipeline_id UUID;
BEGIN
  IF p_org_id IS NULL OR (p_pipeline_id IS NULL AND p_pipeline_slug IS NULL) THEN
    RETURN;
  END IF;
  SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
   WHERE p.organization_id = p_org_id
     AND ((p_pipeline_id IS NOT NULL AND p.id = p_pipeline_id)
       OR (p_pipeline_id IS NULL AND p.slug = p_pipeline_slug));
  IF v_pipeline_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT pe.id, pe.pipeline_id, pe.lead_id, pe.stage_key, pe.assigned_to, pe.notes,
    CASE
      WHEN d.id IS NULL THEN pe.metadata
      ELSE jsonb_set(
        CASE
          WHEN d.value IS NULL THEN COALESCE(pe.metadata, '{}'::jsonb)
          ELSE jsonb_set(COALESCE(pe.metadata, '{}'::jsonb), '{sale_value}', to_jsonb(d.value), true)
        END,
        '{deal_outcome}', to_jsonb(d.outcome), true)
    END AS metadata,
    pe.entered_at, pe.stage_changed_at, pe.created_at, pe.updated_at,
    jsonb_build_object(
      'id', l.id, 'name', l.name, 'company', l.company, 'email', l.email, 'phone', l.phone,
      'rating', l.rating, 'origin', l.origin, 'segment', l.segment, 'faturamento', l.faturamento,
      'urgency', l.urgency, 'notes', l.notes, 'compromisso_date', l.compromisso_date,
      'ai_disabled', l.ai_disabled, 'avatar_url', l.avatar_url,
      'erp_code', l.erp_code,
      'pre_qualification_tier', l.pre_qualification_tier, 'qualification_tier', l.qualification_tier,
      'sdr_id', l.sdr_id, 'closer_id', l.closer_id, 'responsible_id', l.responsible_id,
      'pre_sale_responsible_id', l.pre_sale_responsible_id, 'sale_responsible_id', l.sale_responsible_id,
      'responsible', CASE WHEN tm_resp.id IS NOT NULL THEN jsonb_build_object('id', tm_resp.id, 'name', tm_resp.name, 'avatar_url', tm_resp.avatar_url) ELSE NULL END,
      'sdr', CASE WHEN tm_sdr.id IS NOT NULL THEN jsonb_build_object('id', tm_sdr.id, 'name', tm_sdr.name, 'avatar_url', tm_sdr.avatar_url) ELSE NULL END,
      'closer', CASE WHEN tm_closer.id IS NOT NULL THEN jsonb_build_object('id', tm_closer.id, 'name', tm_closer.name, 'avatar_url', tm_closer.avatar_url) ELSE NULL END,
      'pre_sale_responsible', CASE WHEN tm_pre.id IS NOT NULL THEN jsonb_build_object('id', tm_pre.id, 'name', tm_pre.name, 'avatar_url', tm_pre.avatar_url) ELSE NULL END,
      'sale_responsible', CASE WHEN tm_sale.id IS NOT NULL THEN jsonb_build_object('id', tm_sale.id, 'name', tm_sale.name, 'avatar_url', tm_sale.avatar_url) ELSE NULL END,
      'lead_tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('tag', jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))) FROM public.lead_tags lt JOIN public.tags t ON t.id = lt.tag_id WHERE lt.lead_id = l.id), '[]'::jsonb)
    ) AS lead
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id
  LEFT JOIN public.deals d ON d.id = pe.deal_id AND d.organization_id = pe.organization_id AND d.deleted_at IS NULL
  LEFT JOIN public.team_members tm_resp ON tm_resp.id = l.responsible_id
  LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = l.sdr_id
  LEFT JOIN public.team_members tm_closer ON tm_closer.id = l.closer_id
  LEFT JOIN public.team_members tm_pre ON tm_pre.id = l.pre_sale_responsible_id
  LEFT JOIN public.team_members tm_sale ON tm_sale.id = l.sale_responsible_id
  WHERE pe.pipeline_id = v_pipeline_id AND pe.stage_key = p_stage_id AND pe.organization_id = p_org_id
    AND pe.lead_id IS NOT NULL AND (p_cursor IS NULL OR pe.created_at < p_cursor)
    AND (p_search IS NULL OR p_search = '' OR (l.name ILIKE '%' || p_search || '%' OR l.phone ILIKE '%' || p_search || '%' OR l.company ILIKE '%' || p_search || '%' OR l.erp_code ILIKE '%' || p_search || '%'))
    AND (p_responsible_id IS NULL OR ((pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id OR l.pre_sale_responsible_id = p_responsible_id OR l.sale_responsible_id = p_responsible_id))
    AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (SELECT unnest(p_tag_ids) EXCEPT SELECT lt2.tag_id FROM public.lead_tags lt2 WHERE lt2.lead_id = l.id))
    AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL OR l.qualification_tier::text = ANY(p_qualification_tier))
    AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
    AND (p_origins IS NULL OR array_length(p_origins, 1) IS NULL OR l.origin::TEXT = ANY(p_origins))
    AND (p_rating_min IS NULL OR COALESCE(l.rating, 0) >= p_rating_min)
    AND (p_rating_max IS NULL OR COALESCE(l.rating, 0) <= p_rating_max)
    AND (p_calor_min IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) >= p_calor_min)
    AND (p_calor_max IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) <= p_calor_max)
    AND (p_urgency IS NULL OR l.urgency = p_urgency)
    AND (p_product_type IS NULL OR pe.metadata->>'product_type' = p_product_type)
    AND (p_meeting_after IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ >= p_meeting_after)
    AND (p_meeting_before IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ <= p_meeting_before)
    AND (p_period_after IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at) ELSE pe.created_at END) >= p_period_after)
    AND (p_period_before IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at) ELSE pe.created_at END) <= p_period_before)
    AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: filtro de lista por inatividade; não ancora métrica nem soma receita
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
    AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
    AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  ORDER BY pe.created_at DESC LIMIT p_page_size;
END;
$function$;

-- ACL idêntica à de prod em 2026-09-30 ({postgres, authenticated, service_role}).
-- CREATE OR REPLACE já a preserva; reemitir é no-op lá e fecha qualquer
-- ambiente cuja cadeia tenha divergido.
REVOKE ALL ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) TO service_role;

-- ===========================================================================
-- 3 — Guardas: a migration se recusa a concluir errada
-- ===========================================================================
DO $$
DECLARE
  v_def text;
  v_n   integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.deals'::regclass
     AND t.tgname = 'trg_negocio_ganho_vai_para_etapa_won'
     AND NOT t.tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'trg_negocio_ganho_vai_para_etapa_won nao existe em deals';
  END IF;

  -- Função DEFINER que escreve posição: ninguém chama direto.
  IF has_function_privilege('anon', 'public.fn_negocio_ganho_vai_para_etapa_won()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_negocio_ganho_vai_para_etapa_won()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_negocio_ganho_vai_para_etapa_won ficou executavel por anon/authenticated';
  END IF;

  -- O caminho inverso precisa continuar idempotente, ou a movimentação deste
  -- trigger grava uma segunda venda em `sale_events` (append-only).
  SELECT pg_get_functiondef('public.fn_capture_sale_event()'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%v_outcome_atual IS DISTINCT FROM v_novo%' THEN
    RAISE EXCEPTION 'fn_capture_sale_event perdeu a guarda de idempotencia — mover para won dobraria a venda';
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_pipeline_page';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'get_pipeline_page tem % assinaturas — a chamada ficaria ambigua', v_n;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_pipeline_page';
  IF v_def NOT LIKE '%deal_outcome%' OR v_def NOT LIKE '%d.value%' THEN
    RAISE EXCEPTION 'get_pipeline_page nao projeta deal_outcome e deals.value';
  END IF;
  IF v_def NOT LIKE '%d.organization_id = pe.organization_id%' THEN
    RAISE EXCEPTION 'join de deals perdeu isolamento por organizacao';
  END IF;

  -- CREATE OR REPLACE preserva a ACL (prod em 2026-09-30:
  -- {postgres, authenticated, service_role}). Se um dia isto virar DROP +
  -- CREATE, o grant default devolveria EXECUTE a anon — o leitor do kanban.
  IF has_function_privilege('anon', 'public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon tem EXECUTE em get_pipeline_page';
  END IF;
END $$;
