-- carteira: recompute síncrono das métricas de dinheiro do cliente da carteira
--
-- Problema: get_portfolio_kpis / portfolio tabs leem colunas derivadas de
-- upsell_clients (avg_ticket, last_order_at, next_order_expected, order_count,
-- reorder_cycle_days, days_since_last_order). Essas colunas só eram populadas
-- pelo cron calculate-portfolio-health (a cada 30min) e SÓ contam orders
-- approved. Resultado: registrar/aprovar venda não mexia a métrica na hora
-- (lag de até 30min, ou nunca se a order ficava pending). Ver diagnóstico
-- 2026-07-03 (basic4u).
--
-- Fix: função que recomputa as colunas "de dinheiro" a partir dos upsell_orders
-- APPROVED do cliente, disparada por trigger em qualquer INSERT/UPDATE/DELETE
-- que afete um order approved. Métrica reflete a venda em segundos.
--
-- Escopo intencional: só as colunas de dinheiro/recência. health_score, segment,
-- health_status, churn_probability, trend continuam vindo do cron (dependem de
-- engagement + orgAvgTicket + algoritmo em TS; replicar em SQL divergiria).
-- Semântica espelha supabase/functions/calculate-portfolio-health + _shared/portfolio-health.ts.
-- Validado 11/11 clientes basic4u vs valores gravados pelo edge fn (diff read-only).
--
-- Trade-offs conhecidos (aceitos):
--  - Trigger é FOR EACH ROW: import em massa de K orders do mesmo cliente recomputa
--    K vezes (custo triangular). OK no volume atual; se bulk approve virar comum,
--    trocar por statement-level com transition table.
--  - days_since_last_order só diverge do cron p/ sold_at FUTURO (data inválida):
--    aqui GREATEST(0,...) → 0; cron usa abs → positivo. Valor daqui é o mais correto.

-- ─────────────────────────────────────────────────────────────────────────────
-- Recompute de um cliente
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recalc_upsell_client_metrics(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id        uuid;
  v_org_default   int;
  v_order_count   int;
  v_total         numeric;
  v_avg           numeric;
  v_last          timestamptz;
  v_cycle         int;
  v_days_since    int;
  v_next          timestamptz;
  v_now           timestamptz := now();
BEGIN
  IF p_client_id IS NULL THEN
    RETURN;
  END IF;

  -- FOR UPDATE serializa recomputes concorrentes do MESMO cliente: sob READ
  -- COMMITTED, o 2º recompute espera o 1º commitar e então enxerga o order dele
  -- no agregado — evita lost-update (order_count/lifetime sobrescritos).
  SELECT organization_id INTO v_org_id
  FROM upsell_clients WHERE id = p_client_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RETURN; -- cliente inexistente (ex.: já deletado)
  END IF;

  -- default org de ciclo de recompra (fallback 30) — espelha orgDefaultCycleDays
  SELECT COALESCE(default_reorder_cycle_days, 30) INTO v_org_default
  FROM organizations WHERE id = v_org_id;
  v_org_default := COALESCE(v_org_default, 30);

  -- Agregados dos orders APPROVED (mesmo filtro do edge fn)
  SELECT count(*), COALESCE(sum(sale_value), 0), max(sold_at)
    INTO v_order_count, v_total, v_last
  FROM upsell_orders
  WHERE client_id = p_client_id
    AND approval_status = 'approved';

  -- avg_ticket: total/count, mas NULL se 0 (espelha `avgTicket || null` em JS)
  v_avg := CASE
             WHEN v_order_count > 0 AND v_total > 0 THEN v_total / v_order_count
             ELSE NULL
           END;

  -- reorder_cycle_days: < 2 orders → default org; senão média dos gaps (dias),
  -- arredondada, mínimo 1 (espelha computeCycleDays)
  IF v_order_count < 2 THEN
    v_cycle := v_org_default;
  ELSE
    SELECT GREATEST(1, round(avg(gap_days))::int)
      INTO v_cycle
    FROM (
      SELECT EXTRACT(EPOCH FROM (
               sold_at - lag(sold_at) OVER (ORDER BY sold_at)
             )) / 86400.0 AS gap_days
      FROM upsell_orders
      WHERE client_id = p_client_id
        AND approval_status = 'approved'
    ) g
    WHERE gap_days IS NOT NULL;
    v_cycle := COALESCE(v_cycle, v_org_default);
  END IF;

  -- days_since_last_order: 999 se nunca comprou (espelha edge fn); senão dias
  v_days_since := CASE
                    WHEN v_last IS NULL THEN 999
                    ELSE GREATEST(0, round(EXTRACT(EPOCH FROM (v_now - v_last)) / 86400.0)::int)
                  END;

  -- next_order_expected: último + ciclo (NULL se sem orders)
  v_next := CASE
              WHEN v_last IS NULL THEN NULL
              ELSE v_last + (v_cycle || ' days')::interval
            END;

  UPDATE upsell_clients SET
    order_count           = v_order_count,
    lifetime_value        = v_total,
    avg_ticket            = v_avg,
    last_order_at         = v_last,
    reorder_cycle_days    = v_cycle,
    days_since_last_order = v_days_since,
    next_order_expected   = v_next,
    updated_at            = v_now
  WHERE id = p_client_id;
END;
$function$;

-- Fecha superfície RPC: função nova recebe EXECUTE via PUBLIC por default (anon é
-- membro de PUBLIC) → REVOKE FROM anon não basta. Revoga de PUBLIC e concede só a
-- service_role. O trigger (SECURITY DEFINER, mesmo owner) chama internamente sem grant.
REVOKE ALL ON FUNCTION public.recalc_upsell_client_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalc_upsell_client_metrics(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: recomputa cliente afetado quando um order approved entra/sai/muda
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_upsell_order_recalc_metrics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.approval_status = 'approved' THEN
      PERFORM public.recalc_upsell_client_metrics(NEW.client_id);
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.approval_status = 'approved' THEN
      PERFORM public.recalc_upsell_client_metrics(OLD.client_id);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- só recomputa se algum lado envolve approved (pending↔pending não afeta métrica)
    IF OLD.approval_status = 'approved' OR NEW.approval_status = 'approved' THEN
      PERFORM public.recalc_upsell_client_metrics(NEW.client_id);
      -- cliente mudou de dono no mesmo order → recomputa o antigo também
      IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
        PERFORM public.recalc_upsell_client_metrics(OLD.client_id);
      END IF;
    END IF;
  END IF;

  RETURN NULL; -- AFTER trigger
END;
$function$;

DROP TRIGGER IF EXISTS trg_upsell_order_recalc_metrics ON public.upsell_orders;
CREATE TRIGGER trg_upsell_order_recalc_metrics
AFTER INSERT OR DELETE OR UPDATE OF approval_status, sale_value, sold_at, client_id
ON public.upsell_orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_upsell_order_recalc_metrics();

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: recomputa só os clientes que importam — quem tem order approved OU
-- order_count>0 (p/ resetar quem perdeu todos os orders). Clientes sem histórico
-- já têm null/0/999 corretos do cron; recomputá-los só bumparia updated_at e
-- dispararia realtime à toa. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT id FROM (
      SELECT client_id AS id
      FROM upsell_orders
      WHERE approval_status = 'approved' AND client_id IS NOT NULL
      UNION
      SELECT id FROM upsell_clients WHERE order_count > 0
    ) t
  LOOP
    PERFORM public.recalc_upsell_client_metrics(r.id);
  END LOOP;
END;
$$;
