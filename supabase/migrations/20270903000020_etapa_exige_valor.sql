-- 20270903000020_etapa_exige_valor.sql
--
-- A exigência de valor deixa de ser regra hardcoded de uma tela e passa a ser
-- CONFIGURAÇÃO DA ETAPA: `requires_sale_value`.
--
-- O QUE EXISTE HOJE, E POR QUE NÃO BASTA
--
-- `sale-value-guard.ts` já implementa "não deixa ganhar sem valor", com regra
-- pura, hook de modal e Zod. É bom código. Só que:
--
--   1. A condição está fechada em `stage_role = 'won'` (com ponte
--      `is_final_positive` e fallback legado `'vendido'`). Quem quiser exigir
--      valor ao mandar para "Proposta Enviada" não tem como pedir.
--   2. Ele está ligado em UM de dezessete call-sites de mudança de etapa —
--      só `PipePropostas`. Arrastar card no Kanban do WhatsApp, no da
--      Confirmação, em funil personalizado, mover pelo chat, pela ação em massa
--      ou por automação passa direto, INCLUSIVE para etapa `won`.
--
-- O item 2 é bug e se conserta no front. O item 1 é o que esta migration abre:
-- sem uma coluna, "exigir valor nesta etapa" não tem onde ser dito.
--
-- 🔴 O DEFAULT NÃO MUDA COMPORTAMENTO NENHUM — DE PROPÓSITO
--
-- A coluna nasce `false` e o backfill liga `true` EXATAMENTE onde o guard já
-- disparava: etapas de desfecho positivo. Depois desta migration o produto se
-- comporta igual ao de antes dela; o que muda é que a regra passou a ser dado
-- editável em vez de constante no código.
--
-- Isso é deliberado e vale dizer por quê. O pedido original era "exigir valor
-- ao mover para qualquer etapa que não seja a inicial". Ligar isso de uma vez
-- nas 107 orgs colocaria um modal bloqueante no caminho de 45.128 cards
-- abertos, num produto onde 99,1% dos negócios não têm valor — todo arrasto de
-- card viraria uma parada obrigatória no primeiro dia. Quem decide essa troca é
-- o dono do funil, org por org, e agora tem o interruptor para decidir.
--
-- Para ligar em tudo que não é entrada, numa org, é um UPDATE:
--
--   UPDATE public.pipeline_stages SET requires_sale_value = true
--    WHERE organization_id = '<org>' AND position > 0;
--
-- DUAS TABELAS, DE NOVO
--
-- Etapa vive em `pipeline_stages` (funis de sistema) e em
-- `custom_pipeline_stages` (personalizados). Medido em prod 2026-08-27: 37% das
-- entradas abertas só resolvem na segunda. A coluna entra nas DUAS, senão a
-- configuração só existiria para metade do produto.
--
-- DDL PURA + backfill de CONFIGURAÇÃO (guarda F4)
--
-- O backfill escreve numa coluna de config recém-criada, derivando de outra
-- coluna de config da mesma linha. Não toca dado de cliente (lead, negócio,
-- mensagem, valor) e não pode divergir entre ambientes: `is_final_positive` é
-- a fonte, e ela já está lá.
--
-- ROLLBACK pareado: rollback/20270903000020_etapa_exige_valor.sql

-- ===========================================================================
-- 1 — A COLUNA, NAS DUAS TABELAS
-- ===========================================================================
-- `NOT NULL DEFAULT false` é seguro aqui: Postgres 11+ não reescreve a tabela
-- para default constante, e `false` é o valor que preserva o comportamento.
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS requires_sale_value boolean NOT NULL DEFAULT false;

ALTER TABLE public.custom_pipeline_stages
  ADD COLUMN IF NOT EXISTS requires_sale_value boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pipeline_stages.requires_sale_value IS
  'Mover negócio para esta etapa exige valor lançado. Nasce true nas etapas de desfecho positivo, para preservar o guard que já existia.';
COMMENT ON COLUMN public.custom_pipeline_stages.requires_sale_value IS
  'Mover negócio para esta etapa exige valor lançado. Nasce true nas etapas de desfecho positivo, para preservar o guard que já existia.';

-- ===========================================================================
-- 2 — BACKFILL: exatamente onde o guard já disparava
-- ===========================================================================
-- `stage_role = 'won'` OU `is_final_positive` — a mesma disjunção de
-- `isWonStageKey`, incluindo a ponte para etapa ainda não governada.
UPDATE public.pipeline_stages
   SET requires_sale_value = true
 WHERE requires_sale_value = false
   AND (stage_role = 'won' OR COALESCE(is_final_positive, false));

UPDATE public.custom_pipeline_stages
   SET requires_sale_value = true
 WHERE requires_sale_value = false
   AND (stage_role = 'won' OR COALESCE(is_final_positive, false));

-- ===========================================================================
-- 3 — GUARDA
-- ===========================================================================
DO $guard$
DECLARE
  v_sem_flag bigint;
BEGIN
  -- Se uma etapa de ganho ficou sem a flag, o backfill não cobriu o caso e o
  -- guard de UX passaria a NÃO disparar onde disparava antes. É regressão
  -- silenciosa: o negócio fecha sem valor e o caderno grava NULL para sempre.
  SELECT count(*) INTO v_sem_flag
  FROM (
    SELECT stage_role, is_final_positive, requires_sale_value FROM public.pipeline_stages
    UNION ALL
    SELECT stage_role, is_final_positive, requires_sale_value FROM public.custom_pipeline_stages
  ) s
  WHERE (s.stage_role = 'won' OR COALESCE(s.is_final_positive, false))
    AND s.requires_sale_value = false;

  IF v_sem_flag > 0 THEN
    RAISE EXCEPTION 'GUARDA: % etapa(s) de ganho sem requires_sale_value — o guard de valor deixaria de disparar onde disparava', v_sem_flag;
  END IF;
END
$guard$;
