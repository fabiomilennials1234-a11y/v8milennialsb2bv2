-- =================================================================
-- FIX: Campaign Dispatch - Claim RPC, Processing status, RLS
--
-- Problemas corrigidos:
--   1. Função RPC claim_campaign_dispatch_batch inexistente
--      → Edge function campaign-rule-dispatch falha ao tentar processar fila
--   2. Status 'processing' ausente na CHECK constraint de scheduled_campaign_messages
--      → A função claim não consegue mudar status para 'processing'
--   3. Política RLS de UPDATE ausente para scheduled_campaign_messages
--      → Retry do frontend (reagendar itens falhados) falha silenciosamente
--   4. Verificação de pg_cron/pg_net via NOTICE
--
-- Seguro para rodar múltiplas vezes (idempotente com OR REPLACE e IF NOT EXISTS).
-- Date: 2026-04-03
-- =================================================================

-- ============================================
-- 1. ADICIONAR 'processing' NA CHECK CONSTRAINT
-- ============================================
-- O claim_campaign_dispatch_batch precisa mudar status de 'scheduled' para 'processing'.
-- A constraint atual só permite: scheduled, sent, failed, cancelled, waiting_response,
-- response_received, timed_out, executed. Falta 'processing'.

ALTER TABLE public.scheduled_campaign_messages
DROP CONSTRAINT IF EXISTS scheduled_campaign_messages_status_check;

ALTER TABLE public.scheduled_campaign_messages
ADD CONSTRAINT scheduled_campaign_messages_status_check CHECK (
  status IN ('scheduled', 'processing', 'sent', 'failed', 'cancelled', 'waiting_response', 'response_received', 'timed_out', 'executed')
);

-- Índice para o stale reset (busca itens stuck em 'processing')
CREATE INDEX IF NOT EXISTS idx_scm_processing
  ON public.scheduled_campaign_messages(campanha_id, status, scheduled_at)
  WHERE status = 'processing';

-- ============================================
-- 2. CRIAR FUNÇÃO RPC claim_campaign_dispatch_batch
-- ============================================
-- Atomicamente "reclama" um batch de mensagens agendadas para processamento.
-- Usa FOR UPDATE SKIP LOCKED para evitar processamento concorrente.
-- Retorna os IDs das mensagens reclamadas.

