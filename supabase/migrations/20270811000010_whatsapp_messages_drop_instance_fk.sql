-- =============================================================================
-- 20270811000010_whatsapp_messages_drop_instance_fk.sql
--
-- Passo 1 de 2 — cai a FK que apaga o histórico do WhatsApp. E SÓ ela.
--
-- O resto do desenho (lápide com `phone_number`, `whatsapp_chip_instance_ids`,
-- `get_whatsapp_conversation_list` resolvendo por chip) está em
-- `20270811000011_whatsapp_historico_por_chip.sql`, que aplica logo em seguida e
-- documenta o desenho inteiro. Este arquivo aqui é só a DDL cara.
--
-- O problema que isto resolve
-- ---------------------------
-- `whatsapp_messages.instance_id` tem FK ON DELETE SET NULL contra
-- `whatsapp_instances`. Apagar uma Instance (botão da UI, CASCADE de org, SQL
-- manual) zera o vínculo de TODO o histórico dela. Como o chat filtra por
-- `instance_id = <instância atual>`, a conversa inteira some da tela — embora
-- continue no banco e no aparelho. Medido em 2026-08-10: 385.828 linhas com
-- `instance_id IS NULL` (Alamaster 155.674, Basic4u 87.259, Milennials 28.669),
-- e a hemorragia está ATIVA — a última órfã da Alamaster nasceu 111 segundos
-- antes de a instância ser recriada.
--
-- Soft-delete de Instance foi avaliado e REJEITADO (86 call sites, e desligaria
-- o reaper que remove a Instance no provider). A Instance continua sendo apagada
-- fisicamente; o que muda é o significado da coluna — `instance_id` vira uuid
-- HISTÓRICO, imune ao ciclo de vida da Instance.
--
-- POR QUE ESTE ARQUIVO EXISTE SEPARADO
-- ------------------------------------
-- `DROP CONSTRAINT` pega ACCESS EXCLUSIVE em `whatsapp_messages` (2,3M linhas),
-- que o webhook escreve sem parar. O lock NÃO é devolvido quando o comando
-- termina: fica retido até o COMMIT da transação inteira. Como o apply roda o
-- arquivo dentro de UMA transação, qualquer coisa colocada depois do DROP no
-- mesmo arquivo (ALTER TABLE, CREATE INDEX, CREATE FUNCTION, DO blocks) estende
-- o bloqueio do inbox de ~30 orgs pelo tempo somado de todas elas — com o
-- webhook e o chat enfileirados atrás.
--
-- Aqui a transação é o DROP e o COMMENT pareado, ambos catálogo puro: sub-
-- milissegundo depois que o lock é obtido. É o que faz `lock_timeout` significar
-- o que parece significar.
--
-- ⚠️ APLICAR ESTE ARQUIVO SOZINHO, EM TRANSAÇÃO PRÓPRIA. Se o apply for manual
-- (psql), envolva em `BEGIN; ... COMMIT;` e não emende o passo 2 na mesma
-- transação — emendar desfaz exatamente a proteção deste arquivo.
--
-- ROLLBACK
-- --------
-- NÃO recriar a FK. `ALTER TABLE ... ADD CONSTRAINT` valida as 2,3M linhas (lock
-- longo, agora sim) e as 385.828 órfãs já violam a referência: recriar exige
-- limpar antes, e recriar é justamente recriar o bug. O reverso honesto deste
-- arquivo é apenas restaurar o COMMENT antigo da coluna, e nem isso é urgente.
-- =============================================================================

-- Sem teto, a DDL abaixo entra na fila atrás de uma escrita do webhook e — pior
-- — bloqueia todo mundo que chegar depois dela. Falhar em 5s e tentar de novo é
-- barato; travar o inbox de 30 orgs não é.
SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- A FK que apaga o histórico
--
-- ON DELETE SET NULL é a causa-raiz das 385.828 órfãs. A partir do COMMIT desta
-- transação, `instance_id` é um uuid histórico: aponta para a Instance que
-- RECEBEU a mensagem, exista ela ainda ou não. A integridade referencial que se
-- perde é exatamente a que estava destruindo o dado.
--
-- Some junto a classe de statement timeout que obrigou o `nullifyInBatches` do
-- proxy: sem FK, deletar Instance deixa de tocar as 2,3M linhas.
--
-- O índice `idx_whatsapp_messages_instance` sobrevive ao DROP (não é índice de
-- constraint) — nenhum plano de consulta regride por causa disto.
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_instance_id_fkey;

COMMENT ON COLUMN public.whatsapp_messages.instance_id IS
  'Instance que recebeu/enviou a mensagem. Uuid HISTÓRICO e deliberadamente SEM '
  'FK: a mensagem sobrevive à Instance. Resolva o chip com '
  'whatsapp_chip_instance_ids(org, instance) em vez de comparar com a Instance '
  'atual.';

RESET lock_timeout;
