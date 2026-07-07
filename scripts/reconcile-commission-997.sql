-- scripts/reconcile-commission-997.sql
--
-- INSTÂNCIA do par de COMISSÃO (#997) pro motor genérico reconcile-metrics.sql
-- (ADR-0017 §8). É o LIFT de scripts/reconcile-commissions-994.sql (que já
-- carregava a réplica fiel do cálculo antigo) pro contrato de temp table
-- recon_cells — mesma comparação, agora plugável no portão genérico.
--
--   NOVO   = projeção de comissão (commissions.source='sale_event_projection',
--            #994) — taxa/amount SNAPSHOTADOS, líquida de estorno (linhas
--            negativas), somada por ano/mês/tipo materializados (rollup mensal
--            de folha). É a fonte que get_commission_ledger (#997) lê.
--
--   ANTIGO = cálculo on-the-fly de useCommissionSummary, portado pra SQL fiel
--            bug-a-bug: taxa VIVA do team_member, base pp.sale_value mutável,
--            âncora COALESCE(metrics_period_at, closed_at), mês UTC, type default
--            'mrr'. Sem visão de estorno.
--
-- GRÃO das células: org × membro × ano × mês × tipo (mrr|projeto), field
--   'commission'. new_value = projeção; old_value = cálculo antigo.
--
-- QUANDO RODA: portão de reconciliação do SP-3, dados REAIS (prod read-only /
--   dev), via scripts/reconcile-metrics.sh — NÃO no CI de unidade.
--
-- COMO RODAR:
--   PROD_DATABASE_URL=... scripts/reconcile-metrics.sh scripts/reconcile-commission-997.sql \
--     -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
--   # todas as orgs: -v org_id=NULL  |  `since` >= data do apply do caderno
--   #   (20270302000030); meses anteriores não têm projeção e divergem por §7.
--
-- PORTÃO (ADR-0017 §8): célula divergente sem finding_ref = delta INEXPLICADO
--   → o motor falha. finding_ref vem do MAPA COMMITADO (recon_known_causes
--   abaixo, espelhado em scripts/reconcile-commission-997.deltas.md).

\set ON_ERROR_STOP on

\if :{?org_id} \else \set org_id NULL \endif
\if :{?since}  \else \set since  '''2027-01-01''' \endif

-- ── Mapa COMMITADO causa→finding (espelha reconcile-commission-997.deltas.md) ─
CREATE TEMP TABLE recon_known_causes (pattern text, finding_ref text) ON COMMIT DROP;
INSERT INTO recon_known_causes (pattern, finding_ref) VALUES
  ('venda-pre-caderno%',       'ADR-0017 §7'),  -- janela pré-caderno, declarada
  ('estorno-so-no-caderno%',   'ADR-0017 §3'),  -- motor antigo não vê estorno
  ('taxa-viva-vs-snapshot%',   'ADR-0017 §6');  -- snapshot é o comportamento novo correto
  -- ancora-COALESCE / tz-utc-vs-org / valor-editado-pos-venda caem no catch-all
  -- ('verificar%') e ficam NULL até classificação humana (portão FALHA).

WITH params AS (
  SELECT :org_id::uuid AS org_id, :since::date AS since
),

-- ── Motor antigo: réplica SQL fiel de useCommissionSummary (lift do #994) ──
legacy AS (
  SELECT
    pp.organization_id,
    pp.sale_responsible_id                                   AS team_member_id,
    extract(year  FROM COALESCE(pp.metrics_period_at, pp.closed_at) AT TIME ZONE 'UTC')::int AS year,
    extract(month FROM COALESCE(pp.metrics_period_at, pp.closed_at) AT TIME ZONE 'UTC')::int AS month,
    COALESCE(pp.product_type::text, 'mrr')                   AS type,
    round(sum(COALESCE(pp.sale_value, 0))  -- metric-lint-allow: réplica FIEL do valor mutável do motor antigo (R6)
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
),
scored AS (
  SELECT
    c.*,
    CASE
      WHEN c.projected_amount = 0 AND c.legacy_amount <> 0 THEN 'venda-pre-caderno? (sem evento projetado)'
      WHEN c.legacy_amount = 0 AND c.projected_amount < 0  THEN 'estorno-so-no-caderno (motor antigo não vê)'
      WHEN EXISTS (
        SELECT 1 FROM public.commissions cc
        JOIN public.team_members tm2 ON tm2.id = c.team_member_id
        WHERE cc.team_member_id = c.team_member_id
          AND cc.year = c.year AND cc.month = c.month
          AND cc.type::text = c.type
          AND cc.source = 'sale_event_projection'
          AND cc.rate_percent IS DISTINCT FROM
              CASE WHEN c.type = 'mrr'
                   THEN COALESCE(tm2.commission_mrr_percent, 1.0)
                   ELSE COALESCE(tm2.commission_projeto_percent, 0.5) END
      ) THEN 'taxa-viva-vs-snapshot (taxa mudou depois da venda)'
      ELSE 'verificar: ancora-COALESCE-vs-sold_at | tz-utc-vs-org | valor-editado-pos-venda'
    END AS suggested_cause
  FROM cells c
)
SELECT
  jsonb_build_object(
    'grain', 'org_member_month_type',
    'org',    s.organization_id,
    'member', s.team_member_id,
    'year',   s.year,
    'month',  s.month,
    'type',   s.type,
    'field',  'commission'
  )                                                        AS dims,
  s.projected_amount                                       AS new_value,
  s.legacy_amount                                          AS old_value,
  s.suggested_cause,
  kc.finding_ref                                           AS finding_ref
INTO TEMP recon_cells
FROM scored s
LEFT JOIN recon_known_causes kc ON s.suggested_cause LIKE kc.pattern;

-- ── Invariante interna: par venda↔estorno da projeção soma zero por evento ──
-- (idempotência + net-by-construction do #994; guardião local do portão).
CREATE TEMP TABLE recon_invariants (name text, ok boolean, detail text) ON COMMIT DROP;
INSERT INTO recon_invariants (name, ok, detail)
SELECT
  'projeção: estorno anula a venda original (soma por par = 0)',
  COALESCE(bool_and(pair_sum = 0), true),
  COALESCE(string_agg(CASE WHEN pair_sum <> 0
    THEN format('evento %s Δ=%s', orig_event, pair_sum) END, '; '), 'ok')
FROM (
  SELECT rev.reversed_event_id AS orig_event,
         (SELECT c1.amount FROM public.commissions c1 WHERE c1.sale_event_id = rev.reversed_event_id
            AND c1.source = 'sale_event_projection')
         + rev.amount AS pair_sum
  FROM (
    SELECT se.reversed_event_id, c.amount
    FROM public.commissions c
    JOIN public.sale_events se ON se.id = c.sale_event_id
    WHERE c.source = 'sale_event_projection'
      AND se.event_type = 'sale_reversed'
      AND (:org_id::uuid IS NULL OR c.organization_id = :org_id::uuid)
  ) rev
) pairs
WHERE orig_event IS NOT NULL;
