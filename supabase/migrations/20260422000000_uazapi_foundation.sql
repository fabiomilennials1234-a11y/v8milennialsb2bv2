-- ============================================================
-- Migration: Uazapi Foundation
-- Date: 2026-04-22
-- Branch: feat/migrate-uazapi-whatsapp
-- Description:
--   1. Adiciona colunas provider, uazapi_token, uazapi_instance_id,
--      provider_config em whatsapp_instances.
--   2. Tentativa de REVOKE column-level em uazapi_token (documentado abaixo).
--   3. Cria tabela history_sync_jobs (controle de sync histórico Uazapi).
--   4. Cria tabela uazapi_sender_jobs (controle de disparos Uazapi Sender).
--
-- PGSODIUM TCE (Transparent Column Encryption):
--   pgsodium não está disponível como extensão registrada neste projeto
--   Supabase managed (verificado via SELECT * FROM pg_extension WHERE extname='pgsodium'
--   — retorna vazio). O Supabase Vault (pgsodium managed) requer habilitação via
--   Dashboard e não suporta SECURITY LABEL via migration SQL no ambiente hosted.
--   Se pgsodium for habilitado futuramente, aplicar via Dashboard:
--     SELECT pgsodium.create_key(name := 'uazapi_token_key');
--     SECURITY LABEL FOR pgsodium ON COLUMN public.whatsapp_instances.uazapi_token
--       IS 'ENCRYPT WITH KEY ID <key_id>';
--
-- COLUMN-LEVEL REVOKE — LIMITAÇÃO NO SUPABASE MANAGED:
--   O Supabase bootstrap aplica GRANT ALL ON ALL TABLES IN SCHEMA public TO
--   authenticated, anon (table-level). Em PostgreSQL, table-level SELECT grant
--   domina column-level REVOKE — o REVOKE de coluna só é efetivo quando o grant
--   original é exclusivamente column-level. Portanto, os REVOKE abaixo são
--   executados mas não produzem o efeito esperado neste ambiente.
--   MITIGAÇÃO REAL:
--     1. RLS garante isolamento por org (authenticated vê apenas rows da própria org).
--     2. Edge functions NUNCA incluem uazapi_token em queries retornadas ao cliente.
--        Toda recuperação do token ocorre via service role internamente.
--     3. Alternativa futura: mover uazapi_token para tabela separada
--        whatsapp_instance_secrets com RLS restritiva só para service_role.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.uazapi_sender_jobs;
--   DROP TABLE IF EXISTS public.history_sync_jobs;
--   ALTER TABLE public.whatsapp_instances
--     DROP COLUMN IF EXISTS provider_config,
--     DROP COLUMN IF EXISTS uazapi_instance_id,
--     DROP COLUMN IF EXISTS uazapi_token,
--     DROP COLUMN IF EXISTS provider;
-- ============================================================

-- ============================================================
-- 1. COLUNAS EM whatsapp_instances
-- ============================================================

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'evolution'
    CHECK (provider IN ('evolution', 'uazapi')),
  ADD COLUMN IF NOT EXISTS uazapi_token TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.whatsapp_instances.provider IS
  'Provedor da instância WhatsApp: evolution (padrão atual) ou uazapi';
COMMENT ON COLUMN public.whatsapp_instances.uazapi_token IS
  'Token de autenticação da instância Uazapi. Sensível — acesso restrito a service_role.';
COMMENT ON COLUMN public.whatsapp_instances.uazapi_instance_id IS
  'ID da instância retornado pela Uazapi ao criar/conectar a instância.';
COMMENT ON COLUMN public.whatsapp_instances.provider_config IS
  'Configurações extras do provedor (JSON). Ex: timeout, delay, webhook_url específico.';

-- ============================================================
-- 2. RLS HARDENING — uazapi_token column-level privilege
--    Defesa em profundidade: mesmo que um bug exponha o SELECT,
--    authenticated e anon não conseguem ler uazapi_token.
-- ============================================================

REVOKE SELECT (uazapi_token) ON public.whatsapp_instances FROM authenticated;
REVOKE SELECT (uazapi_token) ON public.whatsapp_instances FROM anon;

