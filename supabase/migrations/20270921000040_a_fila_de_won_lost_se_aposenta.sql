-- A fila de revisão de won/lost se aposenta junto com o papel.
--
-- ── O que sobrou engatilhado ─────────────────────────────────────────────
-- `a_coluna_deixa_de_decidir` tirou `stage_role = won/lost` de 376 etapas. Mas
-- deixou de pé a esteira que os RECOLOCA:
--
--   `classify-stage-roles` sugere won/lost → grava `suggested_stage_role`
--   /master/stage-roles mostra a fila → master aprova → grava `stage_role`
--
-- Medido em prod no momento desta migration: **163 sugestões pendentes**, 86
-- de `won` e 77 de `lost`, nenhuma revisada.
--
-- Aprovar qualquer uma delas hoje reativa `fn_capture_sale_event` naquela
-- etapa. O funil daquela org volta a registrar venda por arrastar, sozinho,
-- em silêncio, contra o modelo que todo o resto do sistema passou a seguir.
--
-- Não é hipótese: uma etapa nasceu com papel `lost` pela tela horas depois de
-- a fatia anterior subir.
--
-- ── O conserto tem três pontas, e esta é a do dado ───────────────────────
-- 1. O classifier para de sugerir won/lost (edge function, mesmo commit).
-- 2. A tela do master para de oferecer won/lost como correção (front, idem).
-- 3. Esta migration encerra as 163 que já estão na fila.
--
-- Sem a 3, a fila continuaria mostrando 163 itens que ninguém pode mais
-- aprovar — a definição de tela morta.
--
-- ── Encerrar, não apagar ─────────────────────────────────────────────────
-- `suggested_stage_role` vai a NULL e `stage_role_reviewed_at` recebe `now()`:
-- a fila esvazia porque foi RESOLVIDA, não porque o registro sumiu.
--
-- `stage_role_suggestion_source` fica INTOCADA. A primeira versão desta
-- migration escrevia 'encerrada_b2d' nela e foi recusada pela CHECK
-- `pipeline_stages_suggestion_source_valid` (aceita deterministic | ai | flag).
-- A CHECK tem razão: a coluna registra QUEM SUGERIU, e isso continua sendo
-- verdade — 'ai' sugeriu, e sugeriu mesmo. Quem encerrou é outra pergunta, e
-- sobrecarregar a coluna para responder as duas seria a mesma troca de
-- vocabulário que já custou quatro bugs de produção neste trabalho.
--
-- A procedência do encerramento é esta migration e a linha dela no ledger.
--
-- ⚠️ NÃO toca em `stage_role`. Nenhuma etapa muda de papel aqui: a
-- 20270921000030 já zerou os papéis de dinheiro, e o que esta faz é impedir
-- que voltem.
--
-- Reaplicar é no-op: o predicado exige sugestão de dinheiro ainda pendente.

UPDATE public.pipeline_stages
   SET suggested_stage_role = NULL,
       stage_role_reviewed_at = COALESCE(stage_role_reviewed_at, now())
 WHERE suggested_stage_role IN ('won', 'lost');

DO $$
DECLARE v_restam integer; v_papel integer; v_reuniao integer;
BEGIN
  SELECT count(*) INTO v_restam FROM public.pipeline_stages
   WHERE suggested_stage_role IN ('won','lost');
  IF v_restam > 0 THEN
    RAISE EXCEPTION '% sugestao(oes) de dinheiro continuam na fila', v_restam;
  END IF;

  -- A migration anterior zerou os papéis; esta não pode ter reintroduzido um.
  SELECT count(*) INTO v_papel FROM public.pipeline_stages
   WHERE stage_role IN ('won','lost');
  IF v_papel > 0 THEN
    RAISE EXCEPTION '% etapa(s) voltaram a ter papel de dinheiro', v_papel;
  END IF;

  -- E os papéis de reunião seguem intocados: eles continuam sendo sugeridos e
  -- auto-aplicados pelo classifier, que é o comportamento que fica.
  SELECT count(*) INTO v_reuniao FROM public.pipeline_stages
   WHERE stage_role IN ('meeting_booked','meeting_held');
  RAISE NOTICE 'papeis de reuniao preservados: %', v_reuniao;
END $$;
