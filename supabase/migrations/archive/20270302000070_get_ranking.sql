-- 20270302000070_get_ranking.sql
--
-- Issue #997 · PRD #986 · ADR-0017 §2-5,§8 — LEADERBOARD CANÔNICO de VENDA (SP-3).
-- Irmão de get_sales_metrics (#995): mesmo caderno, mesma regra líquida, mesma
-- chave de atribuição. É a fonte ÚNICA do pódio de vendas; o motor antigo
-- get_ranking_data (snapshot #987, ADR-0018) fica VIVO e intocado como rollback
-- até o portão de reconciliação passar (ADR-0017 §8).
--
-- POR QUE ESTA RPC EXISTE (o "pódio ≠ comissão"): a auditoria 2026-07-02
-- provou (R5 / linha #3) que o pódio somava atribuição por COALESCE de 5 chaves
-- (sale_responsible_id|closer_id|responsible_id|pre_sale_responsible_id|sdr_id),
-- então Σ(membro) ≤ total dos cards E uma venda creditada por closer_id
-- aparecia no pódio mas NÃO gerava comissão (a comissão lê sale_responsible_id
-- puro). Aqui a atribuição é UMA chave canônica — a MESMA que a projeção de
-- comissão (#994) usa — então venda no pódio ⟺ linha de comissão, por
-- construção. get_commission_ledger (#998/20270302000071) fecha o outro lado.
--
-- MATA, POR CONSTRUÇÃO:
--   · R5 (linha #3) — atribuição por sale_responsible_id ÚNICO, snapshotado no
--     evento pelo caderno. Nenhum COALESCE/OR-chain de chaves. Σ(membro) +
--     não-atribuído = total, sempre.
--   · linha #8 — SEM bucket por team_members.metric_type: um membro nunca
--     "some do pódio" por metric_type errado/NULL. O ranking é do conjunto WON
--     do caderno, ponto. metric_type não entra na query.
--   · R3 — SEM predicado type='system': funil customizado rankeia igual. O
--     recorte é por p_pipeline_id (ou todos), nunca por tipo de funil.
--   · R4 — âncora única sold_at (momento do registro), nunca updated_at/COALESCE.
--   · R6 — receita vem SÓ do caderno sale_events, líquida de estorno.
--
-- INVARIANTE-CHAVE (pódio == dashboard): o conjunto por-membro é IDÊNTICO ao
--   by_closer de get_sales_metrics pros MESMOS parâmetros — mesma fonte, mesmo
--   anti-join de estorno, mesma chave, mesma ordenação (revenue DESC, count
--   DESC). Esta RPC só acrescenta rank (ROW_NUMBER) e share. A igualdade é do
--   SHAPE da query (copiado 1:1 do #995), não de coincidência — fixada em pgTAP.
--
-- ESCOPO (decisão): #997 rankeia SÓ VENDA. Reunião já é event-sourced e correta
--   (meeting_events, ADR-0007), mas o pódio de reunião do motor antigo mistura
--   goals/metas/metric_type (linhas #8/#9) — reconciliá-lo é superfície própria.
--   Preferimos escopo apertado e reconciliável a amplo e não-reconciliado:
--   ranking de reunião é fatia posterior. Esta RPC não lê meeting_events.
--
-- CORTE DE PERÍODO (ADR-0017 §5): caller NOMEIA o período (day|week|month|
--   range); metric_period_bounds (#989) resolve fronteiras no tz da org e
--   devolve tstzrange [). Esta função NUNCA calcula data de corte.
--
-- FILTRO: p_pipeline_id — 1 funil quando informado, TODOS quando NULL (nunca
--   type='system'). Sem filtro de membro: leaderboard é do time inteiro.
--
-- Guard: PERFORM assert_org_access(p_org_id) (mesma fronteira de tenant do #995).
-- SECURITY DEFINER: roda sob authenticated (RLS on) e service_role/cron.
--
-- Rollback: supabase/migrations/rollback/20270302000070_get_ranking.sql
-- Testes:   supabase/tests/get_ranking_test.sql (pgTAP, wired no run.sh)
-- Reconc.:  scripts/reconcile-ranking-997.sql (× get_ranking_data, §8)

CREATE OR REPLACE FUNCTION public.get_ranking(
  p_org_id      uuid,
  p_period      text,
  p_ref         date DEFAULT NULL,
  p_start       date DEFAULT NULL,
  p_end         date DEFAULT NULL,
  p_pipeline_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds     tstzrange;
  v_rev_total  numeric;
  v_cnt_total  integer;
  v_ranking    jsonb;
  v_unattr_rev numeric;
  v_unattr_cnt integer;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  -- Fronteira do período: resolvida SÓ pelo banco, no tz da org (ADR-0017 §5).
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);

  -- Totais do conjunto WON líquido (idêntico ao revenue_total/won_count do #995):
  -- evento `sale` no período, pós-filtros, cujo estorno NÃO existe (anti-join
  -- por reversed_event_id — restaura o período original, ADR-0017 §3).
  SELECT COALESCE(SUM(w.sale_value), 0), COUNT(*)
  INTO v_rev_total, v_cnt_total
  FROM public.sale_events w
  WHERE w.organization_id = p_org_id
    AND w.event_type = 'sale'
    AND w.sold_at <@ v_bounds
    AND (p_pipeline_id IS NULL OR w.pipeline_id = p_pipeline_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.sale_events r
      WHERE r.event_type = 'sale_reversed'
        AND r.reversed_event_id = w.id
    );

  -- Ranking por membro + bucket não-atribuído. O CTE `g` é EXATAMENTE o mesmo
  -- conjunto de get_sales_metrics.by_closer (#995): mesmo WON líquido, mesmo
  -- GROUP BY sobre sale_responsible_id, mesma ordenação. Só acrescenta rank
  -- (row_number APENAS entre os atribuídos, pra não deslocar posições com o
  -- bucket NULL) e share ⇒ pódio == dashboard por construção. share ∈ [0,100].
  WITH g AS (
    SELECT
      w.sale_responsible_id,
      COALESCE(SUM(w.sale_value), 0) AS revenue,
      COUNT(*)::int                  AS sale_count
    FROM public.sale_events w
    WHERE w.organization_id = p_org_id
      AND w.event_type = 'sale'
      AND w.sold_at <@ v_bounds
      AND (p_pipeline_id IS NULL OR w.pipeline_id = p_pipeline_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r
        WHERE r.event_type = 'sale_reversed'
          AND r.reversed_event_id = w.id
      )
    GROUP BY w.sale_responsible_id
  )
  SELECT
    (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'member_id',     ranked.sale_responsible_id,
            'revenue',       ranked.revenue,
            'sale_count',    ranked.sale_count,
            'rank',          ranked.rnk,
            'revenue_share', CASE WHEN v_rev_total > 0
                                  THEN round(ranked.revenue / v_rev_total * 100, 2)
                                  ELSE 0 END
          )
          ORDER BY ranked.rnk
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          g2.sale_responsible_id, g2.revenue, g2.sale_count,
          row_number() OVER (ORDER BY g2.revenue DESC, g2.sale_count DESC) AS rnk
        FROM g g2
        WHERE g2.sale_responsible_id IS NOT NULL
      ) ranked
    ),
    COALESCE(SUM(g.revenue)    FILTER (WHERE g.sale_responsible_id IS NULL), 0),
    COALESCE(SUM(g.sale_count) FILTER (WHERE g.sale_responsible_id IS NULL), 0)::int
  INTO v_ranking, v_unattr_rev, v_unattr_cnt
  FROM g;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'name',  p_period,
      'start', lower(v_bounds),
      'end',   upper(v_bounds)
    ),
    'pipeline_id',      p_pipeline_id,
    'revenue_total',    v_rev_total,
    'sale_count_total', v_cnt_total,
    'ranking',          v_ranking,
    'unattributed', jsonb_build_object(
      'revenue',    v_unattr_rev,
      'sale_count', v_unattr_cnt
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_ranking(uuid, text, date, date, date, uuid) IS
  'ADR-0017 §2-5,§8 / #997 — leaderboard canônico de venda (SP-3). Lê SÓ '
  'sale_events, líquido de estorno; período no tz da org; atribuição por '
  'sale_responsible_id ÚNICO (mesma chave da projeção de comissão) ⇒ pódio == '
  'dashboard (== get_sales_metrics.by_closer) E venda no pódio ⟺ comissão. Mata '
  'R5/#3 (atribuição única), #8 (sem metric_type), R3 (sem type=system), R4/R6. '
  'Escopo: só venda; ranking de reunião é fatia posterior. Motor antigo '
  'get_ranking_data segue vivo (rollback).';

REVOKE ALL ON FUNCTION public.get_ranking(uuid, text, date, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ranking(uuid, text, date, date, date, uuid)
  TO authenticated, service_role;
