-- ============================================================================
-- Backfill: `whatsapp_messages.media_file_name` dos documentos que ainda têm
-- `raw_payload` (Chamado f6fc3c9e).
--
-- A migration 20271108000100 cria a coluna e o trigger BEFORE INSERT, e dali
-- em diante toda mensagem nova já nasce com o nome. Este script preenche as
-- que chegaram ANTES da migration e cujo payload ainda não foi apagado pela
-- retenção de 14 dias. Documento mais velho que isso já não tem payload, e o
-- chat mostra "Documento" para ele: não há de onde recuperar o nome.
--
-- ── ORDEM ──────────────────────────────────────────────────────────────────
--   1. migration 20271108000100 aplicada em prod   (rápida, só DDL)
--   2. ESTE script, FORA DO PICO, por um humano     ← aqui
--   3. KM (count abaixo → 0)
--   4. merge/deploy do frontend
--
-- ── POR QUE NÃO ESTÁ NA MIGRATION ───────────────────────────────────────────
-- `whatsapp_messages` tem ~3 M linhas / ~2 GB de heap e nenhum índice em
-- `message_type`. Dentro da migration, o UPDATE faria seq scan da tabela
-- inteira segurando o ACCESS EXCLUSIVE do ADD COLUMN, e todo INSERT de webhook
-- e todo SELECT do chat ficariam na fila, num banco que já entra em swap.
--
-- ── COMO ESTE SCRIPT EVITA ISSO ─────────────────────────────────────────────
--   * Anda em janelas de 1 h de `created_at` (últimos 15 dias = 360 lotes),
--     com `direction IN ('incoming','outgoing')` e faixa de `created_at`, que
--     é exatamente o índice `idx_whatsapp_messages_direction (direction,
--     created_at DESC)`, conferido em pg_indexes em 2026-10-06. Nada de seq
--     scan.
--   * COMMIT a cada lote: os locks de linha duram um lote, nunca o script.
--   * `lock_timeout` curto: se uma linha estiver presa, o lote falha em vez de
--     enfileirar. Basta rodar de novo.
--   * `statement_timeout` por lote, com pausa curta entre os lotes para não
--     disputar I/O com o tráfego.
--   * IDEMPOTENTE e REEXECUTÁVEL: só toca `media_file_name IS NULL`. Se cair
--     no meio, rode de novo; os lotes já feitos voltam UPDATE 0.
--   * Sem trigger nem webhook: os triggers de UPDATE da tabela são
--     `UPDATE OF status, lead_id, instance_id` e `UPDATE OF phone_number`
--     (conferido em pg_trigger), e SET em `media_file_name` não dispara nenhum.
--     `session_replication_role` NÃO é tocado. O realtime recebe ~1 evento
--     UPDATE por linha (~4,8 k no total, medido em 2026-10-06), o que é
--     inofensivo.
--
-- ── COMO RODAR ─────────────────────────────────────────────────────────────
--   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/backfill-media-file-name.sql
-- Precisa de psql, porque usa `\gexec`, e em AUTOCOMMIT (sem `-1` ou
-- `--single-transaction`). Cada lote vira um statement de nível superior, com
-- COMMIT próprio e `statement_timeout` próprio. Num bloco DO isso não
-- funciona: o timeout conta desde o início do statement de topo, que seria o
-- DO inteiro. O SQL Editor do Supabase não roda `\gexec`.
-- Saída esperada: uma linha `UPDATE n` por lote (a maioria `UPDATE 0`)
-- intercalada com o `pg_sleep`.
-- ============================================================================

\set ON_ERROR_STOP 1
SET lock_timeout = '2s';
SET statement_timeout = '20s';

-- Um UPDATE por janela de 1 h, cada um seguido de uma pausa de 100 ms.
SELECT stmt
  FROM generate_series(
         date_trunc('hour', now() - interval '15 days'),
         date_trunc('hour', now()),
         interval '1 hour'
       ) AS w(win_from)
 CROSS JOIN LATERAL unnest(ARRAY[
   format(
     $q$UPDATE public.whatsapp_messages
           SET media_file_name = public.whatsapp_messages_extract_media_file_name(raw_payload)
         WHERE direction IN ('incoming', 'outgoing')
           AND created_at >= %L
           AND created_at <  %L
           AND message_type = 'document'
           AND media_file_name IS NULL
           AND (raw_payload ? 'content' OR raw_payload ? 'document')
           AND public.whatsapp_messages_extract_media_file_name(raw_payload) IS NOT NULL$q$,
     w.win_from, w.win_from + interval '1 hour'
   ),
   'SELECT pg_sleep(0.1)'
 ]) WITH ORDINALITY AS s(stmt, ord)
 ORDER BY w.win_from, s.ord
\gexec

RESET statement_timeout;
RESET lock_timeout;

-- ── KM (rodar depois; esperado 0) ─────────────────────────────────────────
-- select count(*) from whatsapp_messages
--  where organization_id = '4922638c-4909-494e-ba10-12282ec0b161'
--    and message_type = 'document'
--    and created_at > now() - interval '13 days'
--    and media_file_name is null
--    and raw_payload->'content'->>'fileName' is not null;
