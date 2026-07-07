-- scripts/reconcile-funnel-996.sql
--
-- INSTÂNCIA do par de FUNIL (#996) pro motor genérico reconcile-metrics.sql
-- (ADR-0017 §8). Monta os temp tables `recon_cells` (+ `recon_invariants`)
-- comparando, célula a célula:
--
--   NOVO   = get_funnel_flow (#996) — funil coorte/fluxo lendo o caderno
--            pipeline_stage_events, coorte pela ENTRADA no pipeline no período
--            (tz da org), alcance por stage_role governado (metric_stage_role),
--            monotônico por construção. Aqui replicado como SQL DIRETO sobre o
--            caderno (mesma fonte, mesma regra ⇒ algebricamente igual à RPC;
--            prior art: reconcile-sales-995.sql lê o caderno direto — evita o
--            assert_org_access, que barraria a RPC numa sessão sem tenant).
--
--   ANTIGO = get_funnel_health (snapshot #987) — réplica SQL FIEL, bug-a-bug,
--            do motor de funil vivo:
--              · COORTE por leads.created_at no período (NÃO por entrada no
--                funil) + "ever-reached" sem corte temporal                  (#14)
--              · reunião/compareceu de meeting_events ORG-WIDE (não por-pipe)  (#14)
--              · vendido SÓ do pipeline SYSTEM 'propostas' (type='system') ⇒
--                qualquer funil custom é INVISÍVEL (conta 0)                  (R3)
--              · sem noção de coorte-por-entrada ⇒ o funil não reconcilia
--                célula-a-célula com o novo                                  (#1)
--
-- GRÃO das células: org × pipeline × role × mês, role ∈ {open, meeting_booked,
--   meeting_held, won}. `lost` é capacidade NOVA (balde terminal) sem
--   contraparte no motor antigo ⇒ não é reconciliável e não vira célula
--   (mesma regra do split de Revenue Stream no par de vendas, §2).
--
-- MAPA das divergências (todas ESPERADAS e sancionadas, espelhado em
--   scripts/reconcile-funnel-996.deltas.md):
--   · funil no pipeline SYSTEM propostas: diverge porque a COORTE mudou de
--     created_at-ever-reached (legado) pra entrada-no-funil (novo) ⇒ #14.
--   · funil em QUALQUER pipeline custom: legado conta 0 (cego por type='system'),
--     novo conta números REAIS ⇒ R3.
--   · mês anterior ao caderno (corte 2026-12-01, §7): best-effort declarado.
--   · monotonia/#6 (Reunião→Proposta 100% forjado): não vira célula de contagem
--     — é garantida pela INVARIANTE de monotonicidade + rate∈[0,100] abaixo.
--
-- QUANDO RODA: portão do SP-3, sobre dados REAIS (prod read-only / dev), via
--   scripts/reconcile-metrics.sh — NÃO no CI de unidade.
--
-- COMO RODAR:
--   PROD_DATABASE_URL=... scripts/reconcile-metrics.sh scripts/reconcile-funnel-996.sql \
--     -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
--   # todas as orgs: -v org_id=NULL
--
-- PORTÃO (ADR-0017 §8): célula divergente sem finding_ref = delta INEXPLICADO
--   → o motor falha. finding_ref vem do MAPA COMMITADO (recon_known_causes),
--   espelhado no .deltas.md. Catch-all ("verificar") fica NULL de propósito:
--   exige classificação humana. Alterar política = editar o .deltas.md + a lista,
--   nunca a lógica de comparação do motor.

\set ON_ERROR_STOP on

\if :{?org_id}       \else \set org_id       NULL              \endif
\if :{?since}        \else \set since        '''2027-01-01'''  \endif
\if :{?caderno_since} \else \set caderno_since '''2026-12-01''' \endif

-- ── Mapa COMMITADO causa→finding (espelha reconcile-funnel-996.deltas.md) ────
CREATE TEMP TABLE recon_known_causes (pattern text, finding_ref text) ON COMMIT DROP;
INSERT INTO recon_known_causes (pattern, finding_ref) VALUES
  ('funil-pre-caderno%',        'ADR-0017 §7'),  -- janela pré-caderno, declarada
  ('cohort-vs-ever-reached%',   '#14'),          -- coorte por entrada vs created_at
  ('custom-pipe-now-visible%',  'R3'),           -- custom antes invisível (type=system)
  ('monotonia-corrigida%',      '#6');           -- Reunião→Proposta 100% forjado (via invariante)

-- ═══ NOVO: réplica direta do caderno (algebricamente = get_funnel_flow) ═════
-- Coorte = entrada no pipeline no mês (tz da org); alcance por max_rank de role.
CREATE TEMP TABLE recon_new_raw AS
WITH params AS (
  SELECT :org_id::uuid AS org_id, :since::date AS since
),
new_events AS (
  SELECT
    e.organization_id, e.pipeline_id, e.lead_id, e.from_stage_key, e.occurred_at,
    public.metric_stage_role(e.organization_id, e.pipeline_id, e.to_stage_key) AS role
  FROM public.pipeline_stage_events e
  CROSS JOIN params p
  WHERE (p.org_id IS NULL OR e.organization_id = p.org_id)
),
new_entry AS (   -- âncora ÚNICA: entrada (from NULL, senão a mais antiga) — R4
  SELECT organization_id, pipeline_id, lead_id,
         COALESCE(min(occurred_at) FILTER (WHERE from_stage_key IS NULL),
                  min(occurred_at)) AS entry_at
  FROM new_events GROUP BY 1,2,3
),
new_cohort AS ( -- mês da entrada no tz da org
  SELECT ne.organization_id, ne.pipeline_id, ne.lead_id,
         extract(year  FROM (ne.entry_at AT TIME ZONE o.timezone))::int AS year,
         extract(month FROM (ne.entry_at AT TIME ZONE o.timezone))::int AS month
  FROM new_entry ne
  JOIN public.organizations o ON o.id = ne.organization_id
  CROSS JOIN params p
  WHERE (ne.entry_at AT TIME ZONE o.timezone)::date >= p.since
),
new_reach AS ( -- max_rank de role por (org,pipeline,lead), NULL≙open=0
  SELECT organization_id, pipeline_id, lead_id,
         max(CASE role
               WHEN 'meeting_booked' THEN 1
               WHEN 'meeting_held'   THEN 2
               WHEN 'won'            THEN 3
               ELSE 0
             END) AS max_rank
  FROM new_events GROUP BY 1,2,3
)
SELECT c.organization_id, c.pipeline_id, c.year, c.month,
       count(*)                               AS reached_open,
       count(*) FILTER (WHERE r.max_rank >= 1) AS reached_booked,
       count(*) FILTER (WHERE r.max_rank >= 2) AS reached_held,
       count(*) FILTER (WHERE r.max_rank >= 3) AS reached_won
FROM new_cohort c
JOIN new_reach r
  ON r.organization_id = c.organization_id
 AND r.pipeline_id     = c.pipeline_id
 AND r.lead_id         = c.lead_id
GROUP BY 1,2,3,4;

-- ═══ ANTIGO: réplica fiel de get_funnel_health, bug-a-bug ════════════════════
-- Coorte por created_at (#14); meeting_events org-wide "ever reached"; vendido
-- SÓ do pipeline system 'propostas' (R3). Toda a contagem legada é atribuída a
-- ESSE pipeline (o único que o legado enxerga p/ venda) — os demais ficam 0.
CREATE TEMP TABLE recon_old_raw AS
WITH params AS (
  SELECT :org_id::uuid AS org_id, :since::date AS since
),
sys_propostas AS (
  SELECT pip.organization_id, pip.id AS pipeline_id
  FROM public.pipelines pip
  WHERE pip.slug = 'propostas'
    AND pip.type = 'system'   -- metric-lint-allow: réplica FIEL do legado (R3); o comparador é quem mata R3
),
legacy_cohort AS (
  SELECT l.organization_id, l.id AS lead_id,
         extract(year  FROM (l.created_at AT TIME ZONE o.timezone))::int AS year,
         extract(month FROM (l.created_at AT TIME ZONE o.timezone))::int AS month
  FROM public.leads l
  JOIN public.organizations o ON o.id = l.organization_id
  CROSS JOIN params p
  WHERE l.deleted_at IS NULL
    AND (p.org_id IS NULL OR l.organization_id = p.org_id)
    AND (l.created_at AT TIME ZONE o.timezone)::date >= p.since
),
legacy_meet AS (  -- meeting_events org-wide, ever-reached, deduped por lead (#14)
  SELECT me.lead_id,
         bool_or(me.event_type = 'meeting_booked') AS booked,
         bool_or(me.event_type = 'meeting_held')   AS held
  FROM public.meeting_events me
  GROUP BY me.lead_id
),
legacy_won AS (   -- vendido SÓ do pipeline system propostas (R3)
  SELECT DISTINCT pe.organization_id, pe.lead_id
  FROM public.pipeline_entries pe
  JOIN public.pipelines pip
    ON pip.id = pe.pipeline_id
   AND pip.slug = 'propostas'
   AND pip.type = 'system'   -- metric-lint-allow: réplica FIEL do legado (R3)
  WHERE pe.stage_key = 'vendido'
)
SELECT c.organization_id, sp.pipeline_id, c.year, c.month,
       count(*)                                            AS reached_open,      -- entraram
       count(*) FILTER (WHERE COALESCE(m.booked,false))    AS reached_booked,    -- reuniao
       count(*) FILTER (WHERE COALESCE(m.held,false))      AS reached_held,      -- compareceram
       count(*) FILTER (WHERE w.lead_id IS NOT NULL)       AS reached_won        -- compraram
FROM legacy_cohort c
JOIN sys_propostas sp ON sp.organization_id = c.organization_id
LEFT JOIN legacy_meet m ON m.lead_id = c.lead_id
LEFT JOIN legacy_won  w ON w.lead_id = c.lead_id AND w.organization_id = c.organization_id
GROUP BY 1,2,3,4;

-- ═══ Explode em células por role e cruza NOVO×ANTIGO ════════════════════════
CREATE TEMP TABLE recon_cells AS
WITH new_cells AS (
  SELECT organization_id, pipeline_id, year, month, 'open'           AS role, reached_open   AS val FROM recon_new_raw
  UNION ALL SELECT organization_id, pipeline_id, year, month, 'meeting_booked', reached_booked FROM recon_new_raw
  UNION ALL SELECT organization_id, pipeline_id, year, month, 'meeting_held',   reached_held   FROM recon_new_raw
  UNION ALL SELECT organization_id, pipeline_id, year, month, 'won',            reached_won    FROM recon_new_raw
),
old_cells AS (
  SELECT organization_id, pipeline_id, year, month, 'open'           AS role, reached_open   AS val FROM recon_old_raw
  UNION ALL SELECT organization_id, pipeline_id, year, month, 'meeting_booked', reached_booked FROM recon_old_raw
  UNION ALL SELECT organization_id, pipeline_id, year, month, 'meeting_held',   reached_held   FROM recon_old_raw
  UNION ALL SELECT organization_id, pipeline_id, year, month, 'won',            reached_won    FROM recon_old_raw
),
joined AS (
  SELECT
    COALESCE(n.organization_id, o.organization_id) AS organization_id,
    COALESCE(n.pipeline_id,     o.pipeline_id)     AS pipeline_id,
    COALESCE(n.year,  o.year)                      AS year,
    COALESCE(n.month, o.month)                     AS month,
    COALESCE(n.role,  o.role)                      AS role,
    n.val AS new_value, o.val AS old_value,
    (o.pipeline_id IS NOT NULL) AS legacy_sees_pipe   -- legado só emite p/ o system propostas
  FROM new_cells n
  FULL OUTER JOIN old_cells o
    ON  o.organization_id = n.organization_id
    AND o.pipeline_id     = n.pipeline_id
    AND o.year = n.year AND o.month = n.month
    AND o.role = n.role
),
scored AS (
  SELECT j.*,
    CASE
      WHEN make_date(j.year, j.month, 1) < :caderno_since::date
        THEN 'funil-pre-caderno (mês anterior ao corte do caderno, best-effort §7)'
      -- Custom/qualquer funil que o legado NÃO enxerga (só propostas system):
      WHEN NOT j.legacy_sees_pipe AND COALESCE(j.new_value,0) <> 0
        THEN 'custom-pipe-now-visible (funil fora do propostas system; legado cego por type=system)'
      -- Pipeline system propostas: a coorte mudou (created_at→entrada) — #14.
      WHEN j.legacy_sees_pipe
        THEN 'cohort-vs-ever-reached (coorte por entrada no funil vs created_at ever-reached do legado)'
      ELSE 'verificar: divergencia nao classificada (monotonia? tz? governanca de role?)'
    END AS suggested_cause
  FROM joined j
)
SELECT
  jsonb_build_object(
    'grain', 'org_pipeline_role_month',
    'org',   s.organization_id,
    'pipeline', s.pipeline_id,
    'year',  s.year, 'month', s.month, 'role', s.role
  )                                                AS dims,
  s.new_value,
  s.old_value,
  s.suggested_cause,
  kc.finding_ref                                   AS finding_ref
FROM scored s
LEFT JOIN recon_known_causes kc ON s.suggested_cause LIKE kc.pattern;

-- ── Invariantes internas do motor NOVO (sobem pro CI, #1002) ────────────────
-- (1) Monotonicidade: open >= booked >= held >= won por (org,pipeline,mês).
-- (2) Rate ∈ [0,100]: reached(role) <= reached(open) (numerador <= coorte).
-- Ambas derivam do shape do NOVO (recon_new_raw) — verdadeiras por construção;
-- a checagem é o guardião que #1002 sobe pro CI.
CREATE TEMP TABLE recon_invariants (name text, ok boolean, detail text) ON COMMIT DROP;

INSERT INTO recon_invariants (name, ok, detail)
SELECT
  'novo: funil monotônico (open>=booked>=held>=won) por org×pipeline×mês',
  COALESCE(bool_and(reached_open >= reached_booked
                AND reached_booked >= reached_held
                AND reached_held   >= reached_won), true),
  COALESCE(string_agg(
    CASE WHEN NOT (reached_open >= reached_booked
              AND reached_booked >= reached_held
              AND reached_held   >= reached_won)
         THEN format('%s/%s %s-%s [%s,%s,%s,%s]',
              organization_id, pipeline_id, year, month,
              reached_open, reached_booked, reached_held, reached_won) END, '; '),
    'ok')
FROM recon_new_raw;

INSERT INTO recon_invariants (name, ok, detail)
SELECT
  'novo: rate ∈ [0,100] (reached(role) <= coorte) por org×pipeline×mês',
  COALESCE(bool_and(reached_booked <= reached_open
                AND reached_held   <= reached_open
                AND reached_won    <= reached_open), true),
  'ok'
FROM recon_new_raw;