CREATE OR REPLACE FUNCTION public.claim_campaign_dispatch_batch(
  p_campanha_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(claimed_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT id
    FROM public.scheduled_campaign_messages
    WHERE status = 'scheduled'
      AND scheduled_at <= now()
      AND (p_campanha_id IS NULL OR campanha_id = p_campanha_id)
    ORDER BY scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_campaign_messages scm
  SET status = 'processing'
  FROM batch
  WHERE scm.id = batch.id
  RETURNING scm.id AS claimed_id;
END;
$$;

COMMENT ON FUNCTION public.claim_campaign_dispatch_batch IS 'Reclama atomicamente um batch de scheduled_campaign_messages (scheduled → processing). Usa SKIP LOCKED para concorrência segura.';

-- ============================================
-- 3. CRIAR FUNÇÃO RPC claim_pipe_dispatch_batch (mesma lógica para pipes)
-- ============================================
-- Equivalente para scheduled_pipe_messages (se a tabela existir).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'scheduled_pipe_messages'
  ) THEN
    -- Adicionar 'processing' à CHECK constraint de scheduled_pipe_messages
    BEGIN
      ALTER TABLE public.scheduled_pipe_messages
      DROP CONSTRAINT IF EXISTS scheduled_pipe_messages_status_check;

      ALTER TABLE public.scheduled_pipe_messages
      ADD CONSTRAINT scheduled_pipe_messages_status_check CHECK (
        status IN ('scheduled', 'processing', 'sent', 'failed', 'cancelled', 'waiting_response', 'response_received', 'timed_out', 'executed')
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- Ignora se constraint tem nome diferente
    END;

    EXECUTE $func$
      CREATE OR REPLACE FUNCTION public.claim_pipe_dispatch_batch(
        p_pipe_type TEXT DEFAULT NULL,
        p_limit INTEGER DEFAULT 50
      )
      RETURNS TABLE(claimed_id UUID)
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $inner$
      BEGIN
        RETURN QUERY
        WITH batch AS (
          SELECT id
          FROM public.scheduled_pipe_messages
          WHERE status = 'scheduled'
            AND scheduled_at <= now()
            AND (p_pipe_type IS NULL OR pipe_type = p_pipe_type)
          ORDER BY scheduled_at ASC
          LIMIT p_limit
          FOR UPDATE SKIP LOCKED
        )
        UPDATE public.scheduled_pipe_messages spm
        SET status = 'processing'
        FROM batch
        WHERE spm.id = batch.id
        RETURNING spm.id AS claimed_id;
      END;
      $inner$;
    $func$;
  END IF;
END $$;

-- ============================================
-- 4. ADICIONAR POLICY RLS DE UPDATE PARA RETRY
-- ============================================
-- O frontend precisa atualizar status de 'failed' para 'scheduled' (retry).
-- Sem esta policy, o update via supabase client autenticado é silenciosamente ignorado.

DROP POLICY IF EXISTS "scheduled_campaign_messages_update" ON public.scheduled_campaign_messages;
CREATE POLICY "scheduled_campaign_messages_update"
  ON public.scheduled_campaign_messages FOR UPDATE TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- Mesma policy para scheduled_pipe_messages (se existir)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'scheduled_pipe_messages'
  ) THEN
    EXECUTE $policy$
      DROP POLICY IF EXISTS "scheduled_pipe_messages_update" ON public.scheduled_pipe_messages;
      CREATE POLICY "scheduled_pipe_messages_update"
        ON public.scheduled_pipe_messages FOR UPDATE TO authenticated
        USING (
          organization_id IN (
            SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
          )
        )
        WITH CHECK (
          organization_id IN (
            SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
          )
        );
    $policy$;
  END IF;
END $$;

-- ============================================
-- 5. RESET: Mensagens stuck em 'processing' (limpeza)
-- ============================================
-- Se houver mensagens travadas em 'processing' de execuções anteriores, resetar.

UPDATE public.scheduled_campaign_messages
SET status = 'scheduled', scheduled_at = now()
WHERE status = 'processing';

-- ============================================
-- 6. VERIFICAÇÃO pg_cron e pg_net
-- ============================================

DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
  v_has_pg_net BOOLEAN;
  v_url TEXT;
  v_secret TEXT;
  v_job_count INT;
BEGIN
  -- Verificar extensões
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_pg_cron;
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_net') INTO v_has_pg_net;

  IF NOT v_has_pg_cron THEN
    RAISE NOTICE '⚠️  pg_cron NÃO está habilitado. Habilite em: Supabase Dashboard → Database → Extensions';
  ELSE
    RAISE NOTICE '✅ pg_cron está habilitado';
  END IF;

  IF NOT v_has_pg_net THEN
    RAISE NOTICE '⚠️  pg_net NÃO está habilitado. Habilite em: Supabase Dashboard → Database → Extensions';
  ELSE
    RAISE NOTICE '✅ pg_net está habilitado';
  END IF;

  -- Verificar cron_config
  BEGIN
    SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
    SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

    IF v_url IS NULL OR v_url = '' OR v_url LIKE '%PROJECT_REF%' THEN
      RAISE NOTICE '⚠️  campaign_rule_dispatch_url NÃO CONFIGURADO em cron_config. Execute o script setup_campaign_rule_dispatch_cron.sql';
    ELSE
      RAISE NOTICE '✅ campaign_rule_dispatch_url configurado: %', v_url;
    END IF;

    IF v_secret IS NULL OR v_secret = '' OR v_secret = 'seu-cron-secret-aqui' THEN
      RAISE NOTICE '⚠️  cron_secret NÃO CONFIGURADO em cron_config';
    ELSE
      RAISE NOTICE '✅ cron_secret configurado';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠️  Tabela cron_config não encontrada. Migrations de webhook podem não ter sido aplicadas.';
  END;

  -- Verificar pg_cron job
  IF v_has_pg_cron THEN
    BEGIN
      SELECT COUNT(*) INTO v_job_count FROM cron.job WHERE jobname = 'campaign-rule-dispatch';
      IF v_job_count = 0 THEN
        RAISE NOTICE '⚠️  Job pg_cron "campaign-rule-dispatch" NÃO encontrado. Verifique se migration 20260310000000 foi aplicada.';
      ELSE
        RAISE NOTICE '✅ Job pg_cron "campaign-rule-dispatch" ativo';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '⚠️  Não foi possível verificar jobs do pg_cron';
    END;
  END IF;

  -- Resumo da fila
  RAISE NOTICE '--- Resumo da fila scheduled_campaign_messages ---';
END $$;

-- Mostrar contagem por status
SELECT status, COUNT(*) as total
FROM public.scheduled_campaign_messages
GROUP BY status
ORDER BY status;
