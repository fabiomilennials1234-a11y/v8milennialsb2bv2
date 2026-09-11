-- Piloto da página de Leads da Café Jurerê. Não escreve classificacao,
-- relacao_negocios, configurações da integração ou dados de clientes.
-- Criada via CLI e ordenada após as migrations existentes do repositório.
BEGIN;

-- Campo calculado PostgREST: o filtro precede paginação, contagem e exportação.
-- Parâmetro sem nome: não oferecer uma RPC que aceite um lead arbitrário.
CREATE FUNCTION public.classificacao_cafe_jurere(public.leads)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN ($1).organization_id IS DISTINCT FROM '4922638c-4909-494e-ba10-12282ec0b161'::uuid THEN NULL
    -- O cadastro prevalece sobre situação, representante e desfechos.
    -- Mesmo critério de presença usado pela integração existente.
    WHEN nullif(btrim(($1).erp_code), '') IS NOT NULL THEN 'cliente'
    ELSE (
      WITH desfechos AS (
        SELECT d.outcome
        FROM public.deals d
        WHERE d.organization_id = ($1).organization_id
          AND d.source_lead_id = ($1).id AND d.deleted_at IS NULL
        UNION ALL
        SELECT CASE
          WHEN d.outcome IN ('won', 'lost', 'open') THEN d.outcome
          WHEN st.stage_role IN ('won', 'lost') THEN st.stage_role::text
          ELSE 'open'
        END
        FROM public.pipeline_entries pe
        JOIN public.pipelines p ON p.id = pe.pipeline_id
          AND p.organization_id = pe.organization_id AND p.is_active = true
        LEFT JOIN public.deals d ON d.id = pe.deal_id
          AND d.organization_id = pe.organization_id AND d.deleted_at IS NULL
        LEFT JOIN public.pipeline_stages st ON st.pipeline_id = pe.pipeline_id
          AND st.organization_id = pe.organization_id AND st.is_active = true
          AND (st.stage_key = pe.stage_key OR st.id::text = pe.stage_key)
        WHERE pe.organization_id = ($1).organization_id AND pe.lead_id = ($1).id
          AND (pe.deal_id IS NULL OR d.id IS NOT NULL)
      )
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM desfechos WHERE outcome = 'lost')
          AND NOT EXISTS (SELECT 1 FROM desfechos WHERE outcome = 'won') THEN 'perdido'
        ELSE 'lead'
      END
    )
  END;
$$;
COMMENT ON FUNCTION public.classificacao_cafe_jurere(public.leads) IS
  'Piloto Café Jurerê: erp_code preenchido = cliente; sem código, alguma perda e nenhum ganho = perdido; demais = lead. Negócio aberto não anula perda. RLS do chamador.';
REVOKE ALL ON FUNCTION public.classificacao_cafe_jurere(public.leads) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classificacao_cafe_jurere(public.leads) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
