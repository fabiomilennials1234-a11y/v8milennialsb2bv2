-- scripts/reconcile-sales-995.sql
--
-- INSTÂNCIA do par de VENDAS (#995) pro motor genérico reconcile-metrics.sql
-- (ADR-0017 §8). Monta o temp table `recon_cells` comparando, célula a célula:
--
--   NOVO   = get_sales_metrics (#995) — leitura do caderno sale_events,
--            líquida de estorno, período cortado no tz da org, atribuição por
--            sale_responsible_id único. Aqui replicada como SQL DIRETO sobre o
--            caderno (mesma fonte, mesma regra líquida ⇒ algebricamente igual à
--            RPC; prior art: reconcile-commissions-994.sql lê a projeção direto).
--
--   ANTIGO = get_dashboard_metrics (snapshot #987) — réplica SQL FIEL, bug-a-bug,
--            do cálculo de venda do motor vivo:
--              · âncora   = COALESCE(metrics_period_at, closed_at, updated_at)  (R4)
--              · mês      = cortado em UTC, não no tz da org                    (§5)
--              · valor    = itens do pipe_proposta_items OU sale_value, ESTADO
--                           MUTÁVEL da pipe_propostas (pode ter mudado depois)  (R6)
--              · atribuição por-membro = OR-chain de 5 chaves ⇒ 1 venda credita
--                CADA membro distinto entre as 5 (dupla contagem)              (R5)
--              · estorno: o motor antigo NÃO enxerga; venda saída de won segue
--                contando como vendida                                          (§3)
--
-- GRÃO das células: org × mês (total) e org × membro × mês, campos revenue/count.
--   O split por Revenue Stream (novo_negocio|carteira) é capacidade NOVA (§2)
--   sem contraparte no motor antigo ⇒ não é reconciliável e não vira célula.
--
-- QUANDO RODA: portão de reconciliação do SP-3, sobre dados REAIS (prod
--   read-only / dev), via scripts/reconcile-metrics.sh — NÃO no CI de unidade.
--
-- COMO RODAR:
--   PROD_DATABASE_URL=... scripts/reconcile-metrics.sh scripts/reconcile-sales-995.sql \
--     -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
--   # todas as orgs: -v org_id=NULL   |   `since` >= data do apply do caderno
--   #   (20270302000030); meses anteriores não têm evento e divergem por §7.
--
-- PORTÃO (ADR-0017 §8): célula divergente sem finding_ref = delta INEXPLICADO
--   → o motor falha. finding_ref é preenchido a partir do MAPA COMMITADO de
--   causas sancionadas (recon_known_causes abaixo, espelhado em
--   scripts/reconcile-sales-995.deltas.md). Causa que cai no catch-all
--   ("verificar") fica NULL de propósito: exige classificação humana antes do
--   portão passar. Adicionar uma causa explicada = editar o .deltas.md + a
--   lista recon_known_causes, nunca a lógica de comparação.

\set ON_ERROR_STOP on

\if :{?org_id} \else \set org_id NULL \endif
\if :{?since}  \else \set since  '''2027-01-01''' \endif

-- ── Mapa COMMITADO causa→finding (espelha reconcile-sales-995.deltas.md) ────
-- Célula cuja suggested_cause casa (LIKE) um pattern aqui é EXPLICADA.
CREATE TEMP TABLE recon_known_causes (pattern text, finding_ref text) ON COMMIT DROP;
INSERT INTO recon_known_causes (pattern, finding_ref) VALUES
  ('venda-pre-caderno%',        'ADR-0017 §7'),  -- janela pré-caderno, declarada
  ('estorno-so-no-caderno%',    'ADR-0017 §3'),  -- motor antigo não vê estorno
  ('atribuicao-5-chaves%',      'R5'),           -- OR-chain de atribuição
  ('ancora-COALESCE%',          'R4'),           -- âncoras concorrentes
  ('valor-mutavel%',            'R6'),           -- receita de estado mutável
  ('tz-utc-vs-org%',            'ADR-0017 §5');  -- mês cortado em UTC vs tz org

-- ── Janela de meses a reconciliar (no tz da org, via o motor NOVO) ─────────
WITH params AS (
  SELECT :org_id::uuid AS org_id, :since::date AS since
),

-- ═══ NOVO: leitura líquida do caderno (algebricamente = get_sales_metrics) ══
-- sale não-estornada; mês = sold_at cortado no tz da org (ADR-0017 §5).
projected_base AS (
  SELECT
    se.organization_id,
    se.sale_responsible_id AS member_id,
    extract(year  FROM (se.sold_at AT TIME ZONE o.timezone))::int  AS year,
    extract(month FROM (se.sold_at AT TIME ZONE o.timezone))::int  AS month,
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
projected_member AS (   -- grão org × membro × mês
  SELECT organization_id, member_id, year, month,
         COALESCE(SUM(sale_value),0) AS revenue, COUNT(*)::numeric AS cnt
  FROM projected_base GROUP BY 1,2,3,4
),
projected_org AS (      -- grão org × mês (total, membro = NULL)
  SELECT organization_id, NULL::uuid AS member_id, year, month,
         COALESCE(SUM(sale_value),0) AS revenue, COUNT(*)::numeric AS cnt
  FROM projected_base GROUP BY 1,3,4
),

-- ═══ ANTIGO: réplica fiel de get_dashboard_metrics (venda), bug-a-bug ═══════
-- Valor = itens (pipe_proposta_items) OU sale_value da pipe_propostas (R6,
-- estado mutável). Âncora = COALESCE(metrics_period_at, closed_at, updated_at)
-- (R4). Mês cortado em UTC (§5). Sem visão de estorno (§3).
legacy_value AS (
  SELECT
    pp.id AS proposta_id,
    pp.organization_id,
    pp.sale_responsible_id, pp.closer_id, pp.responsible_id,
    pp.pre_sale_responsible_id, pp.sdr_id,
    COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) AS anchor,
    COALESCE(
      (SELECT SUM(COALESCE(ppi.sale_value,0)) FROM public.pipe_proposta_items ppi
        WHERE ppi.pipe_proposta_id = pp.id),
      COALESCE(pp.sale_value,0)
    ) AS deal_value  -- metric-lint-allow: réplica FIEL do motor antigo (R6), não é métrica nova — o comparador é quem mata R6
  FROM public.pipe_propostas pp
  CROSS JOIN params p
  WHERE pp.status = 'vendido'
    AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) IS NOT NULL
    AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) >= p.since
    AND (p.org_id IS NULL OR pp.organization_id = p.org_id)
),
legacy_dated AS (
  SELECT
    lv.*,
    extract(year  FROM lv.anchor AT TIME ZONE 'UTC')::int  AS year,
    extract(month FROM lv.anchor AT TIME ZONE 'UTC')::int  AS month
  FROM legacy_value lv
),
legacy_org AS (         -- grão org × mês (venda contada 1x)
  SELECT organization_id, NULL::uuid AS member_id, year, month,
         SUM(deal_value) AS revenue, COUNT(*)::numeric AS cnt
  FROM legacy_dated GROUP BY 1,3,4
),
legacy_member AS (      -- grão org × membro × mês, OR-chain 5 chaves (R5):
                        -- unnest das chaves distintas ⇒ dupla contagem fiel
  SELECT organization_id, member_id, year, month,
         SUM(deal_value) AS revenue, COUNT(*)::numeric AS cnt
  FROM (
    SELECT DISTINCT ld.proposta_id, ld.organization_id, ld.year, ld.month,
           ld.deal_value, m.member_id
    FROM legacy_dated ld
    CROSS JOIN LATERAL (
      VALUES (ld.sale_responsible_id), (ld.closer_id), (ld.responsible_id),
             (ld.pre_sale_responsible_id), (ld.sdr_id)
    ) AS m(member_id)
    WHERE m.member_id IS NOT NULL
  ) u
  GROUP BY 1,2,3,4
),

-- ═══ Une os dois grãos e emite revenue + count por célula ═══════════════════
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
-- explode em 1 célula por (coordenada × campo)
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
      -- Atribuição (R5) tem precedência no grão de membro: se o org-total do
      -- mesmo mês bate, a divergência por-membro é a OR-chain de 5 chaves
      -- (mesmo quando o membro só aparece de um lado).
      WHEN c.grain = 'org_member_month'
             AND EXISTS (
               SELECT 1 FROM joined j
               WHERE j.grain='org_month' AND j.organization_id=c.organization_id
                 AND j.year=c.year AND j.month=c.month
                 AND abs(COALESCE(
                     CASE WHEN c.field='revenue' THEN j.new_rev ELSE j.new_cnt END,0)
                   - COALESCE(
                     CASE WHEN c.field='revenue' THEN j.old_rev ELSE j.old_cnt END,0)) <= 0.01)
        THEN 'atribuicao-5-chaves (org-total bate; membro diverge por OR-chain)'
      WHEN COALESCE(c.new_value,0) = 0 AND COALESCE(c.old_value,0) <> 0
        THEN 'venda-pre-caderno? (motor novo sem evento)'
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

-- ── Invariante interna do motor NOVO: Σ(membro) + não-atribuído = total ────
-- (usa o próprio caderno; #1002 sobe pro CI). Rate ∈ [0,100] não se aplica a
-- venda; monotonia de funil é do par de funil (#996/#997), não deste.
-- Deriva de recon_cells: soma dos buckets org_member_month (inclui o bucket
-- não-atribuído, member=NULL) deve igualar o total org_month, por org e mês.
-- Como os dois grãos saem do MESMO projected_base, a igualdade é por
-- construção — a checagem é o guardião que #1002 sobe pro CI.
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
