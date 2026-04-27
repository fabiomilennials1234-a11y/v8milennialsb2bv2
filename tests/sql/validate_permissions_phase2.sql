-- =============================================================================
-- Validação pós-deploy — Fase 2 hotfix permissões multi-org (2026-04-24)
--
-- Rodar no SQL Editor do Supabase (service_role) contra produção
-- (`jsjsmuncfkbsbzqzqhfq`) DEPOIS de aplicar a migration
-- 20260917000100_fix_permissions_multi_org_deterministic.sql.
--
-- Resultados esperados documentados ao lado de cada query. Se qualquer
-- bloco diverge do esperado, PARE o deploy e abra issue.
-- =============================================================================


-- ─── BLOCO 1 — funções canônicas existem com a assinatura nova ──────────────
-- Esperado: 2 rows para has_feature_permission (1-arg e 2-arg),
-- 2 rows para can_manage_copilot (0-arg e 1-arg),
-- 2 rows para can_manage_whatsapp_instances (0-arg e 1-arg).
SELECT p.proname,
       pg_get_function_arguments(p.oid) AS args,
       pg_get_function_result(p.oid)    AS returns,
       p.prosecdef                      AS security_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN (
     'has_feature_permission',
     'can_manage_copilot',
     'can_manage_whatsapp_instances',
     'get_user_organization_id'
   )
 ORDER BY p.proname, args;


-- ─── BLOCO 2 — determinismo de get_user_organization_id ─────────────────────
-- Esperado: 0 rows (não há team_members ativos sem created_at — bug se houver).
SELECT COUNT(*) AS team_members_without_created_at
  FROM public.team_members
 WHERE is_active = true
   AND created_at IS NULL;


-- ─── BLOCO 3 — policies RLS críticas recriadas ──────────────────────────────
-- Esperado: todas com qual contendo "has_feature_permission" ainda usam a
-- versão nova (com 2 args). Se retornar linhas, há policy legada.
SELECT schemaname, tablename, policyname, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN (
     'copilot_agents',
     'copilot_agent_faqs',
     'copilot_agent_kanban_rules',
     'whatsapp_instances',
     'leads',
     'pipe_whatsapp',
     'pipe_confirmacao',
     'pipe_propostas',
     'campanha_leads',
     'lead_history'
   )
   -- Policy ainda usa versão 1-arg de has_feature_permission
   AND qual ~ 'has_feature_permission\([^,)]+\)'
   AND qual !~ 'has_feature_permission\([^,)]+,';


-- ─── BLOCO 4 — members multi-org (alvo do bug) ──────────────────────────────
-- Conta usuários com team_member ativo em 2+ orgs — todos devem funcionar
-- após a migration. Lista emails pra spot-check manual.
WITH multi_org AS (
  SELECT tm.user_id,
         COUNT(DISTINCT tm.organization_id) AS org_count
    FROM public.team_members tm
   WHERE tm.is_active = true
     AND tm.user_id IS NOT NULL
   GROUP BY tm.user_id
  HAVING COUNT(DISTINCT tm.organization_id) > 1
)
SELECT u.email, m.org_count, m.user_id
  FROM multi_org m
  JOIN auth.users u ON u.id = m.user_id
 ORDER BY m.org_count DESC, u.email;


-- ─── BLOCO 5 — features com default_value=false que podem bloquear member ──
-- Esperado: lista pequena. Se uma feature crítica (copilot.view, leads.view,
-- pipeline.view) aparecer com default=false, investigar.
SELECT key, module, name, is_admin_only, default_value
  FROM public.feature_permissions
 WHERE default_value = false
   AND is_admin_only = false
 ORDER BY module, key;


-- ─── BLOCO 6 — sanity: members com zero overrides (usam default em tudo) ───
-- Se o default está correto, member sem override deve conseguir operar.
SELECT tm.organization_id,
       COUNT(*) FILTER (WHERE tm.role = 'member' AND tm.is_active = true) AS active_members,
       COUNT(*) FILTER (
         WHERE tm.role = 'member' AND tm.is_active = true
           AND NOT EXISTS (
             SELECT 1 FROM public.member_feature_permissions mfp
             WHERE mfp.team_member_id = tm.id
           )
       ) AS members_without_overrides
  FROM public.team_members tm
 GROUP BY tm.organization_id
 ORDER BY active_members DESC
 LIMIT 20;


-- ─── BLOCO 7 — smoke RPC: simular chamada de member em produção ─────────────
-- Substitua :user_id por auth.users.id de um member reportado no incidente.
-- Esperado: org_id vinculado ao team_member do user. Chamar 2x — mesmo valor.
-- \set user_id '...'
-- SELECT public.get_user_organization_id() FROM (SELECT set_config('request.jwt.claim.sub', :'user_id', true)) s;


-- ─── BLOCO 8 — verificar team_members órfãos (user_id NULL mas ativo) ──────
-- Órfãos não podem passar RLS; se muitos, reset/restore necessário.
SELECT COUNT(*) AS orphaned_active_team_members
  FROM public.team_members
 WHERE is_active = true
   AND user_id IS NULL;


-- =============================================================================
-- CRITÉRIOS PRA GO/NO-GO APÓS FASE 2:
--
-- GO:
--  - Bloco 1: todas as sobrecargas presentes e SECURITY DEFINER=true
--  - Bloco 3: zero rows (nenhuma policy legada)
--  - Bloco 4: lista de multi-org validada (spot-check com usuários reportados)
--  - Bloco 8: zero órfãos ativos (ou número conhecido estável)
--
-- NO-GO (PARAR deploy):
--  - Bloco 1: função faltando
--  - Bloco 3: policies ainda usando has_feature_permission(key) sem org_id
--  - Bloco 5: feature crítica (copilot.view, leads.view, pipeline.view) com
--    default_value=false — backfill de member_feature_permissions obrigatório
-- =============================================================================
