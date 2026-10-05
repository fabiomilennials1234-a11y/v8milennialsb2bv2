-- runtime_logs · 1B.1 — índice PARCIAL de erros (substitui o status_created)
--
-- TIMESTAMP PROVISÓRIO: renumerar contra o ledger de prod na hora de aplicar.
--
-- ⚠️ COMO APLICAR — NUNCA por `apply_migration` nem `supabase db push`:
--   CONCURRENTLY não roda dentro de transação, e os dois embrulham o arquivo
--   numa. Aplicar por psql, autocommit, com lock_timeout de sessão:
--
--     PGOPTIONS="-c lock_timeout=3s" psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/migrations/20271107130001_runtime_logs_idx_erro_parcial.sql
--
--   Depois registrar a versão no ledger (supabase_migrations.schema_migrations)
--   pela receita cirúrgica. UM statement por arquivo, de propósito: psql -f
--   com dois statements continua autocommit, mas qualquer ferramenta que mande
--   o arquivo como simple-query os junta numa transação implícita.
--
--   Se cair por lock_timeout, o CREATE deixa um índice INVALID para trás:
--     SELECT indisvalid FROM pg_index
--      WHERE indexrelid = 'public.idx_runtime_logs_error_created'::regclass;
--   Se false: DROP INDEX CONCURRENTLY public.idx_runtime_logs_error_created;
--   e repetir.
--
-- ORDEM: este arquivo ANTES de 20271107130002 (drop do status_created). O único
-- leitor que filtra status — a tela master, `useMasterOperations.ts:95/110`,
-- `status=eq.<x>` + `created_at>=` + `ORDER BY created_at DESC` — não pode
-- ficar um instante sem caminho para `status='error'`.
--
-- POR QUE PARCIAL: `status` tem 3 valores; como coluna da frente de um btree de
-- 189 MB ele só serve para separar ~2% de erros dos 98% de sucesso. O parcial
-- guarda só os 2%. Isto NÃO reabre o descarte de 02/09 (aquele era um índice em
-- `created_at` puro, sobre a tabela inteira).
--
-- REVERSÃO EXATA:
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_runtime_logs_error_created;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_runtime_logs_error_created
  ON public.runtime_logs USING btree (created_at DESC)
  WHERE (status = 'error');
