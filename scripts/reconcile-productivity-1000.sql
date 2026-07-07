-- scripts/reconcile-productivity-1000.sql
--
-- INSTÂNCIA do par de PRODUTIVIDADE (#1000) pro motor genérico
-- reconcile-metrics.sql (ADR-0017 §8). Monta o temp table `recon_cells`
-- comparando, célula a célula, a dimensão `vendido` do placar por vendedor:
--
--   NOVO   = get_productivity_activity_by_seller (#1000) — `vendido` lido do
--            caderno sale_events, líquido de estorno (anti-join), âncora sold_at,
--            atribuição sale_responsible_id única, SEM type='system'. Aqui
--            replicado como SQL DIRETO sobre o caderno (mesma fonte, mesma regra
--            líquida ⇒ algebricamente igual à RPC; prior art reconcile-sales-995).
--
--   ANTIGO = bloco `vendido` legado (corpo de 20270201000000, snapshot #987) —
--            réplica SQL FIEL, bug-a-bug:
--              · funil     = pipeline_entries JOIN pipelines type='system'
--                            slug='propostas' stage_key='vendido' → custom
--                            pipelines INVISÍVEIS                             (R3)
--              · atribuição= COALESCE(sale_responsible_id, closer_id,
--                            metadata->>closer_id) ⇒ chave por-membro instável  (R5)
--              · âncora    = COALESCE(min(lead_history), closed_at,
--                            stage_changed_at) ⇒ zoo de âncoras                 (R4)
--              · mês       = cortado nos bounds crus [p_from,p_to] que o app
--                            calcula em UTC (getMonthRangeUTC)                  (§5)
--              · estorno   = invisível; saída de won segue contando            (§3)
--
-- GRÃO das células: org × mês (total de vendido) e org × vendedor × mês (vendido
--   por seller), campo `vendido` (contagem). Produtividade é CONTAGEM — não há
--   receita, então não há célula de revenue (difere do par de vendas #995).
--
-- QUANDO RODA: portão de reconciliação do SP-3, sobre dados REAIS (prod
--   read-only / dev), via scripts/reconcile-metrics.sh — NÃO no CI de unidade.
--
-- COMO RODAR:
--   PROD_DATABASE_URL=... scripts/reconcile-metrics.sh scripts/reconcile-productivity-1000.sql \
--     -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
--   # todas as orgs: -v org_id=NULL   |   `since` >= data do apply do caderno
--   #   (20270302000030); meses anteriores não têm sale_event e divergem por §7.
--
-- PORTÃO (ADR-0017 §8): célula divergente sem finding_ref = delta INEXPLICADO →
--   o motor falha. finding_ref vem do MAPA COMMITADO abaixo (recon_known_causes),
--   espelhado em scripts/reconcile-productivity-1000.deltas.md. Catch-all fica
--   NULL de propósito: exige classificação humana antes do portão passar.

\set ON_ERROR_STOP on

\if :{?org_id} \else \set org_id NULL \endif
\if :{?since}  \else \set since  '''2027-01-01''' \endif

-- ── Mapa COMMITADO causa→finding (espelha reconcile-productivity-1000.deltas.md) ──
CREATE TEMP TABLE recon_known_causes (pattern text, finding_ref text) ON COMMIT DROP;
INSERT INTO recon_known_causes (pattern, finding_ref) VALUES
  ('venda-pre-caderno%',        'ADR-0017 §7'),  -- janela pré-caderno, declarada
  ('estorno-so-no-caderno%',    'ADR-0017 §3'),  -- motor antigo não vê estorno
  ('atribuicao-multi-chave%',   'R5'),           -- COALESCE de atribuição
  ('custom-pipeline%',          'R3'),           -- funil custom (type<>'system') agora conta
  ('ancora-COALESCE%',          'R4'),           -- âncoras concorrentes
  ('tz-utc-vs-org%',            'ADR-0017 §5');  -- mês cortado em UTC vs tz org

WITH params AS (
  SELECT :org_id::uuid AS org_id, :since::date AS since
),

-- ═══ NOVO: `vendido` líquido do caderno (algebricamente = a RPC #1000) ══════
-- sale não-estornada; mês = sold_at cortado no tz da org (ADR-0017 §5);
-- atribuição = sale_responsible_id (chave única).
projected_base AS (
  SELECT
    se.organization_id,
    se.sale_responsible_id AS member_id,
    extract(year  FROM (se.sold_at AT TIME ZONE o.timezone))::int  AS year,
    extract(month FROM (se.sold_at AT TIME ZONE o.timezone))::int  AS month
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
projected_member AS (   -- grão org × vendedor × mês (só vendas atribuídas)
  SELECT organization_id, member_id, year, month, COUNT(*)::numeric AS cnt
  FROM projected_base
  WHERE member_id IS NOT NULL
  GROUP BY 1,2,3,4
),
projected_org AS (      -- grão org × mês (total de vendido, membro = NULL)
  SELECT organization_id, NULL::uuid AS member_id, year, month, COUNT(*)::numeric AS cnt
  FROM projected_base GROUP BY 1,3,4
),

-- ═══ ANTIGO: réplica fiel do bloco `vendido` legado, bug-a-bug ══════════════
-- Estado mutável: pipeline_entries no stage 'vendido' do system 'propostas'
-- (R3), âncora COALESCE lead_history/closed_at/stage_changed_at (R4), corte UTC
-- (§5), atribuição COALESCE 3-chaves (R5), sem visão de estorno (§3).
legacy_won AS (
  SELECT
    pe.organization_id,
    COALESCE(l.sale_responsible_id, l.closer_id, (pe.metadata->>'closer_id')::uuid) AS member_id, -- metric-lint-allow: réplica FIEL do motor antigo (R5) — o comparador é quem mata R5
    COALESCE(
      (
        SELECT min(lh.created_at)
        FROM public.lead_history lh
        WHERE lh.lead_id = pe.lead_id
          AND lh.organization_id = pe.organization_id
          AND (
               (lh.action = 'stage_changed' AND lh.metadata->>'to_stage' = 'vendido')
            OR (lh.action = 'proposal_status_changed' AND lh.description ILIKE '%vendido%')
          )
      ),
      pe.closed_at,
      pe.stage_changed_at
    ) AS sold_at
  FROM public.pipeline_entries pe
  JOIN public.pipelines pip
    ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  JOIN public.leads l
    ON l.id = pe.lead_id AND l.deleted_at IS NULL
  CROSS JOIN params p
  WHERE (p.org_id IS NULL OR pe.organization_id = p.org_id)
    AND pe.stage_key = 'vendido'
),
legacy_dated AS (
  SELECT
    lw.organization_id, lw.member_id,
    -- mês cortado em UTC (o app passa bounds UTC pra RPC legada)
    extract(year  FROM lw.sold_at AT TIME ZONE 'UTC')::int  AS year,
    extract(month FROM lw.sold_at AT TIME ZONE 'UTC')::int  AS month
  FROM legacy_won lw
  CROSS JOIN params p
  WHERE lw.sold_at IS NOT NULL
    AND (lw.sold_at AT TIME ZONE 'UTC')::date >= p.since
),
legacy_member AS (      -- grão org × vendedor × mês (atribuídos)
  SELECT organization_id, member_id, year, month, COUNT(*)::numeric AS cnt
  FROM legacy_dated
  WHERE member_id IS NOT NULL
  GROUP BY 1,2,3,4
),
legacy_org AS (         -- grão org × mês (total)
  SELECT organization_id, NULL::uuid AS member_id, year, month, COUNT(*)::numeric AS cnt
  FROM legacy_dated GROUP BY 1,3,4
),

-- ═══ Une os dois grãos, campo `vendido` (contagem) ══════════════════════════
new_cells AS (
  SELECT 'org_month' AS grain, organization_id, member_id, year, month, cnt FROM projected_org
  UNION ALL
  SELECT 'org_member_month', organization_id, member_id, year, month, cnt FROM projected_member
),
old_cells AS (
  SELECT 'org_month' AS grain, organization_id, member_id, year, month, cnt FROM legacy_org
  UNION ALL
  SELECT 'org_member_month', organization_id, member_id, year, month, cnt FROM legacy_member
),
joined AS (
  SELECT
    COALESCE(n.grain, o.grain)                     AS grain,
    COALESCE(n.organization_id, o.organization_id) AS organization_id,
    COALESCE(n.member_id, o.member_id)             AS member_id,
    COALESCE(n.year,  o.year)                      AS year,
    COALESCE(n.month, o.month)                     AS month,
    n.cnt AS new_cnt, o.cnt AS old_cnt
  FROM new_cells n
  FULL OUTER JOIN old_cells o
    ON  o.grain = n.grain
    AND o.organization_id = n.organization_id
    AND o.member_id IS NOT DISTINCT FROM n.member_id
    AND o.year = n.year AND o.month = n.month
),
scored AS (
  SELECT
    j.*,
    CASE
      -- Atribuição (R5) tem precedência no grão de membro: se o org-total do
      -- mesmo mês bate, a divergência por-membro é a COALESCE de 3 chaves.
      WHEN j.grain = 'org_member_month'
             AND EXISTS (
               SELECT 1 FROM joined t
               WHERE t.grain='org_month' AND t.organization_id=j.organization_id
                 AND t.year=j.year AND t.month=j.month
                 AND abs(COALESCE(t.new_cnt,0) - COALESCE(t.old_cnt,0)) <= 0.01)
        THEN 'atribuicao-multi-chave (org-total bate; membro diverge por COALESCE)'
      -- New conta e old não: funil custom (type<>'system') agora entra (R3).
      WHEN COALESCE(j.old_cnt,0) = 0 AND COALESCE(j.new_cnt,0) <> 0
        THEN 'custom-pipeline? (venda em funil não-system agora conta — R3)'
      -- Old conta e new não: venda cujo won precede o caderno (sem sale_event).
      WHEN COALESCE(j.new_cnt,0) = 0 AND COALESCE(j.old_cnt,0) <> 0
        THEN 'venda-pre-caderno? (motor novo sem sale_event)'
      ELSE 'verificar: ancora-COALESCE-vs-sold_at | tz-utc-vs-org | estorno-so-no-caderno'
    END AS suggested_cause
  FROM joined j
)
SELECT
  jsonb_build_object(
    'grain', s.grain, 'org', s.organization_id, 'member', s.member_id,
    'year', s.year, 'month', s.month, 'field', 'vendido'
  )                                                        AS dims,
  s.new_cnt                                                AS new_value,
  s.old_cnt                                                AS old_value,
  s.suggested_cause,
  kc.finding_ref                                           AS finding_ref
INTO TEMP recon_cells
FROM scored s
LEFT JOIN recon_known_causes kc ON s.suggested_cause LIKE kc.pattern;

-- ── Invariante interna do motor NOVO: Σ(vendido por vendedor) <= total ──────
-- O total org_month inclui vendas SEM sale_responsible_id (não-atribuídas), que
-- não entram em nenhum bucket de membro. Logo Σ(membro) <= total por mês/org
-- (igualdade só quando toda venda tem closer). Violar isso (Σ > total) seria
-- dupla contagem — o exato bug R5 que esta fatia mata.
CREATE TEMP TABLE recon_invariants (name text, ok boolean, detail text) ON COMMIT DROP;
INSERT INTO recon_invariants (name, ok, detail)
SELECT
  'novo: Σ(vendedor,mês) <= total(mês) por org (sem dupla contagem)',
  COALESCE(bool_and(mem_sum <= tot + 0.01), true),
  COALESCE(string_agg(CASE WHEN mem_sum > tot + 0.01
    THEN format('%s %s-%s Σmembro=%s total=%s', org, yr, mo, mem_sum, tot) END, '; '),
    'ok')
FROM (
  SELECT tot.org, tot.yr, tot.mo, COALESCE(tot.total,0) AS tot, COALESCE(mem.s,0) AS mem_sum
  FROM (
    SELECT dims->>'org' AS org, dims->>'year' AS yr, dims->>'month' AS mo, new_value AS total
    FROM recon_cells
    WHERE dims->>'grain' = 'org_month'
  ) tot
  LEFT JOIN (
    SELECT dims->>'org' AS org, dims->>'year' AS yr, dims->>'month' AS mo, SUM(new_value) AS s
    FROM recon_cells
    WHERE dims->>'grain' = 'org_member_month'
    GROUP BY 1,2,3
  ) mem ON mem.org = tot.org AND mem.yr = tot.yr AND mem.mo = tot.mo
) d;
