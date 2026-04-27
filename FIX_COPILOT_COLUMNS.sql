-- =============================================================
-- Script COMPLETO de correção de colunas do copilot_agents
-- Execute no SQL Editor do Supabase Dashboard (Prod e Dev)
-- Atualizado: 2026-03-18
-- Seguro para rodar múltiplas vezes (IF NOT EXISTS em tudo)
-- =============================================================

-- =====================================================
-- 1. Colunas de Pipeline Config (migration 20260125000001)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_move_cards BOOLEAN DEFAULT false;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS auto_move_on_qualify BOOLEAN DEFAULT false;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS auto_move_on_objective BOOLEAN DEFAULT false;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS active_pipes JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS active_stages JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS move_rules JSONB DEFAULT '[]'::jsonb;

-- =====================================================
-- 2. Colunas de Capabilities (migration 20260126000000)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_qualify_lead BOOLEAN DEFAULT true;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_schedule_meeting BOOLEAN DEFAULT true;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_send_followup BOOLEAN DEFAULT true;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_update_crm BOOLEAN DEFAULT false;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_answer_faq BOOLEAN DEFAULT true;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_create_lead BOOLEAN DEFAULT true;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_transfer_human BOOLEAN DEFAULT true;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS max_conversation_turns INTEGER DEFAULT 20;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS response_delay_ms INTEGER DEFAULT 1000;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS llm_model TEXT DEFAULT 'anthropic/claude-3.5-sonnet';

-- =====================================================
-- 3. Colunas do Contexto do Quiz (migration 20260125000003)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS business_context JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS conversation_style JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS qualification_rules JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS few_shot_examples JSONB DEFAULT '[]'::jsonb;

-- =====================================================
-- 4. Colunas de Disponibilidade (migration 20260125000004)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS availability JSONB DEFAULT '{"mode":"always","timezone":"America/Sao_Paulo","days":["mon","tue","wed","thu","fri"],"start":"09:00","end":"18:00"}'::jsonb;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS response_delay_seconds INTEGER DEFAULT 0;

-- =====================================================
-- 5. Wizard Version (migration 20260215100000)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS wizard_version INTEGER DEFAULT 1;

-- =====================================================
-- 6. Colunas de Outbound/BDR (migration 20260128100000)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS operation_mode TEXT DEFAULT 'inbound';

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS activation_triggers JSONB DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS outbound_config JSONB DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS automation_actions JSONB DEFAULT NULL;

-- =====================================================
-- 7. can_update_lead (migration 20260315000000)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_update_lead BOOLEAN DEFAULT true;

-- =====================================================
-- 8. Shadow Leads / attend_unknown_contacts (migration 20260321000000)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS attend_unknown_contacts BOOLEAN DEFAULT false;

-- =====================================================
-- 9. Prompt Redesign (migration 20260605000001)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS objective_composite JSONB DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS custom_instructions TEXT DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS prompt_hash TEXT DEFAULT NULL;

-- =====================================================
-- 10. LLM Temperature Mode (migration 20260626000002)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS llm_temperature_mode TEXT DEFAULT 'balanceado';

-- Adicionar CHECK constraint se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'copilot_agents'
    AND constraint_name = 'copilot_agents_llm_temperature_mode_check'
  ) THEN
    ALTER TABLE public.copilot_agents
      ADD CONSTRAINT copilot_agents_llm_temperature_mode_check
      CHECK (llm_temperature_mode IN ('criativo', 'balanceado', 'preciso'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Constraint llm_temperature_mode: %', SQLERRM;
END $$;

-- =====================================================
-- 11. Natural Messaging Config (migration 20260720000000)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS natural_messaging_config JSONB DEFAULT NULL;

-- =====================================================
-- 12. Routing (migration 20260626000001 + 20260626000005)
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS routing_stages TEXT[] DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS routing_origins TEXT[] DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS routing_segments TEXT[] DEFAULT NULL;

-- =====================================================
-- 13. Outros campos auxiliares
-- =====================================================
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS anti_patterns TEXT[] DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS human_transfer_triggers TEXT[] DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS context_config JSONB DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS intent_detection JSONB DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS template_prompt_override TEXT DEFAULT NULL;

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS whatsapp_instance_id UUID DEFAULT NULL;

-- =====================================================
-- 14. campaign_id com FK condicional
-- =====================================================
DO $$
BEGIN
  ALTER TABLE public.copilot_agents
    ADD COLUMN IF NOT EXISTS campaign_id UUID DEFAULT NULL;

  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campanhas') THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'copilot_agents_campaign_id_fkey'
      ) THEN
        ALTER TABLE public.copilot_agents
          ADD CONSTRAINT copilot_agents_campaign_id_fkey
          FOREIGN KEY (campaign_id) REFERENCES public.campanhas(id) ON DELETE SET NULL;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Constraint campaign_id: %', SQLERRM;
  END;
END $$;

-- =====================================================
-- 15. operation_mode CHECK constraint
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'copilot_agents'
    AND constraint_name = 'copilot_agents_operation_mode_check'
  ) THEN
    ALTER TABLE public.copilot_agents
      ADD CONSTRAINT copilot_agents_operation_mode_check
      CHECK (operation_mode IN ('inbound', 'outbound', 'hybrid'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Constraint operation_mode: %', SQLERRM;
END $$;

-- =====================================================
-- VERIFICAÇÃO FINAL
-- =====================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'copilot_agents'
ORDER BY ordinal_position;
