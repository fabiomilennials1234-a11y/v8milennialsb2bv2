-- carteira: ciclo de recompra e ticket médio passam a contar PEDIDO, não ITEM
--
-- Problema (achado 2026-08-12 medindo o fix da Receita Recorrente): `upsell_orders`
-- grava UMA LINHA POR ITEM de produto (product_id, product_name, sale_value) e não
-- existe coluna que agrupe as linhas de um mesmo pedido — o `external_id` do Tiny
-- é por linha. Tanto esta função quanto a gêmea em TS
-- (supabase/functions/calculate-portfolio-health) tratavam cada linha como um
-- pedido. Uma venda com 2 itens virava "2 pedidos separados por 0 dia":
--
--   BEATRIS SILVEIRA LIBONI   2025-08-12 12:00:00   R$ 3.180,50   approved
--   BEATRIS SILVEIRA LIBONI   2025-08-12 12:00:00   R$   117,70   approved
--
-- Efeito: reorder_cycle_days = 1 → o KPI "Receita Recorrente"
-- (avg_ticket * 30/ciclo) multiplicava o ticket por 30; avg_ticket dividido por
-- linhas ficava subestimado; next_order_expected nascia sempre vencido.
--
-- Fix: pedido = todas as linhas do mesmo cliente no mesmo DIA UTC de sold_at.
-- Determinístico, vale pra Tiny e pra venda manual, não exige coluna nova.
-- UTC (e não America/Sao_Paulo) para casar exatamente com o
-- `new Date(sold_at).toISOString().slice(0,10)` do gêmeo em TS — se as duas
-- implementações divergirem o valor gravado oscila entre a trigger e o cron de
-- 30min (ver src/modules/carteira/CLAUDE.md). Medido no PROD: os dois fusos
-- divergem em 1 cliente de 333; agrupar por dia colapsa 534 linhas em 402
-- pedidos (por timestamp exato seriam 404).
--
-- ESCOPO DELIBERADO (decisão do CTO, 2026-08-13): o agrupamento alimenta SÓ
-- reorder_cycle_days e avg_ticket. `order_count` continua contando LINHAS
-- porque é entrada de deriveSegment no TS (< 3 → 'novo', >= 5 → 'ouro'/'resgate'):
-- trocá-lo jogaria 145 dos 148 clientes da Basic4u pra 'novo' e esvaziaria os
-- funis de ouro/prata/resgate. Consequência aceita e visível na tela do cliente:
-- para pedido multi-item, lifetime_value / order_count ≠ avg_ticket.
--
-- Também corrige código morto de archive/20270107000000_carteira_recalc_client_metrics_trigger.sql
-- (linha 98), cuja versão viva no PROD foi conferida via pg_get_functiondef e
-- bate byte a byte com o arquivo:
--   SELECT GREATEST(1, round(avg(gap_days))::int) INTO v_cycle ...
--   v_cycle := COALESCE(v_cycle, v_org_default);   -- nunca dispara
-- GREATEST IGNORA NULL em Postgres: GREATEST(1, NULL) = 1, não NULL. Cliente sem
-- gap válido recebia ciclo 1 em vez do default da org. Aqui o COALESCE vem ANTES
-- do GREATEST.
--
-- Medido no PROD (read-only, 2026-08-13) — 107 clientes na frota mudam:
--   Basic4u ....... 99 clientes | ciclo médio 18 → 41 | ticket R$ 1.278 → R$ 1.999
--   Milennials .....  4 clientes | Cauta 1 | testevideo 2 | Drink Express 1
--   Receita Recorrente: Basic4u 28.090 → 27.553 | Cauta 471.546 → 450.425
--   Entram/saem de "Recompra Atrasada": 0. Delta de health_score: 0
--   (os 107 já estão além de 2x o ciclo, então a recência já era 0 nos dois casos).
--
-- ⚠️ ORDEM DE DEPLOY (invertida de propósito, confirmada pelo CTO): a edge
-- function calculate-portfolio-health vai PRIMEIRO. O cron dela reescreve todas
-- estas colunas a cada 30min — aplicar só esta migration seria desfeito no ciclo
-- seguinte.
--
-- ─── Duas regras da casa que esta migration toca de propósito ────────────────
--
-- 1. LINT DE MÉTRICAS (ADR-0017, regra ledger-revenue) — suprimido na linha do
--    `sum(sale_value)` com `-- metric-lint-allow`. Justificativa: essa linha é
--    HERDADA VERBATIM da função que já roda em produção (conferida por
--    pg_get_functiondef); esta migration não cria superfície de receita nova nem
--    muda um centavo de lifetime_value — só troca o DIVISOR do avg_ticket (de
--    linhas para pedidos). Reescrever a receita para o caderno de eventos é o
--    SP-3 da própria ADR e continua ABERTO: medido no PROD em 13/08, o caderno
--    tem R$ 248.234,96 no stream 'carteira' contra R$ 1.954.654,93 em
--    upsell_orders (12,7%), alcança 210 dos 888 clientes ativos, e NENHUM dos
--    seus eventos referencia uma linha de upsell_orders (o caderno registra a
--    venda na entrada em etapa `won`, não a recompra por pedido). Migrar agora
--    zeraria 87% da receita da carteira.
--
-- 2. GUARDA F4 ("migration = só schema", CLAUDE.md raiz) — o DO block de backfill
--    no fim CONTRARIA essa guarda, deliberadamente. Sem ele, 135 dos 333 clientes
--    afetados ficariam com o ciclo errado indefinidamente: o cron só processa org
--    com a feature `customer_portfolio` ligada (ela não é default-enabled) e
--    alcança apenas 197; a trigger só dispara em escrita nova de order. O que
--    reduz o risco que a F4 protege: o backfill reescreve SÓ colunas DERIVADAS,
--    recomputáveis a qualquer momento a partir de upsell_orders — um apply em
--    alvo errado não destrói dado de origem, basta rodar o recompute de novo.

