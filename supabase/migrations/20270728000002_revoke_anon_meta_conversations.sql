-- 20270728000002_revoke_anon_meta_conversations.sql
--
-- Corrige o alcance do revoke da 20270728000000.
--
-- Aquele `REVOKE ... FROM PUBLIC` funcionou — o grant de PUBLIC saiu (dá pra
-- comparar com get_agenda_events, que ainda carrega `=X/postgres` no proacl).
-- Mas o `ALTER DEFAULT PRIVILEGES` do Supabase concede DIRETO a `anon`, e
-- grant direto não é alcançado por revoke em PUBLIC. Resultado medido logo
-- após o apply: anon ficou com `rxtm` na tabela e `X` nas duas funções.
--
-- Não era exploitável — a RLS segura sozinha: is_master_user(NULL) = false e
-- get_my_organization_ids() sem JWT devolve 0 linhas, então anon lia 0 linhas.
-- Mas o grant é desnecessário e destoa de channel_messages, que é a referência
-- endurecida do módulo (nenhum grant para anon).
--
-- Nota pra quem escrever a próxima migration: revogar de PUBLIC **e** de anon.
-- As duas metades existem e nenhuma cobre a outra.

REVOKE ALL ON public.meta_conversations FROM anon;
REVOKE ALL ON FUNCTION public.link_meta_conversation_to_lead(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mark_meta_conversation_read(uuid) FROM anon;
