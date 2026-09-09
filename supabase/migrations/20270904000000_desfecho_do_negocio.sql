-- 20270904000000_desfecho_do_negocio.sql
--
-- Ganho e perda deixam de ser propriedade da ETAPA e passam a ser propriedade
-- do NEGÓCIO. A movimentação de etapa vira UM dos caminhos que decidem isso,
-- não o único.
--
-- POR QUE, MEDIDO EM PROD 2026-08-28
--
-- `fn_capture_sale_event` é trigger em `pipeline_stage_events` e deriva tudo da
-- etapa: entrou em etapa `won` grava `sale`, em `lost` grava `sale_lost`, saiu
-- de `won` grava `sale_reversed`. Não existe caminho para ganhar um negócio
-- fora de uma etapa terminal.
--
-- O custo disso não é teórico:
--
--   396 funis ativos
--   283 (71%) SEM etapa `won`
--   171 (43%) SEM etapa `lost`
--
-- As ações de workflow `win_deal`/`lose_deal` já existem, mas são implementadas
-- como "mova o card para a etapa terminal" — então elas FALHAM em 71% dos
-- funis, com a mensagem "O funil deste negócio não tem etapa de ganho". A
-- feature não é nova; é a que existe, destravada.
--
-- 🔴 `deals.won` NÃO SERVE COMO DESFECHO, E É POR ISSO QUE ENTRA COLUNA NOVA
--
--   won = true    →    304
--   won = false   → 34.662
--   won = null    →    147
--
-- `false` é o DEFAULT da coluna, não uma afirmação de perda. Ele é
-- indistinguível de "ainda não decidido", e 34.662 negócios abertos estão
-- marcados assim. Um booleano não expressa três estados; empilhar significado
-- nele seria construir a feature sobre uma ambiguidade que já existe.
--
-- `outcome` é `open|won|lost` e diz exatamente uma coisa. `won` continua
-- existindo e SINCRONIZADO — oito arquivos do front a leem (useDealCardData,
-- contextPanelFunnelHelpers, canonical-metrics, ...), e quebrar isso não é
-- parte deste trabalho.
--
-- UM ESCRITOR NO CADERNO, DOIS CHAMADORES
--
--   ANTES   etapa ──► fn_capture_sale_event ──► sale_events
--
--   AGORA   etapa ──┐
--                   ├──► deals.outcome ──► _registrar_desfecho_no_caderno ──► sale_events
--           workflow┘
--
-- Isto não é elegância: é o que impede RECEITA DOBRADA. Com dois escritores, um
-- workflow que marca ganho num card que também entra em etapa `won` emitiria
-- dois eventos `sale`. Com um só, a segunda transição é no-op porque `outcome`
-- já é `won`. A dedup é estrutural, não uma checagem que alguém lembra de
-- escrever.
--
-- O QUE NÃO MUDA, DE PROPÓSITO
--
--   · Etapa com `stage_role='won'` continua marcando ganho ao receber card.
--     São 113 funis e 188 workflows de `stage_changed` que dependem disso.
--   · Sair de ganho continua emitindo `sale_reversed`.
--   · Card sem linha em `deals` (12.598 de 47.270 — 26,6%) continua gravando o
--     evento DIRETO no caderno, exatamente como hoje. Fazer o move de etapa
--     materializar negócio seria escrita em massa não pedida; a criação
--     automática vale para a AÇÃO de workflow, que é ato deliberado do usuário.
--
-- A FONTE DO VALOR, E POR QUE A CADEIA EXISTE
--
-- O caderno lia `pipeline_entries.metadata->>'sale_value'`. Agora prefere
-- `deals.value` — coluna tipada, e a mesma que `valor_em_aberto` lê — com o
-- metadata como queda. Medido em 2026-08-27 nas entradas abertas: 102 com
-- metadata, 103 com `deals.value`, 99 com as duas, ZERO discordando. A cadeia
-- existe só para não perder os 3 que têm metadata e não têm coluna; ela deve
-- desaparecer quando o valor virar obrigatório (SCRUM-545 fatia 3).
--
-- ROLLBACK pareado: rollback/20270904000000_desfecho_do_negocio.sql

