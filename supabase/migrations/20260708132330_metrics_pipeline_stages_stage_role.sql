-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708132330  name: metrics_pipeline_stages_stage_role
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270301000020_pipeline_stages_stage_role.sql (#990, ADR-0017 §1)
CREATE TYPE public.stage_role AS ENUM ('open','meeting_booked','meeting_held','won','lost');
COMMENT ON TYPE public.stage_role IS 'ADR-0017 §1 — papel semântico exclusivo de uma etapa de pipeline. Único input de etapa permitido em métricas (is_final_* é UI-only).';

CREATE FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text)
RETURNS public.stage_role
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (
    CASE p_pipeline_type
      WHEN 'whatsapp' THEN
        CASE p_stage_key
          WHEN 'agendado' THEN 'meeting_booked'
          WHEN 'compareceu' THEN 'meeting_held'
          WHEN 'nao_compareceu' THEN 'lost'
          ELSE 'open'
        END
      WHEN 'confirmacao' THEN
        CASE p_stage_key
          WHEN 'reuniao_marcada' THEN 'meeting_booked'
          WHEN 'confirmar_d5' THEN 'meeting_booked'
          WHEN 'confirmar_d3' THEN 'meeting_booked'
          WHEN 'confirmar_d2' THEN 'meeting_booked'
          WHEN 'confirmar_d1' THEN 'meeting_booked'
          WHEN 'confirmacao_no_dia' THEN 'meeting_booked'
          WHEN 'compareceu' THEN 'meeting_held'
          WHEN 'perdido' THEN 'lost'
          ELSE 'open'
        END
      WHEN 'propostas' THEN
        CASE p_stage_key
          WHEN 'vendido' THEN 'won'
          WHEN 'perdido' THEN 'lost'
          ELSE 'open'
        END
      ELSE 'open'
    END
  )::public.stage_role
$$;
COMMENT ON FUNCTION public.system_stage_role(text, text) IS 'ADR-0017 §1 / #990 — mapa determinístico stage_key de sistema → stage_role. Fonte única: backfill, trigger de INSERT e classifier (#991) leem daqui. Chaves desconhecidas (custom) → open.';

ALTER TABLE public.pipeline_stages
  ADD COLUMN stage_role public.stage_role NOT NULL DEFAULT 'open';
COMMENT ON COLUMN public.pipeline_stages.stage_role IS 'ADR-0017 §1 — papel semântico governado da etapa. Único input de etapa válido para métricas. Renomear a etapa (name) NUNCA altera o role. is_final_positive/is_final_negative são UI-only.';

UPDATE public.pipeline_stages
SET stage_role = public.system_stage_role(pipeline_type, stage_key)
WHERE public.system_stage_role(pipeline_type, stage_key) <> 'open';

CREATE FUNCTION public.pipeline_stages_assign_system_stage_role()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage_role = 'open' THEN
    NEW.stage_role := public.system_stage_role(NEW.pipeline_type, NEW.stage_key);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_pipeline_stages_system_stage_role
  BEFORE INSERT ON public.pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.pipeline_stages_assign_system_stage_role();
