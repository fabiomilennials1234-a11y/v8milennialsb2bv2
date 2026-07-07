-- scripts/reconcile-commissions-994.sql
--
-- Issue #994 · ADR-0017 §8 — HARNESS DE RECONCILIAÇÃO de comissão:
-- projeção (commissions.source='sale_event_projection', líquida de estornos)
-- × motor antigo (cálculo on-the-fly de useCommissionSummary portado pra SQL,
-- fiel bug-a-bug: janela UTC, taxa VIVA do team_member, COALESCE de âncora).
--
-- QUANDO RODA: no portão de reconciliação da fatia de leitura (SP-3), sobre
-- dados reais — NÃO agora. O portão passa quando TODA célula divergente tem
-- finding_ref apontando pra um finding numerado da auditoria
-- (RELATORIO-AUDITORIA-METRICAS-2026-07-02.md) ou pra uma decisão do
-- ADR-0017; delta inexplicado = portão FALHA (ADR-0017 §8).
--
-- COMO RODAR (read-only; nenhuma escrita):
--
--   # prod (via session pooler / psql com credencial read-only):
--   psql "$PROD_DATABASE_URL" \
--     -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" \
--     -v since="'2027-01-01'" \
--     -f scripts/reconcile-commissions-994.sql
--
--   # todas as orgs: -v org_id=NULL  |  janela: -v since="'YYYY-MM-01'"
--   #   `since` deve ser >= data do apply do 20270302000030 (caderno vivo) —
--   #   meses anteriores não têm eventos e divergem por construção (§7).
--
-- OUTPUT: 1 linha por célula (org × membro × ano × mês × tipo) onde os dois
-- motores divergem > R$ 0,01, com colunas de vínculo pra auditoria:
--   legacy_amount     — motor antigo (taxa viva × base mutável, janela UTC)
--   projected_amount  — projeção (taxa snapshotada, líquida de estorno, tz org)
--   delta             — projected − legacy
--   suggested_cause   — heurística automática (verificar manualmente!)
--   finding_ref       — PREENCHER: 'R4', 'R5', 'ADR-0017 §3', ... (começa NULL)
--
-- Causas conhecidas (mapa heurística → finding):
--   venda-pre-caderno       → ADR-0017 §7 (janela pré-caderno, declarada)
--   taxa-viva-vs-snapshot   → ADR-0017 §6 (snapshot é o comportamento NOVO correto)
--   ancora-COALESCE-vs-sold_at → R4 (âncoras concorrentes) / ADR-0017 §4
--   tz-utc-vs-org           → ADR-0017 §5 (mês cortado no tz da org)
--   valor-editado-pos-venda → R6 (estado mutável) — valor da entry mudou depois
--   estorno-so-no-caderno   → ADR-0017 §3 (motor antigo não vê estorno)

\set ON_ERROR_STOP on
\pset expanded off

-- Defaults quando as vars não vêm na linha de comando.
\if :{?org_id} \else \set org_id NULL \endif
\if :{?since}  \else \set since  '''2027-01-01''' \endif

WITH params AS (
  SELECT :org_id::uuid AS org_id, :since::date AS since
),

-- ── Motor antigo: réplica SQL fiel de useCommissionSummary ─────────────────
-- (janela = mês-calendário UTC; âncora = COALESCE(metrics_period_at,
-- closed_at); atribuição = sale_responsible_id; taxa = colunas VIVAS do
-- team_member com defaults 1.0/0.5; type default 'mrr')
legacy AS (
  SELECT
    pp.organization_id,
    pp.sale_responsible_id                                   AS team_member_id,
    extract(year  FROM COALESCE(pp.metrics_period_at, pp.closed_at) AT TIME ZONE 'UTC')::int AS year,
    extract(month FROM COALESCE(pp.metrics_period_at, pp.closed_at) AT TIME ZONE 'UTC')::int AS month,
    COALESCE(pp.product_type::text, 'mrr')                   AS type,
    round(sum(COALESCE(pp.sale_value, 0))
          * CASE WHEN COALESCE(pp.product_type::text, 'mrr') = 'mrr'
                 THEN COALESCE(tm.commission_mrr_percent, 1.0)
                 ELSE COALESCE(tm.commission_projeto_percent, 0.5) END / 100
        , 2)                                                 AS legacy_amount
  FROM public.pipe_propostas pp
  JOIN public.team_members tm ON tm.id = pp.sale_responsible_id
  CROSS JOIN params p
  WHERE pp.status = 'vendido'
    AND pp.sale_responsible_id IS NOT NULL
    AND COALESCE(pp.metrics_period_at, pp.closed_at) IS NOT NULL
    AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p.since
    AND (p.org_id IS NULL OR pp.organization_id = p.org_id)
  GROUP BY 1, 2, 3, 4, 5, tm.commission_mrr_percent, tm.commission_projeto_percent
),

