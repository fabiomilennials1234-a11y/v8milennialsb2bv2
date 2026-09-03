-- 20270917000000_campanha_e_disparo_por_pipeline_id.sql — Fatia B (épico Funil é Funil — campanhas e disparos)
--
-- Campanha e Disparo apontam pra QUALQUER funil por (pipeline_id, stage_id) —
-- o trio de sistema deixa de ser especial no destino (D1/D4). Os formatos
-- legados (objective/free_target_pipe em `campanhas`, funnelKind/pipelineType
-- nos JSONB de `blast_plans`) continuam ACEITOS NA LEITURA PRA SEMPRE; este
-- arquivo só acrescenta a forma canônica e backfilla o que já existe.
--
-- Numeração: topo do ledger de prod em 2026-09-02 é 20270916000010 (8
-- migrations acima do repo desta worktree — fantasmas de outras branches:
-- 20270909000010/001010, 20270908005010/005020, 20270910000000,
-- 2027091400000{0,10,20}, 2027091[56]…). Por isso 20270917, não 20270910.
--
-- Fatos medidos em prod 2026-09-02 que sustentam este arquivo:
--   • `campanhas`: 12 linhas, todas ativas. objective: qualificacao=4,
--     agendamentos=1, livre=7 (3 com free_target_pipe='pipe_propostas'/
--     free_target_stage='proposta_enviada', 4 sem destino). As 8 com destino
--     derivável resolvem 8/8 em (org, slug) → pipelines e 8/8 em
--     (pipeline_id, stage_key, is_active) → pipeline_stages.
--   • Mapa legado hardcodado no front (OBJECTIVE_TARGET_MAP de useCampanhas):
--     qualificacao→(whatsapp,'novo'), agendamentos→(confirmacao,
--     'reuniao_marcada'), propostas→(propostas,'marcar_compromisso').
--   • `pipelines.config` dos 79 funis custom: objective_pipe_type e
--     objective_stage_key = 0 usos (já medido na 20270908001000) — nada a
--     backfillar do lado custom.
--   • `blast_plans`: 5 linhas (3 completed/cancelled com source
--     funnelKind='system'+pipelineType='whatsapp', 2 antigas sem funnelKind —
--     também whatsapp por stageKey). post_send_target: 2 linhas, ambas
--     {funnelKind:'system', pipelineType:'whatsapp', stageKey:'abordado'}.
--     0 linhas custom em source OU post_send_target.
--   • slug é único por org (0 duplicatas, medido na 20270908003000) →
--     resolução por (org, slug) sem predicado de type é determinística.
--
-- check-metric-antipatterns: nenhum allow novo — não há predicado
-- type='system' (resolução é por slug), não há COALESCE de atribuição, não há
-- updated_at como âncora, não há SUM de valor de venda.
--
-- Rollback pareado: supabase/migrations/rollback/20270917000000_*.sql
-- Ensaio abortável: scripts/ensaio-funis-fatia-b.sh (BEGIN → migration → asserções
-- → ROLLBACK, contra prod via prod-sql.mjs).

-- ────────────────────────────────────────────────────────────────────────────
-- §1 · campanhas — destino canônico por (target_pipeline_id, target_stage_id)
-- ────────────────────────────────────────────────────────────────────────────
-- ON DELETE SET NULL: funil deletado não pode travar a exclusão nem deixar FK
-- pendurada; a campanha volta a resolver pelo formato legado (ou a nada, se o
-- legado também não resolver — mesmo comportamento de hoje pra 'livre' vazio).
-- Sem índice nas FKs de propósito: `campanhas` tem 12 linhas e o custo do
-- scan no DELETE do funil é menor que dois índices permanentes.

ALTER TABLE public.campanhas
  ADD COLUMN IF NOT EXISTS target_pipeline_id uuid
    REFERENCES public.pipelines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_stage_id uuid
    REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.campanhas.target_pipeline_id IS
  'Funil de destino da extração de leads (canônico, Fatia B). NULL = resolver pelo formato legado (objective/free_target_pipe) ou sem destino.';
COMMENT ON COLUMN public.campanhas.target_stage_id IS
  'Etapa de destino da extração (pipeline_stages.id). Anda junto com target_pipeline_id.';

