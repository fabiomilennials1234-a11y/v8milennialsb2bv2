-- ROLLBACK de 20270805000010_aposenta_funis_de_carteira.sql
--
-- SCRUM-248. A migration aposenta os funis de carteira (ADR-0023 §8) em três
-- blocos: NULLifica os ponteiros de transição que apontavam para lá, desativa as
-- etapas de `upsell_base`/`upsell_gestao`, e reescreve
-- `create_default_pipeline_stages` para parar de provisioná-los.
--
-- ── POR QUE ESTE ARQUIVO EXISTE, E POR QUE ELE SÓ FOI POSSÍVEL DEPOIS ──────
-- O cabeçalho da migration dizia, até 07/08: "reverter é `is_active = true` nas
-- mesmas linhas". Não era. O bloco 1 apaga `target_pipe_type`, que é o PRÓPRIO
-- predicado que seleciona as linhas — depois do apply não sobra coluna dizendo
-- quais etapas apontavam para a carteira nem para onde apontavam. Reativar sem
-- restaurar o ponteiro produziria um TERCEIRO estado: etapas vivas apontando
-- para lugar nenhum.
--
-- Por isso o conserto foi na origem, não aqui: a migration ganhou um bloco 0 que
-- grava `backup_aposenta_funis_carteira` antes de tocar qualquer linha. Este
-- rollback é a leitura desse backup. **Sem ele, não há rollback** — e é isso que
-- a seção 0 verifica antes de qualquer escrita.
--
-- 🔴 SE VOCÊ APLICOU A MIGRATION EM UMA VERSÃO ANTERIOR A 07/08 (sem o bloco 0),
-- este arquivo aborta e não tem o que fazer. A reconstrução, nesse caso, sai de
-- fora do banco: um dump anterior ao apply, ou a configuração que cada org tinha.
-- Não existe caminho de dentro.
--
-- ⚠️ O QUE ESTE ROLLBACK **NÃO** RESTAURA, e é a parte que ninguém espera:
-- as regras de Copilot. `on_pipeline_stage_removed` (AFTER UPDATE) trata
-- `is_active` true→false como remoção e DELETA `copilot_agent_kanban_rules`
-- daquela etapa, além de podar `active_stages` e `move_rules` dos agentes.
-- Reativar dispara `on_pipeline_stage_created`, que recria uma regra GENÉRICA
-- com `needs_review = true` — **não** a que a org tinha escrito.
--
-- Isso é assimétrico de propósito e mede-se antes: a própria migration aborta se
-- houver regra de carteira configurada no momento do apply (medido em prod
-- 2026-08-05: 0 regras de kanban, 0 move_rules, 1 agente com pipe de carteira em
-- `active_pipes`). Ou seja, se a migration passou, não havia regra para perder.
-- A seção 3 abaixo reconta e avisa se o cenário mudou.
--
-- ⚠️ E O QUE ELE RE-INTRODUZ: os funis de carteira voltam a existir e a aparecer
-- para o usuário. Se o backfill `scripts/backfill-carteira-negocios` já tiver
-- rodado, os pedidos de ERP viraram Negócios ganhos nos funis normais E os funis
-- de carteira estarão de volta — as duas leituras convivendo. Rodar este
-- rollback depois daquele backfill exige decidir qual das duas é a verdade; o
-- rollback não decide por você.

BEGIN;

-- ── 0. O backup existe? ─────────────────────────────────────────────────────
DO $$
DECLARE v_existe boolean; v_n bigint;
BEGIN
  SELECT to_regclass('public.backup_aposenta_funis_carteira') IS NOT NULL INTO v_existe;

  IF NOT v_existe THEN
    RAISE EXCEPTION
      'ABORTADO: backup_aposenta_funis_carteira não existe. Ou a migration nunca rodou neste banco (nada a reverter), ou rodou numa versão anterior a 2026-08-07, que apagava os ponteiros sem guardá-los. No segundo caso NÃO HÁ caminho de reversão de dentro do banco — a fonte é um dump anterior ao apply.'
      USING ERRCODE = 'undefined_table';
  END IF;

  SELECT count(*) INTO v_n FROM public.backup_aposenta_funis_carteira;
  IF v_n = 0 THEN
    RAISE NOTICE 'Backup existe e está vazio: o apply não alterou linha nenhuma. Rollback será inerte.';
  ELSE
    RAISE NOTICE 'Backup com % linha(s). Restaurando.', v_n;
  END IF;
