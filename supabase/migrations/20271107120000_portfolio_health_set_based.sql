-- 20271107120000_portfolio_health_set_based.sql
--
-- Versão conferida contra o ledger de prod em 2026-10-05 (topo 20271106000010)
-- e acima das irmãs 20271107100000/20271107110000. Reconferir ao aplicar.
--
-- calculate-portfolio-health em lote: a leitura e a escrita saem do N+1.
--
-- ── O PROBLEMA (incidente 2026-10-05, OOM no compute Small) ────────────────
-- A edge function (cron 65) fazia ~6 requisições REST por cliente — pedidos,
-- contexto de conversa, último incoming em whatsapp_messages, UPDATE em
-- upsell_clients, upsert de snapshot, alertas — com 15 em paralelo: ~4.500
-- requisições por execução para 757 clientes, em rajadas de 1.600–2.250 em
-- 2 min. E 757 UPDATEs incondicionais em upsell_clients, que está no
-- supabase_realtime e tem trigger por linha.
--
-- ── O QUE MUDA ─────────────────────────────────────────────────────────────
-- 1. `portfolio_health_inputs(org, after, limit)`: uma página de clientes
--    ativos da org (keyset por id) com tudo que o score precisa, num jsonb.
--    Os campos da org (ciclo default, soma/contagem de pedidos aprovados, flag
--    de alerta por WhatsApp, config do agente de retenção) só na 1ª página.
-- 2. `portfolio_health_apply(org, now, results)`: grava a página numa
--    transação — UPDATE só onde algo mudou, snapshot do dia, resolve e cria
--    alertas — e devolve os alertas CRIADOS, para a edge function notificar
--    depois do commit.
-- 3. Cron do job `calculate-portfolio-health`: de 2×/hora para
--    `21 6,11-23/2 * * *` (madrugada + horário comercial, de 2 em 2 h).
--
-- O SCORE CONTINUA EM TS (_shared/portfolio-health.ts → computeClientHealth).
-- Portar para SQL criaria um terceiro gêmeo da regra (arredondamento do
-- double, toLocaleString, metadata) sem ganho de requisição.
--
-- ── SEGURANÇA ──────────────────────────────────────────────────────────────
-- * SECURITY INVOKER: quem chama é a service_role, que já ignora RLS; INVOKER
--   limita o estrago se um grant sair errado (authenticated cairia na RLS).
-- * Toda leitura e escrita filtra `organization_id = p_org_id`.
-- * apply é FAIL-CLOSED: client_id fora da org, nulo ou repetido → RAISE antes
--   de qualquer escrita. organization_id gravado vem da org validada, nunca do
--   payload.
-- * O default ACL de public em prod dá EXECUTE NOMINAL a anon, authenticated e
--   service_role em função nova — `REVOKE FROM PUBLIC` sozinho não alcança.
--   Por isso o REVOKE explícito dos três papéis abaixo.
-- * Só CREATE OR REPLACE: DROP+CREATE reseta grants.

-- ─── 1. Entradas ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.portfolio_health_inputs(
  p_org_id uuid,
  p_after  uuid DEFAULT NULL,
  p_limit  int  DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit   int;
  v_org     jsonb := NULL;
  v_clients jsonb;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'portfolio_health_inputs: p_org_id obrigatório'
      USING ERRCODE = '22023';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);

  IF p_after IS NULL THEN
    -- Cada campo é um subselect independente: a ausência de uma linha (sem
    -- feature, sem agente) vira default, nunca um objeto org nulo.
    SELECT jsonb_build_object(
      'default_reorder_cycle_days', (
        SELECT o.default_reorder_cycle_days
        FROM public.organizations o
        WHERE o.id = p_org_id
      ),
      'approved_sum', COALESCE(t.approved_sum, 0),
      'approved_count', t.approved_count,
      'whatsapp_alerts_enabled', COALESCE((
        SELECT feat.enabled
        FROM public.organization_features feat
        WHERE feat.organization_id = p_org_id
          AND feat.feature_key = 'portfolio_alerts_whatsapp'
      ), false),
      -- Antes: `.limit(1)` sem ordem. Agora o mais antigo, determinístico.
      'retention_config', (
        SELECT ca.retention_config
        FROM public.copilot_agents ca
        WHERE ca.organization_id = p_org_id
          AND ca.is_active = true
          AND ca.retention_enabled = true
        ORDER BY ca.created_at, ca.id
        LIMIT 1
      )
    )
    INTO v_org
    FROM (
      SELECT sum(uo.sale_value) AS approved_sum, count(*) AS approved_count
      FROM public.upsell_orders uo
      WHERE uo.organization_id = p_org_id
        AND uo.approval_status = 'approved'
    ) t;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'lead_id', c.lead_id,
      'closer_id', c.closer_id,
      'name', c.name,
      'last_order_at', c.last_order_at,
      'orders', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', uo.id,
                 'sale_value', uo.sale_value,
                 'sold_at', uo.sold_at,
                 'product_name', uo.product_name
               ) ORDER BY uo.sold_at, uo.id)
        FROM public.upsell_orders uo
        WHERE uo.organization_id = p_org_id
          AND uo.client_id = c.id
          AND uo.approval_status = 'approved'
      ), '[]'::jsonb),
      'ctx_engagement', (
        SELECT s.engagement_score
        FROM public.conversation_context_summary s
        WHERE s.organization_id = p_org_id
          AND s.lead_id = c.lead_id
        LIMIT 1
      ),
      'last_incoming_at', (
        SELECT m."timestamp"
        FROM public.whatsapp_messages m
        WHERE m.organization_id = p_org_id
          AND m.lead_id = c.lead_id
          AND m.direction = 'incoming'
        ORDER BY m."timestamp" DESC
        LIMIT 1
      )
      -- Sem alertas abertos aqui: o apply relê client_alerts na própria
      -- transação, que é o estado que vale para resolver/inserir.
    ) ORDER BY c.id
  ), '[]'::jsonb)
  INTO v_clients
  FROM (
    SELECT uc.id, uc.lead_id, uc.closer_id, uc.name, uc.last_order_at
    FROM public.upsell_clients uc
    WHERE uc.organization_id = p_org_id
      AND uc.is_active = true
      AND (p_after IS NULL OR uc.id > p_after)
    ORDER BY uc.id
    LIMIT v_limit
  ) c;

  RETURN jsonb_build_object('org', v_org, 'clients', v_clients);