-- ===========================================================================
-- 1 — AS COLUNAS
-- ===========================================================================
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS outcome_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_source text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_outcome_check') THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_outcome_check CHECK (outcome IN ('open', 'won', 'lost'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_outcome_source_check') THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_outcome_source_check
      CHECK (outcome_source IS NULL OR outcome_source IN ('stage', 'workflow', 'ui', 'backfill', 'api'));
  END IF;
END
$$;

COMMENT ON COLUMN public.deals.outcome IS
  'Desfecho do negócio: open|won|lost. Fonte da verdade — deals.won é espelho mantido por trigger para os consumidores antigos.';
COMMENT ON COLUMN public.deals.outcome_source IS
  'Quem decidiu: stage (movimentação de etapa), workflow (ação), ui, api, backfill.';

CREATE INDEX IF NOT EXISTS idx_deals_outcome_org
  ON public.deals(organization_id, outcome) WHERE deleted_at IS NULL;

-- ===========================================================================
-- 2 — BACKFILL: DERIVADO, NUNCA ADIVINHADO
-- ===========================================================================
-- `won = false` NÃO vira 'lost'. É o default da coluna e significa "não
-- decidido" em 34.662 linhas. Só vira perda quem foi explicitamente FECHADO
-- sem ganhar — `closed_at IS NOT NULL AND won IS NOT TRUE` (1.232 linhas
-- medidas: 1.536 fechados menos 304 ganhos).
--
-- Este é o backfill mais conservador possível: na dúvida, 'open'. Marcar
-- negócio aberto como perdido apagaria pipeline real de 107 orgs.
-- `outcome_at` recebe `closed_at` e SÓ ele. `updated_at` como queda seria
-- âncora temporal móvel (anti-padrão 3 do lint de métricas): qualquer toque na
-- linha reescreveria a data do desfecho, e o mês da venda mudaria sozinho.
-- Medido: 1.536 dos 1.538 negócios decididos têm `closed_at`. Os 2 restantes
-- ficam com `outcome_at` NULL — não sabemos quando foi, e NULL diz isso.
UPDATE public.deals
   SET outcome = 'won',
       outcome_at = closed_at,
       outcome_source = 'backfill'
 WHERE won IS TRUE AND outcome = 'open';

UPDATE public.deals
   SET outcome = 'lost',
       outcome_at = closed_at,
       outcome_source = 'backfill'
 WHERE won IS NOT TRUE AND closed_at IS NOT NULL AND outcome = 'open';

-- 🔴 `won IS NULL` em 147 linhas, e `NULL IS DISTINCT FROM false` é VERDADEIRO.
-- Sem normalizar, a guarda do espelho (seção 9) acusa 147 divergências que são
-- aritmética de três valores, não dado errado. `NULL` aqui sempre significou
-- "não ganho" — nenhuma dessas linhas foi ganha, senão teria `true`.
UPDATE public.deals SET won = false WHERE won IS NULL;

