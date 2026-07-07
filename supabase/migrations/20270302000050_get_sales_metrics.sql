-- 20270302000050_get_sales_metrics.sql
--
-- Issue #995 · PRD #986 · ADR-0017 §2-5,§8 — LEITOR CANÔNICO de VENDA (SP-3).
-- "get_dashboard_metrics ... must be rewritten to read ledgers only (SP-3);
--  legacy RPCs stay alive until the reconciliation gate passes (rollback path)."
--
-- O QUE FAZ: expõe a receita de um período NOMEADO lendo SÓ o caderno
-- append-only `sale_events` (#993), líquida de estornos. É o motor NOVO que a
-- fatia SP-3 (dashboard/ranking) passa a consumir; o motor antigo
-- (get_dashboard_metrics, snapshot #987) fica VIVO e intocado como rollback
-- até o portão de reconciliação (#996/#997, ADR-0017 §8).
--
-- MATA, POR CONSTRUÇÃO, os 3 vícios de venda da auditoria 2026-07-02:
--   · R4 (âncoras concorrentes COALESCE(metrics_period_at, closed_at,
--     updated_at)) → UMA âncora só: sale_events.sold_at, momento do REGISTRO
--     (ADR-0017 §4). Nenhum COALESCE de tempo, nenhum updated_at.
--   · R5 (5 chaves de atribuição em OR-chain, soma-por-membro ≠ total) → UMA
--     chave canônica: sale_events.sale_responsible_id, snapshotada no evento
--     pelo caderno (fallback legado closer_id já resolvido LÁ, na transição).
--     Nenhum COALESCE de atribuição aqui.
--   · R6 (receita de estado mutável / 2ª superfície da Carteira) → receita
--     vem EXCLUSIVAMENTE do caderno; Revenue Stream (novo_negocio | carteira)
--     é coluna do evento, decidida pelo CLIENTE no momento da venda (§2).
--
-- CORTE DE PERÍODO (ADR-0017 §5): o caller NOMEIA o período (day|week|month|
--   range); metric_period_bounds (#989) resolve as fronteiras no timezone da
--   ORG e devolve tstzrange meio-aberto [). Esta função NUNCA calcula data de
--   corte — só passa o range pro predicado `sold_at <@ bounds`. Sem timestamptz
--   cru na assinatura de propósito: fronteira é responsabilidade do banco.
--
-- FILTROS:
--   · p_pipeline_id  — 1 funil quando informado, TODOS quando NULL. NUNCA
--     filtra por type='system' (é exatamente o que cega custom pipeline —
--     R1/R2); o recorte é pelo pipeline_id passado, e só.
--   · p_filter_member_id — recorta atribuição por sale_responsible_id (a chave
--     canônica única), jamais por OR-chain de 5 chaves (R5).
--
-- RECEITA LÍQUIDA DE ESTORNO (ADR-0017 §3, semântica do #993): conta o evento
--   `sale` cujo par `sale_reversed` NÃO existe (anti-join por reversed_event_id).
--   Isso restaura o período ORIGINAL da venda estornada (o estorno tem sold_at
--   próprio, possivelmente em outro período; ancorar pelo anti-join na venda
--   original evita creditar receita num período e debitar em outro — é a
--   leitura líquida que o pgTAP do #993 já fixou). `sale_lost` nunca entra em
--   receita. Valor ausente (sale_value NULL) não vira 0 por linha; no agregado,
--   SUM ignora NULL e o total é COALESCE(...,0) (0 reais CONHECIDOS, honesto).
--
-- INVARIANTES EMBUTIDAS (o shape da query as garante, não a esperança):
--   · total = novo_negocio + carteira — total é a SOMA dos streams (o CHECK
--     de revenue_stream garante que não há 3º stream), não recomputado à parte.
--   · Σ(por closer) + não_atribuído = total — closers e o bucket NULL
--     PARTICIONAM o mesmo conjunto `won`; ambos os lados saem do MESMO
--     GROUP BY sale_responsible_id, logo somam ao total por construção.
--   · ticket_medio = receita_líquida / vendas_líquidas, NULL-safe: 0 vendas →
--     NULL (nunca divide por zero, nunca fabrica ticket 0).
--
-- Guard: PERFORM assert_org_access(p_org_id) (mesmo do motor antigo).
-- SECURITY DEFINER: roda sob authenticated (RLS on) e service_role/cron.
--   sale_events tem RLS tenant-scoped; o guard é a fronteira de tenant, mesmo
--   modelo das RPCs de métrica existentes.
--
-- Rollback: supabase/migrations/rollback/20270302000050_get_sales_metrics.sql
-- Testes:   supabase/tests/get_sales_metrics_test.sql (pgTAP, wired no run.sh)
-- Reconc.:  scripts/reconcile-sales-995.sql (× get_dashboard_metrics, §8)

CREATE OR REPLACE FUNCTION public.get_sales_metrics(
  p_org_id           uuid,
  p_period           text,
  p_ref              date DEFAULT NULL,
  p_start            date DEFAULT NULL,
  p_end              date DEFAULT NULL,
  p_pipeline_id      uuid DEFAULT NULL,
  p_filter_member_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds        tstzrange;
  v_rev_total     numeric;
  v_rev_novo      numeric;
  v_rev_carteira  numeric;
  v_cnt_won       integer;
  v_cnt_novo      integer;
  v_cnt_carteira  integer;
  v_cnt_lost      integer;
  v_by_closer     jsonb;
  v_unattr_rev    numeric;
  v_unattr_cnt    integer;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  -- Fronteira do período: resolvida SÓ pelo banco, no tz da org (ADR-0017 §5).
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);

  -- ── Streams + total + contagens, do MESMO conjunto WON líquido ────────────
  -- won = evento `sale` no período, pós-filtros, cujo estorno NÃO existe
  -- (anti-join por reversed_event_id — restaura o período original, ADR-0017
  -- §3). Total = SUM(todos) ≡ SUM(novo)+SUM(carteira) por construção: o CHECK
  -- de revenue_stream (#993) garante que não há 3º stream.
  SELECT
    COALESCE(SUM(w.sale_value), 0),
    COALESCE(SUM(w.sale_value) FILTER (WHERE w.revenue_stream = 'novo_negocio'), 0),
    COALESCE(SUM(w.sale_value) FILTER (WHERE w.revenue_stream = 'carteira'), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE w.revenue_stream = 'novo_negocio'),
    COUNT(*) FILTER (WHERE w.revenue_stream = 'carteira')
  INTO v_rev_total, v_rev_novo, v_rev_carteira,
       v_cnt_won, v_cnt_novo, v_cnt_carteira
  FROM public.sale_events w
  WHERE w.organization_id = p_org_id
    AND w.event_type = 'sale'
    AND w.sold_at <@ v_bounds
    AND (p_pipeline_id IS NULL OR w.pipeline_id = p_pipeline_id)
    AND (p_filter_member_id IS NULL OR w.sale_responsible_id = p_filter_member_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.sale_events r
      WHERE r.event_type = 'sale_reversed'
        AND r.reversed_event_id = w.id
    );

  -- Perdas: contagem de sale_lost no período (nunca entra em receita).
  SELECT COUNT(*)
  INTO v_cnt_lost
  FROM public.sale_events se
  WHERE se.organization_id = p_org_id
    AND se.event_type = 'sale_lost'
    AND se.sold_at <@ v_bounds
    AND (p_pipeline_id IS NULL OR se.pipeline_id = p_pipeline_id)
    AND (p_filter_member_id IS NULL OR se.sale_responsible_id = p_filter_member_id);

  -- Por closer (bucket NULL separado). Ambos os lados saem do MESMO GROUP BY
  -- sobre o MESMO conjunto WON, então Σ(closers) + não_atribuído = total por
  -- construção — a invariante é do shape da query, não de recomputo.
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'member_id',  g.sale_responsible_id,
          'revenue',    g.revenue,
          'sale_count', g.sale_count
        )
        ORDER BY g.revenue DESC, g.sale_count DESC
      ) FILTER (WHERE g.sale_responsible_id IS NOT NULL),
      '[]'::jsonb
    ),
    COALESCE(SUM(g.revenue)    FILTER (WHERE g.sale_responsible_id IS NULL), 0),
    COALESCE(SUM(g.sale_count) FILTER (WHERE g.sale_responsible_id IS NULL), 0)::int
  INTO v_by_closer, v_unattr_rev, v_unattr_cnt
  FROM (
    SELECT
      w.sale_responsible_id,
      COALESCE(SUM(w.sale_value), 0) AS revenue,
      COUNT(*)::int                  AS sale_count
    FROM public.sale_events w
    WHERE w.organization_id = p_org_id
      AND w.event_type = 'sale'
      AND w.sold_at <@ v_bounds
      AND (p_pipeline_id IS NULL OR w.pipeline_id = p_pipeline_id)
      AND (p_filter_member_id IS NULL OR w.sale_responsible_id = p_filter_member_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r
        WHERE r.event_type = 'sale_reversed'
          AND r.reversed_event_id = w.id
      )
    GROUP BY w.sale_responsible_id
  ) g;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'name',  p_period,
      'start', lower(v_bounds),
      'end',   upper(v_bounds)
    ),
    'pipeline_id',       p_pipeline_id,
    'filter_member_id',  p_filter_member_id,
    'revenue_total',     v_rev_total,
    'revenue_by_stream', jsonb_build_object(
      'novo_negocio', jsonb_build_object('revenue', v_rev_novo,     'sale_count', v_cnt_novo),
      'carteira',     jsonb_build_object('revenue', v_rev_carteira, 'sale_count', v_cnt_carteira)
    ),
    'won_count',    v_cnt_won,
    'lost_count',   v_cnt_lost,
    -- Ticket médio NULL-safe: 0 vendas → NULL (nunca /0, nunca ticket 0 forjado).
    'ticket_medio', CASE WHEN v_cnt_won > 0 THEN round(v_rev_total / v_cnt_won, 2) ELSE NULL END,
    'by_closer',    v_by_closer,
    'unattributed', jsonb_build_object('revenue', v_unattr_rev, 'sale_count', v_unattr_cnt)
  );
END;
$$;

COMMENT ON FUNCTION public.get_sales_metrics(uuid, text, date, date, date, uuid, uuid) IS
  'ADR-0017 §2-5,§8 / #995 — leitor canônico de venda (SP-3). Lê SÓ sale_events, '
  'líquido de estorno; período nomeado cortado no tz da org via metric_period_bounds; '
  'receita por stream (total = soma) e por closer + bucket não-atribuído (Σ = total). '
  'Mata R4 (âncora única sold_at), R5 (atribuição única sale_responsible_id) e '
  'R6 (receita só do caderno). Motor antigo get_dashboard_metrics segue vivo (rollback).';

REVOKE ALL ON FUNCTION public.get_sales_metrics(uuid, text, date, date, date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_metrics(uuid, text, date, date, date, uuid, uuid)
  TO authenticated, service_role;
