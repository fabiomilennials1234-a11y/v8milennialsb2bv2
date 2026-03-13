-- =============================================================================
-- FIX: scheduled_pipe_messages CHECK constraint não inclui 'processing'
--
-- Problema: A RPC claim_pipe_dispatch_batch tenta SET status = 'processing',
-- mas a CHECK constraint original só permite:
--   scheduled, sent, failed, cancelled, waiting_response, response_received, timed_out, executed
-- Isso faz com que o claim falhe silenciosamente e os itens fiquem presos em 'scheduled'.
--
-- Esta migration:
--   1. Remove QUALQUER CHECK constraint na coluna status (busca pelo nome real)
--   2. Adiciona a constraint correta incluindo 'processing'
--   3. Garante que a RPC claim_pipe_dispatch_batch existe e funciona
--
-- Seguro para rodar múltiplas vezes (idempotente).
-- Date: 2026-03-04
-- =============================================================================

-- ============================================
-- 1. REMOVER CHECK CONSTRAINT DE STATUS (pelo nome real, não assumido)
-- ============================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Buscar o nome REAL da constraint CHECK na coluna status
  FOR v_constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'scheduled_pipe_messages'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'  -- CHECK constraint
      AND pg_get_constraintdef(con.oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.scheduled_pipe_messages DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped CHECK constraint: %', v_constraint_name;
  END LOOP;
END $$;

-- ============================================
-- 2. ADICIONAR CHECK CONSTRAINT CORRETA (com 'processing')
-- ============================================

ALTER TABLE public.scheduled_pipe_messages
DROP CONSTRAINT IF EXISTS scheduled_pipe_messages_status_check;

ALTER TABLE public.scheduled_pipe_messages
ADD CONSTRAINT scheduled_pipe_messages_status_check CHECK (
  status IN ('scheduled', 'processing', 'sent', 'failed', 'cancelled', 'waiting_response', 'response_received', 'timed_out', 'executed')
);

-- ============================================
-- 3. GARANTIR QUE A RPC claim_pipe_dispatch_batch EXISTE
-- ============================================

CREATE OR REPLACE FUNCTION public.claim_pipe_dispatch_batch(
  p_pipe_type TEXT DEFAULT NULL,
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
$$;

-- ============================================
-- 4. RESETAR ITENS STUCK EM 'processing' (limpeza)
-- ============================================

UPDATE public.scheduled_pipe_messages
SET status = 'scheduled', scheduled_at = now()
WHERE status = 'processing';

-- ============================================
-- 5. GARANTIR pipe_rule_dispatch_url EM cron_config
-- ============================================

DO $$
DECLARE
  v_campaign_url TEXT;
  v_pipe_url TEXT;
  v_existing_pipe_url TEXT;
BEGIN
  -- Verificar se já tem pipe_rule_dispatch_url
  SELECT value INTO v_existing_pipe_url
  FROM public.cron_config
  WHERE key = 'pipe_rule_dispatch_url';

  IF v_existing_pipe_url IS NOT NULL AND v_existing_pipe_url != '' THEN
    RAISE NOTICE '✅ pipe_rule_dispatch_url já configurado: %', v_existing_pipe_url;
    RETURN;
  END IF;

  -- Derivar da campaign_rule_dispatch_url
  SELECT value INTO v_campaign_url
  FROM public.cron_config
  WHERE key = 'campaign_rule_dispatch_url';

  IF v_campaign_url IS NOT NULL AND v_campaign_url != '' THEN
    v_pipe_url := replace(v_campaign_url, 'campaign-rule-dispatch', 'pipe-rule-dispatch');

    INSERT INTO public.cron_config (key, value)
    VALUES ('pipe_rule_dispatch_url', v_pipe_url)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

    RAISE NOTICE '✅ pipe_rule_dispatch_url configurado: %', v_pipe_url;
  ELSE
    RAISE NOTICE '⚠️  campaign_rule_dispatch_url não encontrado. Configure pipe_rule_dispatch_url manualmente.';
  END IF;
END $$;

-- ============================================
-- 6. GARANTIR pg_cron JOB PARA pipe-rule-dispatch
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remover job anterior se existir
    BEGIN
      PERFORM cron.unschedule('pipe-rule-dispatch');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'pipe-rule-dispatch',
      '* * * * *',
      'SELECT public.invoke_pipe_rule_dispatch()'
    );
    RAISE NOTICE '✅ Job pg_cron "pipe-rule-dispatch" agendado (a cada minuto)';
  ELSE
    RAISE NOTICE '⚠️  pg_cron não habilitado';
  END IF;
END $$;

-- ============================================
-- 7. VERIFICAÇÃO FINAL
-- ============================================

DO $$
DECLARE
  v_constraint_def TEXT;
  v_pending INT;
  v_has_processing BOOLEAN;
BEGIN
  -- Verificar que a constraint inclui 'processing'
  SELECT pg_get_constraintdef(con.oid) INTO v_constraint_def
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'scheduled_pipe_messages'
    AND nsp.nspname = 'public'
    AND con.contype = 'c'
    AND con.conname = 'scheduled_pipe_messages_status_check';

  v_has_processing := v_constraint_def IS NOT NULL AND v_constraint_def LIKE '%processing%';

  IF v_has_processing THEN
    RAISE NOTICE '✅ CHECK constraint inclui "processing": %', v_constraint_def;
  ELSE
    RAISE NOTICE '❌ CHECK constraint NÃO inclui "processing"! Def: %', COALESCE(v_constraint_def, 'NÃO ENCONTRADA');
  END IF;

  -- Contar pendentes
  SELECT COUNT(*) INTO v_pending
  FROM public.scheduled_pipe_messages WHERE status = 'scheduled';

  RAISE NOTICE '📬 % mensagens pendentes (scheduled)', v_pending;
END $$;

-- Mostrar contagem por status
SELECT status, COUNT(*) as total
FROM public.scheduled_pipe_messages
GROUP BY status
ORDER BY status;
