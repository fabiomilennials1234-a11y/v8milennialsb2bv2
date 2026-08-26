-- 20270830000020_meetings_pipeline_id.sql
--
-- A reunião passa a lembrar DE QUAL FUNIL o lead foi escolhido.
--
-- POR QUE UMA COLUNA, E NÃO DERIVAR DO LEAD NA HORA DE REABRIR:
--
--   1. Lead em vários funis é a NORMA, não a exceção — é invariante declarada
--      no CLAUDE.md raiz, em `src/modules/pipelines/CLAUDE.md` e no
--      ADR-0023. `useLeadAllPipelines` existe justamente porque um lead tem N
--      entries, e ele já precisa CHUTAR qual é a "corrente" (aberto antes de
--      fechado, depois o mais recente). Derivar o funil devolveria *um* funil,
--      nunca *o que a pessoa escolheu* — e a tela mentiria sem avisar.
--
--   2. Sair do funil é DELETE FÍSICO. `pipeline_entries` não tem `deleted_at`
--      (nem `custom_pipe_entries`): remover o lead do funil apaga a linha. Uma
--      reunião de ontem reabriria amanhã com o funil vazio, ou pior, com outro
--      funil — mudança silenciosa de dado histórico.
--
-- POR QUE `pipelines(id)` E NÃO `custom_pipelines(id)`:
--   `pipelines` é a UNIÃO — 3 linhas `type='system'` por org (semeadas por
--   `create_default_pipelines()`) mais uma linha `type='custom'` por funil do
--   usuário, espelhada de `custom_pipelines` pelo trigger
--   `trg_sync_custom_pipeline` COM O MESMO uuid. Apontar para cá é o que torna
--   a coluna genérica: um único id serve para funil de sistema e customizado,
--   sem ramificar por espécie — que é exatamente o requisito ("funcionar
--   dinamicamente para todos os funis, sem configuração por funil").
--   Medido no PROD em 2026-08-26: 392 linhas em `pipelines` (315 system + 77
--   custom), e ZERO linhas de `pipeline_entries` órfãs de `pipelines`.
--
-- `ON DELETE SET NULL` e não CASCADE: excluir o funil não pode apagar a agenda
-- da equipe. A reunião sobrevive com o lead intacto e sem funil — que é a
-- verdade do momento, e é o mesmo tratamento que `meetings.lead_id` já recebe
-- (`meetings_lead_id_fkey ... ON DELETE SET NULL`, baseline:35089).
--
-- NULLABLE de propósito: reunião sem lead (e portanto sem funil) continua
-- válida — é o caso "Criar reunião sem funil" do roteiro de teste. Nenhuma
-- linha existente precisa de backfill.
--
-- SÓ SCHEMA — nenhum DML sobre dado de cliente (guarda F4 do CLAUDE.md raiz).
-- Idempotente: pode rodar duas vezes sem estourar.
--
-- 🚨 ORDEM DE DEPLOY: esta migration vai ao PROD **antes** do front. O caminho
-- inverso quebra a criação de reunião INTEIRA (o INSERT manda uma coluna que o
-- banco não conhece → PGRST204), não só o campo novo.
--
-- ⚠️ LACUNA CONHECIDA, HERDADA E NÃO FECHADA AQUI: nada impede
-- `meetings.pipeline_id` (nem `meetings.lead_id`, que já é assim hoje) apontar
-- para um funil de OUTRA organização. O guard genérico
-- `fn_assert_member_same_org()` só inspeciona colunas que apontam
-- `team_members`, e só está anexado a `pipeline_entries`, `custom_pipe_entries`
-- e `leads`. Fechar isso muda a superfície de escrita de `meetings` e é decisão
-- de produto — fica registrado, não resolvido nesta migration. A exposição
-- prática hoje é baixa: a RLS de `leads`/`pipelines` continua escondendo a
-- linha alheia, então o embed volta NULL em vez de vazar.

BEGIN;

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS pipeline_id uuid;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meetings_pipeline_id_fkey'
      AND conrelid = 'public.meetings'::regclass
  ) THEN
    ALTER TABLE public.meetings
      ADD CONSTRAINT meetings_pipeline_id_fkey
      FOREIGN KEY (pipeline_id)
      REFERENCES public.pipelines(id)
      ON DELETE SET NULL;
  END IF;
END
$do$;

-- Parcial: a esmagadora maioria das reuniões não tem funil, e indexar NULL só
-- engorda o índice. Espelha o formato de `idx_meetings_org_lead`.
CREATE INDEX IF NOT EXISTS idx_meetings_org_pipeline
  ON public.meetings (organization_id, pipeline_id)
  WHERE pipeline_id IS NOT NULL;

COMMENT ON COLUMN public.meetings.pipeline_id IS
  'Funil de onde o lead desta reunião foi escolhido. FK -> pipelines(id) '
  '(a UNIÃO system+custom), ON DELETE SET NULL. NULL = reunião sem funil. '
  'Persistida em vez de derivada porque o lead pode estar em vários funis e '
  'sair de um deles é DELETE físico — derivar mudaria dado histórico em '
  'silêncio.';

-- Gabarito — a Management API devolve só o resultado do ÚLTIMO statement.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meetings'
      AND column_name = 'pipeline_id')                        AS coluna_criada,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'meetings_pipeline_id_fkey')              AS fk_criada,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_meetings_org_pipeline')
                                                              AS indice_criado,
  (SELECT count(*) FROM public.meetings)                      AS reunioes_no_total,
  (SELECT count(*) FROM public.meetings WHERE pipeline_id IS NOT NULL)
                                                              AS reunioes_com_funil;

COMMIT;
