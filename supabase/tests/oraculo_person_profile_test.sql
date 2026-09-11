BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

SELECT has_function('public', 'oraculo_person_profile_at', ARRAY['uuid','uuid','date'], '(CONTRATO) perfil por prática existe');
SELECT ok(NOT has_function_privilege('authenticated', 'public.oraculo_person_profile_at(uuid,uuid,date)', 'EXECUTE'), '(ACL) navegador não chama perfil server-only');
SELECT ok(NOT has_function_privilege('authenticated', 'public.oraculo_revenue_bottleneck_without_people(uuid,uuid)', 'EXECUTE'), '(ACL) implementação interna também fica server-only');

INSERT INTO public.organizations (id,name,slug,timezone) VALUES
  ('a6040000-0000-4000-8000-000000000001','Org 604','org-604','America/Sao_Paulo');

SET LOCAL session_replication_role = replica;

INSERT INTO public.team_members (id,organization_id,name,role,is_active,metric_type) VALUES
  ('a6040000-0000-4000-8000-000000000011','a6040000-0000-4000-8000-000000000001','Ana','admin',true,'meetings');
INSERT INTO public.team_members (id,organization_id,name,role,is_active,metric_type) VALUES
  ('a6040000-0000-4000-8000-000000000012','a6040000-0000-4000-8000-000000000001','Bia','member',true,'sales'),
  ('a6040000-0000-4000-8000-000000000013','a6040000-0000-4000-8000-000000000001','Caio','member',true,'sales'),
  ('a6040000-0000-4000-8000-000000000014','a6040000-0000-4000-8000-000000000001','Duda','member',true,'sales'),
  ('a6040000-0000-4000-8000-000000000015','a6040000-0000-4000-8000-000000000001','Conta sem prática','member',true,'meetings');

-- Quatro praticantes de fechamento: taxas 0%, 40%, 60%, 80%; mediana 50%.
-- Ana nunca vendeu. O impacto dela ainda usa o ticket observado do time.
INSERT INTO public.sale_events (
  id,organization_id,lead_id,deal_id,event_type,sale_value,sold_at,sale_responsible_id,revenue_stream
)
SELECT gen_random_uuid(),'a6040000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),
  CASE WHEN g <= successes THEN 'sale' ELSE 'sale_lost' END,
  CASE WHEN g <= successes THEN 1000 END,'2026-08-10 12:00+00',member_id,'novo_negocio'
FROM (VALUES
 ('a6040000-0000-4000-8000-000000000011'::uuid,0),
 ('a6040000-0000-4000-8000-000000000012'::uuid,4),
 ('a6040000-0000-4000-8000-000000000013'::uuid,6),
 ('a6040000-0000-4000-8000-000000000014'::uuid,8)
) people(member_id,successes) CROSS JOIN generate_series(1,10) g;
INSERT INTO public.sale_events (
  id,organization_id,lead_id,deal_id,event_type,sale_value,sold_at,sale_responsible_id,revenue_stream
)
SELECT gen_random_uuid(),'a6040000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),
  'sale_lost',NULL,'2026-07-01 12:00+00','a6040000-0000-4000-8000-000000000011','novo_negocio'
FROM generate_series(1,10) g;

CREATE TEMP TABLE profile_result AS
SELECT public.oraculo_person_profile_at('a6040000-0000-4000-8000-000000000001',NULL,'2026-09-10') value;

SELECT is((SELECT p->>'status' FROM profile_result, jsonb_array_elements(value->'profiles') p
  WHERE p->>'team_member_name'='Ana' AND p->>'metric'='sales'), 'evaluable', '(PRÁTICA) Ana é avaliada em vendas apesar do declarado');
SELECT is((SELECT p->>'declared_absence' FROM profile_result, jsonb_array_elements(value->'profiles') p
  WHERE p->>'team_member_name'='Ana' AND p->>'metric'='meetings'), 'true', '(DECLARADO) campo só explica ausência observada');
SELECT is((SELECT p->>'status' FROM profile_result, jsonb_array_elements(value->'profiles') p
  WHERE p->>'team_member_name'='Conta sem prática' AND p->>'metric'='meetings'), 'insufficient_volume', '(PISO) conta sem atribuição aparece marcada');
SELECT is((SELECT p->>'team_sample_size' FROM profile_result, jsonb_array_elements(value->'profiles') p
  WHERE p->>'team_member_name'='Ana' AND p->>'metric'='sales'), '4', '(TIME) quatro praticantes liberam mediana');
SELECT is((SELECT p->>'benchmark_conversion' FROM profile_result, jsonb_array_elements(value->'profiles') p
  WHERE p->>'team_member_name'='Ana' AND p->>'metric'='sales'), '0.5000', '(MEDIANA) referência anônima é 50%');
SELECT is((SELECT value->'bottleneck'->>'dimension' FROM profile_result), 'person', '(ADMIN) gargalo pode apontar pessoa');
SELECT is((SELECT value->'bottleneck'->>'team_member_name' FROM profile_result), 'Ana', '(ADMIN) gestor recebe nome do gargalo');
SELECT is(((SELECT value->'bottleneck'->>'estimated_leaked_revenue' FROM profile_result))::numeric, 5000::numeric, '(DINHEIRO) zero venda própria usa ticket observado do time');

CREATE TEMP TABLE self_result AS
SELECT public.oraculo_person_profile_at('a6040000-0000-4000-8000-000000000001','a6040000-0000-4000-8000-000000000011','2026-09-10') value;
SELECT is((SELECT value->'bottleneck'->>'dimension' FROM self_result), 'self', '(MEMBER) dimensão pessoa não atravessa a fronteira');
SELECT ok((SELECT value::text NOT LIKE '%Bia%' AND value::text NOT LIKE '%Ana%' FROM self_result), '(PRIVACIDADE) autoavaliação não contém nomes');

SELECT * FROM finish();
ROLLBACK;
