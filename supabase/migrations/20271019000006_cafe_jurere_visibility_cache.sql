BEGIN;
ALTER TABLE public.leads ADD COLUMN cafe_jurere_erp_elegivel boolean NOT NULL DEFAULT false;

-- Projeção derivada: nenhuma permissão adicional de leitura de clientes.
-- Recalcular na escrita evita executar RLS das três tabelas para cada lead.
CREATE FUNCTION public.derive_cafe_jurere_lead_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_id = '4922638c-4909-494e-ba10-12282ec0b161'::uuid THEN
    NEW.cafe_jurere_erp_elegivel := EXISTS (
      SELECT 1 FROM public.upsell_clients c
      JOIN public.erp_owner_map m ON m.organization_id=c.organization_id
        AND m.provider='toth' AND m.erp_owner_external_id=c.erp_owner_external_id
      JOIN public.team_members t ON t.id=m.team_member_id AND t.organization_id=c.organization_id
      WHERE c.organization_id=NEW.organization_id AND c.lead_id=NEW.id
        AND c.external_source='toth' AND c.erp_company='CAFE JURERE' AND c.erp_status IN ('0','3')
    );
  ELSE
    NEW.cafe_jurere_erp_elegivel := false;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER derive_cafe_jurere_lead_scope
BEFORE INSERT OR UPDATE OF cafe_jurere_erp_elegivel, organization_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.derive_cafe_jurere_lead_scope();

CREATE FUNCTION public.refresh_cafe_jurere_lead_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  old_row jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  new_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
BEGIN
  IF old_row->>'organization_id' IS DISTINCT FROM '4922638c-4909-494e-ba10-12282ec0b161'
    AND new_row->>'organization_id' IS DISTINCT FROM '4922638c-4909-494e-ba10-12282ec0b161' THEN
    RETURN NULL;
  END IF;
  UPDATE public.leads l SET cafe_jurere_erp_elegivel=l.cafe_jurere_erp_elegivel
  WHERE l.organization_id='4922638c-4909-494e-ba10-12282ec0b161'::uuid
    AND (TG_TABLE_NAME <> 'upsell_clients'
      OR l.id IN ((old_row->>'lead_id')::uuid,(new_row->>'lead_id')::uuid))
    AND l.cafe_jurere_erp_elegivel IS DISTINCT FROM EXISTS (
      SELECT 1 FROM public.upsell_clients c
      JOIN public.erp_owner_map m ON m.organization_id=c.organization_id
        AND m.provider='toth' AND m.erp_owner_external_id=c.erp_owner_external_id
      JOIN public.team_members t ON t.id=m.team_member_id AND t.organization_id=c.organization_id
      WHERE c.organization_id=l.organization_id AND c.lead_id=l.id
        AND c.external_source='toth' AND c.erp_company='CAFE JURERE' AND c.erp_status IN ('0','3')
    );
  RETURN NULL;
END;
$$;
CREATE TRIGGER refresh_cafe_jurere_scope_clients
AFTER INSERT OR DELETE OR UPDATE OF organization_id, lead_id, external_source, erp_company, erp_status, erp_owner_external_id
ON public.upsell_clients FOR EACH ROW EXECUTE FUNCTION public.refresh_cafe_jurere_lead_scope();
CREATE TRIGGER refresh_cafe_jurere_scope_map
AFTER INSERT OR DELETE OR UPDATE OF organization_id, provider, erp_owner_external_id, team_member_id
ON public.erp_owner_map FOR EACH ROW EXECUTE FUNCTION public.refresh_cafe_jurere_lead_scope();
CREATE TRIGGER refresh_cafe_jurere_scope_members
AFTER DELETE OR UPDATE OF organization_id ON public.team_members
FOR EACH ROW EXECUTE FUNCTION public.refresh_cafe_jurere_lead_scope();

REVOKE ALL ON FUNCTION public.derive_cafe_jurere_lead_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_cafe_jurere_lead_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derive_cafe_jurere_lead_scope(), public.refresh_cafe_jurere_lead_scope() TO service_role;

CREATE OR REPLACE FUNCTION public.visivel_lista_cafe_jurere(public.leads)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT ($1).organization_id IS DISTINCT FROM '4922638c-4909-494e-ba10-12282ec0b161'::uuid
    OR nullif(pg_catalog.btrim(($1).erp_code),'') IS NULL
    OR ($1).cafe_jurere_erp_elegivel;
$$;
ALTER FUNCTION public.visivel_lista_cafe_jurere(public.leads) RESET ALL;
NOTIFY pgrst, 'reload schema';
COMMIT;
