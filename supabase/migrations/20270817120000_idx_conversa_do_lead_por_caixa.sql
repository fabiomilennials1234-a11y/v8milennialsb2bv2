-- Índice que torna o seletor de Conversa do Lead O(caixas) em vez de
-- O(mensagens do lead).
--
-- MEDIDO EM PRODUÇÃO (2026-08-17, issue #1610):
--
--   O seletor precisa, por caixa, da última mensagem trocada com um telefone.
--   Com o índice existente `(organization_id, normalized_phone)` o Postgres lê
--   TODAS as mensagens daquele telefone e depois ordena, para devolver 3 ou 4
--   linhas:
--
--     lead com   642 msgs, 3 caixas → 271 ms a frio (514 buffers)
--     lead com  1811 msgs, 3 caixas → 618 ms a frio (1224 buffers, 1036 do disco)
--
--   E o lead falador é exatamente o que se clica. Tentar `LATERAL` por caixa
--   sem este índice é PIOR — 4880 buffers, porque relê a lista inteira uma vez
--   por caixa (`Rows Removed by Filter: 1746`, 4 loops).
--
--   Com `instance_id` no prefixo, o `LATERAL` vira N buscas de uma linha e o
--   `DISTINCT ON (instance_id)` dispensa o sort.
--
-- CONCURRENTLY é obrigatório, não preferência: a tabela tem 2,4 milhões de
-- linhas e 4,7 GB, e há 107 instâncias conectadas gravando inbound. Um
-- `CREATE INDEX` comum travaria escrita por dezenas de segundos — mensagem de
-- cliente falhando.
--
-- Parcial em `deleted_at IS NULL` porque o seletor nunca mostra apagada, e o
-- índice fica menor numa tabela que já carrega 2 GB de índice.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_msgs_org_phone_instance_ts
  ON public.whatsapp_messages (organization_id, normalized_phone, instance_id, "timestamp" DESC)
  WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL;
