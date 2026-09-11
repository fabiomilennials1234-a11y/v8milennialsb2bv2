BEGIN;
-- Apenas filtro de lista: nenhum cadastro ou histórico é removido.
CREATE FUNCTION public.visivel_lista_cafe_jurere(public.leads)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN ($1).organization_id IS DISTINCT FROM '4922638c-4909-494e-ba10-12282ec0b161'::uuid THEN true
    -- Leads nativos do CRM continuam nas abas Lead e Perdido.
    WHEN nullif(btrim(($1).erp_code), '') IS NULL THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.upsell_clients c
      JOIN public.erp_owner_map m ON m.organization_id = c.organization_id
        AND m.provider = 'toth' AND m.erp_owner_external_id = c.erp_owner_external_id
      JOIN public.team_members t ON t.id = m.team_member_id
        AND t.organization_id = c.organization_id
      WHERE c.organization_id = ($1).organization_id AND c.lead_id = ($1).id
        AND c.external_source = 'toth' AND c.erp_company = 'CAFE JURERE'
        AND c.erp_status IN ('0', '3')
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.visivel_lista_cafe_jurere(public.leads) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visivel_lista_cafe_jurere(public.leads) TO authenticated, service_role;
COMMENT ON FUNCTION public.visivel_lista_cafe_jurere(public.leads) IS
  'Filtro exclusivo da lista Café Jurerê: CRM nativo ou ERP Toth 0/3 com representante mapeado na mesma organização. SECURITY INVOKER; sem exclusão de dados.';
NOTIFY pgrst, 'reload schema';
COMMIT;