CREATE OR REPLACE FUNCTION public.recalc_upsell_client_metrics(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id        uuid;
  v_org_default   int;
  v_order_count   int;   -- LINHAS de item (inalterado de propósito — ver cabeçalho)
  v_day_count     int;   -- PEDIDOS de verdade (dias UTC distintos com venda)
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

  -- Agregados dos orders APPROVED (mesmo filtro do edge fn).
  -- count(*) = linhas; count(DISTINCT dia UTC) = pedidos de verdade.
  SELECT count(*),
         count(DISTINCT (sold_at AT TIME ZONE 'UTC')::date),
         COALESCE(sum(sale_value), 0),  -- metric-lint-allow: linha herdada verbatim da função viva; receita inalterada, ver cabeçalho (ADR-0017 SP-3)
         max(sold_at)
    INTO v_order_count, v_day_count, v_total, v_last
  FROM upsell_orders
  WHERE client_id = p_client_id
    AND approval_status = 'approved';

  -- avg_ticket: total / PEDIDOS, NULL se 0 (espelha `avgTicket || null` em JS)
  v_avg := CASE
             WHEN v_day_count > 0 AND v_total > 0 THEN v_total / v_day_count
             ELSE NULL
           END;

  -- reorder_cycle_days: < 2 PEDIDOS → default da org (não há gap pra medir);
  -- senão média dos gaps entre dias distintos, arredondada, mínimo 1.
  -- Espelha computeCycleDays(groupOrdersByDay(orders), orgDefault).
  IF v_day_count < 2 THEN
    v_cycle := v_org_default;
  ELSE
    SELECT round(avg(gap_days))::int
      INTO v_cycle
    FROM (
      SELECT (dia - lag(dia) OVER (ORDER BY dia))::numeric AS gap_days
      FROM (
        SELECT DISTINCT (sold_at AT TIME ZONE 'UTC')::date AS dia
        FROM upsell_orders
        WHERE client_id = p_client_id
          AND approval_status = 'approved'
      ) d
    ) g
    WHERE gap_days IS NOT NULL;
    -- COALESCE ANTES do GREATEST: GREATEST(1, NULL) = 1 em Postgres, então na
    -- ordem inversa o fallback pro default da org nunca disparava.
    v_cycle := GREATEST(1, COALESCE(v_cycle, v_org_default));
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

-- CREATE OR REPLACE preserva grants; reafirmado por clareza. Função recebe
-- EXECUTE via PUBLIC por default (anon é membro de PUBLIC) → revoga de PUBLIC e
-- concede só a service_role. O trigger (SECURITY DEFINER, mesmo owner) chama
-- internamente sem precisar de grant.
REVOKE ALL ON FUNCTION public.recalc_upsell_client_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalc_upsell_client_metrics(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: mesma seleção de 20270107000000 — quem tem order approved OU
-- order_count > 0. Cliente sem histórico já tem null/0/999 corretos; recomputá-lo
-- só bumparia updated_at e dispararia realtime à toa. Idempotente.
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
