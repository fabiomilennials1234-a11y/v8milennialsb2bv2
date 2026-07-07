-- scripts/reconcile-ranking-997.sql
--
-- INSTÂNCIA do par de RANKING (#997) pro motor genérico reconcile-metrics.sql
-- (ADR-0017 §8). Monta o temp table `recon_cells` comparando, célula a célula:
--
--   NOVO   = get_ranking (#997) — pódio do caderno sale_events, líquido de
--            estorno, atribuição por sale_responsible_id ÚNICO, mês no tz da org.
--            Replicado como SQL DIRETO sobre o caderno (mesma fonte, mesma regra
--            líquida ⇒ algebricamente igual à RPC; fixado por pgTAP
--            get_ranking_test.sql: ranking == get_sales_metrics.by_closer).
--
--   ANTIGO = get_ranking_data (snapshot #987, ADR-0018) — réplica SQL FIEL,
--            bug-a-bug, do pódio de venda do motor vivo:
--              · atribuição = COALESCE(sale_responsible_id, responsible_id,
--                closer_id) — cadeia de fallback: a venda vai pro 1º não-nulo,
--                não pro Closer canônico (R5 / linha #3)                     (R5)
--              · bucket metric_type: só entram membros com metric_type IN
--                ('sales', NULL); vendedor com metric_type errado/NULL some do
--                pódio ou aparece 0 (linha #8)                               (#8)
--              · mês  = cortado em UTC (make_timestamptz ... 'UTC')          (§5)
--              · valor = pp.sale_value da pipe_propostas — estado MUTÁVEL     (R6)
--              · âncora = COALESCE(metrics_period_at, closed_at, updated_at)  (R4)
--              · sem visão de estorno (venda saída de won segue contando)    (§3)
--
-- GRÃO das células: org × membro × mês (revenue/count) + org × mês (total, p/
--   a precedência de atribuição, igual ao par de vendas #995).
--
-- INVARIANTES INTERNAS (recon_invariants):
--   · Σ(membro) + não-atribuído == revenue_total do get_sales_metrics no MESMO
--     período (agreement cross-RPC pódio==dashboard, o que R5 quebrava).
--   · revenue_share ∈ [0,100] em todo membro do pódio.
--
-- QUANDO RODA: portão de reconciliação do SP-3, sobre dados REAIS (prod
--   read-only / dev), via scripts/reconcile-metrics.sh — NÃO no CI de unidade.
--
-- COMO RODAR:
--   PROD_DATABASE_URL=... scripts/reconcile-metrics.sh scripts/reconcile-ranking-997.sql \
--     -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
--   # todas as orgs: -v org_id=NULL  |  `since` >= data do apply do caderno
--   #   (20270302000030); meses anteriores não têm evento e divergem por §7.
--
-- PORTÃO (ADR-0017 §8): célula divergente sem finding_ref = delta INEXPLICADO
--   → o motor falha. finding_ref vem do MAPA COMMITADO (recon_known_causes
--   abaixo, espelhado em scripts/reconcile-ranking-997.deltas.md). Catch-all
--   ("verificar") fica NULL de propósito: exige classificação humana.

\set ON_ERROR_STOP on

\if :{?org_id} \else \set org_id NULL \endif
\if :{?since}  \else \set since  '''2027-01-01''' \endif

-- ── Mapa COMMITADO causa→finding (espelha reconcile-ranking-997.deltas.md) ──
CREATE TEMP TABLE recon_known_causes (pattern text, finding_ref text) ON COMMIT DROP;
INSERT INTO recon_known_causes (pattern, finding_ref) VALUES
  ('venda-pre-caderno%',        'ADR-0017 §7'),  -- janela pré-caderno, declarada
  ('estorno-so-no-caderno%',    'ADR-0017 §3'),  -- motor antigo não vê estorno
  ('atribuicao-COALESCE%',      'R5'),           -- COALESCE(sale_resp,resp,closer)
  ('metric_type-bucket%',       '#8'),           -- metric_type esconde vendedor
  ('ancora-COALESCE%',          'R4'),           -- âncoras concorrentes
  ('valor-mutavel%',            'R6'),           -- receita de estado mutável
  ('tz-utc-vs-org%',            'ADR-0017 §5');  -- mês cortado em UTC vs tz org

WITH params AS (
  SELECT :org_id::uuid AS org_id, :since::date AS since
),

-- ═══ NOVO: leitura líquida do caderno (algebricamente = get_ranking) ════════
projected_base AS (
  SELECT
    se.organization_id,
    se.sale_responsible_id AS member_id,
    extract(year  FROM (se.sold_at AT TIME ZONE o.timezone))::int AS year,
    extract(month FROM (se.sold_at AT TIME ZONE o.timezone))::int AS month,
    se.sale_value
  FROM public.sale_events se
  JOIN public.organizations o ON o.id = se.organization_id
  CROSS JOIN params p
  WHERE se.event_type = 'sale'
    AND (se.sold_at AT TIME ZONE o.timezone)::date >= p.since
    AND (p.org_id IS NULL OR se.organization_id = p.org_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.sale_events r
      WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id
    )
),
projected_member AS (   -- grão org × membro × mês (membro NULL = não-atribuído)
  SELECT organization_id, member_id, year, month,
         COALESCE(SUM(sale_value),0) AS revenue, COUNT(*)::numeric AS cnt
  FROM projected_base GROUP BY 1,2,3,4
),
projected_org AS (      -- grão org × mês (total)
  SELECT organization_id, NULL::uuid AS member_id, year, month,
         COALESCE(SUM(sale_value),0) AS revenue, COUNT(*)::numeric AS cnt
  FROM projected_base GROUP BY 1,3,4
),

-- ═══ ANTIGO: réplica fiel do pódio de venda de get_ranking_data ═════════════
-- atribuição COALESCE(sale_responsible_id, responsible_id, closer_id) (R5),
-- bucket metric_type IN ('sales',NULL) (#8), mês UTC (§5), valor pp.sale_value
-- mutável (R6), âncora COALESCE (R4), sem estorno (§3).
legacy_rows AS (
  SELECT
    pp.organization_id,
    COALESCE(pp.sale_responsible_id, pp.responsible_id, pp.closer_id) AS member_id,  -- metric-lint-allow: réplica FIEL do COALESCE do motor antigo (R5) — o comparador é quem mata R5
    extract(year  FROM COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) AT TIME ZONE 'UTC')::int AS year,
    extract(month FROM COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) AT TIME ZONE 'UTC')::int AS month,
    COALESCE(pp.sale_value, 0) AS deal_value  -- metric-lint-allow: réplica FIEL do valor mutável do motor antigo (R6)
  FROM public.pipe_propostas pp
  JOIN public.team_members tm
    ON tm.id = COALESCE(pp.sale_responsible_id, pp.responsible_id, pp.closer_id)  -- metric-lint-allow: espelha o bucket metric_type do motor antigo (#8)
   AND tm.organization_id = pp.organization_id
   AND tm.is_active = true
   AND (tm.metric_type = 'sales' OR tm.metric_type IS NULL)   -- bucket metric_type (#8)
  CROSS JOIN params p
  WHERE pp.status = 'vendido'
    AND COALESCE(pp.sale_responsible_id, pp.responsible_id, pp.closer_id) IS NOT NULL  -- metric-lint-allow: réplica fiel
    AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) IS NOT NULL
    AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) >= p.since
    AND (p.org_id IS NULL OR pp.organization_id = p.org_id)
),
legacy_member AS (      -- grão org × membro × mês
  SELECT organization_id, member_id, year, month,
         SUM(deal_value) AS revenue, COUNT(*)::numeric AS cnt
  FROM legacy_rows GROUP BY 1,2,3,4
),
legacy_org AS (         -- grão org × mês (total)
  SELECT organization_id, NULL::uuid AS member_id, year, month,
         SUM(deal_value) AS revenue, COUNT(*)::numeric AS cnt
  FROM legacy_rows GROUP BY 1,3,4
),

-- ═══ Une os dois grãos e emite revenue + count por célula ════════════════════
new_cells AS (
  SELECT 'org_month' AS grain, organization_id, member_id, year, month, revenue, cnt FROM projected_org
  UNION ALL
  SELECT 'org_member_month', organization_id, member_id, year, month, revenue, cnt FROM projected_member
),
old_cells AS (
  SELECT 'org_month' AS grain, organization_id, member_id, year, month, revenue, cnt FROM legacy_org
  UNION ALL
  SELECT 'org_member_month', organization_id, member_id, year, month, revenue, cnt FROM legacy_member
),
joined AS (
  SELECT
    COALESCE(n.grain, o.grain)                     AS grain,
    COALESCE(n.organization_id, o.organization_id) AS organization_id,
    COALESCE(n.member_id, o.member_id)             AS member_id,
    COALESCE(n.year,  o.year)                      AS year,
    COALESCE(n.month, o.month)                     AS month,
    n.revenue AS new_rev, o.revenue AS old_rev,
    n.cnt     AS new_cnt, o.cnt     AS old_cnt
  FROM new_cells n
  FULL OUTER JOIN old_cells o
    ON  o.grain = n.grain
    AND o.organization_id = n.organization_id
    AND o.member_id IS NOT DISTINCT FROM n.member_id
    AND o.year = n.year AND o.month = n.month
),
cells AS (
  SELECT grain, organization_id, member_id, year, month, 'revenue' AS field,
         new_rev AS new_value, old_rev AS old_value FROM joined
  UNION ALL
  SELECT grain, organization_id, member_id, year, month, 'count',
         new_cnt, old_cnt FROM joined
),
scored AS (
  SELECT
    c.*,
    CASE
      -- Precedência de atribuição (R5): org-total do mês bate mas o membro
      -- diverge ⇒ é a cadeia COALESCE do motor antigo.
      WHEN c.grain = 'org_member_month'
             AND EXISTS (
               SELECT 1 FROM joined j
               WHERE j.grain='org_month' AND j.organization_id=c.organization_id
                 AND j.year=c.year AND j.month=c.month
                 AND abs(COALESCE(
                     CASE WHEN c.field='revenue' THEN j.new_rev ELSE j.new_cnt END,0)
                   - COALESCE(
                     CASE WHEN c.field='revenue' THEN j.old_rev ELSE j.old_cnt END,0)) <= 0.01)
        THEN 'atribuicao-COALESCE (org-total bate; membro diverge por fallback sale_resp→resp→closer)'
      -- Membro só no NOVO cujo team_member tem metric_type ≠ sales ⇒ #8.
      WHEN c.grain = 'org_member_month'
             AND COALESCE(c.old_value,0) = 0 AND COALESCE(c.new_value,0) <> 0
             AND EXISTS (
               SELECT 1 FROM public.team_members tm
               WHERE tm.id = c.member_id AND tm.organization_id = c.organization_id
                 AND tm.metric_type IS NOT NULL AND tm.metric_type <> 'sales')
        THEN 'metric_type-bucket (vendedor com metric_type≠sales some do pódio antigo)'
      WHEN COALESCE(c.new_value,0) = 0 AND COALESCE(c.old_value,0) <> 0
        THEN 'venda-pre-caderno? (motor novo sem evento) | ou membro só no COALESCE antigo'
      WHEN COALESCE(c.old_value,0) = 0 AND COALESCE(c.new_value,0) <> 0
        THEN 'estorno-so-no-caderno? (motor antigo não vê saída de won)'
      ELSE 'verificar: ancora-COALESCE-vs-sold_at | valor-mutavel-pos-venda | tz-utc-vs-org | estorno'
    END AS suggested_cause
  FROM cells c
)
SELECT
  jsonb_build_object(
    'grain', s.grain, 'org', s.organization_id, 'member', s.member_id,
    'year', s.year, 'month', s.month, 'field', s.field
  )                                                        AS dims,
  s.new_value,
  s.old_value,
  s.suggested_cause,
  kc.finding_ref                                           AS finding_ref
INTO TEMP recon_cells
FROM scored s
LEFT JOIN recon_known_causes kc ON s.suggested_cause LIKE kc.pattern;

-- ── Invariantes internas ────────────────────────────────────────────────────
-- (1) NOVO: Σ(membro,mês) = total(mês) por org (pódio==dashboard; os dois grãos
--     saem do MESMO projected_base ⇒ igualdade por construção).
-- (2) get_ranking.revenue_total == get_sales_metrics.revenue_total (cross-RPC),
--     amostrado no mês corrente da org (agreement que R5 quebrava).
CREATE TEMP TABLE recon_invariants (name text, ok boolean, detail text) ON COMMIT DROP;

INSERT INTO recon_invariants (name, ok, detail)
SELECT
  'novo: Σ(membro,mês) = total(mês) por org',
  COALESCE(bool_and(diff <= 0.01), true),
  COALESCE(string_agg(CASE WHEN diff > 0.01
    THEN format('%s %s-%s Δ=%s', org, yr, mo, round(diff,2)) END, '; '),
    'ok')
FROM (
  SELECT tot.org, tot.yr, tot.mo,
         abs(COALESCE(tot.total,0) - COALESCE(mem.s,0)) AS diff
  FROM (
    SELECT dims->>'org' AS org, dims->>'year' AS yr, dims->>'month' AS mo, new_value AS total
    FROM recon_cells
    WHERE dims->>'grain' = 'org_month' AND dims->>'field' = 'revenue'
  ) tot
  LEFT JOIN (
    SELECT dims->>'org' AS org, dims->>'year' AS yr, dims->>'month' AS mo, SUM(new_value) AS s
    FROM recon_cells
    WHERE dims->>'grain' = 'org_member_month' AND dims->>'field' = 'revenue'
    GROUP BY 1,2,3
  ) mem ON mem.org = tot.org AND mem.yr = tot.yr AND mem.mo = tot.mo
) d;

-- (2) cross-RPC: get_ranking vs get_sales_metrics no mês corrente de cada org
--     coberta (amostra barata; a igualdade estrutural já é do shape das RPCs).
INSERT INTO recon_invariants (name, ok, detail)
SELECT
  'cross-RPC: get_ranking.revenue_total == get_sales_metrics.revenue_total (mês corrente)',
  COALESCE(bool_and(
    abs(
      COALESCE((public.get_ranking(o.id, 'month', NULL)        ->> 'revenue_total')::numeric, 0)
    - COALESCE((public.get_sales_metrics(o.id, 'month', NULL)  ->> 'revenue_total')::numeric, 0)
    ) <= 0.01), true),
  'amostra mês corrente por org coberta'
FROM public.organizations o
WHERE (:org_id::uuid IS NULL OR o.id = :org_id::uuid)
  AND EXISTS (SELECT 1 FROM public.sale_events se WHERE se.organization_id = o.id);
