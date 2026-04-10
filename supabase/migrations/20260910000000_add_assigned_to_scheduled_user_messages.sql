-- ============================================
-- MIGRAÇÃO: Adicionar assigned_to em scheduled_user_messages
-- ============================================
-- Problema: mensagens agendadas usavam created_by como ownership,
-- enquanto follow_ups usam assigned_to. Isso impedia membros de
-- verem mensagens agendadas criadas por outros (ex: admin) para
-- leads do seu escopo.
--
-- Solução: adicionar assigned_to com a mesma semântica de follow_ups,
-- unificando a regra de visibilidade na tela de Revisão.
-- ============================================

-- 1. Adicionar coluna assigned_to (nullable inicialmente para backfill)
ALTER TABLE public.scheduled_user_messages
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.team_members(id) ON DELETE SET NULL;

-- 2. Backfill: registros existentes recebem assigned_to = created_by
UPDATE public.scheduled_user_messages
  SET assigned_to = created_by
  WHERE assigned_to IS NULL;

-- 3. Trigger de segurança: se um INSERT vier sem assigned_to, herda created_by.
--    Cobre INSERT e UPDATE para evitar NULLs acidentais.
CREATE OR REPLACE FUNCTION public.default_assigned_to_scheduled_msg()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    NEW.assigned_to := NEW.created_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_assigned_to_scheduled_msg ON public.scheduled_user_messages;

CREATE TRIGGER trg_default_assigned_to_scheduled_msg
  BEFORE INSERT OR UPDATE ON public.scheduled_user_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.default_assigned_to_scheduled_msg();

-- 4. Índice para filtro por membro atribuído
CREATE INDEX IF NOT EXISTS idx_scheduled_user_messages_assigned_to
  ON public.scheduled_user_messages (assigned_to, status);
