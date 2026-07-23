-- 20270205000000_fix_rls_disabled_errors.sql
--
-- Fase 3 segurança (Dossiê DB). Fecha os 3 ERROR `rls_disabled_in_public` +
-- `policy_exists_rls_disabled` do advisor.
--
-- ⚠️ GOTCHA CRÍTICO deste projeto: service_role NÃO faz BYPASSRLS aqui (ver
-- 20261117000020). Habilitar RLS sem policy pro writer NEGA as escritas.
--
-- 1) whatsapp_rate_tracking — contador de rate-limit escrito por edge functions
--    via service_role. Tinha 2 policies master-ghost mas RLS OFF (a policy
--    service_role de 20261117000020 foi perdida num rebuild de RLS). Re-habilita
--    RLS + recria a policy service_role-only (preserva o writer) + revoke anon.
--    0 linhas na tabela; nenhum código cliente a lê (grep src/+functions).
--
-- 2/3) _backup_bertin_20260608_pipe_entries (320 rows) e
--    _backup_merge_agendamentos_milennials (1000 rows) — backups estáticos de
--    dados de lead, expostos (RLS off). Ninguém lê/escreve (grep: só as
--    migrations que os criaram). Enable RLS deny-all (0 policy) fecha a
--    exposição p/ anon+authenticated; superuser (recovery manual) ainda acessa.
--    Não dropados (data loss) — dropar exige confirmação CTO separada.
--
-- APLICADO EM PROD via execute_sql (autorização CTO) + registrado schema_migrations.
-- Verificado: relrowsecurity=true nas 3; rate_tracking com 3 policies.

BEGIN;

-- 1) whatsapp_rate_tracking
ALTER TABLE public.whatsapp_rate_tracking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_tracking_service_role_all ON public.whatsapp_rate_tracking;
CREATE POLICY rate_tracking_service_role_all
  ON public.whatsapp_rate_tracking
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.whatsapp_rate_tracking FROM anon;

-- 2/3) backups estáticos → deny-all
ALTER TABLE public._backup_bertin_20260608_pipe_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_merge_agendamentos_milennials ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- ALTER TABLE public.whatsapp_rate_tracking DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS rate_tracking_service_role_all ON public.whatsapp_rate_tracking;
-- ALTER TABLE public._backup_bertin_20260608_pipe_entries DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public._backup_merge_agendamentos_milennials DISABLE ROW LEVEL SECURITY;
