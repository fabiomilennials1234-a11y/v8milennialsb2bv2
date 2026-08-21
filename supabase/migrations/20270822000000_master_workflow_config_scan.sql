-- =====================================================
-- Varredura de configuração de workflow — leitura para o Master
--
-- O gate de ativação no editor previne workflow NOVO com nó incompleto. Ele não
-- alcança dois casos, e os dois estão sangrando em produção hoje:
--
--   1. Workflow já ativo e já quebrado. Ninguém vai abrir e re-salvar cada um.
--   2. Referência que APODRECEU: o nó aponta para uma etapa que existia quando o
--      workflow foi salvo e foi renomeada ou apagada depois. Era válido; virou
--      inválido sozinho. Nenhum gate de ativação pega isso.
--
-- Medido em 90 dias: ~6.400 execuções mortas por configuração — 3.296 de tag
-- ausente, 1.259 de membro ausente, ~1.500 de etapa inexistente, 223 de áudio sem
-- URL em 8 orgs distintas.
--
-- Esta função devolve MATÉRIA-PRIMA, não veredito: os nós e as etapas válidas.
-- Quem julga é `src/contracts/workflows/node-requirements.ts` — a MESMA função que
-- o editor usa. Reimplementar as regras em SQL criaria a divergência que este
-- trabalho inteiro existe para evitar.
--
-- SECURITY DEFINER com o gate DENTRO: RLS na tabela não fecha uma DEFINER.
-- =====================================================

CREATE OR REPLACE FUNCTION public.master_workflow_config_scan()
RETURNS TABLE (
  workflow_id       uuid,
  workflow_name     text,
  organization_id   uuid,
  organization_name text,
  nodes             jsonb,
  stage_keys        jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
BEGIN
  IF NOT (SELECT public.is_master_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH etapas AS (
    SELECT ps.organization_id AS org,
           jsonb_object_agg(ps.pipeline_type, ps.chaves) AS por_pipe
    FROM (
      SELECT organization_id, pipeline_type, jsonb_agg(stage_key) AS chaves
      FROM public.pipeline_stages
      WHERE is_active
      GROUP BY organization_id, pipeline_type
    ) ps
    GROUP BY ps.organization_id
  )
  SELECT w.id,
         w.name::text,
         w.organization_id,
         o.name::text,
         COALESCE(w.definition -> 'nodes', '[]'::jsonb),
         COALESCE(e.por_pipe, '{}'::jsonb)
  FROM public.workflows w
  JOIN public.organizations o ON o.id = w.organization_id
  LEFT JOIN etapas e ON e.org = w.organization_id
  WHERE w.is_active
  ORDER BY o.name, w.name;
END $$;

-- Função nova nasce com EXECUTE para PUBLIC. Fecha e concede só a authenticated —
-- o gate de master dentro do corpo é quem decide de fato.
REVOKE ALL ON FUNCTION public.master_workflow_config_scan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_workflow_config_scan() TO authenticated;

COMMENT ON FUNCTION public.master_workflow_config_scan() IS
  'Matéria-prima da varredura de config de workflow: nós dos workflows ATIVOS + etapas '
  'válidas por funil. O veredito é do contrato em src/contracts/workflows/node-requirements.ts, '
  'a mesma função que o editor usa — SQL não replica as regras.';
