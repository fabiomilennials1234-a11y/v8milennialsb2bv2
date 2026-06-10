-- #755: transição de campos de atribuição legados → canônicos (CONTEXT.md).
-- Espelhamento bidirecional em leads: qualquer writer (UI, RPC, webhook, import)
-- que toque só o legado (sdr_id/closer_id/responsible_id) mantém o canônico
-- (pre_sale_responsible_id/sale_responsible_id) sincronizado, e vice-versa.
-- Inclui desatribuição (legado → NULL espelha canônico → NULL).
-- Remove a necessidade de dual-write em 12+ call sites; o drop das colunas
-- legadas (fase final do #755) só exige flip dos readers.

CREATE OR REPLACE FUNCTION public.fn_sync_canonical_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.pre_sale_responsible_id IS NULL THEN NEW.pre_sale_responsible_id := NEW.sdr_id; END IF;
    IF NEW.sdr_id IS NULL THEN NEW.sdr_id := NEW.pre_sale_responsible_id; END IF;
    IF NEW.sale_responsible_id IS NULL THEN NEW.sale_responsible_id := COALESCE(NEW.closer_id, NEW.responsible_id); END IF;
    IF NEW.closer_id IS NULL THEN NEW.closer_id := NEW.sale_responsible_id; END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: espelha só o lado que mudou; quem foi tocado explicitamente vence.
  IF NEW.sdr_id IS DISTINCT FROM OLD.sdr_id
     AND NEW.pre_sale_responsible_id IS NOT DISTINCT FROM OLD.pre_sale_responsible_id THEN
    NEW.pre_sale_responsible_id := NEW.sdr_id;
  ELSIF NEW.pre_sale_responsible_id IS DISTINCT FROM OLD.pre_sale_responsible_id
     AND NEW.sdr_id IS NOT DISTINCT FROM OLD.sdr_id THEN
    NEW.sdr_id := NEW.pre_sale_responsible_id;
  END IF;

  IF NEW.closer_id IS DISTINCT FROM OLD.closer_id
     AND NEW.sale_responsible_id IS NOT DISTINCT FROM OLD.sale_responsible_id THEN
    NEW.sale_responsible_id := NEW.closer_id;
  ELSIF NEW.responsible_id IS DISTINCT FROM OLD.responsible_id
     AND NEW.closer_id IS NOT DISTINCT FROM OLD.closer_id
     AND NEW.sale_responsible_id IS NOT DISTINCT FROM OLD.sale_responsible_id THEN
    NEW.sale_responsible_id := COALESCE(NEW.closer_id, NEW.responsible_id);
  ELSIF NEW.sale_responsible_id IS DISTINCT FROM OLD.sale_responsible_id
     AND NEW.closer_id IS NOT DISTINCT FROM OLD.closer_id THEN
    NEW.closer_id := NEW.sale_responsible_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_sync_canonical_assignment ON public.leads;
CREATE TRIGGER trg_leads_sync_canonical_assignment
  BEFORE INSERT OR UPDATE OF sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id
  ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_canonical_assignment();
