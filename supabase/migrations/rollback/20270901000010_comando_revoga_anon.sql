-- ROLLBACK de 20270901000010_comando_revoga_anon.sql
--
-- ⚠️ Rodar isto REABRE superfície: devolve `EXECUTE` a `anon` em três funções
-- `SECURITY DEFINER` (que bypassam RLS por construção) e numa `INVOKER`. Não há
-- caso de uso legítimo — a migration original é ACL pura e não pode quebrar
-- chamador nenhum, porque todo chamador de produção é `authenticated` ou
-- `service_role`, e esses dois continuam com o grant.
--
-- Este arquivo existe pelo PAREAMENTO do diretório, não porque alguém deva
-- usá-lo: quando o inverso não está escrito, quem precisa reverter às pressas
-- reescreve na hora, e é aí que se erra a assinatura — e `GRANT` em assinatura
-- errada é no-op silencioso, exatamente o modo de falha que a migration
-- original veio consertar do outro lado.
--
-- As assinaturas abaixo são cópia literal das linhas 35/39/43/47 da migration,
-- e foram conferidas contra `pg_get_function_identity_arguments` no PROD: as
-- quatro funções têm UMA assinatura cada, sem overload.
--
-- NÃO devolve o grant a PUBLIC. O `REVOKE ... FROM PUBLIC` das migrations
-- 20270825000000/010/020 é anterior a esta e continua valendo; reabrir PUBLIC
-- aqui seria desfazer trabalho de outra migration, não reverter esta.

GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.my_team_member_id(uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer) TO anon;

GRANT EXECUTE ON FUNCTION public.get_comando_agenda_events(uuid, timestamptz, timestamptz) TO anon;
