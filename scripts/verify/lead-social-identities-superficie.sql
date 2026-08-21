-- Asserções de SUPERFÍCIE da migration 20270817090000_lead_social_identities.
--
-- Uso:  node scripts/prod-sql.mjs --file scripts/verify/lead-social-identities-superficie.sql
--       (trocar o alvo no script para rodar contra dev)
--
-- Só leitura. Verifica o que a migration PROMETE: RLS ligada, policies, índice
-- único, e — sobretudo — QUEM PODE EXECUTAR O QUÊ. Os grants são a metade da
-- migration que nenhum teste de comportamento pega: uma função DEFINER nasce
-- executável por PUBLIC/anon/service_role pelo default privilege do Supabase, e
-- o REVOKE é o que fecha. Se alguém fizer DROP+CREATE de qualquer uma destas
-- funções, os grants voltam ao default e este arquivo fica vermelho.
--
-- CONTROLE NEGATIVO: com a tabela ausente ele ERRA (42P01) em vez de dar verde —
-- foi medido antes do apply em prod, em 2026-08-15.
--
-- Cada linha é um fato verificável. `esperado` explicita o que tem de ser.
WITH checks(ordem, alvo, medido, esperado) AS (
  VALUES
    (1,  'tabela existe',
         (to_regclass('public.lead_social_identities') IS NOT NULL)::text, 'true'),
    (2,  'RLS habilitada',
         COALESCE((SELECT relrowsecurity::text FROM pg_class WHERE oid = to_regclass('public.lead_social_identities')), 'AUSENTE'), 'true'),
    (3,  'policies na tabela',
         COALESCE((SELECT count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='lead_social_identities'), '0'), '2'),
    (4,  'indice unico (org,tipo,id)',
         (to_regclass('public.uq_lead_social_identities_org_identity') IS NOT NULL)::text, 'true'),
    (5,  'anon NAO le a tabela',
         has_table_privilege('anon', 'public.lead_social_identities', 'SELECT')::text, 'false'),
    (6,  'authenticated LE a tabela',
         has_table_privilege('authenticated', 'public.lead_social_identities', 'SELECT')::text, 'true'),
    (7,  'authenticated NAO escreve na tabela',
         (has_table_privilege('authenticated', 'public.lead_social_identities', 'INSERT')
          OR has_table_privilege('authenticated', 'public.lead_social_identities', 'UPDATE')
          OR has_table_privilege('authenticated', 'public.lead_social_identities', 'DELETE'))::text, 'false'),
    (8,  'service_role escreve na tabela',
         has_table_privilege('service_role', 'public.lead_social_identities', 'INSERT')::text, 'true'),
    (9,  'can_link_or_read_lead: anon SEM execute',
         has_function_privilege('anon', 'public.can_link_or_read_lead(uuid,uuid)', 'EXECUTE')::text, 'false'),
    (10, 'can_link_or_read_lead: authenticated SEM execute',
         has_function_privilege('authenticated', 'public.can_link_or_read_lead(uuid,uuid)', 'EXECUTE')::text, 'false'),
    (11, 'can_link_or_read_lead: service_role SEM execute',
         has_function_privilege('service_role', 'public.can_link_or_read_lead(uuid,uuid)', 'EXECUTE')::text, 'false'),
    (12, 'link: authenticated COM execute',
         has_function_privilege('authenticated', 'public.link_social_conversation_to_lead(uuid,uuid,text,uuid)', 'EXECUTE')::text, 'true'),
    (13, 'link: anon SEM execute',
         has_function_privilege('anon', 'public.link_social_conversation_to_lead(uuid,uuid,text,uuid)', 'EXECUTE')::text, 'false'),
    (14, 'link: service_role SEM execute',
         has_function_privilege('service_role', 'public.link_social_conversation_to_lead(uuid,uuid,text,uuid)', 'EXECUTE')::text, 'false'),
    (15, 'create: authenticated COM execute',
         has_function_privilege('authenticated', 'public.create_lead_from_social_conversation(uuid,uuid,text,text,text,text,text,text,uuid,uuid,uuid)', 'EXECUTE')::text, 'true'),
    (16, 'create: anon SEM execute',
         has_function_privilege('anon', 'public.create_lead_from_social_conversation(uuid,uuid,text,text,text,text,text,text,uuid,uuid,uuid)', 'EXECUTE')::text, 'false'),
    (17, 'create: service_role SEM execute',
         has_function_privilege('service_role', 'public.create_lead_from_social_conversation(uuid,uuid,text,text,text,text,text,text,uuid,uuid,uuid)', 'EXECUTE')::text, 'false'),
    (18, 'unlink: authenticated COM execute',
         has_function_privilege('authenticated', 'public.unlink_social_conversation_from_lead(uuid,uuid,text)', 'EXECUTE')::text, 'true'),
    (19, 'unlink: anon SEM execute',
         has_function_privilege('anon', 'public.unlink_social_conversation_from_lead(uuid,uuid,text)', 'EXECUTE')::text, 'false'),
    (20, 'lista: authenticated COM execute',
         has_function_privilege('authenticated', 'public.get_social_conversation_list(uuid,uuid,integer,timestamptz)', 'EXECUTE')::text, 'true'),
    (21, 'lista: anon SEM execute',
         has_function_privilege('anon', 'public.get_social_conversation_list(uuid,uuid,integer,timestamptz)', 'EXECUTE')::text, 'false'),
    (22, 'lista: service_role COM execute',
         has_function_privilege('service_role', 'public.get_social_conversation_list(uuid,uuid,integer,timestamptz)', 'EXECUTE')::text, 'true'),
    (23, 'lista devolve lead_name',
         (EXISTS (SELECT 1 FROM pg_proc p
                   WHERE p.pronamespace='public'::regnamespace
                     AND p.proname='get_social_conversation_list'
                     AND pg_get_function_result(p.oid) LIKE '%lead_name%'))::text, 'true'),
    (24, 'trigger updated_at',
         (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_lead_social_identities_updated_at' AND NOT tgisinternal))::text, 'true'),
    (25, 'as 4 RPCs sao SECURITY DEFINER',
         (SELECT count(*)::text FROM pg_proc
           WHERE pronamespace='public'::regnamespace AND prosecdef
             AND proname IN ('can_link_or_read_lead','link_social_conversation_to_lead',
                             'create_lead_from_social_conversation','unlink_social_conversation_from_lead')), '4')
)
SELECT ordem,
       alvo,
       medido,
       esperado,
       CASE WHEN medido = esperado THEN 'ok' ELSE 'FALHA' END AS veredito
  FROM checks
 ORDER BY ordem;
