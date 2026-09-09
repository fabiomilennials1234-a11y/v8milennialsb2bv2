-- rollback/20270908005000_webhook_negocio_stage_changed.sql
--
-- Desfaz a 20270908005000 (SCRUM-630):
--   1. Remove trigger + função do evento negocio.stage_changed.
--   2. Recria os 3 enqueuers de pipe EXATAMENTE como estavam em prod
--      (pg_get_functiondef capturado em 2026-09-02) + owner/grants do baseline.
--      Nota: eles voltam ÓRFÃOS (sem CREATE TRIGGER) — estado pré-migration.

DROP TRIGGER IF EXISTS trg_pe_webhook_stage_changed ON public.pipeline_entries;
DROP FUNCTION IF EXISTS public.enqueue_negocio_stage_changed_webhooks();

CREATE OR REPLACE FUNCTION public.enqueue_pipe_confirmacao_webhooks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ev TEXT;
  payload JSONB;
  org_id UUID;
BEGIN
  org_id := (SELECT organization_id FROM public.leads WHERE id = NEW.lead_id LIMIT 1);
  IF org_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    ev := 'pipe_confirmacao.created';
  ELSE
    ev := 'pipe_confirmacao.updated';
  END IF;
  payload := jsonb_build_object(
    'event', ev,
    'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data', jsonb_build_object(
      'id', NEW.id,
      'lead_id', NEW.lead_id,
      'status', NEW.status,
      'sdr_id', NEW.sdr_id,
      'closer_id', NEW.closer_id,
      'meeting_date', NEW.meeting_date,
      'is_confirmed', NEW.is_confirmed,
      'notes', NEW.notes
    )
  );
  PERFORM enqueue_webhook_deliveries_for_org(org_id, ev, payload);
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_pipe_propostas_webhooks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ev TEXT;
  payload JSONB;
  org_id UUID;
BEGIN
  org_id := (SELECT organization_id FROM public.leads WHERE id = NEW.lead_id LIMIT 1);
  IF org_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    ev := 'pipe_propostas.created';
  ELSE
    ev := 'pipe_propostas.updated';
  END IF;
  payload := jsonb_build_object(
    'event', ev,
    'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data', jsonb_build_object(
      'id', NEW.id,
      'lead_id', NEW.lead_id,
      'status', NEW.status,
      'closer_id', NEW.closer_id,
      'calor', NEW.calor,
      'sale_value', NEW.sale_value,
      'commitment_date', NEW.commitment_date,
      'closed_at', NEW.closed_at,
      'notes', NEW.notes
    )
  );
  PERFORM enqueue_webhook_deliveries_for_org(org_id, ev, payload);
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_pipe_whatsapp_webhooks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ev TEXT;
  payload JSONB;
  org_id UUID;
BEGIN
  org_id := (SELECT organization_id FROM public.leads WHERE id = NEW.lead_id LIMIT 1);
  IF org_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    ev := 'pipe_whatsapp.created';
  ELSE
    ev := 'pipe_whatsapp.updated';
  END IF;
  payload := jsonb_build_object(
    'event', ev,
    'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data', jsonb_build_object(
      'id', NEW.id,
      'lead_id', NEW.lead_id,
      'status', NEW.status,
      'sdr_id', NEW.sdr_id,
      'scheduled_date', NEW.scheduled_date,
      'notes', NEW.notes
    )
  );
  PERFORM enqueue_webhook_deliveries_for_org(org_id, ev, payload);
  RETURN NEW;
END;
$function$


ALTER FUNCTION public.enqueue_pipe_confirmacao_webhooks() OWNER TO postgres;
ALTER FUNCTION public.enqueue_pipe_propostas_webhooks() OWNER TO postgres;
ALTER FUNCTION public.enqueue_pipe_whatsapp_webhooks() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.enqueue_pipe_confirmacao_webhooks() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_pipe_confirmacao_webhooks() TO authenticated;
GRANT ALL ON FUNCTION public.enqueue_pipe_confirmacao_webhooks() TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_pipe_propostas_webhooks() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_pipe_propostas_webhooks() TO authenticated;
GRANT ALL ON FUNCTION public.enqueue_pipe_propostas_webhooks() TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_pipe_whatsapp_webhooks() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_pipe_whatsapp_webhooks() TO authenticated;
GRANT ALL ON FUNCTION public.enqueue_pipe_whatsapp_webhooks() TO service_role;
