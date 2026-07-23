-- 20261117000000_cleanup_orphan_revert_table_and_rls_rate_tracking.sql
--
-- CLEANUP slice — resolve as duas últimas tabelas non-RLS pendentes da
-- auditoria 2026-06-01 (prod jsjsmuncfkbsbzqzqhfq).
--
-- 1) DROP public.pipeline_entries_revert_20260514
--    Backup órfão criado no revert de 2026-05-14. O acesso de anon +
--    authenticated já foi revogado (ver 20261114000000_security_revoke_anon_
--    config_tables.sql e 20260601130000_security_fix_anon_conversation_leak.sql,
--    que listou esta tabela como "DROP it after confirming it is unused").
--    Os dados vivos residem em public.pipeline_entries — esta é só cópia morta.
--    Nenhum código a referencia (grep src/ + supabase/ — 2026-06-01; só aparece
--    em comentários de migrations e no types.ts auto-gerado).
--
-- 2) RLS em public.whatsapp_rate_tracking
--    Contador de rate-limit escrito EXCLUSIVAMENTE por edge functions via
--    service_role (RPCs increment/check de envio WhatsApp — ver
--    20260125000224_add_campaign_modes.sql). A tabela tem organization_id mas
--    NUNCA é lida/escrita por usuários autenticados; é infraestrutura de cron.
--    Estava sem RLS forçada. Habilitamos RLS e adicionamos uma policy ALL
--    restrita a service_role.
--
--    POR QUE A POLICY É OBRIGATÓRIA: habilitar RLS sem nenhuma policy aplicável
--    ao writer faz o Postgres NEGAR todas as linhas (default-deny). As edge
--    functions escrevem como `service_role` — sem uma policy `TO service_role`,
--    os INSERT/UPDATE do contador passariam a falhar silenciosamente (0 rows),
--    quebrando o controle de rate-limit de envio. A policy
--    USING(true) WITH CHECK(true) TO service_role preserva exatamente o
--    comportamento atual desse writer; nenhum outro role ganha acesso.
--    (service_role, por padrão do Supabase, NÃO faz BYPASSRLS — daí a policy
--    explícita ser o que mantém as escritas funcionando após o ENABLE.)
--
--    REVOKE ALL ... FROM anon: defesa em profundidade — anon jamais deve tocar
--    um contador de infra. Idempotente.
--
-- IDEMPOTÊNCIA (seguro re-aplicar via Management API e `supabase db push`):
--   * DROP TABLE IF EXISTS  → no-op se já dropada.
--   * Enable RLS guardado por to_regclass (tabela existe?) + leitura de
--     pg_class.relrowsecurity (RLS já ligada?) → só executa ALTER se necessário.
--   * DROP POLICY IF EXISTS antes do CREATE POLICY → recria sem colidir.
--   * REVOKE é naturalmente idempotente.
--
-- ROLLBACK (improvável — backup morto + contador de infra):
--   1) restaurar o backup exigiria recriá-lo de um dump (não há reverso de DROP).
--   2) ALTER TABLE public.whatsapp_rate_tracking DISABLE ROW LEVEL SECURITY;
--      DROP POLICY IF EXISTS rate_tracking_service_role_all ON public.whatsapp_rate_tracking;

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Remover backup órfão do revert de 2026-05-14.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.pipeline_entries_revert_20260514;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Habilitar RLS em whatsapp_rate_tracking (somente se a tabela existir e a
--    RLS ainda não estiver habilitada) e garantir a policy service_role-only.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.whatsapp_rate_tracking') IS NOT NULL THEN
    -- Liga RLS só se ainda não estiver ligada (catalog-driven guard).
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'whatsapp_rate_tracking'
        AND c.relrowsecurity = true
    ) THEN
      EXECUTE 'ALTER TABLE public.whatsapp_rate_tracking ENABLE ROW LEVEL SECURITY';
    END IF;

    -- Policy ALL exclusiva de service_role (writer real do contador).
    -- DROP IF EXISTS + CREATE garante o estado final, idempotente.
    EXECUTE 'DROP POLICY IF EXISTS rate_tracking_service_role_all ON public.whatsapp_rate_tracking';
    EXECUTE $pol$
      CREATE POLICY rate_tracking_service_role_all
        ON public.whatsapp_rate_tracking
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true)
    $pol$;

    -- Defesa em profundidade: anon nunca toca infra de rate-limit.
    EXECUTE 'REVOKE ALL ON public.whatsapp_rate_tracking FROM anon';
  END IF;
END $$;

COMMIT;