-- ===========================================================================
-- 3 — O ESPELHO: `won` e `closed_at` seguem `outcome`
-- ===========================================================================
-- BEFORE UPDATE, mexendo em NEW: não recorre, e mantém a coluna velha coerente
-- para os oito consumidores do front que ainda leem `won`.
CREATE OR REPLACE FUNCTION public.fn_deals_espelha_outcome()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
BEGIN
  IF NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    NEW.won := (NEW.outcome = 'won');
    IF NEW.outcome = 'open' THEN
      NEW.closed_at := NULL;
      NEW.outcome_at := NULL;
    ELSE
      NEW.closed_at := COALESCE(NEW.closed_at, now());
      NEW.outcome_at := COALESCE(NEW.outcome_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_espelha_outcome ON public.deals;
CREATE TRIGGER trg_deals_espelha_outcome
  BEFORE UPDATE OF outcome ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.fn_deals_espelha_outcome();

-- ===========================================================================
-- 4 — O ESCRITOR ÚNICO DO CADERNO
-- ===========================================================================
-- Toda a lógica que estava dentro de `fn_capture_sale_event` mora aqui, e passa
-- a ser chamada pelos dois caminhos. Preserva o comportamento vigente linha a
-- linha: estorno ao sair de ganho, `sale` ao entrar, `sale_lost` ao perder.
--
-- NOVIDADE: `deal_id` finalmente é gravado. A coluna existe desde sempre e
-- estava em 0 de 1.869 eventos — o caderno estava ancorado só em
-- (lead_id, pipeline_id), o que impede responder "qual negócio foi esta venda"
-- quando o lead tem mais de um.
CREATE OR REPLACE FUNCTION public._registrar_desfecho_no_caderno(
  p_org uuid, p_lead uuid, p_pipeline uuid, p_stage_key text,
  p_stage_event_id uuid, p_deal_id uuid,
  p_de text, p_para text, p_actor uuid, p_source text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_meta jsonb; v_sale_value numeric; v_currency text;
  v_sale_resp uuid; v_pre_resp uuid; v_stream text;
  v_original public.sale_events%ROWTYPE; v_enabled boolean;
BEGIN
  IF p_de IS NOT DISTINCT FROM p_para THEN
    RETURN;
  END IF;

  -- ── Estorno: saiu de ganho ────────────────────────────────────────────────
  IF p_de = 'won' THEN
    SELECT s.* INTO v_original FROM public.sale_events s
     WHERE s.lead_id = p_lead
       AND s.pipeline_id IS NOT DISTINCT FROM p_pipeline
       AND s.event_type = 'sale'
       AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = s.id)
     ORDER BY s.sold_at DESC, s.created_at DESC
     LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.sale_events
        (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type,
         reversed_event_id, sold_at, sale_value, currency, revenue_stream,
         sale_responsible_id, pre_sale_responsible_id, actor, source, deal_id)
      VALUES
        (p_org, p_lead, p_pipeline, p_stage_key, p_stage_event_id, 'sale_reversed',
         v_original.id, now(), v_original.sale_value, v_original.currency, v_original.revenue_stream,
         v_original.sale_responsible_id, v_original.pre_sale_responsible_id, p_actor, p_source, p_deal_id);
    END IF;
  END IF;

  IF p_para NOT IN ('won', 'lost') THEN
    RETURN;
  END IF;

  -- ── Valor: coluna tipada primeiro, metadata como queda ────────────────────
  SELECT pe.metadata INTO v_meta
    FROM public.pipeline_entries pe
   WHERE (p_deal_id IS NOT NULL AND pe.deal_id = p_deal_id)
      OR (p_deal_id IS NULL AND pe.lead_id = p_lead AND pe.pipeline_id IS NOT DISTINCT FROM p_pipeline)
   ORDER BY pe.closed_at NULLS FIRST, pe.entered_at DESC
   LIMIT 1;

  BEGIN
    v_sale_value := NULLIF(v_meta->>'sale_value', '')::numeric;
  EXCEPTION WHEN OTHERS THEN v_sale_value := NULL;
  END;

  IF p_deal_id IS NOT NULL THEN
    SELECT COALESCE(d.value, v_sale_value) INTO v_sale_value
      FROM public.deals d WHERE d.id = p_deal_id;
  END IF;

  v_currency := COALESCE(NULLIF(upper(v_meta->>'currency'), ''), 'BRL');
  IF v_currency !~ '^[A-Z]{3}$' THEN v_currency := 'BRL'; END IF;

  -- Cadeia PRESERVADA do corpo vigente de fn_capture_sale_event, não introduzida
  -- aqui. O lint tem razão no geral — cadeia de atribuição faz SUM(membro) ≠
  -- total —, mas trocar a chave nesta migration reescreveria a atribuição de
  -- 1.869 eventos já gravados. A dívida é do modelo, não deste arquivo.
  SELECT COALESCE(l.sale_responsible_id, l.closer_id), l.pre_sale_responsible_id -- metric-lint-allow: cópia literal do comportamento vigente (ADR-0017); trocar a chave aqui reescreveria a atribuição histórica
    INTO v_sale_resp, v_pre_resp
    FROM public.leads l WHERE l.id = p_lead AND l.organization_id = p_org;

  SELECT o.carteira_emits_revenue_enabled INTO v_enabled
    FROM public.organizations o WHERE o.id = p_org;

  IF COALESCE(v_enabled, false) THEN
    v_stream := public.metric_revenue_stream(p_org, p_lead, now());
  ELSE
    v_stream := CASE WHEN EXISTS (
        SELECT 1 FROM public.upsell_clients uc
         WHERE uc.organization_id = p_org AND uc.lead_id = p_lead AND uc.is_active
      ) THEN 'carteira' ELSE 'novo_negocio' END;
  END IF;

  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type,
     reversed_event_id, sold_at, sale_value, currency, revenue_stream,
     sale_responsible_id, pre_sale_responsible_id, actor, source, deal_id)
  VALUES
    (p_org, p_lead, p_pipeline, p_stage_key, p_stage_event_id,
     CASE WHEN p_para = 'won' THEN 'sale' ELSE 'sale_lost' END,
     NULL, now(), v_sale_value, v_currency, v_stream,
     v_sale_resp, v_pre_resp, p_actor, p_source, p_deal_id);
