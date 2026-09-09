-- Comando — fecha `anon` nas 4 funções criadas pelo escopo por usuário.
--
-- ── O buraco ──────────────────────────────────────────────────────────────
-- As migrations 20270825000000/010/020 escreveram `REVOKE ALL ... FROM PUBLIC`
-- e pararam aí. Não basta: o `ALTER DEFAULT PRIVILEGES` do schema `public`
-- concede EXECUTE **direto a `anon`** no momento do CREATE, e grant nominal não
-- é alcançado por revoke em PUBLIC. Medido no PROD em 2026-08-24:
--
--   is_org_admin(uuid)                              anon=X   SECURITY DEFINER
--   my_team_member_id(uuid)                         anon=X   SECURITY DEFINER
--   get_conversations_awaiting_human_reply(...)     anon=X   SECURITY DEFINER
--   get_comando_agenda_events(...)                  anon=X   SECURITY INVOKER
--
-- Este repo já sabia disso e deixou escrito. A 20270728000002 fez exatamente
-- este conserto para as funções do Meta e fechou com a nota:
--   "Nota pra quem escrever a próxima migration: revogar de PUBLIC **e** de
--    anon. As duas metades existem e nenhuma cobre a outra."
-- A entrega do Comando escreveu só a primeira metade. Esta migration escreve a
-- segunda.
--
-- ── Por que não é incidente ───────────────────────────────────────────────
-- Não é explorável hoje, e vale dizer por quê em vez de deixar no ar: sem JWT,
-- `auth.uid()` é NULL, `get_my_organization_ids()` devolve zero linhas e a RPC
-- de conversas levanta `forbidden`; `is_org_admin` devolve false e
-- `my_team_member_id` devolve NULL. As três SECURITY DEFINER validam org por
-- dentro — foi assim que a entrega foi desenhada.
--
-- O que se conserta aqui é superfície: três funções que BYPASSAM RLS por
-- construção estavam executáveis por um role público, e a única coisa entre
-- elas e o mundo era o cuidado de quem as escreveu. Defesa em profundidade é
-- não depender disso.
--
-- Só ACL: nenhum objeto muda, nenhuma linha é tocada. Reaplicar é no-op.

REVOKE ALL     ON FUNCTION public.is_org_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_org_admin(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.my_team_member_id(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_team_member_id(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.my_team_member_id(uuid) TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer) TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.get_comando_agenda_events(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_comando_agenda_events(uuid, timestamptz, timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_comando_agenda_events(uuid, timestamptz, timestamptz) TO authenticated, service_role;
