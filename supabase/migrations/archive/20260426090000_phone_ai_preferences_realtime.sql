-- ============================================================================
-- U3 (Onda 2 Toggle Unify) — habilita realtime em phone_ai_preferences
--
-- Sem isso, toggle por phone (sem lead) não broadcasta. Usuário B na mesma
-- org não recebe broadcast quando A toggla. Apenas leads.ai_disabled tinha
-- realtime — fonte denormalizada.
--
-- Adiciona phone_ai_preferences à publication supabase_realtime.
-- Idempotente — IF NOT EXISTS sintático via DO block.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'phone_ai_preferences'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.phone_ai_preferences;
    RAISE NOTICE '[realtime] phone_ai_preferences added to supabase_realtime publication';
  ELSE
    RAISE NOTICE '[realtime] phone_ai_preferences already in publication — skipping';
  END IF;
END $$;
