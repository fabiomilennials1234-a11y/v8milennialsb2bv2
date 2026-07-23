-- 20270302000060_get_funnel_flow.sql
--
-- Issue #996 · PRD #986 · ADR-0017 §1,§5,§7,§8 — LEITOR CANÔNICO de FUNIL (SP-3).
-- "get_dashboard_metrics ... must be rewritten to read ledgers only (SP-3);
--  legacy RPCs stay alive until the reconciliation gate passes (rollback path)."
--
-- O QUE FAZ: expõe o funil COORTE/FLUXO (modelo Pipedrive/HubSpot) de UM
-- pipeline num período NOMEADO, lendo SÓ o caderno append-only
-- `pipeline_stage_events` (#992) e resolvendo semântica de etapa SÓ pelo
-- `stage_role` governado (via metric_stage_role, #993/#990). É o motor NOVO que
-- a fatia SP-3 (funil/TV) passa a consumir; os motores antigos
-- (get_funnel_health, get_funnel_conversion — snapshots #987) ficam VIVOS e
-- intocados como rollback até o portão de reconciliação (#996, ADR-0017 §8).
--
-- MATA, POR CONSTRUÇÃO, os vícios de funil da auditoria 2026-07-02:
--   · R1 (funil de estado mutável do kanban — renomear/reordenar etapa zera a
--     métrica) → funil vem SÓ do caderno imutável de transições; renomear uma
--     stage nunca move um número (ADR-0017 §1).
--   · R2 (stage_key editável hardcoded na métrica) → NENHUMA string de stage_key
--     aparece aqui; a semântica vem SÓ de metric_stage_role → stage_role enum.
--   · R3 (custom pipelines invisíveis por predicado type='system') → o funil é
--     parametrizado por p_pipeline_id (OBRIGATÓRIO); NUNCA há filtro type=
--     'system'. Custom pipeline é cidadão de primeira classe — devolve números
--     REAIS, não zero. (Governança de role em custom_pipeline_stages ainda não
--     existe → custom sem role resolve NULL ≙ open; limitação declarada abaixo.)
--   · R4 (âncoras temporais concorrentes) → a coorte ancora numa âncora só:
--     occurred_at da ENTRADA do lead no funil. Nenhum COALESCE de tempo.
--   · #1 (funil não reconcilia) → reconciliado célula-a-célula vs réplica fiel
--     de get_funnel_health (scripts/reconcile-funnel-996.sql, §8).
--   · #6 (Reunião→Proposta sempre 100% por bug de copy-paste do LAG/ELSE 100)
--     → conversion_from_prev é NULL-safe: prev=0 → NULL, JAMAIS 100 forjado.
--   · #14 (get_funnel_health conta "ever-reached" sem corte temporal sobre
--     coorte por created_at) → aqui a COORTE é cortada pela ENTRADA no pipeline
--     no período (tz da org); a divergência vs #14 é explicada no portão.
--   · #16 (truncamento de 500 entries na TV) → agregação é 100% no banco
--     (COUNT sobre o caderno), sem teto de linhas no cliente.
--
-- MODELO COORTE/FLUXO (não "estado atual do board"):
--   COORTE = leads cuja ENTRADA no pipeline p_pipeline_id ocorreu DENTRO do
--     período (metric_period_bounds, tz da org). Entrada = a linha mais antiga
--     do lead no caderno para esse pipeline: a de from_stage_key IS NULL (o
--     INSERT da entry) e, na sua ausência (backfill sem linha de entrada),
--     min(occurred_at). Ancorar a coorte na ENTRADA — não em created_at do lead
--     (isso é #14) nem no estado atual — é o que dá um funil de fluxo honesto.
--
--   ALCANCE por role, em ordem canônica open → meeting_booked → meeting_held →
--     won (lost = balde terminal SEPARADO). Para cada role R, conta os leads da
--     coorte que EVER (a qualquer tempo, por occurred_at) alcançaram R **ou
--     qualquer role a jusante**. Operacionalmente: por lead, max_rank = maior
--     rank de role entre TODAS as suas transições no pipeline
--     (open=0 booked=1 held=2 won=3; NULL≙open=0); reached(R) = #{lead da coorte
--     com max_rank >= rank(R)}.
--
--   MONOTONICIDADE POR CONSTRUÇÃO: reached(R) é a contagem de um predicado
--     max_rank >= rank(R) com rank ESTRITAMENTE crescente na ordem canônica;
--     logo reached(open) >= reached(booked) >= reached(held) >= reached(won)
--     SEMPRE — inclusive quando um lead PULA etapas (entra direto em won:
--     max_rank=3 >= todos os ranks, então conta em open/booked/held/won). O
--     funil nunca "alarga" descendo. A invariante é do shape, não da esperança.
--     (mata a classe do #6: um degrau nunca fica maior que o anterior.)
--
-- CORTE DE PERÍODO (ADR-0017 §5): o caller NOMEIA o período; metric_period_bounds
--   (#989) resolve as fronteiras no tz da ORG e devolve tstzrange meio-aberto [).
--   Esta função NUNCA calcula data de corte — só passa o range pro predicado
--   `entry_at <@ bounds`. Fronteira é responsabilidade do banco.
--
-- CAVEAT PRÉ-CORTE (ADR-0017 §7): o backfill de transições é best-effort até o
--   corte contratual 2026-12-01. Se a fronteira inferior da coorte for anterior
--   a esse corte, o funil "parecerá mais raso" que a realidade — rotulado
--   (pre_cutover_caveat=true), não mascarado. Rótulo grosseiro ancorado em UTC
--   (é um label, não um corte de métrica).
--
-- CONVERSÕES:
--   · conversion_from_top(R) = reached(R)/cohort_size · 100  ∈ [0,100].
--   · conversion_from_prev(R) = reached(R)/reached(prev) · 100 ∈ [0,100],
--     NULL-safe: prev=0 → NULL (nunca /0, nunca 100 forjado — mata #6). O
--     primeiro degrau (open) tem conversion_from_prev = NULL (não há anterior).
--   Ambas ∈ [0,100] por construção: numerador <= denominador (monotonicidade),
--     ambos contagens da MESMA coorte.
--
-- Guard: PERFORM assert_org_access(p_org_id) (mesma fronteira de tenant das
--   demais RPCs de métrica). SECURITY DEFINER: roda sob authenticated (RLS on)
--   e service_role/cron; pipeline_stage_events é tenant-scoped e o guard é a
--   fronteira. NÃO toca nas RPCs de funil legadas (caminho de rollback).
--
-- Rollback: supabase/migrations/rollback/20270302000060_get_funnel_flow.sql
-- Testes:   supabase/tests/get_funnel_flow_test.sql (pgTAP, wired no run.sh)
-- Reconc.:  scripts/reconcile-funnel-996.sql (× get_funnel_health, §8)

CREATE OR REPLACE FUNCTION public.get_funnel_flow(
  p_org_id      uuid,
  p_pipeline_id uuid,
  p_period      text,
  p_ref         date DEFAULT NULL,
  p_start       date DEFAULT NULL,
  p_end         date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds       tstzrange;
  v_cohort_size  integer;
  v_reached_open integer;
  v_reached_book integer;
  v_reached_held integer;
  v_reached_won  integer;
  v_lost_count   integer;
  v_pre_cutover  boolean;
BEGIN
  -- p_pipeline_id é OBRIGATÓRIO: funil é por-pipeline (R3 — nada de type='system').
  IF p_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'get_funnel_flow: p_pipeline_id é obrigatório (funil é por-pipeline)'
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  PERFORM public.assert_org_access(p_org_id);

  -- Fronteira do período: resolvida SÓ pelo banco, no tz da org (ADR-0017 §5).
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);

  -- ── Coorte (entrada no pipeline dentro do período) + alcance por role ──────
  -- pipe_events: todas as transições do pipeline p, com o role governado de
  --   cada to_stage_key (metric_stage_role; NULL ≙ open — R3/limitação custom).
  -- entry: âncora ÚNICA da coorte = occurred_at da entrada (from_stage_key NULL,
  --   senão a mais antiga). Nada de COALESCE de âncoras concorrentes (R4).
  -- lead_reach: por lead da coorte, o maior rank de role alcançado (max_rank) e
  --   se alguma vez caiu em lost. reached(R) = #{max_rank >= rank(R)} — monotônico
  --   por construção mesmo com pulo de etapa.
  WITH pipe_events AS (
    SELECT
      e.lead_id,
      e.from_stage_key,
      e.occurred_at,
      public.metric_stage_role(p_org_id, p_pipeline_id, e.to_stage_key) AS role
    FROM public.pipeline_stage_events e
    WHERE e.organization_id = p_org_id
      AND e.pipeline_id     = p_pipeline_id
  ),
  entry AS (
    SELECT
      pe.lead_id,
      COALESCE(
        min(pe.occurred_at) FILTER (WHERE pe.from_stage_key IS NULL),
        min(pe.occurred_at)
      ) AS entry_at
    FROM pipe_events pe
    GROUP BY pe.lead_id
  ),
  cohort AS (
    SELECT en.lead_id
    FROM entry en
    WHERE en.entry_at <@ v_bounds
  ),
  lead_reach AS (
    SELECT
      pe.lead_id,
      max(
        CASE pe.role
          WHEN 'meeting_booked' THEN 1
          WHEN 'meeting_held'   THEN 2
          WHEN 'won'            THEN 3
          ELSE 0   -- open E NULL (custom sem governança ≙ open) E lost → rank 0 na cadeia
        END
      ) AS max_rank,
      bool_or(pe.role = 'lost') AS ever_lost
    FROM pipe_events pe
    JOIN cohort c ON c.lead_id = pe.lead_id
    GROUP BY pe.lead_id
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE lr.max_rank >= 0),   -- open  (== coorte por construção)
    count(*) FILTER (WHERE lr.max_rank >= 1),   -- meeting_booked ou a jusante
    count(*) FILTER (WHERE lr.max_rank >= 2),   -- meeting_held ou a jusante
    count(*) FILTER (WHERE lr.max_rank >= 3),   -- won
    count(*) FILTER (WHERE lr.ever_lost)        -- terminal negativo (balde à parte)
  INTO v_cohort_size, v_reached_open, v_reached_book, v_reached_held, v_reached_won, v_lost_count
  FROM lead_reach lr;

  v_cohort_size := COALESCE(v_cohort_size, 0);
  v_reached_open := COALESCE(v_reached_open, 0);
  v_reached_book := COALESCE(v_reached_book, 0);
  v_reached_held := COALESCE(v_reached_held, 0);
  v_reached_won  := COALESCE(v_reached_won, 0);
  v_lost_count   := COALESCE(v_lost_count, 0);

  -- Rótulo best-effort pré-corte 2026-12-01 (ADR-0017 §7). Grosseiro (UTC), é
  -- um label de confiabilidade, não um corte de métrica.
  v_pre_cutover := lower(v_bounds) < '2026-12-01T00:00:00Z'::timestamptz;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'name',  p_period,
      'start', lower(v_bounds),
      'end',   upper(v_bounds)
    ),
    'pipeline_id',         p_pipeline_id,
    'cohort_size',         v_cohort_size,
    'lost_count',          v_lost_count,
    -- Funil pré-corte é best-effort DECLARADO, não mascarado (§7).
    'pre_cutover_caveat',  v_pre_cutover,
    'steps', jsonb_build_array(
      public.fn_funnel_flow_step('open',           v_reached_open, v_cohort_size, NULL),
      public.fn_funnel_flow_step('meeting_booked', v_reached_book, v_cohort_size, v_reached_open),
      public.fn_funnel_flow_step('meeting_held',   v_reached_held, v_cohort_size, v_reached_book),
      public.fn_funnel_flow_step('won',            v_reached_won,  v_cohort_size, v_reached_held)
    ),
    'lost', jsonb_build_object(
      'role',                'lost',
      'lost_count',          v_lost_count,
      -- lost é balde terminal: % sobre a coorte, fora da cadeia monotônica.
      'conversion_from_top', CASE WHEN v_cohort_size > 0
                                  THEN round(v_lost_count::numeric / v_cohort_size * 100, 1)
                                  ELSE NULL END
    )
  );
END;
$$;

-- Helper puro: monta um degrau do funil com as duas taxas NULL-safe.
-- conversion_from_prev é NULL quando prev=0 (nunca /0, nunca 100 forjado — #6).
-- IMMUTABLE: função pura sobre os argumentos.
CREATE OR REPLACE FUNCTION public.fn_funnel_flow_step(
  p_role        text,
  p_reached     integer,
  p_cohort_size integer,
  p_prev        integer   -- NULL no primeiro degrau (não há anterior)
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'role',           p_role,
    'reached_count',  p_reached,
    'conversion_from_top',
      CASE WHEN p_cohort_size > 0
           THEN round(p_reached::numeric / p_cohort_size * 100, 1)
           ELSE NULL END,
    'conversion_from_prev',
      CASE WHEN p_prev IS NULL OR p_prev = 0
           THEN NULL                                   -- NULL-safe: mata o #6
           ELSE round(p_reached::numeric / p_prev * 100, 1) END
  );
$$;

COMMENT ON FUNCTION public.fn_funnel_flow_step(text, integer, integer, integer) IS
  'ADR-0017 §8 / #996 — helper puro de degrau de funil. conversion_from_prev '
  'NULL-safe (prev=0 → NULL, nunca 100 forjado — mata #6).';

COMMENT ON FUNCTION public.get_funnel_flow(uuid, uuid, text, date, date, date) IS
  'ADR-0017 §1,§5,§7,§8 / #996 — leitor canônico de FUNIL coorte/fluxo (SP-3). '
  'Lê SÓ pipeline_stage_events; semântica de etapa SÓ por stage_role governado. '
  'Coorte = entrada no pipeline no período (tz da org); reached(role ou a jusante) '
  'monotônico por construção; conversion_from_prev NULL-safe. Mata R1/R2/R3/R4 e '
  '#1/#6/#14/#16. Custom sem governança de role ≙ open (limitação declarada). '
  'Motores antigos get_funnel_health/get_funnel_conversion seguem vivos (rollback).';

REVOKE ALL ON FUNCTION public.get_funnel_flow(uuid, uuid, text, date, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_funnel_flow(uuid, uuid, text, date, date, date)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_funnel_flow_step(text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_funnel_flow_step(text, integer, integer, integer)
  TO authenticated, service_role;
