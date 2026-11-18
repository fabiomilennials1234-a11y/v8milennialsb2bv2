-- supabase/tests/prod-only/gen_prelude_de_prod.sql
--
-- Gera o "prelúdio de fidelidade": o DDL EXATO de prod dos policies de
-- leads/pipelines/pipeline_entries, mais o fecho das funções private.*/public.*
-- que eles chamam e as tabelas/views private.* que essas funções leem.
-- SOMENTE LEITURA (SET TRANSACTION READ ONLY). Rode em prod pela Management API
-- (python ~/.claude/scripts/prod_sql.py <este-arquivo>) e grave a coluna
-- `prelude` num .sql; depois injete com `--migration` ANTES da migration testada.
-- O que não entra: as ~65 policies strict_* das outras tabelas (leads_phones,
-- whatsapp_*, deals...) e a view private.whatsapp_conversation_summary.SET default_transaction_read_only = on;
SET TRANSACTION READ ONLY;
WITH RECURSIVE base AS (
  SELECT DISTINCT d.refobjid AS oid
    FROM pg_depend d
    JOIN pg_policy po ON d.classid = 'pg_policy'::regclass AND d.objid = po.oid
   WHERE po.polrelid IN ('public.leads'::regclass, 'public.pipelines'::regclass, 'public.pipeline_entries'::regclass)
     AND d.refclassid = 'pg_proc'::regclass
), closure AS (
  SELECT oid FROM base
  UNION
  SELECT p2.oid
    FROM closure c
    JOIN pg_proc p ON p.oid = c.oid
    JOIN pg_proc p2 ON p2.pronamespace IN ('private'::regnamespace, 'public'::regnamespace)
                   AND p2.oid <> p.oid
                   AND p.prosrc ~ ('(^|[^a-z0-9_])' || p2.proname || '\s*\(')
), fn AS (
  SELECT p.* FROM closure c JOIN pg_proc p ON p.oid = c.oid
   WHERE p.pronamespace IN ('private'::regnamespace, 'public'::regnamespace)
), parts AS (
  SELECT 1 AS ord, 0 AS seq, 'SET LOCAL check_function_bodies = off;' AS part
  UNION ALL
  SELECT 2, 0, 'CREATE SCHEMA IF NOT EXISTS private;'
  UNION ALL
  SELECT 30, row_number() OVER (ORDER BY c.relname)::int,
         format('CREATE TABLE IF NOT EXISTS private.%I (%s);', c.relname,
           (SELECT string_agg(format('%I %s', a.attname, format_type(a.atttypid, a.atttypmod)), ', ' ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
    FROM pg_class c
   WHERE c.relnamespace = 'private'::regnamespace AND c.relkind = 'r'
     AND c.relname = ANY (ARRAY['jrtex_karine_pending_leads','jrtex_pipeline_accounts','riofix_balcao_accounts',
                                'riofix_balcao_pending_leads','riofix_balcao_pipelines','whatsapp_user_instance_restrictions'])
  UNION ALL
  SELECT 57, row_number() OVER (ORDER BY c.relname)::int,
         format('CREATE OR REPLACE VIEW private.%I %s AS %s', c.relname,
           CASE WHEN c.reloptions IS NOT NULL THEN 'WITH (' || array_to_string(c.reloptions, ', ') || ')' ELSE '' END,
           pg_get_viewdef(c.oid, true))
    FROM pg_class c
   WHERE c.relnamespace = 'private'::regnamespace AND c.relkind = 'v'
     AND c.relname = ANY (ARRAY['lead_owners','leads','pipeline_entries'])
  UNION ALL
  SELECT 50, row_number() OVER (ORDER BY n.nspname, p.proname, p.oid)::int,
         pg_get_functiondef(p.oid) || ';'
    FROM fn p JOIN pg_namespace n ON n.oid = p.pronamespace
  UNION ALL
  SELECT 55, row_number() OVER (ORDER BY p.oid)::int,
         format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role;', p.oid::regprocedure)
    FROM fn p WHERE p.proacl IS NOT NULL
  UNION ALL
  SELECT 56, row_number() OVER (ORDER BY p.oid, g.grantee)::int,
         format('GRANT EXECUTE ON FUNCTION %s TO %s;', p.oid::regprocedure,
                CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = g.grantee)) END)
    FROM fn p, LATERAL aclexplode(p.proacl) g
   WHERE g.privilege_type = 'EXECUTE' AND g.grantee <> p.proowner
  UNION ALL
  SELECT 60, 0, $d$DO $x$ DECLARE r record; BEGIN
    FOR r IN SELECT policyname, tablename FROM pg_policies
              WHERE schemaname = 'public' AND tablename IN ('leads','pipelines','pipeline_entries') LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    END LOOP; END $x$;$d$
  UNION ALL
  SELECT 70, row_number() OVER (ORDER BY c.relname, po.polname)::int,
         format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s;', po.polname, c.relname,
           CASE WHEN po.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
           CASE po.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
           CASE WHEN po.polroles = '{0}'::oid[] THEN 'PUBLIC'
                ELSE (SELECT string_agg(quote_ident(rolname), ', ') FROM pg_roles WHERE oid = ANY (po.polroles)) END,
           CASE WHEN po.polqual IS NOT NULL THEN ' USING (' || pg_get_expr(po.polqual, po.polrelid) || ')' ELSE '' END,
           CASE WHEN po.polwithcheck IS NOT NULL THEN ' WITH CHECK (' || pg_get_expr(po.polwithcheck, po.polrelid) || ')' ELSE '' END)
    FROM pg_policy po JOIN pg_class c ON c.oid = po.polrelid
   WHERE po.polrelid IN ('public.leads'::regclass, 'public.pipelines'::regclass, 'public.pipeline_entries'::regclass)
)
SELECT current_setting('transaction_read_only') AS ro,
       (SELECT count(*) FROM parts) AS n_partes,
       string_agg(part, E'\n' ORDER BY ord, seq) AS prelude
  FROM parts;
