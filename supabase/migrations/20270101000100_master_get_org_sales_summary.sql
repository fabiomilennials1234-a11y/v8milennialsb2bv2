-- 20270101000100_master_get_org_sales_summary.sql
--
-- RPC master-scoped: resumo de vendas fechadas de uma org ARBITRÁRIA num período.
-- Alimenta a ferramenta master de unit economics (CAC/Payback) — o master
-- seleciona a org e puxa num_vendas / ticket_medio / receita_total reais.
--
-- SEGURANÇA
--   SECURITY DEFINER + search_path pinado (public, extensions) — segue a classe
--   de hardening 42883/definer do repo (20261227000000). NÃO usa search_path ''
--   (incidente leads_uf): manter `public` evita o modo de falha de resolução
--   de nomes não-qualificados.
--   Gate de acesso: levanta exceção se NOT is_master_user() ANTES de qualquer
--   leitura. Master não tem team_members, então NÃO há caminho por org
--   membership — só a função is_master_user() (pinada) libera. Não-master nunca
--   lê dados de org alguma por aqui.
--
-- PARIDADE COM O DASHBOARD
--   Reusa a definição CANÔNICA de "venda" do get_dashboard_metrics
--   (20261215000000): mesma fonte (public.pipe_propostas), mesmo status
--   ('vendido'), mesmo campo de período COALESCE(metrics_period_at, closed_at,
--   updated_at) e mesma receita SUM(COALESCE(sale_value, 0)) — idêntico à série
--   daily_sales do dashboard. Não inventa nova definição de receita.

CREATE OR REPLACE FUNCTION public.master_get_org_sales_summary(
  p_org_id uuid,
  p_start  date,
  p_end    date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_num_vendas    integer := 0;
  v_receita_total numeric := 0;
  v_ticket_medio  numeric := 0;
  v_sale_values   numeric[] := '{}';
  v_start         timestamptz;
  v_end           timestamptz;
BEGIN
  -- Gate de acesso: SÓ master. Sem fallback por org membership (master não tem).
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'forbidden: master only';
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;

  -- Bordas inclusivas por dia: [p_start 00:00, p_end+1dia) sobre o ts canônico.
  v_start := p_start::timestamptz;
  v_end   := (p_end + 1)::timestamptz;

  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(COALESCE(pp.sale_value, 0)), 0),
    COALESCE(array_agg(COALESCE(pp.sale_value, 0)), '{}')
  INTO v_num_vendas, v_receita_total, v_sale_values
  FROM public.pipe_propostas pp
  WHERE pp.organization_id = p_org_id
    AND pp.status = 'vendido'
    AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) >= v_start
    AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) <  v_end;

  IF v_num_vendas > 0 THEN
    v_ticket_medio := v_receita_total / v_num_vendas;
  END IF;

  RETURN jsonb_build_object(
    'num_vendas',    v_num_vendas,
    'receita_total', v_receita_total,
    'ticket_medio',  v_ticket_medio,
    'sale_values',   to_jsonb(v_sale_values),
    'period_start',  p_start,
    'period_end',    p_end
  );
END;
$$;

-- Só authenticated chama (o gate is_master_user() faz o resto). Nunca anon/public.
REVOKE ALL ON FUNCTION public.master_get_org_sales_summary(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.master_get_org_sales_summary(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.master_get_org_sales_summary(uuid, date, date) TO authenticated;
