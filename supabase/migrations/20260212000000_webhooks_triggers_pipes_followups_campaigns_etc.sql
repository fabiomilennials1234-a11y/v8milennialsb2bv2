-- Migration: Triggers para webhooks outbound (pipes, follow-ups, campanhas, tarefas, mensagens)
-- Description: Função genérica de enfileiramento por org/evento; triggers em pipe_*, follow_ups,
--              campaign_dispatch_batches, acoes_do_dia, whatsapp_messages.
-- Date: 2026-02-12

-- =====================================================
-- 1. FUNÇÃO GENÉRICA: enfileirar entregas por org/evento
-- =====================================================

CREATE OR REPLACE FUNCTION public.enqueue_webhook_deliveries_for_org(
  p_organization_id UUID,
  p_event TEXT,
  p_payload JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w RECORD;
BEGIN
  IF p_organization_id IS NULL THEN
    RETURN;
  END IF;
  FOR w IN
    SELECT id FROM public.webhooks
    WHERE organization_id = p_organization_id
      AND is_active = true
      AND events @> ARRAY[p_event]::text[]
  LOOP
    INSERT INTO public.webhook_deliveries (webhook_id, event, payload, next_retry_at)
    VALUES (w.id, p_event, p_payload, now());
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.enqueue_webhook_deliveries_for_org IS 'Enfileira entregas para todos os webhooks da org que escutam o evento.';

-- =====================================================
-- 2. PIPE WHATSAPP
-- =====================================================

CREATE OR REPLACE FUNCTION public.enqueue_pipe_whatsapp_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_enqueue_pipe_whatsapp_webhooks ON public.pipe_whatsapp;
CREATE TRIGGER trg_enqueue_pipe_whatsapp_webhooks
  AFTER INSERT OR UPDATE ON public.pipe_whatsapp
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_pipe_whatsapp_webhooks();

-- =====================================================
-- 3. PIPE CONFIRMACAO
-- =====================================================

CREATE OR REPLACE FUNCTION public.enqueue_pipe_confirmacao_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_enqueue_pipe_confirmacao_webhooks ON public.pipe_confirmacao;
CREATE TRIGGER trg_enqueue_pipe_confirmacao_webhooks
  AFTER INSERT OR UPDATE ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_pipe_confirmacao_webhooks();

-- =====================================================
-- 4. PIPE PROPOSTAS
-- =====================================================

CREATE OR REPLACE FUNCTION public.enqueue_pipe_propostas_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_enqueue_pipe_propostas_webhooks ON public.pipe_propostas;
CREATE TRIGGER trg_enqueue_pipe_propostas_webhooks
  AFTER INSERT OR UPDATE ON public.pipe_propostas
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_pipe_propostas_webhooks();

-- =====================================================
-- 5. FOLLOW_UPS (organization_id direto; completed quando completed_at preenchido)
-- =====================================================

CREATE OR REPLACE FUNCTION public.enqueue_follow_ups_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev TEXT;
  payload JSONB;
  org_id UUID;
BEGIN
  org_id := NEW.organization_id;
  IF org_id IS NULL THEN
    org_id := (SELECT organization_id FROM public.leads WHERE id = NEW.lead_id LIMIT 1);
  END IF;
  IF org_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    ev := 'follow_up.created';
  ELSIF TG_OP = 'UPDATE' AND OLD.completed_at IS DISTINCT FROM NEW.completed_at AND NEW.completed_at IS NOT NULL THEN
    ev := 'follow_up.completed';
  ELSE
    ev := 'follow_up.updated';
  END IF;
  payload := jsonb_build_object(
    'event', ev,
    'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data', jsonb_build_object(
      'id', NEW.id,
      'lead_id', NEW.lead_id,
      'organization_id', org_id,
      'title', NEW.title,
      'due_date', NEW.due_date,
      'completed_at', NEW.completed_at,
      'assigned_to', NEW.assigned_to,
      'priority', NEW.priority,
      'source_pipe', NEW.source_pipe
    )
  );
  PERFORM enqueue_webhook_deliveries_for_org(org_id, ev, payload);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_follow_ups_webhooks ON public.follow_ups;
CREATE TRIGGER trg_enqueue_follow_ups_webhooks
  AFTER INSERT OR UPDATE ON public.follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_follow_ups_webhooks();

-- =====================================================
-- 6. CAMPAIGN_DISPATCH_BATCHES (scheduled on INSERT; completed on status completed/failed)
-- =====================================================

CREATE OR REPLACE FUNCTION public.enqueue_campaign_dispatch_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev TEXT;
  payload JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    ev := 'campaign_dispatch.scheduled';
    payload := jsonb_build_object(
      'event', ev,
      'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'data', jsonb_build_object(
        'id', NEW.id,
        'organization_id', NEW.organization_id,
        'campanha_id', NEW.campanha_id,
        'template_id', NEW.template_id,
        'scheduled_at', NEW.scheduled_at,
        'status', NEW.status
      )
    );
    PERFORM enqueue_webhook_deliveries_for_org(NEW.organization_id, ev, payload);
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('completed', 'failed', 'cancelled') THEN
    ev := 'campaign_dispatch.completed';
    payload := jsonb_build_object(
      'event', ev,
      'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'data', jsonb_build_object(
        'id', NEW.id,
        'organization_id', NEW.organization_id,
        'campanha_id', NEW.campanha_id,
        'status', NEW.status,
        'total_leads', NEW.total_leads,
        'sent_count', NEW.sent_count,
        'failed_count', NEW.failed_count
      )
    );
    PERFORM enqueue_webhook_deliveries_for_org(NEW.organization_id, ev, payload);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_campaign_dispatch_webhooks ON public.campaign_dispatch_batches;
