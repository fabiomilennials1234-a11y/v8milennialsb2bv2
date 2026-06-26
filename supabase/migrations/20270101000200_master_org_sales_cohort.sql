-- 20270101000200_master_org_sales_cohort.sql
--
-- Espelha get_funnel_health.stages.compraram (coorte por created_at) — alinha a
-- aba Dados do Insights com a aba Saúde. Antes (20270101000100) a métrica era
-- "vendas FECHADAS no período" (anchor = closed_at/metrics_period_at), o que
-- mostrava 12 contra os 8 da aba Saúde. Agora a base é a mesma COORTE da Saúde:
-- leads CRIADOS no período (anchor = created_at, não-deletados) que viraram
-- venda no pipe system 'propostas'. Mesma definição, mesmo número (= 8).
--
-- CAC usa coorte por decisão do CTO; ressalva: coortes recentes ainda maturam
-- (CAC recente fica superestimado até a coorte converter) — uma venda que fecha
-- num mês mas cujo lead entrou no mês anterior conta no mês de ENTRADA, não no
-- de fechamento.
--
-- SEGURANÇA
--   SECURITY DEFINER + search_path pinado (public, extensions) — segue a classe
--   de hardening 42883/definer do repo (20261227000000). NÃO usa search_path ''
--   (incidente leads_uf): manter `public` evita o modo de falha de resolução de
--   nomes não-qualificados. Gate de acesso: levanta exceção se NOT
--   is_master_user() ANTES de qualquer leitura. Master não tem team_members,
--   então NÃO há caminho por org membership — só is_master_user() (pinada)
--   libera. Não-master nunca lê dados de org alguma por aqui.
--
-- FONTE DO sale_value
--   pipeline_entries NÃO tem coluna sale_value direta: o valor vive em
--   metadata->>'sale_value' (é exatamente como a view pipe_propostas e o
--   get_funnel_health_stage_leads o lêem). Usamos a mesma expressão.

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

  -- Bordas por created_at do lead: [p_start 00:00, p_end+1dia) — dia inclusivo.
  v_start := p_start::timestamptz;
  v_end   := (p_end + 1)::timestamptz;

  WITH cohort AS (
    -- Leads criados no período, não-deletados (espelha o cohort da Saúde).
    SELECT id
    FROM public.leads
    WHERE organization_id = p_org_id
      AND deleted_at IS NULL
      AND created_at >= v_start
      AND created_at <  v_end
  ),
  vendas AS (
    -- Coorte que virou venda: entry 'vendido' no pipe SYSTEM 'propostas'.
    -- Um row por lead (a contagem = distinct cohort leads que venderam).
    SELECT pe.lead_id,
           MAX(COALESCE((pe.metadata ->> 'sale_value')::numeric, 0)) AS sale_value
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip
      ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = p_org_id
      AND pe.stage_key = 'vendido'
      AND pe.lead_id IN (SELECT id FROM cohort)
    GROUP BY pe.lead_id
  )
  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(sale_value), 0),
    COALESCE(array_agg(sale_value), '{}')
  INTO v_num_vendas, v_receita_total, v_sale_values
  FROM vendas;

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
