-- Rollback de 20280124013300_crm_mcp_escrita.sql.
-- ⚠️ Apaga a trilha de ações do MCP e volta os tokens para só leitura: tokens com
-- escopo de escrita são revogados (a constraint v1 não os aceitaria).

DROP FUNCTION IF EXISTS public.crm_mcp_action_mark_undone(text, uuid);
DROP FUNCTION IF EXISTS public.crm_mcp_action_get_applied(text, uuid);
DROP FUNCTION IF EXISTS public.crm_mcp_action_finish(text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.crm_mcp_action_take(text, uuid);
DROP FUNCTION IF EXISTS public.crm_mcp_action_open(text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public._crm_mcp_live_pat(text);
DROP TABLE IF EXISTS public.crm_mcp_actions;

DROP POLICY IF EXISTS pat_owner_insert ON public.personal_access_tokens;
DROP FUNCTION IF EXISTS public.crm_mcp_issue_check(uuid, text[]);

CREATE OR REPLACE FUNCTION public.crm_mcp_issue_check(p_org uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'unauthenticated';
  END IF;
  RETURN public.crm_mcp_principal_check(auth.uid(), p_org);
END
$$;
REVOKE ALL ON FUNCTION public.crm_mcp_issue_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_mcp_issue_check(uuid) TO authenticated;

CREATE POLICY pat_owner_insert ON public.personal_access_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND created_by = (SELECT auth.uid())
    AND public.crm_mcp_issue_check(organization_id) = 'ok'
  );

DROP FUNCTION IF EXISTS public.crm_mcp_scope_check(uuid, uuid, text);
DROP FUNCTION IF EXISTS public._crm_mcp_member_feature(uuid, text);
DROP FUNCTION IF EXISTS public.crm_mcp_write_enabled(uuid);

-- O gatilho de imutabilidade proíbe reescrever scopes: tokens de escrita saem inteiros
-- (o dono gera outro, só leitura).
DELETE FROM public.personal_access_tokens WHERE scopes <> ARRAY['read']::text[];
ALTER TABLE public.personal_access_tokens DROP CONSTRAINT IF EXISTS pat_scopes_v2;
ALTER TABLE public.personal_access_tokens ADD CONSTRAINT pat_scopes_v1
  CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['read']::text[]);

-- crm_mcp_housekeeping volta à versão de 20280124013200 reaplicando aquela migration.
