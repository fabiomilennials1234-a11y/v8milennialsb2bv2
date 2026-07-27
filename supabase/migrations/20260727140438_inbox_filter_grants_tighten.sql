-- 20260727140438_inbox_filter_grants_tighten.sql
--
-- APLICADA EM PROD em 2026-07-27 (ledger: 20260727140438).
--
-- Complemento de 20260727140241_inbox_filter_server_side.sql (issue #1277).
--
-- O `CREATE FUNCTION` daquela migration reconcedeu EXECUTE a PUBLIC (default do
-- Postgres) e a `anon` (default privilege do Supabase no schema public). A função
-- anterior tinha só `authenticated` e `service_role`:
--
--   antes:  {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--   depois: {=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
-- Não há vazamento de dado — a função é SECURITY DEFINER e o gate exige
-- team_member ativo da org ou master, então `anon` (sem auth.uid()) só recebe
-- 42501. Mas EXECUTE concedido a quem nunca vai passar do gate é superfície de
-- ataque gratuita: qualquer regressão futura no gate passa a ser explorável sem
-- autenticação. Restaura o conjunto de grants exato de antes.
--
-- Vale para toda função recriada com DROP+CREATE: os grants voltam ao default do
-- schema, não ao que a função tinha. Conferir `proacl` depois de recriar.

REVOKE EXECUTE ON FUNCTION public.get_whatsapp_conversation_list(
  uuid, uuid, integer, timestamptz, uuid[], text[], uuid[], text[], uuid, boolean,
  text, boolean, boolean, boolean, text
) FROM PUBLIC, anon;
