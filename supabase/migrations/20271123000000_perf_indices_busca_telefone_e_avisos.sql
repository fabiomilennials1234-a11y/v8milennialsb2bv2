-- 20271123000000_perf_indices_busca_telefone_e_avisos.sql
--
-- Perf onda 1 (RAM 83% + pool do PostgREST saturando, 16/10). Dois índices,
-- nenhuma mudança de semântica, nenhuma RLS tocada.
--
-- MEDIDO EM PRODUÇÃO (16/10, janela de 15 min, pg_stat_statements):
--   lead_phones  `ilike '%dígitos%'`   1.041 ms/chamada, 10,6% do tempo do banco
--   notifications (sino, polling 30 s)   22 ms/chamada,  81,5/min, 8,5%
--
-- ─── 1. lead_phones: trigrama para a busca "contém" de telefone ─────────────
--
-- A pré-consulta da lista de Leads (`buscarLeadIdsPorTelefoneSecundario`) é
--   organization_id = $1 AND deleted_at IS NULL
--   AND normalized_phone ILIKE '%<4+ dígitos>%' LIMIT 200
-- e os btree de `lead_phones` (`20271112000000`) não servem `%x%`: o plano lê
-- a org inteira e avalia a RLS (EXISTS em `leads`, que passa pela RLS de
-- `leads`) linha a linha até achar 200 ou acabar. Com o GIN de trigrama o
-- Postgres vai direto nos candidatos, e a RLS só roda neles.
--
-- Seletividade com dígitos (só 1.000 trigramas possíveis): o `%x%` de ILIKE
-- extrai os trigramas internos do padrão — 4 dígitos = 2 trigramas, 11 = 9.
-- Trigramas do DDI/DDD ("551", "119", "999") são frequentes, mas a interseção
-- de vários cai rápido; e o recheck no heap é exato (o resultado é o mesmo do
-- seq scan). Com 4 dígitos ainda é um bitmap de algumas centenas a poucos
-- milhares de linhas, contra a org inteira hoje.
--
-- Coluna simples (sem `organization_id` via btree_gin, como em
-- `idx_leads_org_name_trgm`): o padrão de 11 dígitos é praticamente único na
-- base inteira, e a org filtra no recheck. Índice menor, menos escrita.
--
-- ─── 2. notifications: a ordenação do sino ──────────────────────────────────
--
-- A consulta do sino é
--   user_id = $1 AND organization_id = $2
--   ORDER BY last_event_at DESC NULLS LAST LIMIT 50
-- e `notifications_recipient_org_unread_idx (user_id, organization_id,
-- read_at, last_event_at DESC)` tem `read_at` no meio: serve o filtro, não a
-- ordem — o plano lê TODOS os avisos do usuário na org e ordena. Com
-- `(user_id, organization_id, last_event_at DESC NULLS LAST)` a leitura para
-- em 50. `DESC NULLS LAST` precisa estar escrito: o padrão de DESC é NULLS
-- FIRST, e um índice com a ordem de nulos trocada não serve o ORDER BY.
-- O índice antigo NÃO sai aqui (pode ter outro leitor; ver relatório).
--
-- ─── 3. Por que NÃO há trigrama em leads.normalized_phone ────────────────────
--
-- O `normalized_phone.ilike.%x%` da lista (`lead-list-filters.ts`) não vem
-- sozinho: é um braço de um OR com `name`, `company`, `email`, `phone`,
-- `erp_code` (todos `ilike %x%`) e `id.in.(…)`. Para um OR usar índice, TODO
-- braço precisa de um (BitmapOr); `company`/`email`/`phone`/`erp_code` não têm
-- trigrama. Um GIN só em `normalized_phone` não muda o plano da lista (provado
-- em `tests/integration/perf-indices-busca-telefone-e-avisos.test.mjs`) e
-- custaria escrita numa tabela com 21+ gatilhos. Fica fora até alguém indexar
-- o OR inteiro — decisão de outra onda.
--
-- ─── Por que sem CONCURRENTLY ───────────────────────────────────────────────
--
-- Este arquivo roda numa transação EXPLÍCITA (BEGIN … COMMIT abaixo, para o
-- `SET LOCAL lock_timeout` valer), e CONCURRENTLY não roda dentro de transação
-- (mesma decisão de `20270730000020_leads_claim.sql`, item 7).
-- O precedente que usou CONCURRENTLY (`20270817120000`) foi por tamanho:
-- 2,4 mi de linhas / 4,7 GB em tabela com webhook gravando. Aqui não —
-- tamanhos medidos em prod em 16/10:
--   lead_phones    70.363 linhas vivas / 11 MB de heap
--   notifications  47.413 linhas / 60 MB no total (heap + índices + toast)
-- CREATE INDEX comum leva menos de 1 s em cada, segurando SHARE (bloqueia
-- escrita, não leitura) só por esse tempo. A escrita em `lead_phones` vem de
-- edição manual e do sync do ERP; em `notifications`, de gatilhos — ambos
-- toleram 1 s de fila.
--
-- lock_timeout 3s (mesmo padrão de `20271116000000` e `20271117000100`): se uma
-- transação longa segurar a tabela, o CREATE INDEX não fica na fila travando
-- a escrita de todo mundo atrás dele — aborta limpo, e é só rodar de novo.
-- Aplicar fora do pico matinal (08:00–11:00 BRT).
--
-- Rollback: supabase/migrations/rollback/20271123000000_perf_indices_busca_telefone_e_avisos.sql

BEGIN;

SET LOCAL lock_timeout = '3s';

-- pg_trgm 1.6 já vive em `public` (baseline `20260101000000`, linha 153).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS lead_phones_normalized_phone_trgm_idx
  ON public.lead_phones USING gin (normalized_phone public.gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_recipient_org_recent_idx
  ON public.notifications (user_id, organization_id, last_event_at DESC NULLS LAST);

COMMIT;
