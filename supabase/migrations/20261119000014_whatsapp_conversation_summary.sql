-- 20261119000014_whatsapp_conversation_summary.sql
--
-- V3 Fase 2: tabela-resumo de conversas (1 linha por conversa = org+instance+phone).
-- Mantida por trigger AFTER INSERT em whatsapp_messages. Substitui o skip-scan
-- caro (walk de todos os telefones p/ ordenar por recência) por um SELECT indexado:
-- a lista vira <50ms p/ qualquer tamanho de org (vs 2.5s do RPC na org grande).
--
-- RLS: org-isolation InitPlan-wrapped. SEM grant anon (ver incidente anon-leak).

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_summary (
  organization_id          uuid        NOT NULL,
  instance_id              uuid        NOT NULL,
  normalized_phone         text        NOT NULL,
  phone_number             text,
  last_message             text,
  last_message_time        timestamptz NOT NULL,
  last_message_direction   text,
  last_message_sent_source text,
  last_push_name           text,
  lead_id                  uuid,
  is_group                 boolean     NOT NULL DEFAULT false,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, instance_id, normalized_phone)
);

-- Ordenação do inbox (recência) por org+instance.
CREATE INDEX IF NOT EXISTS idx_wa_conv_summary_recency
  ON public.whatsapp_conversation_summary (organization_id, instance_id, last_message_time DESC);

ALTER TABLE public.whatsapp_conversation_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_conv_summary_select_org ON public.whatsapp_conversation_summary;
CREATE POLICY wa_conv_summary_select_org ON public.whatsapp_conversation_summary
  FOR SELECT USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS wa_conv_summary_service ON public.whatsapp_conversation_summary;
CREATE POLICY wa_conv_summary_service ON public.whatsapp_conversation_summary
  FOR ALL USING (((select auth.role()) = 'service_role'::text))
  WITH CHECK (((select auth.role()) = 'service_role'::text));

GRANT SELECT ON public.whatsapp_conversation_summary TO authenticated;
GRANT ALL    ON public.whatsapp_conversation_summary TO service_role;
-- (intencional: SEM grant a anon)

-- ── Trigger: mantém o resumo a cada INSERT de mensagem ───────────────────────
CREATE OR REPLACE FUNCTION public.tg_whatsapp_conversation_summary()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.normalized_phone IS NULL OR NEW.instance_id IS NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.whatsapp_conversation_summary AS s
    (organization_id, instance_id, normalized_phone, phone_number, last_message,
     last_message_time, last_message_direction, last_message_sent_source,
     last_push_name, lead_id, is_group, updated_at)
  VALUES (
    NEW.organization_id, NEW.instance_id, NEW.normalized_phone, NEW.phone_number,
    CASE WHEN NEW.deleted_at IS NULL THEN NEW.content ELSE NULL END,
    NEW."timestamp", NEW.direction, NEW.sent_source,
    CASE WHEN NEW.direction = 'incoming' THEN NEW.push_name ELSE NULL END,
    NEW.lead_id, coalesce(NEW.is_group, false), now()
  )
  ON CONFLICT (organization_id, instance_id, normalized_phone) DO UPDATE SET
    -- só sobrescreve "last_*" se a nova msg for >= a atual (history-sync insere antigas)
    phone_number             = CASE WHEN EXCLUDED.last_message_time >= s.last_message_time THEN EXCLUDED.phone_number             ELSE s.phone_number END,
    last_message             = CASE WHEN EXCLUDED.last_message_time >= s.last_message_time THEN EXCLUDED.last_message             ELSE s.last_message END,
    last_message_direction   = CASE WHEN EXCLUDED.last_message_time >= s.last_message_time THEN EXCLUDED.last_message_direction   ELSE s.last_message_direction END,
    last_message_sent_source = CASE WHEN EXCLUDED.last_message_time >= s.last_message_time THEN EXCLUDED.last_message_sent_source ELSE s.last_message_sent_source END,
    last_message_time        = greatest(s.last_message_time, EXCLUDED.last_message_time),
    last_push_name           = COALESCE(EXCLUDED.last_push_name, s.last_push_name),
    lead_id                  = COALESCE(s.lead_id, EXCLUDED.lead_id),
    is_group                 = s.is_group OR EXCLUDED.is_group,
    updated_at               = now();

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_whatsapp_conversation_summary ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_conversation_summary
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_whatsapp_conversation_summary();