-- Backfill one-shot do formato legado por (org, slug) + stage_key ativa.
-- O predicado do UPDATE é a própria guarda (só escreve o que resolve inteiro
-- e na MESMA org); linhas irresolvíveis ficam NULL e seguem no caminho legado.
WITH alvo AS (
  SELECT
    c.id AS campanha_id,
    p.id AS pipeline_id,
    ps.id AS stage_id
  FROM public.campanhas c
  JOIN public.pipelines p
    ON p.organization_id = c.organization_id
   AND p.slug = CASE c.objective
                  WHEN 'qualificacao'  THEN 'whatsapp'
                  WHEN 'agendamentos'  THEN 'confirmacao'
                  WHEN 'propostas'     THEN 'propostas'
                  WHEN 'livre'         THEN replace(c.free_target_pipe, 'pipe_', '')
                END
  JOIN public.pipeline_stages ps
    ON ps.pipeline_id = p.id
   AND ps.is_active
   AND ps.stage_key = CASE c.objective
                        WHEN 'qualificacao'  THEN 'novo'
                        WHEN 'agendamentos'  THEN 'reuniao_marcada'
                        WHEN 'propostas'     THEN 'marcar_compromisso'
                        WHEN 'livre'         THEN c.free_target_stage
                      END
  WHERE c.target_pipeline_id IS NULL
)
UPDATE public.campanhas c
   SET target_pipeline_id = a.pipeline_id,
       target_stage_id    = a.stage_id
  FROM alvo a
 WHERE c.id = a.campanha_id;

-- ────────────────────────────────────────────────────────────────────────────
-- §2 · blast_plans — funil do público por pipeline_id (coluna) + chaves
--      canônicas ADITIVAS nos JSONB legados
-- ────────────────────────────────────────────────────────────────────────────
-- `pipeline_id` NULLABLE por semântica: público de planilha, "todos os funis"
-- e planos antigos irresolvíveis não têm UM funil de origem.

