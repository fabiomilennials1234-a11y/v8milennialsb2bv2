-- Rollback de 20270817120000_idx_conversa_do_lead_por_caixa.sql
--
-- Derrubar o índice devolve o seletor de Conversa do Lead ao custo medido
-- antes dele: 618 ms a frio para um lead com 1811 mensagens, contra 0,27 ms
-- depois. Nada quebra — as consultas voltam a usar
-- `idx_whatsapp_messages_normalized_phone` e ficam lentas, não erradas.
--
-- CONCURRENTLY também na queda: DROP INDEX comum pega ACCESS EXCLUSIVE na
-- tabela e trava o inbound das 107 instâncias conectadas.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_whatsapp_msgs_org_phone_instance_ts;