END;
$$;

COMMENT ON FUNCTION public.portfolio_health_inputs(uuid, uuid, int) IS
  'calculate-portfolio-health: página (keyset por id) de clientes ativos da org com pedidos aprovados, engajamento e último incoming. Campos da org só na 1ª página. Só service_role.';

-- ─── 2. Gravação ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.portfolio_health_apply(
  p_org_id  uuid,
  p_now     timestamptz,
  p_results jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total     int;
  v_distintos int;
  v_da_org    int;
  v_updated   int := 0;
  v_snapshots int := 0;
  v_resolved  int := 0;
  v_inserted  jsonb := '[]'::jsonb;
  v_sig       record;
  v_alert     record;
BEGIN
  IF p_org_id IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'portfolio_health_apply: p_org_id e p_now obrigatórios'
      USING ERRCODE = '22023';
  END IF;
  IF p_results IS NULL OR jsonb_typeof(p_results) <> 'array' THEN
    RAISE EXCEPTION 'portfolio_health_apply: p_results precisa ser um array'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_results) > 1000 THEN
    RAISE EXCEPTION 'portfolio_health_apply: no máximo 1000 clientes por chamada'
      USING ERRCODE = '22023';
  END IF;

  -- (a) FAIL-CLOSED: todo client_id do payload existe, é único e é desta org.
  -- count(DISTINCT) ignora NULL, então client_id nulo também derruba.
  SELECT count(*), count(DISTINCT r.client_id), count(uc.id)
  INTO v_total, v_distintos, v_da_org
  FROM jsonb_to_recordset(p_results) AS r(client_id uuid)
  LEFT JOIN public.upsell_clients uc
    ON uc.id = r.client_id AND uc.organization_id = p_org_id;

  IF v_total <> v_distintos OR v_total <> v_da_org THEN
    RAISE EXCEPTION 'portfolio_health_apply: payload com cliente fora da organização, nulo ou repetido'
      USING ERRCODE = '42501';
  END IF;

  -- (b) Colunas de saúde — só onde algo mudou. health_updated_at passa a ser
  -- "última mudança"; nenhum leitor no front nem nas edge functions.
  UPDATE public.upsell_clients uc
  SET health_score          = r.health_score,
      health_status         = r.health_status,
      segment               = r.segment,
      reorder_cycle_days    = r.reorder_cycle_days,
      days_since_last_order = r.days_since_last_order,
      last_order_at         = r.last_order_at,
      next_order_expected   = r.next_order_expected,
      order_count           = r.order_count,
      lifetime_value        = r.lifetime_value,
      avg_ticket            = r.avg_ticket,
      trend                 = r.trend,
      churn_probability     = r.churn_probability,
      health_updated_at     = p_now
  FROM jsonb_to_recordset(p_results) AS r(
    client_id             uuid,
    health_score          int,
    health_status         text,
    segment               text,
    reorder_cycle_days    int,
    days_since_last_order int,
    last_order_at         timestamptz,
    next_order_expected   timestamptz,
    order_count           int,
    lifetime_value        numeric,
    avg_ticket            numeric,
    trend                 text,
    churn_probability     int
  )
  WHERE uc.id = r.client_id
    AND uc.organization_id = p_org_id
    AND (uc.health_score, uc.health_status, uc.segment, uc.reorder_cycle_days,
         uc.days_since_last_order, uc.last_order_at, uc.next_order_expected,
         uc.order_count, uc.lifetime_value, uc.avg_ticket, uc.trend,
         uc.churn_probability)
        IS DISTINCT FROM
        (r.health_score, r.health_status, r.segment, r.reorder_cycle_days,
         r.days_since_last_order, r.last_order_at, r.next_order_expected,
         r.order_count, r.lifetime_value, r.avg_ticket, r.trend,
         r.churn_probability);
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- (c) Snapshot do dia (UTC, como o `toISOString().slice(0,10)` de antes).
  -- organization_id vem da linha de upsell_clients, nunca do payload.
  INSERT INTO public.client_health_snapshots AS s
    (client_id, organization_id, health_score, health_status, segment, snapshot_date)
  SELECT r.client_id, uc.organization_id, r.health_score, r.health_status, r.segment,
         (p_now AT TIME ZONE 'UTC')::date
  FROM jsonb_to_recordset(p_results) AS r(
    client_id uuid, health_score int, health_status text, segment text
  )
  JOIN public.upsell_clients uc
    ON uc.id = r.client_id AND uc.organization_id = p_org_id
  ON CONFLICT (client_id, snapshot_date) DO UPDATE
  SET health_score  = EXCLUDED.health_score,
      health_status = EXCLUDED.health_status,
      segment       = EXCLUDED.segment
  WHERE (s.health_score, s.health_status, s.segment)
        IS DISTINCT FROM
        (EXCLUDED.health_score, EXCLUDED.health_status, EXCLUDED.segment);
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  -- (d) Resolve todo alerta aberto cujo tipo deixou de disparar.
  UPDATE public.client_alerts ca
  SET is_resolved = true,
      resolved_at = p_now
  FROM jsonb_to_recordset(p_results) AS r(client_id uuid, signals jsonb)
  WHERE ca.organization_id = p_org_id
    AND ca.client_id = r.client_id
    AND ca.is_resolved = false
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(r.signals, '[]'::jsonb)) AS e(sig)
      WHERE e.sig->>'alert_type' = ca.alert_type
    );
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  -- (e) Cria os sinais cujo tipo não está aberto — um a um, para devolver o
  -- índice do sinal (a edge function notifica na ordem de detectSignals). O
  -- NOT EXISTS lê o estado anterior a esta etapa: vários sinais do mesmo tipo
  -- novo entram todos, como antes.
  FOR v_sig IN
    SELECT r.client_id,
           (e.ord - 1)::int                           AS signal_index,
           e.sig->>'alert_type'                       AS alert_type,
           e.sig->>'severity'                         AS severity,
           e.sig->>'title'                            AS title,
           e.sig->>'description'                      AS description,
           COALESCE(e.sig->'metadata', '{}'::jsonb)   AS metadata
    FROM jsonb_to_recordset(p_results) AS r(client_id uuid, signals jsonb)
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.signals, '[]'::jsonb))
      WITH ORDINALITY AS e(sig, ord)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.client_alerts ca
      WHERE ca.organization_id = p_org_id
        AND ca.client_id = r.client_id
        AND ca.alert_type = e.sig->>'alert_type'
        AND ca.is_resolved = false
    )
    ORDER BY r.client_id, e.ord
  LOOP
    INSERT INTO public.client_alerts
      (organization_id, client_id, alert_type, severity, title, description, metadata)
    VALUES
      (p_org_id, v_sig.client_id, v_sig.alert_type, v_sig.severity, v_sig.title,
       v_sig.description, v_sig.metadata)
    RETURNING id, client_id, alert_type, severity, metadata INTO v_alert;

    v_inserted := v_inserted || jsonb_build_array(jsonb_build_object(
      'id', v_alert.id,
      'client_id', v_alert.client_id,
      'signal_index', v_sig.signal_index,
      'alert_type', v_alert.alert_type,
      'severity', v_alert.severity,
      'metadata', v_alert.metadata
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'snapshots', v_snapshots,
    'resolved', v_resolved,
    'inserted', v_inserted
  );
END;
$$;

COMMENT ON FUNCTION public.portfolio_health_apply(uuid, timestamptz, jsonb) IS
  'calculate-portfolio-health: grava uma página de scores (UPDATE só onde mudou, snapshot do dia, resolve/cria alertas) e devolve os alertas criados. Fail-closed em cliente fora da org. Só service_role.';

-- ─── Grants ───────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.portfolio_health_inputs(uuid, uuid, int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portfolio_health_apply(uuid, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portfolio_health_inputs(uuid, uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.portfolio_health_apply(uuid, timestamptz, jsonb) TO service_role;

-- ─── 3. Cron ──────────────────────────────────────────────────────────────
--
-- 21 6,11-23/2 * * * = 06:21 UTC (03:21 BRT) + 11:21–23:21 UTC de 2 em 2 h
-- (08:21–20:21 BRT). Subconjunto dos disparos atuais (21-59/30): nenhum
-- minuto ganha disparo, então o TETO de cron-escalonamento-contrato segue.
-- Não 1×/dia: o Copilot (build-prompt, suggest-retention-action) lê
-- client_alerts e ficaria até 24 h atrasado.
--
-- Casa por jobname, nunca por jobid (padrão de 20270915000010). Job ausente
-- passa em silêncio.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron ausente — agenda de calculate-portfolio-health ignorada';
    RETURN;
  END IF;

  PERFORM cron.alter_job(job_id => j.jobid, schedule => '21 6,11-23/2 * * *')
  FROM cron.job j
  WHERE j.jobname = 'calculate-portfolio-health';
END $$;
