-- VERIFICAÇÃO de 20270301000020_pipeline_stages_stage_role.sql (issue #990)
--
-- Rodar logo após aplicar a migration (dev primeiro; prod só com autorização):
--   psql "$DATABASE_URL" -f supabase/migrations/rollback/20270301000020_pipeline_stages_stage_role_verify.sql
--
-- Critério de aceite: a query (1) retorna 0 LINHAS — 100% das stages de
-- sistema carregam o role do mapa determinístico e 100% das custom estão
-- 'open'. Nota: após a fatia #991 (classifier) e overrides humanos, stages
-- CUSTOM podem legitimamente divergir do mapa (que devolve 'open' pra elas);
-- esta verificação vale para o estado imediatamente pós-backfill.

-- (1) Divergências do mapa determinístico — esperado: 0 linhas
SELECT organization_id,
       pipeline_type,
       stage_key,
       name,
       stage_role,
       public.system_stage_role(pipeline_type, stage_key) AS expected_role
FROM public.pipeline_stages
WHERE stage_role IS DISTINCT FROM
      public.system_stage_role(pipeline_type, stage_key)
ORDER BY organization_id, pipeline_type, position;

-- (2) Cobertura positiva — sanity: distribuições por role
--     (toda org com pipes de sistema deve ter won, lost, meeting_booked,
--      meeting_held; nenhum role NULL é possível — coluna NOT NULL)
SELECT stage_role,
       count(*)                       AS stages,
       count(DISTINCT organization_id) AS orgs
FROM public.pipeline_stages
GROUP BY stage_role
ORDER BY stage_role;

-- (3) Chaves de sistema esperadas por org — esperado: 0 linhas
--     (org com pipe de sistema mas sem a stage won/lost/meeting seeded)
WITH expected(pipeline_type, stage_key, role) AS (
  VALUES
    ('whatsapp',    'agendado',           'meeting_booked'),
    ('confirmacao', 'reuniao_marcada',    'meeting_booked'),
    ('confirmacao', 'compareceu',         'meeting_held'),
    ('confirmacao', 'perdido',            'lost'),
    ('propostas',   'vendido',            'won'),
    ('propostas',   'perdido',            'lost')
)
SELECT o.id AS organization_id, e.pipeline_type, e.stage_key, e.role AS missing_role
FROM public.organizations o
CROSS JOIN expected e
WHERE EXISTS (  -- a org tem o pipe de sistema em questão
        SELECT 1 FROM public.pipeline_stages ps
        WHERE ps.organization_id = o.id AND ps.pipeline_type = e.pipeline_type)
  AND NOT EXISTS (
        SELECT 1 FROM public.pipeline_stages ps
        WHERE ps.organization_id = o.id
          AND ps.pipeline_type   = e.pipeline_type
          AND ps.stage_key       = e.stage_key
          AND ps.stage_role      = e.role::public.stage_role)
ORDER BY o.id, e.pipeline_type, e.stage_key;
