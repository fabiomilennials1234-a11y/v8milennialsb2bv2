-- 20270908005000_webhook_negocio_stage_changed.sql
--
-- SCRUM-630 · Funil é funil (Wave 3, F3/D10) — webhook de saída
-- `negocio.stage_changed` para QUALQUER funil + fim dos 6 eventos mortos
-- `pipe_{whatsapp,confirmacao,propostas}.{created,updated}`.
-- Rollback pareado: supabase/migrations/rollback/20270908005000_webhook_negocio_stage_changed.sql
--
-- ── MEDIDO EM PROD (2026-09-02, jsjsmuncfkbsbzqzqhfq) ───────────────────────
--
--   · Os "6 enqueuers" do baseline são 3 FUNÇÕES (enqueue_pipe_whatsapp/
--     confirmacao/propostas_webhooks) cobrindo 6 EVENTOS (.created/.updated
--     cada). 0 CREATE TRIGGER pendurado em qualquer uma — órfãs desde que
--     pipe_* viraram views (Wave 1); o evento nunca mais foi enfileirado.
--   · `webhooks`: 0 linhas (0 orgs, 0 ativos, 0 assinaturas de evento morto).
--     `webhook_deliveries`: 0 linhas. Nenhum cliente perde nada com o drop.
--   · `enqueue_webhook_deliveries_for_org(org, event, payload)` JÁ filtra
--     is_active + events @> ARRAY[event] e resolve os webhooks da org — o
--     trigger NÃO duplica esse filtro como autoridade; faz só um EXISTS de
--     fast-path (usa idx_webhooks_organization_active) para não montar payload
--     nem resolver nomes em org sem assinante (hoje: todas as ~30 orgs).
--     Custo por move de kanban sem assinante: 1 probe de índice.
--
-- ── DECISÕES ────────────────────────────────────────────────────────────────
--
--   D-1 Trigger em `pipeline_entries` (fonte única pós-Wave 1) — vale para
--       funil de sistema E custom, sem enumeration por tipo.
--   D-2 `AFTER UPDATE OF stage_key, stage_id` com as DUAS colunas na lista OF:
--       limitação D-g documentada na 20270906002000 — OF dispara pela lista
--       SET do statement, não pelo valor; escritor vivo hoje muda stage_key
--       (views pipe_*, RPCs mover_negocio, sync custom), escritor futuro
--       mudará só stage_id. As duas listadas cobrem os dois mundos.
--   D-3 WHEN (IS DISTINCT FROM nas duas) — touch de outras colunas não dispara.
--   D-4 Payload FLAT (contrato F3/D10), sem o envelope {event,timestamp,data}
--       dos eventos legados: 0 consumidores existem em prod, contrato novo
--       nasce limpo. `moved_at` UTC no formato da casa.
--   D-5 `stage_name`/`stage_role` NULL quando a etapa é fantasma (stage_id
--       NULL — as 56 órfãs documentadas na 20270906002000). O evento ainda
--       sai: previous_/stage_key preservam o rastro.
--   D-6 Trigger function sem EXECUTE para nenhum role de aplicação: disparo é
--       interno (runtime de trigger não checa EXECUTE); superfície RPC zero.
--   D-7 DROP dos 3 enqueuers órfãos com guarda: aborta se algum trigger ainda
--       os referencia (ambiente divergente de prod).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Função do evento negocio.stage_changed
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enqueue_negocio_stage_changed_webhooks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pipeline_slug text;
  v_pipeline_name text;
  v_stage_name    text;
  v_stage_role    text;
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fast-path (performance, não autoridade): org sem webhook ativo assinando
  -- o evento sai por 1 probe de idx_webhooks_organization_active. O filtro
  -- autoritativo continua sendo o de enqueue_webhook_deliveries_for_org.
  IF NOT EXISTS (
    SELECT 1
      FROM public.webhooks w
     WHERE w.organization_id = NEW.organization_id
       AND w.is_active = true
       AND w.events @> ARRAY['negocio.stage_changed']::text[]
  ) THEN
    RETURN NULL;
  END IF;

  -- 1 SELECT enxuto: nomes do funil + etapa (LEFT JOIN tolera etapa fantasma).
  SELECT p.slug, p.name, ps.name, ps.stage_role::text
    INTO v_pipeline_slug, v_pipeline_name, v_stage_name, v_stage_role
    FROM public.pipelines p
    LEFT JOIN public.pipeline_stages ps ON ps.id = NEW.stage_id
   WHERE p.id = NEW.pipeline_id;

  PERFORM public.enqueue_webhook_deliveries_for_org(
    NEW.organization_id,
    'negocio.stage_changed',
    jsonb_build_object(
      'event',              'negocio.stage_changed',
      'organization_id',    NEW.organization_id,
      'pipeline_id',        NEW.pipeline_id,
      'pipeline_slug',      v_pipeline_slug,
      'pipeline_name',      v_pipeline_name,
      'stage_id',           NEW.stage_id,
      'stage_key',          NEW.stage_key,
      'stage_name',         v_stage_name,
      'stage_role',         v_stage_role,
      'previous_stage_id',  OLD.stage_id,
      'previous_stage_key', OLD.stage_key,
      'deal_id',            NEW.deal_id,
      'lead_id',            NEW.lead_id,
      'entry_id',           NEW.id,
      'moved_at',           to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.enqueue_negocio_stage_changed_webhooks() IS
  'SCRUM-630 (F3/D10): enfileira webhook negocio.stage_changed quando um card muda de etapa em qualquer funil. Fast-path EXISTS antes de montar payload; filtro autoritativo em enqueue_webhook_deliveries_for_org.';

ALTER FUNCTION public.enqueue_negocio_stage_changed_webhooks() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_negocio_stage_changed_webhooks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_negocio_stage_changed_webhooks() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_negocio_stage_changed_webhooks() FROM authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Trigger (AFTER — roda depois do espelho trg_pe_stage_mirror, então
--    NEW.stage_id e NEW.stage_key já chegam consistentes entre si)
-- ════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_pe_webhook_stage_changed ON public.pipeline_entries;
CREATE TRIGGER trg_pe_webhook_stage_changed
  AFTER UPDATE OF stage_key, stage_id ON public.pipeline_entries
  FOR EACH ROW
  WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key
     OR OLD.stage_id  IS DISTINCT FROM NEW.stage_id)
  EXECUTE FUNCTION public.enqueue_negocio_stage_changed_webhooks();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Drop dos 3 enqueuers órfãos (6 eventos mortos) — com prova de 0 triggers
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('enqueue_pipe_whatsapp_webhooks',
                       'enqueue_pipe_confirmacao_webhooks',
                       'enqueue_pipe_propostas_webhooks');
  IF n > 0 THEN
    RAISE EXCEPTION 'SCRUM630: % trigger(s) ainda referenciam os enqueuers de pipe — ambiente diverge de prod (medido: 0). Abortando drop.', n;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.enqueue_pipe_whatsapp_webhooks();
DROP FUNCTION IF EXISTS public.enqueue_pipe_confirmacao_webhooks();
DROP FUNCTION IF EXISTS public.enqueue_pipe_propostas_webhooks();
