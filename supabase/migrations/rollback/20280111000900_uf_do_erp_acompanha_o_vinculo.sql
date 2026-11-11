-- Rollback de 20280111000900_uf_do_erp_acompanha_o_vinculo.sql
--
-- Volta ao trigger de 20280111000600: a UF do ERP vai ao lead, mas não sai
-- mais dele (ERP limpando a UF, re-vínculo e exclusão do cliente voltam a
-- deixar o lead com a UF velha marcada 'erp').
--
-- Os leads que este trigger já devolveu ao DDD continuam no DDD — é o estado
-- certo para quem não tem mais cliente com UF válida. uf_brasileira fica: é
-- de 20280111000600.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.upsell_clients_uf_para_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_uf char(2);
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NULL;
  END IF;
  v_uf := public.uf_brasileira(NEW.erp_uf);
  IF v_uf IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads l
     SET uf = v_uf,
         uf_source = 'erp'
   WHERE l.id = NEW.lead_id
     AND l.organization_id = NEW.organization_id
     -- Só palpite (DDD), vazio ou o próprio ERP; nunca o que alguém disse.
     AND (l.uf IS NULL OR l.uf_source IN ('ddd', 'erp'))
     -- E só quando muda algo: o lead tem 21 triggers.
     AND (l.uf IS DISTINCT FROM v_uf OR l.uf_source IS DISTINCT FROM 'erp');

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.upsell_clients_uf_para_lead() IS
  'Trigger de upsell_clients: a UF do ERP (erp_uf) vai para o lead vinculado da mesma org quando a UF dele está vazia ou veio de DDD/ERP. Nunca sobrescreve manual/webhook/ai. Ver 20280111000600.';

REVOKE ALL ON FUNCTION public.upsell_clients_uf_para_lead() FROM PUBLIC, anon, authenticated;

-- O corpo de 600 lê NEW: o trigger volta a não disparar em DELETE.
CREATE OR REPLACE TRIGGER trg_upsell_clients_uf_para_lead
  AFTER INSERT OR UPDATE OF erp_uf, lead_id ON public.upsell_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.upsell_clients_uf_para_lead();

DO $verify$
BEGIN
  IF position('AFTER INSERT OR UPDATE OF erp_uf, lead_id ON public.upsell_clients FOR EACH ROW'
              IN coalesce(pg_get_triggerdef((SELECT oid FROM pg_trigger
                                              WHERE tgrelid = 'public.upsell_clients'::regclass
                                                AND tgname = 'trg_upsell_clients_uf_para_lead')), '')) = 0 THEN
    RAISE EXCEPTION 'rollback: trg_upsell_clients_uf_para_lead não voltou ao estado de 20280111000600';
  END IF;
END
$verify$;
