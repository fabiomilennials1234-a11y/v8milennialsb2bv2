-- ROLLBACK de 20270803000010_deals_drop_position_columns.sql
--
-- SCRUM-248. A migration faz `ALTER TABLE public.deals DROP COLUMN pipeline_id`
-- e `DROP COLUMN stage_id` (levando junto `idx_deals_pipeline`, `idx_deals_stage`
-- e a FK `deals_stage_id_fkey`). A posição do Negócio passa a viver só em
-- `pipeline_entries`.
--
-- 🔴 DROP COLUMN É IRREVERSÍVEL PARA O CONTEÚDO. Este arquivo recria a FORMA —
-- colunas, índices e FK, idênticos ao baseline. Ele NÃO recria o que estava
-- dentro delas, porque isso não existe mais em lugar nenhum do banco.
--
-- E ISSO É ACEITÁVEL AQUI, por uma razão medida e só por ela: a migration ABORTA
-- se houver qualquer linha com `pipeline_id` ou `stage_id` preenchido (guarda na
-- seção 0 dela; medido em prod 2026-08-03 = 0 linhas). Ou seja, ela só roda sobre
-- colunas VAZIAS, e recriar coluna vazia devolve o estado exato. Se alguém
-- afrouxar aquela guarda, esta afirmação morre junto e este rollback passa a ser
-- perda de dado silenciosa — a seção 3 abaixo é o que impede isso de passar
-- despercebido.
--
-- QUANDO PRECISA: a janela do SCRUM-243. `origin/main` — o que roda em produção
-- hoje — tem 8 arquivos usando `useDeals`, incluindo `pages/Negocios.tsx`,
-- `CreateDealDialog`, `DealDetailDrawer`, `DealKanbanCard` e `DealKPICards`, e
-- `useDeals.ts:104` filtra por `pipeline_id`. Aplicar o DROP antes de o front
-- novo chegar em main quebra a rota `/negocios` e os diálogos de negócio da
-- Carteira com erro de coluna inexistente vindo do PostgREST. Se o DROP for
-- aplicado cedo demais, este arquivo é o desfazer — e ele é barato justamente
-- porque as colunas estão vazias.
--
-- A ORDEM CERTA (e que dispensa este rollback) está no SCRUM-243: aplicar o lote
-- SEM esta migration → deployar as edge functions → mergear develop→main (o front
-- sobe sozinho pelo webhook do EasyPanel) → verificar → e só então aplicar o DROP
-- num segundo push.

BEGIN;

-- ── 1. As duas colunas ──────────────────────────────────────────────────────
-- Tipos e nulabilidade verbatim do baseline
-- (`20260101000000_baseline_prod_schema.sql`, CREATE TABLE "public"."deals"):
-- ambas `uuid` NULL, sem default. `IF NOT EXISTS` para o arquivo ser
-- re-executável e para não quebrar num banco onde o DROP nunca chegou a rodar.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS pipeline_id uuid;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS stage_id    uuid;

-- ── 2. Índices e FK que caíram junto com as colunas ─────────────────────────
-- Os dois índices são PARCIAIS no baseline (`WHERE ... IS NOT NULL`) — recriar
-- sem o predicado mudaria o objeto, então o predicado vai junto.
--
-- Sem CONCURRENTLY porque este arquivo é transacional. Sobre colunas recém-criadas
-- (todas NULL) o índice parcial nasce vazio e o build é instantâneo — o lock não
-- é preocupação real aqui, ao contrário do rollback de `deal_por_lead_destrava`.
CREATE INDEX IF NOT EXISTS idx_deals_pipeline
  ON public.deals USING btree (pipeline_id) WHERE (pipeline_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_deals_stage
  ON public.deals USING btree (stage_id) WHERE (stage_id IS NOT NULL);

-- `ON DELETE SET NULL` verbatim do baseline (:34589). `IF NOT EXISTS` não existe
-- para ADD CONSTRAINT, daí o bloco.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.deals'::regclass AND conname = 'deals_stage_id_fkey'
  ) THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_stage_id_fkey FOREIGN KEY (stage_id)
      REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;
  END IF;
END$$;

-- ── 3. Verificação (aborta) ─────────────────────────────────────────────────
DO $$
DECLARE v_cols int; v_idx int; v_fk int; v_preenchidas bigint;
BEGIN
  SELECT count(*) INTO v_cols FROM pg_attribute
   WHERE attrelid = 'public.deals'::regclass
     AND attname IN ('pipeline_id','stage_id') AND NOT attisdropped;
  IF v_cols <> 2 THEN
    RAISE EXCEPTION 'FAIL: esperava as 2 colunas de posição de volta, achei %.', v_cols;
  END IF;

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'deals'
     AND indexname IN ('idx_deals_pipeline','idx_deals_stage');
  IF v_idx <> 2 THEN
    RAISE EXCEPTION 'FAIL: esperava os 2 índices de posição de volta, achei %.', v_idx;
  END IF;

  SELECT count(*) INTO v_fk FROM pg_constraint
   WHERE conrelid = 'public.deals'::regclass AND conname = 'deals_stage_id_fkey';
  IF v_fk <> 1 THEN
    RAISE EXCEPTION 'FAIL: deals_stage_id_fkey não voltou.';
  END IF;

  -- A asserção honesta sobre o limite deste rollback: as colunas voltam VAZIAS,
  -- e isso só é equivalente ao estado anterior porque a migration recusava rodar
  -- com elas preenchidas. Se este número não for 0, alguém preencheu DEPOIS do
  -- rollback (ok) — mas se a guarda da migration tiver sido afrouxada, o dado
  -- que existia antes do DROP não está aqui e não volta.
  SELECT count(*) INTO v_preenchidas FROM public.deals
   WHERE pipeline_id IS NOT NULL OR stage_id IS NOT NULL;

  RAISE NOTICE
    'ROLLBACK OK: deals.pipeline_id e deals.stage_id de volta (uuid NULL), + idx_deals_pipeline, idx_deals_stage e deals_stage_id_fkey. As colunas voltam VAZIAS — % linha(s) preenchida(s) agora. Isso equivale ao estado anterior SOMENTE porque a migration abortava com qualquer linha preenchida (medido em prod 2026-08-03: 0). O conteúdo de um DROP COLUMN não volta.',
    v_preenchidas;
END$$;

COMMIT;
