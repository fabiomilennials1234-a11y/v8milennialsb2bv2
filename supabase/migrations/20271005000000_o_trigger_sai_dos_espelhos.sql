-- 20271005000000_o_trigger_sai_dos_espelhos.sql
--
-- SCRUM-674, passo 3 de 4, janela 2.
--
-- A última escritora SQL dos espelhos passa a chamar a função compartilhada.
-- O trigger continua sendo o adaptador do trio legado de leads; a função
-- canônica não aprende esse vocabulário. Cada patch reproduz exatamente o
-- NEW que o INSTEAD OF receberia, inclusive nulos explícitos e a atribuição
-- vigente. campanha_leads não é espelho e permanece atualização direta.

CREATE OR REPLACE FUNCTION public.sync_responsible_from_lead_to_pipes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.responsible_id IS DISTINCT FROM OLD.responsible_id THEN
    PERFORM public.fn_entrada_sistema_atualizar(
      pe.id,
      CASE pip.slug
        WHEN 'whatsapp' THEN jsonb_build_object(
          'stage_key', pe.stage_key,
          'notes', pe.notes,
          'assigned_to', COALESCE(
            NEW.responsible_id,
            NULLIF(pe.metadata->>'sdr_id', '')::uuid),
          'responsible_id', NEW.responsible_id,
          'sdr_id', NULLIF(pe.metadata->>'sdr_id', '')::uuid,
          'pre_sale_responsible_id', NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid,
          'sale_responsible_id', NULLIF(pe.metadata->>'sale_responsible_id', '')::uuid,
          'scheduled_date', NULLIF(pe.metadata->>'scheduled_date', '')::timestamptz)
        WHEN 'confirmacao' THEN jsonb_build_object(
          'stage_key', pe.stage_key,
          'notes', pe.notes,
          'assigned_to', COALESCE(
            NEW.responsible_id,
            NULLIF(pe.metadata->>'closer_id', '')::uuid,
            NULLIF(pe.metadata->>'sdr_id', '')::uuid),
          'meeting_date', NULLIF(pe.metadata->>'meeting_date', '')::timestamptz,
          'is_confirmed', COALESCE((pe.metadata->>'is_confirmed')::boolean, false),
          'closer_id', NULLIF(pe.metadata->>'closer_id', '')::uuid,
          'responsible_id', NEW.responsible_id,
          'sdr_id', NULLIF(pe.metadata->>'sdr_id', '')::uuid,
          'meet_link', pe.metadata->>'meet_link',
          'metrics_period_at', NULLIF(pe.metadata->>'metrics_period_at', '')::timestamptz,
          'pre_sale_responsible_id', NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid,
          'sale_responsible_id', NULLIF(pe.metadata->>'sale_responsible_id', '')::uuid)
        WHEN 'propostas' THEN jsonb_build_object(
          'stage_key', pe.stage_key,
          'notes', pe.notes,
          'closed_at', pe.closed_at,
          'assigned_to', COALESCE(
            NEW.responsible_id,
            NULLIF(pe.metadata->>'closer_id', '')::uuid),
          'sale_value', NULLIF(pe.metadata->>'sale_value', '')::numeric,
          'closer_id', NULLIF(pe.metadata->>'closer_id', '')::uuid,
          'responsible_id', NEW.responsible_id,
          'product_id', NULLIF(pe.metadata->>'product_id', '')::uuid,
          'product_type', pe.metadata->>'product_type',
          'calor', NULLIF(pe.metadata->>'calor', '')::integer,
          'loss_reason', pe.metadata->>'loss_reason',
          'loss_reason_id', NULLIF(pe.metadata->>'loss_reason_id', '')::uuid,
          'commitment_date', NULLIF(pe.metadata->>'commitment_date', '')::date,
          'contract_duration', NULLIF(pe.metadata->>'contract_duration', '')::integer,
          'metrics_period_at', NULLIF(pe.metadata->>'metrics_period_at', '')::timestamptz,
          'pre_sale_responsible_id', NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid,
          'sale_responsible_id', NULLIF(pe.metadata->>'sale_responsible_id', '')::uuid)
      END)
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
    WHERE pe.lead_id = NEW.id
      AND pe.organization_id = NEW.organization_id
      AND pip.type = 'system' -- metric-lint-allow: adaptador legado reproduz o recorte das três views; não é métrica
      AND pip.slug IN ('whatsapp', 'confirmacao', 'propostas')
      AND NULLIF(pe.metadata->>'responsible_id', '')::uuid IS DISTINCT FROM NEW.responsible_id;

    UPDATE public.campanha_leads
       SET responsible_id = NEW.responsible_id
     WHERE lead_id = NEW.id
       AND responsible_id IS DISTINCT FROM NEW.responsible_id;
  END IF;

  IF NEW.closer_id IS DISTINCT FROM OLD.closer_id THEN
    PERFORM public.fn_entrada_sistema_atualizar(
      pe.id,
      CASE pip.slug
        WHEN 'confirmacao' THEN jsonb_build_object(
          'stage_key', pe.stage_key,
          'notes', pe.notes,
          'assigned_to', COALESCE(
            NULLIF(pe.metadata->>'responsible_id', '')::uuid,
            NEW.closer_id,
            NULLIF(pe.metadata->>'sdr_id', '')::uuid),
          'meeting_date', NULLIF(pe.metadata->>'meeting_date', '')::timestamptz,
          'is_confirmed', COALESCE((pe.metadata->>'is_confirmed')::boolean, false),
          'closer_id', NEW.closer_id,
          'responsible_id', NULLIF(pe.metadata->>'responsible_id', '')::uuid,
          'sdr_id', NULLIF(pe.metadata->>'sdr_id', '')::uuid,
          'meet_link', pe.metadata->>'meet_link',
          'metrics_period_at', NULLIF(pe.metadata->>'metrics_period_at', '')::timestamptz,
          'pre_sale_responsible_id', NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid,
          'sale_responsible_id', NULLIF(pe.metadata->>'sale_responsible_id', '')::uuid)
        WHEN 'propostas' THEN jsonb_build_object(
          'stage_key', pe.stage_key,
          'notes', pe.notes,
          'closed_at', pe.closed_at,
          'assigned_to', COALESCE(
            NULLIF(pe.metadata->>'responsible_id', '')::uuid,
            NEW.closer_id),
          'sale_value', NULLIF(pe.metadata->>'sale_value', '')::numeric,
          'closer_id', NEW.closer_id,
          'responsible_id', NULLIF(pe.metadata->>'responsible_id', '')::uuid,
          'product_id', NULLIF(pe.metadata->>'product_id', '')::uuid,
          'product_type', pe.metadata->>'product_type',
          'calor', NULLIF(pe.metadata->>'calor', '')::integer,
          'loss_reason', pe.metadata->>'loss_reason',
          'loss_reason_id', NULLIF(pe.metadata->>'loss_reason_id', '')::uuid,
          'commitment_date', NULLIF(pe.metadata->>'commitment_date', '')::date,
          'contract_duration', NULLIF(pe.metadata->>'contract_duration', '')::integer,
          'metrics_period_at', NULLIF(pe.metadata->>'metrics_period_at', '')::timestamptz,
          'pre_sale_responsible_id', NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid,
          'sale_responsible_id', NULLIF(pe.metadata->>'sale_responsible_id', '')::uuid)
      END)
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
    WHERE pe.lead_id = NEW.id
      AND pe.organization_id = NEW.organization_id
      AND pip.type = 'system' -- metric-lint-allow: adaptador legado reproduz o recorte das views; não é métrica
      AND pip.slug IN ('confirmacao', 'propostas')
      AND NULLIF(pe.metadata->>'closer_id', '')::uuid IS DISTINCT FROM NEW.closer_id;
  END IF;

  IF NEW.sdr_id IS DISTINCT FROM OLD.sdr_id THEN
    PERFORM public.fn_entrada_sistema_atualizar(
      pe.id,
      CASE pip.slug
        WHEN 'whatsapp' THEN jsonb_build_object(
          'stage_key', pe.stage_key,
          'notes', pe.notes,
          'assigned_to', COALESCE(
            NULLIF(pe.metadata->>'responsible_id', '')::uuid,
            NEW.sdr_id),
          'responsible_id', NULLIF(pe.metadata->>'responsible_id', '')::uuid,
          'sdr_id', NEW.sdr_id,
          'pre_sale_responsible_id', NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid,
          'sale_responsible_id', NULLIF(pe.metadata->>'sale_responsible_id', '')::uuid,
          'scheduled_date', NULLIF(pe.metadata->>'scheduled_date', '')::timestamptz)
        WHEN 'confirmacao' THEN jsonb_build_object(
          'stage_key', pe.stage_key,
          'notes', pe.notes,
          'assigned_to', COALESCE(
            NULLIF(pe.metadata->>'responsible_id', '')::uuid,
            NULLIF(pe.metadata->>'closer_id', '')::uuid,
            NEW.sdr_id),
          'meeting_date', NULLIF(pe.metadata->>'meeting_date', '')::timestamptz,
          'is_confirmed', COALESCE((pe.metadata->>'is_confirmed')::boolean, false),
          'closer_id', NULLIF(pe.metadata->>'closer_id', '')::uuid,
          'responsible_id', NULLIF(pe.metadata->>'responsible_id', '')::uuid,
          'sdr_id', NEW.sdr_id,
          'meet_link', pe.metadata->>'meet_link',
          'metrics_period_at', NULLIF(pe.metadata->>'metrics_period_at', '')::timestamptz,
          'pre_sale_responsible_id', NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid,
          'sale_responsible_id', NULLIF(pe.metadata->>'sale_responsible_id', '')::uuid)
      END)
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
    WHERE pe.lead_id = NEW.id
      AND pe.organization_id = NEW.organization_id
      AND pip.type = 'system' -- metric-lint-allow: adaptador legado reproduz o recorte das views; não é métrica
      AND pip.slug IN ('whatsapp', 'confirmacao')
      AND NULLIF(pe.metadata->>'sdr_id', '')::uuid IS DISTINCT FROM NEW.sdr_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_responsible_from_lead_to_pipes() IS
  'SCRUM-674: reverse sync de leads para pipeline_entries via função compartilhada; preserva o contrato legado sem escrever pelos espelhos.';

