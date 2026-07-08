-- 20270302000090_stage_role_money_guard_and_fn_hardening.sql
--
-- Code-review fixes sobre a refundação de métricas (ADR-0017). Money-critical.
-- Reúne 3 correções que compartilham superfície (pipeline_stages + funções da
-- fatia SP-3), numa migration só, sem tocar no CORPO das migrations mergeadas.
--
-- FIX-4 (SEGURANÇA) — stage_role (won/lost = dinheiro) é gravável por QUALQUER
--   membro. A RLS efetiva de pipeline_stages ("Users can manage pipeline
--   stages" FOR ALL USING organization_id IN get_my_organization_ids()) libera
--   escrita pra todo membro. Com stage_role=won/lost decidindo se uma transição
--   emite sale_event (receita) + projeta commission (ADR-0017 §1-2,§6), um
--   membro não-admin poderia marcar uma etapa custom como 'won', mover leads e
--   inflar receita + auto-creditar comissão (dentro do tenant). ADR-0017 §1:
--   won/lost = confirmação HUMANA (master ou admin da org). Trigger BEFORE
--   INSERT/UPDATE fecha esse buraco no nível de escrita — a RLS não distingue
--   admin de membro pra esta coluna, então o gate vive no trigger.
--
-- FIX-5 (segurança/consistência):
--   · fn_sale_events_force_sold_at() ganha SET search_path (invariante #638 —
--     search_path pinado em toda função; a original nasceu sem).
--   · get_funnel_flow() passa a chamar assert_org_access ANTES da validação de
--     p_pipeline_id (guard-first, como as RPCs irmãs). Corpo idêntico no resto.
--
-- FIX-6 (docs) — cabeçalhos de get_ranking (#997) e das RPCs de produtividade
--   (#1000) afirmam "custom pipelines contam / R3 morto". É PARCIAL: o SHAPE do
--   leitor é custom-agnóstico (nenhum predicado type='system'), mas
--   custom_pipeline_stages ainda NÃO tem governança de stage_role, então
--   metric_stage_role resolve NULL (≙ open) pra etapa custom → venda em pipeline
--   custom NÃO entra em sale_events → some do ledger. COMMENT ON FUNCTION honesto
--   registra a limitação e aponta o único ponto de extensão (metric_stage_role).
--   NÃO edita o corpo das migrations mergeadas.
--
-- READ/WRITE: cria 1 trigger + função nova; faz CREATE OR REPLACE em 2 funções
--   já existentes (preserva assinatura e grants); ajusta COMMENTs. Nenhuma
--   escrita em tabela de dados.
--
-- Rollback: supabase/migrations/rollback/20270302000090_stage_role_money_guard_and_fn_hardening.sql
-- Testes:   supabase/tests/stage_role_money_guard_test.sql (pgTAP, wired no run.sh)

-- ============================================================================
-- FIX-4 — Trigger: só master/admin (ou backend) grava stage_role won/lost
-- ============================================================================
-- Semântica:
--   · Só importa quando NEW.stage_role é won/lost. open/meeting_booked/
--     meeting_held ficam graváveis por membro (meeting_* são AUTO-APLICADOS
--     pelo classifier; ADR-0017 §1) — o trigger os deixa passar.
--   · No UPDATE, só barra quando o role está de fato SENDO ALTERADO pra
--     won/lost (OLD != NEW). Rename/reorder de uma etapa que JÁ era won/lost
--     (OLD = NEW = won) não reatribui dinheiro e não pode ser bloqueado — é
--     exatamente o caso que a razão-de-existir do ADR-0017 protege (renomear
--     nunca move métrica).
--   · Writers autorizados de role de dinheiro:
--       – backend/service_role: seed de org nova (create_default_pipeline_stages
--         → propostas/vendido = won via trigger de sistema), classifier
--         (aplica só suggested_stage_role / meeting_*; won/lost só após
--         aprovação humana), jobs internos. Detecção dupla (JWT claim OU role
--         de banco) porque o edge function usa a service key (seta ambos).
--       – superusuário / owner: migrations (backfill do #990), seed privilegiado
--         do pgTAP (SET role postgres).
--       – master (is_master_user): tela /master/stage-roles.
--       – admin da org de NEW.organization_id (get_my_admin_organization_ids):
--         modal de etapa do admin.
--   · Ordem de disparo: nomeado pra rodar DEPOIS de
--     trg_pipeline_stages_system_stage_role (BEFORE INSERT dispara em ordem
--     alfabética de nome; 'won_lost_guard' > 'system_stage_role'), pra avaliar
--     o role FINAL — inclusive quando o mapa determinístico converte
--     propostas/vendido em won no seed.
--
-- SECURITY INVOKER (default): os helpers is_master_user /
--   get_my_admin_organization_ids já são SECURITY DEFINER (bypassam RLS
--   internamente); o trigger não precisa de privilégio extra. search_path
--   pinado (invariante #638).

CREATE OR REPLACE FUNCTION public.fn_pipeline_stages_guard_money_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fora de won/lost: nada a governar (open/meeting_* seguem livres).
  IF NEW.stage_role IS DISTINCT FROM 'won'
     AND NEW.stage_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;

  -- UPDATE que NÃO muda o role (rename/reorder de etapa já won/lost): libera.
  IF TG_OP = 'UPDATE' AND OLD.stage_role IS NOT DISTINCT FROM NEW.stage_role THEN
    RETURN NEW;
  END IF;

  -- Writers autorizados de role de dinheiro.
  IF coalesce(auth.role(), '') = 'service_role'
     OR current_user = 'service_role'
     OR coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR public.is_master_user()
     OR NEW.organization_id IN (SELECT public.get_my_admin_organization_ids()) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'access_denied: stage_role % é dinheiro (ADR-0017 §1) — só admin da org ou master pode definir/alterar won/lost',
    NEW.stage_role
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_pipeline_stages_guard_money_role() FROM PUBLIC;

COMMENT ON FUNCTION public.fn_pipeline_stages_guard_money_role() IS
  'ADR-0017 §1 / FIX-4 — barra escrita de stage_role won/lost (dinheiro) por '
  'membro não-admin. Libera backend (service_role/superuser), master e admin '
  'da org. meeting_*/open ficam livres. Roda DEPOIS do trigger de mapa de '
  'sistema (avalia o role final). Fecha o gap: RLS de pipeline_stages não '
  'distingue admin de membro nesta coluna.';

-- Nome 'won_lost_guard' garante disparo APÓS 'system_stage_role' (ordem alfa).
DROP TRIGGER IF EXISTS trg_pipeline_stages_won_lost_guard ON public.pipeline_stages;
CREATE TRIGGER trg_pipeline_stages_won_lost_guard
  BEFORE INSERT OR UPDATE ON public.pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_pipeline_stages_guard_money_role();

-- ============================================================================
-- FIX-5a — search_path pinado em fn_sale_events_force_sold_at (#638)
-- ============================================================================
-- Corpo IDÊNTICO ao 20270302000030; só adiciona SET search_path.

CREATE OR REPLACE FUNCTION public.fn_sale_events_force_sold_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source = 'trigger' THEN
    NEW.sold_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- FIX-5b — get_funnel_flow: assert_org_access PRIMEIRO (guard-first)
-- ============================================================================
-- Corpo IDÊNTICO ao 20270302000060, com uma única mudança: assert_org_access
-- movido pra ANTES da validação de p_pipeline_id (consistência com as RPCs
-- irmãs — a fronteira de tenant é a primeira coisa avaliada). Assinatura e
-- grants preservados (CREATE OR REPLACE mantém privilégios).

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
  -- Guard-first: fronteira de tenant antes de qualquer validação de parâmetro
  -- (consistência com as RPCs irmãs de métrica).
  PERFORM public.assert_org_access(p_org_id);

  -- p_pipeline_id é OBRIGATÓRIO: funil é por-pipeline (R3 — nada de type='system').
  IF p_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'get_funnel_flow: p_pipeline_id é obrigatório (funil é por-pipeline)'
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

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

-- ============================================================================
-- FIX-6 — COMMENT honesto sobre cobertura de pipeline custom (sem editar corpos)
-- ============================================================================
-- Verdade: leitores têm SHAPE custom-agnóstico (nenhum predicado type='system'),
-- MAS custom_pipeline_stages ainda não tem governança de stage_role, então
-- metric_stage_role resolve NULL (≙ open) pra etapa custom → 'won' custom não
-- vira sale_event → venda de pipeline custom NÃO entra no ledger (some da
-- receita/pódio/produtividade) ATÉ a governança de role chegar em
-- custom_pipeline_stages. Ponto único de extensão: metric_stage_role.

COMMENT ON FUNCTION public.get_ranking(uuid, text, date, date, date, uuid) IS
  'ADR-0017 §2-5,§8 / #997 — leaderboard canônico de venda (SP-3). Lê SÓ '
  'sale_events, líquido de estorno; período no tz da org; atribuição por '
  'sale_responsible_id ÚNICO (mesma chave da projeção de comissão) ⇒ pódio == '
  'dashboard (== get_sales_metrics.by_closer) E venda no pódio ⟺ comissão. Mata '
  'R5/#3 (atribuição única), #8 (sem metric_type), R3 (sem type=system), R4/R6. '
  'Escopo: só venda; ranking de reunião é fatia posterior. Motor antigo '
  'get_ranking_data segue vivo (rollback). '
  'RESSALVA custom-pipeline (FIX-6): o SHAPE é custom-agnóstico (sem predicado '
  'type=''system''), mas custom_pipeline_stages ainda NÃO tem governança de '
  'stage_role → metric_stage_role resolve NULL (≙ open) pra etapa custom → venda '
  'em pipeline custom não emite sale_event e NÃO aparece aqui até essa governança '
  'chegar. Único ponto de extensão: metric_stage_role.';

COMMENT ON FUNCTION public.get_productivity_activity_by_seller(uuid, timestamptz, timestamptz) IS
  'ADR-0013 activity-in-period / ADR-0017 §2-5 / #1000 — placar por vendedor. '
  'vendido lê SÓ sale_events (líquido de estorno, âncora sold_at, atribuição '
  'sale_responsible_id única, sem type=''system''): mata R3/R4/R5 reintroduzidos '
  'na RPC de 2026-07-03. reuniões via meeting_events (ADR-0007); novos por created_at. '
  'RESSALVA custom-pipeline (FIX-6): o shape não filtra type=''system'', mas '
  'custom_pipeline_stages ainda sem governança de stage_role → venda em pipeline '
  'custom resolve role NULL, não entra em sale_events e NÃO conta aqui até a '
  'governança chegar. Ponto único de extensão: metric_stage_role.';

COMMENT ON FUNCTION public.get_productivity_activity(uuid, timestamptz, timestamptz, uuid) IS
  'ADR-0013 activity-in-period / ADR-0017 §2-5 / #1000 — produtividade da org. '
  'vendido lê SÓ sale_events (líquido de estorno, âncora sold_at). '
  'RESSALVA custom-pipeline (FIX-6): shape custom-agnóstico (sem type=''system''), '
  'mas custom_pipeline_stages ainda sem governança de stage_role → venda custom '
  'resolve role NULL, não entra em sale_events e NÃO conta até a governança '
  'chegar. Ponto único de extensão: metric_stage_role.';

COMMENT ON FUNCTION public.get_productivity_activity_leads(uuid, timestamptz, timestamptz, text, uuid) IS
  'ADR-0013 activity-in-period / ADR-0017 §2-5 / #1000 — drill do caderno de '
  'produtividade. vendido lê SÓ sale_events (líquido de estorno). '
  'RESSALVA custom-pipeline (FIX-6): sem predicado type=''system'', mas '
  'custom_pipeline_stages ainda sem governança de stage_role → venda custom '
  'não entra em sale_events e NÃO aparece no drill até a governança chegar. '
  'Ponto único de extensão: metric_stage_role.';
