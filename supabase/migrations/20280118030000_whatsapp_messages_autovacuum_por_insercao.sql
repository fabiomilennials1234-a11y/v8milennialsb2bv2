-- ════════════════════════════════════════════════════════════════════════════
-- whatsapp_messages: autovacuum por INSERÇÃO em limiar absoluto — o mapa de
-- visibilidade deixa de apodrecer entre reinícios
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA: index-only scan em whatsapp_messages fazendo 107 mil heap fetches
-- em 103 mil linhas (18 s com disco frio). Um index-only scan só pula o heap
-- nas páginas marcadas all-visible no mapa de visibilidade (VM), e quem marca
-- é o VACUUM.
--
-- MEDIDO em prod em 16/11/2026:
--   reltuples ........................... 3,55 milhões
--   páginas all-visible ................. 115.013 de 289.761 (39,7%)
--   último (auto)vacuum ................. NUNCA desde o reinício de 10/11
--     (pg_stat zerado pelo crash; n_ins_since_vacuum 102.661,
--      n_dead_tup 48.103, autovacuum_count 0)
--   reloptions .......................... autovacuum_vacuum_scale_factor=0.10
--
-- CAUSA: os gatilhos do autovacuum são PROPORCIONAIS a reltuples:
--   por mortas ..... 50   + 0,10 × 3,55 M = 355 mil tuplas mortas
--   por inserção ... 1000 + 0,20 × 3,55 M = 710 mil inserções
-- Com ~17 mil inserções/dia, o vacuum por inserção dispara a cada ~6 semanas;
-- e cada reinício não-limpo zera o contador e recomeça a espera. Toda mensagem
-- nova fica fora da VM nesse intervalo — exatamente as linhas que o inbox lê
-- (janelas de 7 e 30 dias).
--
-- CORREÇÃO: limiar ABSOLUTO por tabela para o vacuum por inserção —
--   autovacuum_vacuum_insert_threshold    = 20000  (≈ 1 dia de mensagens)
--   autovacuum_vacuum_insert_scale_factor = 0
-- O vacuum disparado por inserção numa tabela só-de-append é barato: pula as
-- páginas já all-visible pela própria VM e, com pouca tupla morta, pula a
-- limpeza dos índices (bypass do PG 14+). O que ele faz é marcar as páginas
-- novas como all-visible — o que o inbox precisa.
--   autovacuum_vacuum_scale_factor 0.10 → 0.02 (≈ 71 mil mortas), para as
-- tuplas mortas (48 mil hoje, de UPDATE de status/leitura) não esperarem 355
-- mil.
--
-- AÇÃO OPERACIONAL (fora do escopo de migration — não roda em transação e
-- não é schema): um `VACUUM (ANALYZE, VERBOSE) public.whatsapp_messages;` em
-- horário de baixo tráfego recupera a VM imediatamente, sem esperar o
-- primeiro gatilho. Ver o PR.
--
-- Só schema: ALTER TABLE … SET (reloptions). Não reescreve a tabela, não
-- bloqueia leitura/escrita além de um ShareUpdateExclusiveLock instantâneo.
-- Rollback: supabase/migrations/rollback/20280118030000_whatsapp_messages_autovacuum_por_insercao.sql
-- NÃO APLICADA em nenhum banco remoto por esta entrega.

ALTER TABLE public.whatsapp_messages SET (
  autovacuum_vacuum_insert_threshold    = 20000,
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_scale_factor        = 0.02
);
