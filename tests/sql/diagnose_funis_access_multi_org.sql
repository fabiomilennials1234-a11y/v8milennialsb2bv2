-- =============================================================================
-- Diagnóstico em PRODUÇÃO — incidente funis-access-multi-org-rls (2026-04-23)
-- =============================================================================
--
-- Usuários reportados sem acesso aos funis:
--   - Weder-Milennials
--   - Vagner
--   - Mateus - Vanilla Brasil
--
-- Este script é somente LEITURA. Rodar no SQL Editor do Supabase (role
-- service) contra o projeto de produção `jsjsmuncfkbsbzqzqhfq`.
--
-- Para cada usuário afetado, preencha p_user_email com o auth.users.email
-- (ou substitua por user_id se já souber) e execute cada bloco. Os resultados
-- preparam as evidências do relatório por usuário.
-- =============================================================================

-- ─── Parâmetros ──────────────────────────────────────────────────────────
\set user_email 'weder@milennials.com.br'      -- troque por cada usuário

-- ─── BLOCO 0 — identificar o auth user ───────────────────────────────────
SELECT id, email, created_at
  FROM auth.users
 WHERE email = :'user_email';

-- Guarde o id retornado e substitua nos blocos abaixo — ou use CTE:
-- WITH u AS (SELECT id FROM auth.users WHERE email = :'user_email')

-- ─── BLOCO 1 — todos os team_members ativos do usuário ───────────────────
-- Se vier MAIS DE UMA linha, o usuário é multi-org e está sujeito ao bug:
-- sem organization_id no body, get-member-permissions avalia contra o
-- primeiro (ordem created_at), não contra a org em que o usuário está
-- navegando no front.
SELECT tm.id         AS team_member_id,
       tm.organization_id,
       o.name        AS organization_name,
       tm.role,
       tm.is_active,
       tm.created_at
  FROM public.team_members tm
  JOIN public.organizations o ON o.id = tm.organization_id
  JOIN auth.users u ON u.id = tm.user_id
 WHERE u.email = :'user_email'
 ORDER BY tm.created_at ASC;

-- ─── BLOCO 2 — master_users? ─────────────────────────────────────────────
-- Master bypass RLS e também o PermissionProtectedRoute — se aparecer aqui,
-- o problema não é permissão da conta, é outra coisa.
SELECT mu.id, mu.is_active, mu.created_at
  FROM public.master_users mu
  JOIN auth.users u ON u.id = mu.user_id
 WHERE u.email = :'user_email';

-- ─── BLOCO 3 — member_feature_permissions per org (pipeline.view) ───────
-- Isto é a decisão efetiva que bloqueia /funis, /pipe-* para membros.
-- Se `enabled=false` numa org e `enabled=true` em outra, cruze com o bloco
-- 1 para ver se o fallback está escolhendo a org com `false`.
SELECT tm.organization_id,
       o.name                         AS organization_name,
       tm.role,
       mfp.feature_key,
       mfp.enabled,
       mfp.updated_at
  FROM public.team_members tm
  JOIN public.organizations o ON o.id = tm.organization_id
  JOIN auth.users u           ON u.id = tm.user_id
  LEFT JOIN public.member_feature_permissions mfp
         ON mfp.team_member_id = tm.id
        AND mfp.feature_key IN ('pipeline.view', 'leads.view_all', 'leads.view')
 WHERE u.email = :'user_email'
 ORDER BY tm.created_at ASC, mfp.feature_key;

-- ─── BLOCO 4 — default do catálogo para as features-chave ───────────────
-- Quando não há override em member_feature_permissions, a edge usa default.
-- Se pipeline.view default=false, membros novos ficam bloqueados até
-- admin habilitar explicitamente — é uma causa possível.
SELECT key, is_admin_only, default_value, module, sort_order
  FROM public.feature_permissions
 WHERE key IN ('pipeline.view', 'leads.view_all', 'leads.view')
 ORDER BY key;