END $$;

-- ── 1. Os ponteiros de transição ────────────────────────────────────────────
-- Só as linhas que TINHAM ponteiro. As outras entraram no backup por causa do
-- `is_active` e não devem ter `target_*` reescrito.
UPDATE public.pipeline_stages ps
   SET target_pipe_type  = b.target_pipe_type_antes,
       target_stage_key  = b.target_stage_key_antes,
       is_final_positive = b.is_final_positive_antes
  FROM public.backup_aposenta_funis_carteira b
 WHERE ps.id = b.stage_id
   AND b.tinha_ponteiro;

-- ── 2. As etapas ────────────────────────────────────────────────────────────
-- ⚠️ Este UPDATE dispara `on_pipeline_stage_created` nas linhas reativadas — ver
-- o aviso do cabeçalho sobre as regras genéricas com `needs_review = true`.
-- Só as que ESTE apply desativou; etapa que já estava inativa antes continua.
UPDATE public.pipeline_stages ps
   SET is_active = true
  FROM public.backup_aposenta_funis_carteira b
 WHERE ps.id = b.stage_id
   AND b.foi_desativada
   AND NOT ps.is_active;

-- ── 3. Verificação ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_ponteiro_faltando bigint;
  v_inativa_faltando  bigint;
  v_regras_genericas  bigint;
BEGIN
  SELECT count(*) INTO v_ponteiro_faltando
    FROM public.backup_aposenta_funis_carteira b
    JOIN public.pipeline_stages ps ON ps.id = b.stage_id
   WHERE b.tinha_ponteiro
     AND ps.target_pipe_type IS DISTINCT FROM b.target_pipe_type_antes;

  SELECT count(*) INTO v_inativa_faltando
    FROM public.backup_aposenta_funis_carteira b
    JOIN public.pipeline_stages ps ON ps.id = b.stage_id
   WHERE b.foi_desativada AND NOT ps.is_active;

  IF v_ponteiro_faltando <> 0 THEN
    RAISE EXCEPTION 'FAIL: % etapa(s) com ponteiro não restaurado. Provável linha deletada de pipeline_stages depois do apply.', v_ponteiro_faltando;
  END IF;
  IF v_inativa_faltando <> 0 THEN
    RAISE EXCEPTION 'FAIL: % etapa(s) seguem inativas depois do rollback.', v_inativa_faltando;
  END IF;

  -- O custo assimétrico, contado: regras que o trigger recriou no lugar das que
  -- a org tinha escrito. Não é erro — é o preço, e quem reverteu precisa saber.
  SELECT count(*) INTO v_regras_genericas
    FROM public.copilot_agent_kanban_rules
   WHERE pipe_type IN ('upsell_base','upsell_gestao')
     AND COALESCE(needs_review, false);

  RAISE NOTICE 'ROLLBACK OK: ponteiros e etapas de carteira restaurados a partir do backup.';

  IF v_regras_genericas > 0 THEN
    RAISE WARNING
      '% regra(s) de kanban de carteira com needs_review = true — recriadas GENÉRICAS por on_pipeline_stage_created, não são as que a org tinha. Um humano precisa revisá-las.',
      v_regras_genericas;
  END IF;

  RAISE NOTICE
    'NÃO restaurado por este arquivo: o corpo anterior de create_default_pipeline_stages (bloco 3 da migration). Ele está em supabase/migrations/20260101000000_baseline_prod_schema.sql — reponha por CREATE OR REPLACE se a reversão precisar voltar a provisionar funil de carteira em org nova.';
END $$;

COMMIT;