ALTER TABLE public.blast_plans
  ADD COLUMN IF NOT EXISTS pipeline_id uuid
    REFERENCES public.pipelines(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.blast_plans.pipeline_id IS
  'Funil de origem do público (canônico, Fatia B). NULL = público sem funil único (planilha, todos os funis, plano legado irresolvível).';

-- Backfill da coluna a partir do descriptor legado:
--   · funnelKind='custom'  → source->>'pipelineId' (uuid direto, validado por org)
--   · funnelKind='system' OU descriptor antigo sem funnelKind (context='disparo'
--     + stageKey, todos whatsapp em prod) → (org, slug)
UPDATE public.blast_plans b
   SET pipeline_id = p.id
  FROM public.pipelines p
 WHERE b.pipeline_id IS NULL
   AND p.organization_id = b.organization_id
   AND (
         (b.source->>'funnelKind' = 'custom'
          AND (b.source->>'pipelineId') ~ '^[0-9a-fA-F-]{36}$'
          AND p.id = (b.source->>'pipelineId')::uuid)
      OR ((b.source->>'funnelKind' = 'system' OR b.source->>'funnelKind' IS NULL)
          AND b.source->>'context' = 'disparo'
          AND b.source ? 'stageKey'
          AND p.slug = COALESCE(b.source->>'pipelineType', 'whatsapp'))
       )
   AND COALESCE(b.source->>'funnelKind', 'system') <> 'all';

-- pipelineId ADITIVO nos JSONB legados de forma que leitores novos resolvam
-- id-first sem tabela de tradução. Chaves legadas preservadas intactas
-- (aceitas na leitura pra sempre). Marcador 'backfilled_pipeline_id' separa o
-- one-shot de escrita nova (e é o que o rollback usa pra desfazer só o dele).
UPDATE public.blast_plans b
   SET source = b.source
              || jsonb_build_object('pipelineId', b.pipeline_id::text)
              || '{"backfilled_pipeline_id": true}'::jsonb
 WHERE b.pipeline_id IS NOT NULL
   AND b.source IS NOT NULL
   AND NOT (b.source ? 'pipelineId');

UPDATE public.blast_plans b
   SET post_send_target = b.post_send_target
              || jsonb_build_object('pipelineId', p.id::text)
              || '{"backfilled_pipeline_id": true}'::jsonb
  FROM public.pipelines p
 WHERE b.post_send_target IS NOT NULL
   AND NOT (b.post_send_target ? 'pipelineId')
   AND b.post_send_target->>'funnelKind' = 'system'
   AND p.organization_id = b.organization_id
   AND p.slug = b.post_send_target->>'pipelineType';

-- ────────────────────────────────────────────────────────────────────────────
-- §3 · Asserções — consistência, não contagem fixa (a janela pode rodar com
--      dados mais novos que a medição)
-- ────────────────────────────────────────────────────────────────────────────
DO $assert$
DECLARE
  v_cross_org integer;
  v_stage_fora integer;
  v_perdida integer;
  v_bp_cross integer;
  v_bp_perdida integer;
BEGIN
  -- A1: nenhum destino de campanha aponta funil/etapa de OUTRA org.
  SELECT count(*) INTO v_cross_org
    FROM public.campanhas c
    JOIN public.pipelines p ON p.id = c.target_pipeline_id
   WHERE p.organization_id <> c.organization_id;
  IF v_cross_org > 0 THEN
    RAISE EXCEPTION 'FATIA-B A1: % campanha(s) com target_pipeline_id de outra org', v_cross_org;
  END IF;

  -- A2: target_stage_id sempre pertence ao target_pipeline_id.
  SELECT count(*) INTO v_stage_fora
    FROM public.campanhas c
    JOIN public.pipeline_stages ps ON ps.id = c.target_stage_id
   WHERE ps.pipeline_id IS DISTINCT FROM c.target_pipeline_id;
  IF v_stage_fora > 0 THEN
    RAISE EXCEPTION 'FATIA-B A2: % campanha(s) com etapa que não pertence ao funil de destino', v_stage_fora;
  END IF;

  -- A3: o backfill não deixou pra trás nenhuma campanha cujo destino legado
  -- RESOLVE (funil por slug + etapa ativa na org) — se sobrou, o UPDATE errou.
  SELECT count(*) INTO v_perdida
    FROM public.campanhas c
    JOIN public.pipelines p
      ON p.organization_id = c.organization_id
     AND p.slug = CASE c.objective
                    WHEN 'qualificacao' THEN 'whatsapp'
                    WHEN 'agendamentos' THEN 'confirmacao'
                    WHEN 'propostas'    THEN 'propostas'
                    WHEN 'livre'        THEN replace(c.free_target_pipe, 'pipe_', '')
                  END
    JOIN public.pipeline_stages ps
      ON ps.pipeline_id = p.id AND ps.is_active
     AND ps.stage_key = CASE c.objective
                          WHEN 'qualificacao' THEN 'novo'
                          WHEN 'agendamentos' THEN 'reuniao_marcada'
                          WHEN 'propostas'    THEN 'marcar_compromisso'
                          WHEN 'livre'        THEN c.free_target_stage
                        END
   WHERE c.target_pipeline_id IS NULL;
  IF v_perdida > 0 THEN
    RAISE EXCEPTION 'FATIA-B A3: % campanha(s) com destino legado resolvível ficaram sem backfill', v_perdida;
  END IF;

  -- A4: nenhum blast_plan aponta funil de outra org.
  SELECT count(*) INTO v_bp_cross
    FROM public.blast_plans b
    JOIN public.pipelines p ON p.id = b.pipeline_id
   WHERE p.organization_id <> b.organization_id;
  IF v_bp_cross > 0 THEN
    RAISE EXCEPTION 'FATIA-B A4: % blast_plan(s) com pipeline_id de outra org', v_bp_cross;
  END IF;

  -- A5: todo blast_plan com descriptor de funil ÚNICO resolvível ganhou a
  -- coluna (system por slug; custom por uuid; 'all'/planilha ficam NULL).
  SELECT count(*) INTO v_bp_perdida
    FROM public.blast_plans b
    JOIN public.pipelines p
      ON p.organization_id = b.organization_id
     AND (
           (b.source->>'funnelKind' = 'custom'
            AND (b.source->>'pipelineId') ~ '^[0-9a-fA-F-]{36}$'
            AND p.id = (b.source->>'pipelineId')::uuid)
        OR ((b.source->>'funnelKind' = 'system' OR b.source->>'funnelKind' IS NULL)
            AND b.source->>'context' = 'disparo'
            AND b.source ? 'stageKey'
            AND p.slug = COALESCE(b.source->>'pipelineType', 'whatsapp'))
         )
   WHERE b.pipeline_id IS NULL
     AND COALESCE(b.source->>'funnelKind', 'system') <> 'all';
  IF v_bp_perdida > 0 THEN
    RAISE EXCEPTION 'FATIA-B A5: % blast_plan(s) com funil resolvível ficaram sem pipeline_id', v_bp_perdida;
  END IF;
END
$assert$;