CREATE TRIGGER trg_enqueue_campaign_dispatch_webhooks
  AFTER INSERT OR UPDATE ON public.campaign_dispatch_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_campaign_dispatch_webhooks();

-- =====================================================
-- 7. ACOES_DO_DIA (org via lead_id ou user_id -> team_members)
-- =====================================================

CREATE OR REPLACE FUNCTION public.enqueue_acoes_do_dia_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev TEXT;
  payload JSONB;
  org_id UUID;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    org_id := (SELECT organization_id FROM public.leads WHERE id = NEW.lead_id LIMIT 1);
  ELSE
    org_id := (SELECT organization_id FROM public.team_members WHERE user_id = NEW.user_id AND is_active = true LIMIT 1);
  END IF;
  IF org_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    ev := 'acao_dia.created';
  ELSIF TG_OP = 'UPDATE' AND (OLD.is_completed IS DISTINCT FROM NEW.is_completed AND NEW.is_completed = true) THEN
    ev := 'acao_dia.completed';
  ELSE
    RETURN NEW;  /* outros updates não disparam evento */
  END IF;
  payload := jsonb_build_object(
    'event', ev,
    'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data', jsonb_build_object(
      'id', NEW.id,
      'user_id', NEW.user_id,
      'lead_id', NEW.lead_id,
      'title', NEW.title,
      'description', NEW.description,
      'is_completed', NEW.is_completed,
      'completed_at', NEW.completed_at,
      'confirmacao_id', NEW.confirmacao_id,
      'follow_up_id', NEW.follow_up_id,
      'proposta_id', NEW.proposta_id
    )
  );
  PERFORM enqueue_webhook_deliveries_for_org(org_id, ev, payload);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_acoes_do_dia_webhooks ON public.acoes_do_dia;
CREATE TRIGGER trg_enqueue_acoes_do_dia_webhooks
  AFTER INSERT OR UPDATE ON public.acoes_do_dia
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_acoes_do_dia_webhooks();

-- =====================================================
-- 8. WHATSAPP_MESSAGES (organization_id direto; received/sent por direction)
-- =====================================================

CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_messages_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev TEXT;
  payload JSONB;
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.direction = 'incoming' THEN
    ev := 'whatsapp_message.received';
  ELSE
    ev := 'whatsapp_message.sent';
  END IF;
  payload := jsonb_build_object(
    'event', ev,
    'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data', jsonb_build_object(
      'id', NEW.id,
      'organization_id', NEW.organization_id,
      'lead_id', NEW.lead_id,
      'direction', NEW.direction,
      'message_type', NEW.message_type,
      'content', CASE WHEN length(COALESCE(NEW.content, '')) > 500 THEN left(NEW.content, 500) || '...' ELSE NEW.content END,
      'phone_number', NEW.phone_number,
      'status', NEW.status,
      'message_id', NEW.message_id
    )
  );
  PERFORM enqueue_webhook_deliveries_for_org(NEW.organization_id, ev, payload);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_whatsapp_messages_webhooks ON public.whatsapp_messages;
CREATE TRIGGER trg_enqueue_whatsapp_messages_webhooks
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_whatsapp_messages_webhooks();
