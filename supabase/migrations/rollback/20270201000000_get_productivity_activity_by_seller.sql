-- ROLLBACK: remove a RPC additiva do placar por vendedor.
-- Additiva (nova função) — reverter = DROP. Não toca nenhuma função existente.
DROP FUNCTION IF EXISTS public.get_productivity_activity_by_seller(uuid, timestamptz, timestamptz);