-- ── Projeção: líquida por construção (estornos são linhas negativas) ───────
projected AS (
  SELECT
    c.organization_id,
    c.team_member_id,
    c.year,
    c.month,
    c.type::text                                             AS type,
    sum(c.amount)                                            AS projected_amount
  FROM public.commissions c
  CROSS JOIN params p
  WHERE c.source = 'sale_event_projection'
    AND make_date(c.year, c.month, 1) >= date_trunc('month', p.since)::date
    AND (p.org_id IS NULL OR c.organization_id = p.org_id)
  GROUP BY 1, 2, 3, 4, 5
),

cells AS (
  SELECT
    COALESCE(l.organization_id, pr.organization_id) AS organization_id,
    COALESCE(l.team_member_id, pr.team_member_id)   AS team_member_id,
    COALESCE(l.year,  pr.year)                      AS year,
    COALESCE(l.month, pr.month)                     AS month,
    COALESCE(l.type,  pr.type)                      AS type,
    COALESCE(l.legacy_amount, 0)                    AS legacy_amount,
    COALESCE(pr.projected_amount, 0)                AS projected_amount
  FROM legacy l
  FULL OUTER JOIN projected pr
    ON  pr.organization_id = l.organization_id
    AND pr.team_member_id  = l.team_member_id
    AND pr.year  = l.year
    AND pr.month = l.month
    AND pr.type  = l.type
)

SELECT
  c.organization_id,
  o.name                                            AS org_name,
  c.team_member_id,
  tm.name                                           AS member_name,
  c.year,
  c.month,
  c.type,
  c.legacy_amount,
  c.projected_amount,
  round(c.projected_amount - c.legacy_amount, 2)    AS delta,
  CASE
    WHEN c.projected_amount = 0 AND c.legacy_amount <> 0 THEN 'venda-pre-caderno? (sem evento projetado)'
    WHEN c.legacy_amount = 0 AND c.projected_amount < 0  THEN 'estorno-so-no-caderno (motor antigo não vê)'
    WHEN EXISTS (
      SELECT 1 FROM public.commissions cc
      WHERE cc.team_member_id = c.team_member_id
        AND cc.year = c.year AND cc.month = c.month
        AND cc.type::text = c.type
        AND cc.source = 'sale_event_projection'
        AND cc.rate_percent IS DISTINCT FROM
            CASE WHEN c.type = 'mrr'
                 THEN COALESCE(tm.commission_mrr_percent, 1.0)
                 ELSE COALESCE(tm.commission_projeto_percent, 0.5) END
    ) THEN 'taxa-viva-vs-snapshot (taxa mudou depois da venda)'
    ELSE 'verificar: ancora-COALESCE-vs-sold_at | tz-utc-vs-org | valor-editado-pos-venda'
  END                                               AS suggested_cause,
  NULL::text                                        AS finding_ref  -- PREENCHER no portão
FROM cells c
LEFT JOIN public.organizations o  ON o.id  = c.organization_id
LEFT JOIN public.team_members  tm ON tm.id = c.team_member_id
WHERE abs(c.projected_amount - c.legacy_amount) > 0.01
ORDER BY c.organization_id, c.year, c.month, tm.name, c.type;
