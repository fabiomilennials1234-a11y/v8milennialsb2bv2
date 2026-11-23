-- crm-mcp v1 — ciclo de vida dos tokens pessoais.
--
-- ── Por que ───────────────────────────────────────────────────────────────
-- A autenticação (20280124013100) já recusa, a cada requisição, token de quem
-- saiu da org. Isso para o acesso, mas deixa o token "ativo" na tela e volta a
-- valer se a pessoa for reativada meses depois. Desligar tem que matar o token
-- de vez. E token esquecido é superfície sem dono: quem não usa há 90 dias
-- perde o token (o dono gera outro em 10 segundos).
--
-- ── O que cria ────────────────────────────────────────────────────────────
--   1. gatilhos em team_members: desativar ou apagar o membro revoga os tokens
--      dele NAQUELA org (motivo 'offboarding');
--   2. crm_mcp_housekeeping(): revoga sem uso há 90 dias ('auto_unused'), apaga
--      contadores de limite com mais de 2 dias e recusas com mais de 90;
--   3. pg_cron diário às 06:17 UTC.
--
-- Rollback: rollback/20280124013200_crm_mcp_lifecycle.sql

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Desligamento revoga
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.crm_mcp_revoke_on_offboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- DEFINER: quem desativa o membro (admin, master, rotina) não precisa ter
  -- grant de UPDATE nos tokens dele. Rodando como dono da função, o gatilho de
  -- imutabilidade reconhece contexto de sistema e mantém 'offboarding'.
  IF OLD.user_id IS NOT NULL THEN
    UPDATE public.personal_access_tokens
       SET revoked_at = now(), revoked_reason = 'offboarding'
     WHERE user_id = OLD.user_id
       AND organization_id = OLD.organization_id
       AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS zz_crm_mcp_revoke_on_deactivate ON public.team_members;
CREATE TRIGGER zz_crm_mcp_revoke_on_deactivate
  AFTER UPDATE OF is_active ON public.team_members
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active AND NEW.is_active IS NOT TRUE)
  EXECUTE FUNCTION public.crm_mcp_revoke_on_offboarding();

DROP TRIGGER IF EXISTS zz_crm_mcp_revoke_on_delete ON public.team_members;
CREATE TRIGGER zz_crm_mcp_revoke_on_delete
  AFTER DELETE ON public.team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_mcp_revoke_on_offboarding();

REVOKE ALL ON FUNCTION public.crm_mcp_revoke_on_offboarding() FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Faxina
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.crm_mcp_housekeeping()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revogados integer;
  v_contadores integer;
  v_recusas integer;
BEGIN
  UPDATE public.personal_access_tokens
     SET revoked_at = now(), revoked_reason = 'auto_unused'
   WHERE revoked_at IS NULL
     AND expires_at > now()
     AND COALESCE(last_used_at, created_at) < now() - interval '90 days';
  GET DIAGNOSTICS v_revogados = ROW_COUNT;

  DELETE FROM public.crm_mcp_rate_counters WHERE window_start < now() - interval '2 days';
  GET DIAGNOSTICS v_contadores = ROW_COUNT;

  DELETE FROM public.crm_mcp_auth_denials WHERE window_start < now() - interval '90 days';
  GET DIAGNOSTICS v_recusas = ROW_COUNT;

  RETURN jsonb_build_object(
    'revogados_sem_uso', v_revogados,
    'contadores_apagados', v_contadores,
    'recusas_apagadas', v_recusas
  );
END
$$;

REVOKE ALL ON FUNCTION public.crm_mcp_housekeeping() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('crm-mcp-housekeeping')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-mcp-housekeeping');
    PERFORM cron.schedule('crm-mcp-housekeeping', '17 6 * * *', $cron$SELECT public.crm_mcp_housekeeping();$cron$);
  END IF;
END $$;
