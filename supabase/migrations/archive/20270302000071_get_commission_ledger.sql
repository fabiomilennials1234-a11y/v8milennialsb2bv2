-- 20270302000071_get_commission_ledger.sql
--
-- Issue #997 · PRD #986 · ADR-0017 §6,§8 — COMISSÃO como LEITURA de LEDGER (SP-3).
-- "Commission is a projection of sale_events via trigger — ledger equals metric
--  by construction." Esta RPC lê ESSA projeção (#994) e é o outro lado do
--  par que mata o "venda no pódio, zero comissão" (R5 / linha #3): irmã de
--  get_ranking (#997/20270302000070), derivam do MESMO caderno pela MESMA chave.
--
-- FONTE ÚNICA: commissions WHERE source='sale_event_projection' (#994) — linhas
--   projetadas do caderno sale_events, atribuídas por team_member_id (que É o
--   snapshot sale_responsible_id da venda), com taxa e amount SNAPSHOTADOS no
--   momento do evento. Mudar a taxa do membro depois NÃO move o ledger (o amount
--   já está materializado na linha). O cálculo on-the-fly antigo (useCommissions)
--   segue VIVO e intocado até o portão de reconciliação (ADR-0017 §8, rollback).
--   Mata #11 (comissão de estado mutável, sem ledger) e #3 (pódio × comissão).
--
-- NET-OF-ESTORNO + AGREEMENT COM O PÓDIO (a decisão que amarra tudo):
--   A projeção materializa estorno como LINHA NEGATIVA no período da venda
--   original (ADR-0017 §3). Mas para AGREGAR EXATAMENTE com get_ranking (que
--   ancora em sale_events.sold_at e exclui a venda estornada via anti-join),
--   este leitor ancora do MESMO jeito: junta cada linha projetada ao seu
--   sale_event (FK sale_event_id, UNIQUE ⇒ 1:1), considera SÓ as linhas cuja
--   venda é `sale` NÃO-estornada no período (mesmo anti-join do #995/#997).
--   A venda estornada some inteira (linha positiva excluída pelo anti-join) —
--   o mesmo líquido que somar a linha negativa, e em mês fechado É idêntico ao
--   rollup do #994 (o estorno §3 zera o mês da original ⟺ o anti-join remove a
--   original do seu mês). Vantagem: funciona pra QUALQUER período nomeado
--   (day|week|month|range), não só mês, e o conjunto de vendas é BIT-A-BIT o do
--   pódio ⇒ base_revenue por membro == get_ranking.revenue por membro, e
--   membro no pódio ⟺ membro no ledger. Invariante fixada em pgTAP.
--
-- POR QUE A JUNÇÃO A sale_events NÃO FERE "ler só a projeção": a projeção
--   REFERENCIA o caderno por FK (sale_event_id); a junção é só o ANCORAMENTO
--   temporal/net — o dinheiro (amount, rate) vem inteiro da linha de comissão.
--   Nenhuma receita é recomputada de estado mutável; sale_value é o snapshot do
--   evento (o mesmo que a base da própria projeção usou).
--
-- CORTE DE PERÍODO (ADR-0017 §5): caller NOMEIA (day|week|month|range);
--   metric_period_bounds (#989) corta no tz da org e devolve tstzrange [). O
--   ano/mês materializado na projeção (rollup mensal de folha, #994) NÃO é a
--   chave de período deste leitor — a chave é sold_at <@ bounds, UMA âncora,
--   a MESMA do pódio. Em mês fechado os dois coincidem (ver acima).
--
-- FILTRO: p_filter_member_id — recorta por team_member_id (a chave canônica
--   única, == sale_responsible_id), jamais por OR-chain (R5).
--
-- FORMA: por membro → comissão líquida, base (receita das mesmas vendas),
--   contagem, e quebra por tipo (mrr|projeto) com a taxa snapshotada. A taxa
--   por membro×tipo é exposta quando UNIFORME entre as linhas (caso comum);
--   se a taxa mudou entre duas vendas do mesmo tipo, vira NULL (honesto — não
--   há taxa única) e o amount continua correto (soma dos snapshots). Vendas sem
--   Closer (não-atribuídas) NÃO têm projeção (o trigger pula) ⇒ não aparecem
--   aqui, coerente com o bucket não-atribuído do pódio (que não gera comissão).
--
-- Guard: PERFORM assert_org_access(p_org_id). SECURITY DEFINER (authenticated
--   RLS on + service_role/cron), mesma fronteira de tenant das irmãs.
--
-- Rollback: supabase/migrations/rollback/20270302000071_get_commission_ledger.sql
-- Testes:   supabase/tests/get_commission_ledger_test.sql (pgTAP, wired no run.sh)
-- Reconc.:  scripts/reconcile-commission-997.sql (× cálculo antigo, §8)

CREATE OR REPLACE FUNCTION public.get_commission_ledger(
  p_org_id           uuid,
  p_period           text,
  p_ref              date DEFAULT NULL,
  p_start            date DEFAULT NULL,
  p_end              date DEFAULT NULL,
  p_filter_member_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds       tstzrange;
  v_comm_total   numeric;
  v_base_total   numeric;
  v_cnt_total    integer;
  v_by_member    jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  -- Fronteira do período: resolvida SÓ pelo banco, no tz da org (ADR-0017 §5).
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);

  -- Conjunto: linha projetada cuja venda `sale` está no período e NÃO foi
  -- estornada (mesmo anti-join do pódio) ⇒ base e membros idênticos ao #997.
  WITH ledger AS (
    SELECT
      c.team_member_id AS member_id,
      c.type           AS ptype,
      c.amount         AS amount,
      c.rate_percent   AS rate_percent,
      se.sale_value    AS base_value
    FROM public.commissions c
    JOIN public.sale_events se ON se.id = c.sale_event_id
    WHERE c.source = 'sale_event_projection'
      AND c.organization_id = p_org_id
      AND se.event_type = 'sale'          -- só linhas positivas (estorno aponta sale_reversed)
      AND se.sold_at <@ v_bounds
      AND (p_filter_member_id IS NULL OR c.team_member_id = p_filter_member_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r
        WHERE r.event_type = 'sale_reversed'
          AND r.reversed_event_id = se.id
      )
  ),
  member_agg AS (
    SELECT
      l.member_id,
      COALESCE(SUM(l.amount), 0)                                          AS commission,
      COALESCE(SUM(l.base_value), 0)                                      AS base_revenue,
      COUNT(*)::int                                                       AS sale_count,
      -- mrr
      COALESCE(SUM(l.amount)     FILTER (WHERE l.ptype = 'mrr'), 0)       AS mrr_commission,
      COALESCE(SUM(l.base_value) FILTER (WHERE l.ptype = 'mrr'), 0)       AS mrr_base,
      COUNT(*) FILTER (WHERE l.ptype = 'mrr')::int                        AS mrr_count,
      CASE WHEN COUNT(DISTINCT l.rate_percent) FILTER (WHERE l.ptype = 'mrr') = 1
           THEN min(l.rate_percent) FILTER (WHERE l.ptype = 'mrr') END    AS mrr_rate,
      -- projeto
      COALESCE(SUM(l.amount)     FILTER (WHERE l.ptype = 'projeto'), 0)   AS proj_commission,
      COALESCE(SUM(l.base_value) FILTER (WHERE l.ptype = 'projeto'), 0)   AS proj_base,
      COUNT(*) FILTER (WHERE l.ptype = 'projeto')::int                    AS proj_count,
      CASE WHEN COUNT(DISTINCT l.rate_percent) FILTER (WHERE l.ptype = 'projeto') = 1
           THEN min(l.rate_percent) FILTER (WHERE l.ptype = 'projeto') END AS proj_rate
    FROM ledger l
    GROUP BY l.member_id
  )
  SELECT
    COALESCE(SUM(m.commission), 0),
    COALESCE(SUM(m.base_revenue), 0),
    COALESCE(SUM(m.sale_count), 0)::int,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'member_id',    m.member_id,
          'commission',   m.commission,
          'base_revenue', m.base_revenue,
          'sale_count',   m.sale_count,
          'by_type', jsonb_build_object(
            'mrr', jsonb_build_object(
              'commission',   m.mrr_commission,
              'base_revenue', m.mrr_base,
              'sale_count',   m.mrr_count,
              'rate_percent', m.mrr_rate
            ),
            'projeto', jsonb_build_object(
              'commission',   m.proj_commission,
              'base_revenue', m.proj_base,
              'sale_count',   m.proj_count,
              'rate_percent', m.proj_rate
            )
          )
        )
        ORDER BY m.commission DESC, m.base_revenue DESC
      ),
      '[]'::jsonb
    )
  INTO v_comm_total, v_base_total, v_cnt_total, v_by_member
  FROM member_agg m;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'name',  p_period,
      'start', lower(v_bounds),
      'end',   upper(v_bounds)
    ),
    'filter_member_id',   p_filter_member_id,
    'commission_total',   v_comm_total,
    'base_revenue_total', v_base_total,
    'sale_count_total',   v_cnt_total,
    'by_member',          v_by_member
  );
END;
$$;

COMMENT ON FUNCTION public.get_commission_ledger(uuid, text, date, date, date, uuid) IS
  'ADR-0017 §6,§8 / #997 — comissão como leitura da PROJEÇÃO de sale_events '
  '(commissions.source=sale_event_projection, #994): taxa/amount snapshotados, '
  'líquido de estorno via anti-join na venda (mesmo do pódio). Ancorado em '
  'sold_at <@ metric_period_bounds ⇒ base por membro == get_ranking.revenue e '
  'venda no pódio ⟺ linha de comissão (mata R5/#3/#11). Mudar taxa depois não '
  'move o ledger. Cálculo antigo (useCommissions) segue vivo (rollback).';

REVOKE ALL ON FUNCTION public.get_commission_ledger(uuid, text, date, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_commission_ledger(uuid, text, date, date, date, uuid)
  TO authenticated, service_role;
