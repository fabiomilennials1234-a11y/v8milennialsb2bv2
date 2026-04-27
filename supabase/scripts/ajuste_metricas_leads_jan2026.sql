-- =============================================================================
-- Ajuste: leads sem movimentação até 03/02/2026 → métricas de janeiro/2026
-- =============================================================================
-- Movimentação = presença em pipe_confirmacao, pipe_propostas, pipe_whatsapp
-- ou follow_ups com created_at até o cutoff.
-- Executar no Supabase SQL Editor (role com permissão para UPDATE em leads).
-- Rode a ETAPA 1 primeiro; confira a contagem; depois rode a ETAPA 2.
-- =============================================================================

-- =============================================================================
-- ETAPA 1: Identificação (somente leitura) — rode primeiro para auditoria
-- =============================================================================
-- Leads criados até 03/02/2026 que NÃO têm nenhum registro em pipes ou
-- follow_ups com created_at <= 03/02/2026.

WITH cutoff_leads AS (
  SELECT id, organization_id, name, created_at
  FROM public.leads
  WHERE created_at <= '2026-02-03T23:59:59.999Z'
),
with_movimentacao AS (
  SELECT lead_id FROM public.pipe_confirmacao WHERE created_at <= '2026-02-03T23:59:59.999Z'
  UNION
  SELECT lead_id FROM public.pipe_propostas  WHERE created_at <= '2026-02-03T23:59:59.999Z'
  UNION
  SELECT lead_id FROM public.pipe_whatsapp   WHERE created_at <= '2026-02-03T23:59:59.999Z'
  UNION
  SELECT lead_id FROM public.follow_ups      WHERE created_at <= '2026-02-03T23:59:59.999Z'
),
leads_sem_movimentacao AS (
  SELECT c.id, c.organization_id, c.name, c.created_at
  FROM cutoff_leads c
  LEFT JOIN with_movimentacao m ON m.lead_id = c.id
  WHERE m.lead_id IS NULL
)
-- Contagem
SELECT COUNT(*) AS total_leads_para_ajuste FROM leads_sem_movimentacao;

-- Lista (opcional, para auditoria) — descomente para ver os ids:
-- SELECT id, organization_id, name, created_at FROM leads_sem_movimentacao ORDER BY organization_id, created_at;


-- =============================================================================
-- ETAPA 2: Atualização em massa
-- =============================================================================
-- Só execute após conferir a contagem da Etapa 1.

UPDATE public.leads
SET metrics_period_at = '2026-01-01T00:00:00.000Z'
WHERE id IN (
  WITH cutoff_leads AS (
    SELECT id FROM public.leads
    WHERE created_at <= '2026-02-03T23:59:59.999Z'
  ),
  with_movimentacao AS (
    SELECT lead_id FROM public.pipe_confirmacao WHERE created_at <= '2026-02-03T23:59:59.999Z'
    UNION
    SELECT lead_id FROM public.pipe_propostas  WHERE created_at <= '2026-02-03T23:59:59.999Z'
    UNION
    SELECT lead_id FROM public.pipe_whatsapp   WHERE created_at <= '2026-02-03T23:59:59.999Z'
    UNION
    SELECT lead_id FROM public.follow_ups      WHERE created_at <= '2026-02-03T23:59:59.999Z'
  )
  SELECT c.id
  FROM cutoff_leads c
  LEFT JOIN with_movimentacao m ON m.lead_id = c.id
  WHERE m.lead_id IS NULL
);


-- =============================================================================
-- ETAPA 3: Verificação pós-ajuste (janeiro/2026)
-- =============================================================================
-- Total de leads contabilizados em janeiro/2026 (mesma lógica do dashboard):
-- COALESCE(metrics_period_at, created_at) no intervalo do mês.

SELECT COUNT(*) AS total_leads_januario_2026
FROM public.leads
WHERE (
  (metrics_period_at IS NOT NULL AND metrics_period_at >= '2026-01-01T00:00:00.000Z' AND metrics_period_at <= '2026-01-31T23:59:59.999Z')
  OR
  (metrics_period_at IS NULL AND created_at >= '2026-01-01T00:00:00.000Z' AND created_at <= '2026-01-31T23:59:59.999Z')
);
