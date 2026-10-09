-- 20271115000000_whatsapp_unarchive_on_inbound.sql
--
-- Regra de produto (CTO, opção A, 09/10): para TODAS as orgs, mensagem
-- recebida (lead → nós) em conversa arquivada desarquiva a conversa
-- (`whatsapp_conversations.archived_at = NULL`). Não desarquiva:
--   - resposta nossa (`direction = 'outgoing'`);
--   - grupo (`is_group` OU `remote_jid` terminando em `@g.us`);
--   - importação de histórico (`received_via = 'history_sync'`);
--   - edição/remoção de mensagem (`edited`, `deleted_at`);
--   - mensagem anterior ao arquivamento (`timestamp < archived_at`): evento
--     atrasado não desfaz um arquivamento feito depois dele.
-- O front faz o mesmo patch otimista em
-- `src/modules/communication/hooks/chat/shared/unarchiveOnInbound.ts`; os dois
-- predicados são o mesmo e mudam juntos.
--
-- Escopo da linha: `archived_at` mora em (instance_id, phone_number) e é
-- compartilhado pela org. O UPDATE casa por (organization_id, instance_id,
-- normalized_phone) — exatamente o índice parcial
-- `idx_whatsapp_conversations_normalized_phone`. Uma conversa arquivada numa
-- Instance APOSENTADA da mesma linha (reap_queue) não é alcançada; medido em
-- prod em 09/10: 0 de 121 conversas arquivadas estão nesse caso.
--
-- ORDEM DOS GATILHOS. Gatilhos AFTER do mesmo evento disparam em ordem
-- alfabética do nome. O gatilho só-Riofix `riofix_reabrir_conversa_arquivada`
-- (fora do repo, aplicado em prod) desarquiva E enfileira um workflow só
-- quando o próprio UPDATE dele reabriu alguma linha. Se este gatilho rodasse
-- antes, a Riofix veria 0 linhas reabertas e o workflow nunca mais dispararia.
-- `trg_unarchive_on_inbound` > `riofix_…` e > `riofix_bot_inbound` (que lê
-- archived_at), então ambos enxergam o estado original. Não renomeie para algo
-- que ordene antes de `riofix_`.
--
-- ROBUSTEZ. Isto roda dentro do INSERT de cada mensagem recebida — a tabela de
-- maior volume do banco. Perder a mensagem é catastrófico; deixar de
-- desarquivar não é. O UPDATE fica num bloco BEGIN … EXCEPTION WHEN others:
-- qualquer falha (lock, deadlock, constraint) vira WARNING e o INSERT segue. O
-- sub-bloco é uma subtransação, mas sem escrita ela não recebe XID — o caso
-- comum (conversa não arquivada, UPDATE casa 0 linhas) não pesa no cache de
-- subxids. Nenhum RAISE de erro sai daqui: nada de 40001 subindo ao PostgREST.
-- NÃO ponha leitura de `whatsapp_conversations` FORA do bloco (ex.: uma guarda
-- `IF NOT EXISTS (SELECT …)` "para poupar a subtransação"): ela pega lock na
-- tabela e é planejada fora do EXCEPTION — com `lock_timeout` do authenticator
-- (8 s) e um AccessExclusive pendente (ALTER, índice sem CONCURRENTLY), o 55P03
-- sobe e aborta o INSERT da mensagem, inclusive de conversa NÃO arquivada; um
-- drift de coluna (42703) derrubaria todo inbound. Provado em PG 16 (volta 2).
-- Sem backfill de propósito: a regra vale daqui pra frente.
--
-- SEGURANÇA. SECURITY DEFINER porque o INSERT pode vir de role sem UPDATE em
-- `whatsapp_conversations`; `search_path = ''` e nomes qualificados. A org do
-- UPDATE é a da própria mensagem (NEW.organization_id), nunca parâmetro. Mora
-- em `private` (fora do PostgREST) e tem EXECUTE revogado de todos, inclusive
-- `service_role` — função nova nasce executável por PUBLIC e `REVOKE FROM
-- PUBLIC` sozinho não alcança `service_role`. Gatilho dispara sem checar
-- EXECUTE de quem insere.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.unarchive_conversation_on_inbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    UPDATE public.whatsapp_conversations c
       SET archived_at = NULL
     WHERE c.organization_id = NEW.organization_id
       AND c.instance_id = NEW.instance_id
       AND c.normalized_phone = NEW.normalized_phone
       AND c.deleted_at IS NULL
       AND c.archived_at IS NOT NULL
       AND c.archived_at <= NEW."timestamp";
  EXCEPTION WHEN others THEN
    RAISE WARNING 'unarchive_conversation_on_inbound: não aplicado (SQLSTATE %)', SQLSTATE;
  END;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION private.unarchive_conversation_on_inbound()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_unarchive_on_inbound ON public.whatsapp_messages;

CREATE TRIGGER trg_unarchive_on_inbound
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
WHEN (
  NEW.direction = 'incoming'
  AND NEW.received_via IS DISTINCT FROM 'history_sync'
  AND NOT COALESCE(NEW.is_group, false)
  AND NEW.remote_jid NOT LIKE '%@g.us'
  AND NOT COALESCE(NEW.edited, false)
  AND NEW.deleted_at IS NULL
  AND NEW.instance_id IS NOT NULL
  AND NEW.normalized_phone IS NOT NULL
  AND NEW."timestamp" IS NOT NULL
)
EXECUTE FUNCTION private.unarchive_conversation_on_inbound();