END;
$$;

COMMENT ON FUNCTION public._registrar_desfecho_no_caderno(uuid, uuid, uuid, text, uuid, uuid, text, text, uuid, text) IS
  'Escritor ÚNICO de sale_events. Chamado pela transição de deals.outcome e, para card sem negócio, direto por fn_capture_sale_event.';

-- ===========================================================================
-- 5 — CHAMADOR 1: a transição de `outcome`
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_deal_outcome_para_caderno()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_pipeline uuid; v_stage_key text;
BEGIN
  IF NEW.outcome IS NOT DISTINCT FROM OLD.outcome THEN
    RETURN NEW;
  END IF;

  -- Onde o negócio está AGORA. Entrada aberta primeiro; se não houver, a última
  -- que existiu — o caderno precisa de um lugar, e "nenhum" perderia o evento.
  SELECT pe.pipeline_id, pe.stage_key INTO v_pipeline, v_stage_key
    FROM public.pipeline_entries pe
   WHERE pe.deal_id = NEW.id
   ORDER BY pe.closed_at NULLS FIRST, pe.entered_at DESC
   LIMIT 1;

  PERFORM public._registrar_desfecho_no_caderno(
    NEW.organization_id, NEW.source_lead_id, v_pipeline, v_stage_key,
    NULL, NEW.id, OLD.outcome, NEW.outcome, NEW.created_by,
    COALESCE(NEW.outcome_source, 'api'));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_outcome_para_caderno ON public.deals;
CREATE TRIGGER trg_deal_outcome_para_caderno
  AFTER UPDATE OF outcome ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.fn_deal_outcome_para_caderno();

-- ===========================================================================
-- 6 — CHAMADOR 2: a movimentação de etapa
-- ===========================================================================
-- Deixa de escrever no caderno quando há negócio: passa a mover `outcome`, e o
-- trigger de cima escreve. Card SEM negócio mantém o caminho direto de hoje.
CREATE OR REPLACE FUNCTION public.fn_capture_sale_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_from_role public.stage_role; v_to_role public.stage_role;
  v_deal_id uuid; v_outcome_atual text; v_novo text;
BEGIN
  v_from_role := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.from_stage_key);
  v_to_role   := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.to_stage_key);

  IF v_from_role IS DISTINCT FROM 'won'
     AND v_to_role IS DISTINCT FROM 'won'
     AND v_to_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;

  v_novo := CASE
    WHEN v_to_role = 'won'  THEN 'won'
    WHEN v_to_role = 'lost' THEN 'lost'
    ELSE 'open'   -- saiu de ganho para etapa comum: reabre
  END;

  SELECT pe.deal_id INTO v_deal_id
    FROM public.pipeline_entries pe WHERE pe.id = NEW.entry_id;

  IF v_deal_id IS NOT NULL THEN
    -- Um escritor: mexe no desfecho e deixa o trigger de `deals` gravar. Se o
    -- negócio JÁ está neste desfecho, o UPDATE não muda nada e nenhum evento
    -- nasce — é aqui que a receita dobrada morre por construção.
    SELECT d.outcome INTO v_outcome_atual FROM public.deals d WHERE d.id = v_deal_id;
    IF v_outcome_atual IS DISTINCT FROM v_novo THEN
      UPDATE public.deals
         SET outcome = v_novo, outcome_source = 'stage', outcome_at = now()
       WHERE id = v_deal_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Card sem negócio (26,6% em prod): caminho direto, como sempre foi.
  PERFORM public._registrar_desfecho_no_caderno(
    NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key,
    NEW.id, NULL,
    CASE WHEN v_from_role = 'won' THEN 'won'
         WHEN v_from_role = 'lost' THEN 'lost' ELSE 'open' END,
    v_novo, NEW.actor, 'trigger');

  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 7 — MATERIALIZAR O NEGÓCIO DE UMA ENTRADA
