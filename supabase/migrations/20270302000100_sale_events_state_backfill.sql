-- 20270302000100_sale_events_state_backfill.sql
--
-- U2 · PRD #986 · ADR-0017 §7 — BACKFILL GOVERNADO DE VENDA POR ESTADO ATUAL.
--
-- CONTEXTO (decisão CTO 2026-07-08): vendas JÁ paradas em stage won/lost do
-- estado vivo do kanban precisam CONTAR quando as métricas canônicas (SP-3)
-- ligarem. O §8 do 20270302000030 declarou "backfill de venda = NÃO" para a
-- história PROFUNDA (sold_at seria fake, valor/atribuição mudaram, a transição
-- não está guardada). Isto aqui é DIFERENTE e honesto: backfill de ESTADO
-- ATUAL — só entradas VIVAS, ancorado no momento REAL em que entraram no stage
-- terminal (pipeline_entries.stage_changed_at, mantido por trigger desde a
-- consolidação). Espelha exatamente o que o #992 (Parte B) já fez pro FUNIL
-- (alinhamento terminal das entries vivas), agora pra RECEITA.
--
-- Por que sold_at é o timestamp real e NÃO now():
--   O normalizador fn_sale_events_force_sold_at() só reescreve sold_at quando
--   source='trigger'. Estas linhas nascem source='backfill' → sold_at
--   preservado = COALESCE(stage_changed_at, entered_at, created_at). É a única
--   forma sancionada (ADR-0017 §4,§7) de carregar timestamp original, rotulada.
--
-- Semântica (roles via metric_stage_role, #990 — NUNCA 'vendido' hardcoded/R2):
--   · stage atual role 'won'  → 1 sale
--   · stage atual role 'lost' → 1 sale_lost
--   · role open/meeting/NULL  → nada. Pipeline custom sem governança de role
--     resolve NULL → NÃO entra (limitação declarada até U1 chegar em
--     custom_pipeline_stages; ponto único de extensão: metric_stage_role).
--
-- Snapshots (idênticos ao fn_capture_sale_event ao vivo, #993):
--   · valor  = metadata->>'sale_value' via parse honesto (malformado/negativo
--     → NULL, jamais 0). currency da metadata ou BRL.
--   · atribuição = sale_responsible_id do lead (fallback legado closer_id
--     sancionado só aqui, ADR-0017 §5) + pre_sale_responsible_id.
--   · revenue_stream = 'carteira' se upsell_clients ativo p/ (org, lead), senão
--     'novo_negocio' — decidido pelo CLIENTE, não pelo funil (ADR-0017 §2).
--   · stage_event_id = último pipeline_stage_events do (lead, pipeline) se
--     resolvível (o #992 Parte B garante 1 por entry viva), senão NULL. actor NULL.
--
-- IDEMPOTÊNCIA: re-rodar NÃO duplica. Guarda = NÃO emite se já existe, pra
--   aquele (lead, pipeline), uma sale/sale_lost NÃO-estornada (viva OU backfill
--   anterior). Defesa no WHERE. O único writer de sale_events fora do trigger
--   ao vivo é esta função definer (owner) — receita continua governada.
--
-- Empacotado como FUNÇÃO (não INSERT inline como o #992/#993) DE PROPÓSITO:
--   torna o backfill re-executável com segurança por ops (idempotente por
--   construção) e é o choke point único auditável. EXECUTE revogado de
--   PUBLIC/anon (invariante #638 §2: definer que escreve não pode ser
--   chamável por anon/PUBLIC); liberado só pra service_role (re-run operacional).
--
-- Rollback: supabase/migrations/rollback/20270302000100_sale_events_state_backfill.sql
-- Testes:   supabase/tests/sale_events_state_backfill_test.sql (pgTAP, wired no run.sh)

-- ============================================================================
-- 1. Helper de parse honesto de valor
-- ============================================================================
-- Parse honesto de sale_value da metadata (jsonb livre): número ausente,
-- vazio, malformado OU negativo → NULL. Nunca fabrica 0 nem quebra o backfill.
-- Espelha o BEGIN/EXCEPTION por-linha do fn_capture_sale_event (#993), mas
-- utilizável em set-based SELECT (uma exceção por valor, não por statement).
CREATE FUNCTION public.fn_backfill_parse_sale_value(p_raw text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v numeric;
BEGIN
  v := NULLIF(p_raw, '')::numeric;
  IF v IS NULL OR v < 0 THEN
    RETURN NULL;  -- desconhecido/negativo = honesto NULL, jamais 0 fabricado
  END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;    -- malformado = desconhecido
END;
$$;

REVOKE ALL ON FUNCTION public.fn_backfill_parse_sale_value(text) FROM PUBLIC;

COMMENT ON FUNCTION public.fn_backfill_parse_sale_value(text) IS
  'U2 / ADR-0017 §7 — parse honesto de metadata->>sale_value pro backfill de '
  'estado: ausente/vazio/malformado/negativo → NULL (nunca 0 fabricado).';

-- ============================================================================
-- 2. Backfill idempotente de venda por estado atual
-- ============================================================================
CREATE FUNCTION public.fn_backfill_state_sales()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer;
BEGIN
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, stage_event_id,
     event_type, reversed_event_id, sold_at, sale_value, currency,
     revenue_stream, sale_responsible_id, pre_sale_responsible_id,
     actor, source)
  SELECT
    pe.organization_id,
    pe.lead_id,
    pe.pipeline_id,
    pe.stage_key,
    se.id,
    CASE WHEN public.metric_stage_role(pe.organization_id, pe.pipeline_id, pe.stage_key) = 'won'
         THEN 'sale' ELSE 'sale_lost' END,
    NULL,
    COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at),
    public.fn_backfill_parse_sale_value(pe.metadata->>'sale_value'),
    CASE
      WHEN COALESCE(upper(pe.metadata->>'currency'), '') ~ '^[A-Z]{3}$'
      THEN upper(pe.metadata->>'currency') ELSE 'BRL'
    END,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.upsell_clients uc
      WHERE uc.organization_id = pe.organization_id
        AND uc.lead_id = pe.lead_id
        AND uc.is_active
    ) THEN 'carteira' ELSE 'novo_negocio' END,
    COALESCE(l.sale_responsible_id, l.closer_id), -- metric-lint-allow: fallback legado closer_id sancionado (ADR-0017 §5)
    l.pre_sale_responsible_id,
    NULL,
    'backfill'
  FROM public.pipeline_entries pe
  JOIN public.leads l
    ON l.id = pe.lead_id
   AND l.organization_id = pe.organization_id
  LEFT JOIN LATERAL (
    SELECT e.id
    FROM public.pipeline_stage_events e
    WHERE e.lead_id = pe.lead_id
      AND e.pipeline_id = pe.pipeline_id
    ORDER BY e.occurred_at DESC, e.created_at DESC
    LIMIT 1
  ) se ON true
  WHERE pe.lead_id IS NOT NULL
    AND public.metric_stage_role(pe.organization_id, pe.pipeline_id, pe.stage_key)
        IN ('won', 'lost')
    -- Guarda de idempotência: NÃO emite se já existe, pra este (lead, pipeline),
    -- uma venda/perda NÃO-estornada — seja captura ao vivo (source='trigger')
    -- ou backfill anterior (re-run). Uma 'sale' anulada por 'sale_reversed'
    -- NÃO conta como "já representada": o estado vivo voltou a won honestamente
    -- e merece nova linha. 'sale_lost' nunca é estornável ⇒ sua existência
    -- sozinha já bloqueia. 1 desfecho terminal por ocupação (lead, pipeline).
    AND NOT EXISTS (
      SELECT 1
      FROM public.sale_events s
      WHERE s.lead_id     = pe.lead_id
        AND s.pipeline_id = pe.pipeline_id
        AND s.event_type IN ('sale', 'sale_lost')
        AND NOT EXISTS (
          SELECT 1 FROM public.sale_events r
          WHERE r.event_type = 'sale_reversed'
            AND r.reversed_event_id = s.id
        )
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_backfill_state_sales() FROM PUBLIC;
-- Re-run operacional só pelo backend (definer escreve como owner; service_role
-- não precisa de grant de INSERT no caderno). anon/authenticated NUNCA.
GRANT EXECUTE ON FUNCTION public.fn_backfill_state_sales() TO service_role;

COMMENT ON FUNCTION public.fn_backfill_state_sales() IS
  'U2 / ADR-0017 §7 — backfill GOVERNADO de venda por ESTADO ATUAL. Emite 1 '
  'sale/sale_lost por entry viva parada em stage won/lost (role via '
  'metric_stage_role, não hardcoded), ancorado no stage_changed_at REAL. '
  'Idempotente (guarda de sale/sale_lost não-estornada por lead+pipeline). '
  'Espelha o alinhamento terminal do #992 pra receita. Re-executável por ops.';

-- ============================================================================
-- 3. Execução one-shot do backfill (idempotente — safe em re-deploy)
-- ============================================================================
DO $backfill$
DECLARE
  v_n integer;
BEGIN
  SELECT public.fn_backfill_state_sales() INTO v_n;
  RAISE NOTICE 'U2 backfill de venda por estado: % linha(s) emitida(s).', v_n;
END;
$backfill$;
