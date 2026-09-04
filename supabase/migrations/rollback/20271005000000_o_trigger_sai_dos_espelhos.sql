-- Rollback exato de 20271005000000_o_trigger_sai_dos_espelhos.sql.
-- Capturado de PROD em 2026-09-04 antes da janela.

CREATE OR REPLACE FUNCTION public.sync_responsible_from_lead_to_pipes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.responsible_id IS DISTINCT FROM OLD.responsible_id THEN
    UPDATE public.pipe_whatsapp
       SET responsible_id = NEW.responsible_id
     WHERE lead_id = NEW.id AND responsible_id IS DISTINCT FROM NEW.responsible_id;

    UPDATE public.pipe_confirmacao
       SET responsible_id = NEW.responsible_id
     WHERE lead_id = NEW.id AND responsible_id IS DISTINCT FROM NEW.responsible_id;

    UPDATE public.pipe_propostas
       SET responsible_id = NEW.responsible_id
     WHERE lead_id = NEW.id AND responsible_id IS DISTINCT FROM NEW.responsible_id;

    UPDATE public.campanha_leads
       SET responsible_id = NEW.responsible_id
     WHERE lead_id = NEW.id AND responsible_id IS DISTINCT FROM NEW.responsible_id;
  END IF;

  IF NEW.closer_id IS DISTINCT FROM OLD.closer_id THEN
    UPDATE public.pipe_confirmacao
       SET closer_id = NEW.closer_id
     WHERE lead_id = NEW.id AND closer_id IS DISTINCT FROM NEW.closer_id;

    UPDATE public.pipe_propostas
       SET closer_id = NEW.closer_id
     WHERE lead_id = NEW.id AND closer_id IS DISTINCT FROM NEW.closer_id;
  END IF;

  IF NEW.sdr_id IS DISTINCT FROM OLD.sdr_id THEN
    UPDATE public.pipe_whatsapp
       SET sdr_id = NEW.sdr_id
     WHERE lead_id = NEW.id AND sdr_id IS DISTINCT FROM NEW.sdr_id;

    UPDATE public.pipe_confirmacao
       SET sdr_id = NEW.sdr_id
     WHERE lead_id = NEW.id AND sdr_id IS DISTINCT FROM NEW.sdr_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_responsible_from_lead_to_pipes() IS
  'Reverse sync: leads.{responsible_id,closer_id,sdr_id} → pipe_*. Corrige bug de visibilidade em que o closer/sdr antigo continuava vendo o card após transferência (incidente 2026-04-23).';

