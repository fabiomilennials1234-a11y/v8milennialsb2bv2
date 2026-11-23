-- Rollback de 20280124013100_crm_mcp_tokens.sql.
-- ⚠️ Apaga todos os tokens pessoais (os clientes de IA conectados param na hora).
-- Rode o rollback de 20280124013200 antes.

DROP FUNCTION IF EXISTS public.crm_mcp_authenticate(text);
DROP FUNCTION IF EXISTS public.crm_mcp_issue_check(uuid);
DROP FUNCTION IF EXISTS public.crm_mcp_principal_check(uuid, uuid);
DROP FUNCTION IF EXISTS public.crm_mcp_org_enabled(uuid);

DROP TABLE IF EXISTS public.crm_mcp_auth_denials;
DROP TABLE IF EXISTS public.crm_mcp_rate_counters;
DROP TABLE IF EXISTS public.personal_access_tokens;

DROP FUNCTION IF EXISTS public.pat_before_insert();
DROP FUNCTION IF EXISTS public.pat_before_update();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_mcp_resolver') THEN
    REVOKE crm_mcp_resolver FROM authenticator;
    REVOKE USAGE ON SCHEMA public FROM crm_mcp_resolver;
    DROP ROLE crm_mcp_resolver;
  END IF;
END $$;