-- ============================================================
-- 3. TABELA history_sync_jobs
--    Controla jobs de sincronização de histórico de conversas Uazapi.
--    Um job por instância/escopo. Cursor permite retomada incremental.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.history_sync_jobs (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id             UUID        NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  chat_jid                TEXT,
  scope                   TEXT        NOT NULL DEFAULT 'default'
    CHECK (scope IN ('default', 'full', 'chat')),
  max_days                INTEGER     NOT NULL DEFAULT 30,
  max_messages_per_chat   INTEGER     NOT NULL DEFAULT 500,
  max_chats               INTEGER     NOT NULL DEFAULT 100,
  cursor                  TEXT,
  status                  TEXT        NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed')),
  total_fetched           INTEGER     NOT NULL DEFAULT 0,
  error                   TEXT,
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para queries operacionais:
-- 1. Busca de jobs por org + status (polling do cron job)
CREATE INDEX IF NOT EXISTS idx_history_sync_jobs_org_status
  ON public.history_sync_jobs(organization_id, status);
-- 2. Busca de jobs por instância + status (gestão de instância)
CREATE INDEX IF NOT EXISTS idx_history_sync_jobs_instance_status
  ON public.history_sync_jobs(instance_id, status);
-- 3. Ordenação de fila por criação (FIFO de queued jobs)
CREATE INDEX IF NOT EXISTS idx_history_sync_jobs_status_created
  ON public.history_sync_jobs(status, created_at);

COMMENT ON TABLE public.history_sync_jobs IS
  'Jobs de sincronização de histórico de conversas via Uazapi. Cursor permite retomada incremental.';

ALTER TABLE public.history_sync_jobs ENABLE ROW LEVEL SECURITY;

-- Membros da org lêem apenas jobs da própria org
CREATE POLICY "Members read own org history_sync_jobs"
  ON public.history_sync_jobs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- Service role tem acesso total (usado pelas edge functions)
CREATE POLICY "Service role full access history_sync_jobs"
  ON public.history_sync_jobs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE TRIGGER trg_history_sync_jobs_updated_at
  BEFORE UPDATE ON public.history_sync_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 4. TABELA uazapi_sender_jobs
--    Controla jobs de disparo em massa via Uazapi Sender.
--    Rastreia progresso, falhas e quem disparou.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.uazapi_sender_jobs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id           UUID        NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  campaign_id           UUID        REFERENCES public.campanhas(id) ON DELETE SET NULL,
  uazapi_sender_id      TEXT,
  status                TEXT        NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  total_messages        INTEGER     NOT NULL DEFAULT 0,
  sent                  INTEGER     NOT NULL DEFAULT 0,
  failed                INTEGER     NOT NULL DEFAULT 0,
  triggered_by_user_id  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  triggered_via         TEXT        NOT NULL DEFAULT 'api'
    CHECK (triggered_via IN ('ui', 'api', 'cron', 'workflow')),
  payload               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para queries operacionais:
-- 1. Busca de jobs por org + status (dashboard + polling)
CREATE INDEX IF NOT EXISTS idx_uazapi_sender_jobs_org_status
  ON public.uazapi_sender_jobs(organization_id, status);
-- 2. Lookup por uazapi_sender_id (webhook de callback da Uazapi)
--    Partial: apenas linhas com sender_id preenchido
CREATE INDEX IF NOT EXISTS idx_uazapi_sender_jobs_sender_id
  ON public.uazapi_sender_jobs(uazapi_sender_id)
  WHERE uazapi_sender_id IS NOT NULL;
-- 3. Ordenação por status + updated_at (jobs recentes por estado)
CREATE INDEX IF NOT EXISTS idx_uazapi_sender_jobs_status_updated
  ON public.uazapi_sender_jobs(status, updated_at);

COMMENT ON TABLE public.uazapi_sender_jobs IS
  'Jobs de disparo em massa via Uazapi Sender. Rastreia progresso, falhas e auditoria de trigger.';

ALTER TABLE public.uazapi_sender_jobs ENABLE ROW LEVEL SECURITY;

-- Membros da org lêem apenas jobs da própria org
CREATE POLICY "Members read own org uazapi_sender_jobs"
  ON public.uazapi_sender_jobs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- Service role tem acesso total
CREATE POLICY "Service role full access uazapi_sender_jobs"
  ON public.uazapi_sender_jobs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE TRIGGER trg_uazapi_sender_jobs_updated_at
  BEFORE UPDATE ON public.uazapi_sender_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