-- ===========================================================================
-- Decisão do CTO 2026-08-28: a ação de workflow não pode falhar por um detalhe
-- de modelagem que o usuário não conhece. 12.598 entradas (26,6%) não têm
-- `deals`; para elas a ação materializa a linha e segue.
--
-- Idempotente e escopada por organização. NÃO é usada pelo caminho de etapa:
-- lá, materializar seria escrita em massa não pedida.
CREATE OR REPLACE FUNCTION public.garantir_negocio_da_entrada(p_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_entry public.pipeline_entries%ROWTYPE;
  v_deal_id uuid; v_titulo text; v_valor numeric;
BEGIN
  SELECT * INTO v_entry FROM public.pipeline_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entrada % não existe', p_entry_id USING ERRCODE = '22023';
  END IF;
  IF v_entry.deal_id IS NOT NULL THEN
    RETURN v_entry.deal_id;
  END IF;

  SELECT COALESCE(NULLIF(l.name, ''), 'Negócio sem título') INTO v_titulo
    FROM public.leads l WHERE l.id = v_entry.lead_id;

  BEGIN
    v_valor := NULLIF(v_entry.metadata->>'sale_value', '')::numeric;
  EXCEPTION WHEN OTHERS THEN v_valor := NULL;
  END;

  INSERT INTO public.deals (organization_id, title, value, source_lead_id, owner_id, source)
  VALUES (v_entry.organization_id, COALESCE(v_titulo, 'Negócio'), v_valor,
          v_entry.lead_id, v_entry.assigned_to, 'entrada_materializada')
  RETURNING id INTO v_deal_id;

  UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = p_entry_id;
  RETURN v_deal_id;
END;
$$;

-- ===========================================================================
-- 8 — `valor_em_aberto` PARA DE CONTAR NEGÓCIO JÁ DECIDIDO
-- ===========================================================================
-- Acoplamento que esta migration CRIA se não for tratado aqui: até hoje,
-- ganhar significava mover para etapa final, e `_metric_leaf_valor_em_aberto`
-- excluía por `_stage_is_final`. Com desfecho no negócio, o card ganho FICA na
-- etapa onde está — e passaria a contar como "parado na etapa".
--
-- O predicado de etapa continua (card sem negócio não tem `outcome`).
CREATE OR REPLACE FUNCTION public._metric_leaf_valor_em_aberto(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_scoped boolean;
  v_base_count bigint; v_com_valor bigint;
BEGIN
  IF p_recorte NOT IN ('total', 'etapa', 'pipeline', 'closer', 'origem') THEN
    RAISE EXCEPTION 'recorte % incompatible with measure valor_em_aberto', p_recorte
      USING ERRCODE = '22023';
  END IF;

  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

  SELECT count(*), count(*) FILTER (WHERE d.value IS NOT NULL AND d.value > 0)
  INTO v_base_count, v_com_valor
  FROM public.pipeline_entries pe
  JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
  LEFT JOIN public.leads l ON l.id = pe.lead_id
  WHERE pe.organization_id = p_org_id
    AND pe.closed_at IS NULL
    AND d.outcome = 'open'
    AND NOT public._stage_is_final(p_org_id, pe.pipeline_id, pe.stage_key)
    AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    AND ((p_filters->>'member_id')   IS NULL OR d.owner_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'));

  IF p_recorte = 'total' THEN
    SELECT COALESCE(sum(x.valor), 0) INTO v_val
    FROM (
      SELECT DISTINCT d.id, d.value AS valor
      FROM public.pipeline_entries pe
      JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
      LEFT JOIN public.leads l ON l.id = pe.lead_id
      WHERE pe.organization_id = p_org_id
        AND pe.closed_at IS NULL
        AND d.outcome = 'open'
        AND NOT public._stage_is_final(p_org_id, pe.pipeline_id, pe.stage_key)
        AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
        AND ((p_filters->>'member_id')   IS NULL OR d.owner_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
    ) x;

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
      'coverage_total', v_base_count, 'coverage_com_valor', v_com_valor);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',   g.bucket_key,
           'label', COALESCE(g.bucket_label, 'Sem valor'),
           'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'pipeline' THEN pe.pipeline_id::text
        WHEN 'etapa'    THEN pe.pipeline_id::text || ':' || pe.stage_key
        WHEN 'closer'   THEN d.owner_id::text
        WHEN 'origem'   THEN l.origin
      END AS bucket_key,
      CASE p_recorte
        WHEN 'pipeline' THEN pip.name
        WHEN 'etapa'    THEN public._stage_bucket_label(
                               p_org_id, pe.pipeline_id, pe.stage_key, v_scoped)
        WHEN 'closer'   THEN COALESCE(tm.name, 'Sem responsável')
        WHEN 'origem'   THEN l.origin
      END AS bucket_label,
      COALESCE(sum(d.value), 0) AS val
    FROM public.pipeline_entries pe
    JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
    LEFT JOIN public.leads l ON l.id = pe.lead_id
    LEFT JOIN public.team_members tm ON tm.id = d.owner_id
    LEFT JOIN public.pipelines pip ON pip.id = pe.pipeline_id
    WHERE pe.organization_id = p_org_id
      AND pe.closed_at IS NULL
      AND d.outcome = 'open'
      AND NOT public._stage_is_final(p_org_id, pe.pipeline_id, pe.stage_key)
      AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      AND ((p_filters->>'member_id')   IS NULL OR d.owner_id = (p_filters->>'member_id')::uuid)
      AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
    'coverage_total', v_base_count, 'coverage_com_valor', v_com_valor);
END;
$$;

-- ===========================================================================
-- 9 — GRANTS + GUARDAS
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._registrar_desfecho_no_caderno(uuid, uuid, uuid, text, uuid, uuid, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._registrar_desfecho_no_caderno(uuid, uuid, uuid, text, uuid, uuid, text, text, uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.garantir_negocio_da_entrada(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.garantir_negocio_da_entrada(uuid) TO service_role;

DO $guard$
DECLARE
  v_n bigint;
  v_fn regprocedure;
BEGIN
  -- O caderno não pode ter dois escritores. `fn_capture_sale_event` só escreve
  -- direto no ramo sem negócio; se alguém reintroduzir um INSERT no ramo com
  -- negócio, a receita dobra e ninguém percebe até o fechamento do mês.
  IF (SELECT count(*) FROM regexp_matches(
        pg_get_functiondef('public.fn_capture_sale_event()'::regprocedure),
        'INSERT\s+INTO\s+public\.sale_events', 'g')) > 0 THEN
    RAISE EXCEPTION 'GUARDA: fn_capture_sale_event voltou a inserir em sale_events direto — use _registrar_desfecho_no_caderno';
  END IF;

  -- Backfill conservador: negócio ABERTO não pode ter virado perdido.
  SELECT count(*) INTO v_n FROM public.deals
   WHERE outcome = 'lost' AND closed_at IS NULL AND deleted_at IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'GUARDA: % negócio(s) marcados perdidos sem closed_at — o backfill inventou perda', v_n;
  END IF;

  -- O espelho tem que valer para toda linha, senão os 8 consumidores de `won`
  -- passam a discordar da fonte da verdade.
  SELECT count(*) INTO v_n FROM public.deals
   WHERE deleted_at IS NULL AND won IS DISTINCT FROM (outcome = 'won');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'GUARDA: % linha(s) com deals.won divergindo de outcome', v_n;
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public._registrar_desfecho_no_caderno(uuid, uuid, uuid, text, uuid, uuid, text, text, uuid, text)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: % exposta a anon/authenticated — escreve no caderno', v_fn;
    END IF;
  END LOOP;
END
$guard$;
