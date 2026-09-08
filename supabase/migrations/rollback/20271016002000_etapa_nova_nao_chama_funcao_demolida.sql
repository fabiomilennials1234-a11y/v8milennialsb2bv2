-- Rollback seguro: restaura o comportamento anterior completo, nunca o estado
-- quebrado em que o trigger existia sem sua dependência.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.system_stage_role(
  p_pipeline_type text,
  p_stage_key text
) RETURNS public.stage_role
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $$
  SELECT (
    CASE p_pipeline_type
      WHEN 'whatsapp' THEN
        CASE p_stage_key
          WHEN 'agendado' THEN 'meeting_booked'
          WHEN 'compareceu' THEN 'meeting_held'
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
          ELSE 'open'
        END
      ELSE 'open'
    END
  )::public.stage_role
$$;

CREATE OR REPLACE FUNCTION public.pipeline_stages_assign_system_stage_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.stage_role = 'open' THEN
    NEW.stage_role := public.system_stage_role(NEW.pipeline_type, NEW.stage_key);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipeline_stages_system_stage_role
  ON public.pipeline_stages;
CREATE TRIGGER trg_pipeline_stages_system_stage_role
BEFORE INSERT ON public.pipeline_stages
FOR EACH ROW
EXECUTE FUNCTION public.pipeline_stages_assign_system_stage_role();

REVOKE ALL ON FUNCTION public.system_stage_role(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pipeline_stages_assign_system_stage_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.system_stage_role(text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pipeline_stages_assign_system_stage_role()
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
