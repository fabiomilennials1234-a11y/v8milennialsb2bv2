-- Rollback de 20270816110000_channel_messages_multi_org_read.sql
--
-- Restaura `channel_messages_org_access` na forma EXATA do baseline
-- (20260101000000_baseline_prod_schema.sql L37524): `FOR ALL`, USING com
-- `get_user_organization_id()`, sem WITH CHECK explícito.
--
-- ⚠️ O QUE VOLTA JUNTO — os dois defeitos, não um:
--
--   1. USUÁRIO MULTI-ORG VOLTA A VER CONVERSA QUE ABRE EM BRANCO.
--      `get_user_organization_id()` é `LIMIT 1` sobre a org mais ANTIGA do
--      usuário. A lista do inbox social (`get_social_conversation_list`) segue
--      com `get_my_organization_ids()`, então os dois gates divergem de novo: a
--      conversa aparece na lista e a thread devolve zero linhas. E como esta
--      policy é o gate de `apply_rls()`, o Realtime cala junto — mensagem nova
--      sem F5 (`useSocialRealtime`) e aviso de recebida (`useIncomingMessageToast`)
--      param para esse usuário. Sem erro em lugar nenhum: sucesso com zero linhas.
--
--   2. `FOR ALL` SEM WITH CHECK VOLTA A SER CAMINHO DE ESCRITA.
--      Policy permissiva sem WITH CHECK reusa o USING como WITH CHECK. Isso só
--      não é explorável enquanto o REVOKE do bloco 7 de
--      `20270815104500_notificame_instagram_inbound.sql` estiver de pé —
--      `authenticated` fica com SELECT e nada mais. Se este rollback for rodado
--      DEPOIS do rollback daquele arquivo (que devolve os grants), um membro
--      comum da org volta a poder INSERIR mensagem forjada em
--      `channel_messages`, que a partir da fatia 2-IG é o que o inbox social
--      RENDERIZA. Ordem segura: reverter este arquivo ANTES daquele, nunca
--      depois.
--
-- Nada é reescrito e nada é apagado: policy é metadata. Não há janela de tabela
-- sem policy — o DROP e o CREATE ficam na mesma transação do `db push`.

DROP POLICY IF EXISTS "channel_messages_org_access" ON public.channel_messages;

CREATE POLICY "channel_messages_org_access"
  ON public.channel_messages
  USING (organization_id = (SELECT public.get_user_organization_id()));