-- ─── BLOCO 5 — drift pipe_* vs leads (para todas as orgs do usuário) ─────
-- Se a migration 20260417110000 NÃO foi aplicada em prod, as linhas aqui
-- explicam "funil abre mas aparece vazio/faltando cards" — o pipe ainda
-- aponta para responsável antigo que o user não é.
WITH user_orgs AS (
  SELECT DISTINCT tm.organization_id
    FROM public.team_members tm
    JOIN auth.users u ON u.id = tm.user_id
   WHERE u.email = :'user_email'
     AND tm.is_active = true
)
SELECT 'pipe_propostas.closer_id'      AS source, COUNT(*) AS drift_rows
  FROM public.pipe_propostas pp
  JOIN public.leads l ON l.id = pp.lead_id
 WHERE pp.organization_id IN (SELECT organization_id FROM user_orgs)
   AND pp.closer_id IS DISTINCT FROM l.closer_id
UNION ALL
SELECT 'pipe_confirmacao.closer_id',   COUNT(*)
  FROM public.pipe_confirmacao pc
  JOIN public.leads l ON l.id = pc.lead_id
 WHERE pc.organization_id IN (SELECT organization_id FROM user_orgs)
   AND pc.closer_id IS DISTINCT FROM l.closer_id
UNION ALL
SELECT 'pipe_confirmacao.sdr_id',      COUNT(*)
  FROM public.pipe_confirmacao pc
  JOIN public.leads l ON l.id = pc.lead_id
 WHERE pc.organization_id IN (SELECT organization_id FROM user_orgs)
   AND pc.sdr_id IS DISTINCT FROM l.sdr_id
UNION ALL
SELECT 'pipe_whatsapp.sdr_id',         COUNT(*)
  FROM public.pipe_whatsapp pw
  JOIN public.leads l ON l.id = pw.lead_id
 WHERE pw.organization_id IN (SELECT organization_id FROM user_orgs)
   AND pw.sdr_id IS DISTINCT FROM l.sdr_id;

-- ─── BLOCO 6 — o trigger canônico está no estado esperado em prod? ──────
-- Se o array não incluir closer_id + sdr_id + responsible_id, a migration
-- 20260417110000 não foi aplicada e estamos no estado pré-fix.
SELECT t.tgname,
       array_agg(a.attname ORDER BY a.attname) AS monitored_columns
  FROM pg_trigger t
  JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY(t.tgattr)
 WHERE t.tgname = 'trg_sync_responsible_from_lead_to_pipes'
 GROUP BY t.tgname;

-- ─── BLOCO 7 — "ghost leads" visíveis em prod para o user ───────────────
-- Rows nos pipes cujo join com leads seria NULL via RLS do user. Exige
-- impersonar via JWT ou rodar localmente; aqui apresentamos a contagem
-- agregada indicativa, assumindo que o user não é admin/master.
-- Substitua :'user_email' antes de rodar.
SELECT 'pipe_whatsapp'    AS pipe, COUNT(*) AS rows_visible
  FROM public.pipe_whatsapp pw
 WHERE pw.organization_id IN (
         SELECT organization_id FROM public.team_members tm
          JOIN auth.users u ON u.id = tm.user_id
         WHERE u.email = :'user_email' AND tm.is_active = true
       )
UNION ALL
SELECT 'pipe_confirmacao', COUNT(*)
  FROM public.pipe_confirmacao pc
 WHERE pc.organization_id IN (
         SELECT organization_id FROM public.team_members tm
          JOIN auth.users u ON u.id = tm.user_id
         WHERE u.email = :'user_email' AND tm.is_active = true
       )
UNION ALL
SELECT 'pipe_propostas',   COUNT(*)
  FROM public.pipe_propostas pp
 WHERE (SELECT organization_id FROM public.leads WHERE id = pp.lead_id) IN (
         SELECT organization_id FROM public.team_members tm
          JOIN auth.users u ON u.id = tm.user_id
         WHERE u.email = :'user_email' AND tm.is_active = true
       );

-- ─── BLOCO 8 — view de drift auxiliar (após aplicar a migration fix) ─────
-- Só funciona após aplicar 20260423120000_verify_pipe_sync_and_backfill.
-- Em regime, espera-se 0 linhas.
SELECT source, field, COUNT(*) AS drift_rows
  FROM public.v_pipe_responsibility_drift
 GROUP BY source, field
 ORDER BY source, field;
