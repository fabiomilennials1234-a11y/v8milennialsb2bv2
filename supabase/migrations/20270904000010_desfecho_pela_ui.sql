-- 20270904000010_desfecho_pela_ui.sql
--
-- A porta do humano para o desfecho. `20270904000000` deu ao NEGÓCIO um
-- desfecho próprio e destravou a ação de workflow; a tela continuou movendo o
-- card para a etapa terminal.
--
-- O QUE ISSO CUSTAVA NA TELA
--
-- Os botões "Ganhou"/"Perdeu" do card só apareciam quando o funil tinha etapa
-- de papel `won`/`lost` — o comentário no `DealCard.tsx` dizia, corretamente,
-- que "botão que não tem para onde ir mente". Medido em 2026-08-28: **283 dos
-- 396 funis ativos (71%) não têm etapa `won`**. Em quase três quartos dos
-- funis, o vendedor não tinha botão nenhum para dizer que vendeu.
--
-- POR QUE UMA RPC, E NÃO UM `UPDATE` DO CLIENTE
--
-- Três razões, e a terceira é a que decide:
--
--   1. `deals.outcome` não existe em `types.ts` até o apply + `gen types`. Um
--      `.update({ outcome })` no cliente não compila hoje.
--   2. A transição de `outcome` é o que grava no caderno de vendas. Deixar o
--      cliente escrever direto significa que qualquer chamada malformada vira
--      evento de venda — e o caderno é append-only (ADR-0017 §4).
--   3. 26,6% das entradas não têm linha em `deals`. Materializar do cliente
--      seriam duas chamadas sem transação entre elas: dá para criar o negócio e
--      falhar ao decidir, deixando lixo.
--
-- A RPC recebe a ENTRADA, não o negócio, porque é o que a tela tem em mãos e é
-- o que permite materializar. Mesma escolha da ação de workflow.
--
-- AUTORIZAÇÃO
--
-- `SECURITY DEFINER` + `assert_org_access` da organização DA ENTRADA. Sem isso
-- a função seria um IDOR: qualquer autenticado fecharia a venda de qualquer
-- organização passando um uuid. O `assert` roda ANTES de qualquer escrita.
--
-- ROLLBACK pareado: rollback/20270904000010_desfecho_pela_ui.sql

CREATE OR REPLACE FUNCTION public.definir_desfecho_da_entrada(
  p_entry_id uuid,
  p_outcome text,
  p_loss_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_org uuid; v_deal_id uuid; v_atual text;
BEGIN
  IF p_outcome NOT IN ('open', 'won', 'lost') THEN
    RAISE EXCEPTION 'desfecho % inválido', p_outcome USING ERRCODE = '22023';
  END IF;

  SELECT pe.organization_id, pe.deal_id INTO v_org, v_deal_id
    FROM public.pipeline_entries pe WHERE pe.id = p_entry_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'entrada % não existe', p_entry_id USING ERRCODE = '22023';
  END IF;

  -- ANTES de escrever. Uma função DEFINER sem esta linha fecha a venda de
  -- qualquer organização para quem souber um uuid.
  PERFORM public.assert_org_access(v_org);

  IF v_deal_id IS NULL THEN
    v_deal_id := public.garantir_negocio_da_entrada(p_entry_id);
  END IF;

  SELECT d.outcome INTO v_atual FROM public.deals d WHERE d.id = v_deal_id;

  -- Idempotente por escolha, não por economia: escrever o desfecho que já vale
  -- dispara a transição, e a transição é o que grava em `sale_events`. Um
  -- duplo-clique viraria duas vendas que ninguém consegue apagar.
  IF v_atual IS NOT DISTINCT FROM p_outcome THEN
    RETURN jsonb_build_object('deal_id', v_deal_id, 'outcome', v_atual, 'idempotent', true);
  END IF;

  UPDATE public.deals
     SET outcome = p_outcome,
         outcome_source = 'ui',
         outcome_at = now(),
         loss_reason = CASE
           WHEN p_outcome = 'lost' AND NULLIF(btrim(COALESCE(p_loss_reason, '')), '') IS NOT NULL
             THEN btrim(p_loss_reason)
           ELSE loss_reason
         END
   WHERE id = v_deal_id
     AND organization_id = v_org
     -- Trava de concorrência: se outro caminho (etapa, workflow) decidiu entre
     -- a leitura e esta escrita, nenhuma linha é pega e nada vai ao caderno.
     AND outcome IS NOT DISTINCT FROM v_atual;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deal_id', v_deal_id, 'outcome', v_atual, 'idempotent', true);
  END IF;

  RETURN jsonb_build_object('deal_id', v_deal_id, 'outcome', p_outcome, 'idempotent', false);
END;
$$;

COMMENT ON FUNCTION public.definir_desfecho_da_entrada(uuid, text, text) IS
  'Marca ganho/perda a partir da ENTRADA, materializando o negócio se faltar. Porta do humano; a de workflow é win_deal/lose_deal.';

-- ===========================================================================
-- GRANTS + GUARDA
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public.definir_desfecho_da_entrada(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.definir_desfecho_da_entrada(uuid, text, text) TO authenticated, service_role;

DO $guard$
DECLARE
  v_fn regprocedure := 'public.definir_desfecho_da_entrada(uuid, text, text)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: anon executa % — fecharia venda sem sessão', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated NÃO executa % — a tela não funciona', v_fn;
  END IF;
  -- DEFINER sem checagem de organização é IDOR. A asserção é textual porque é
  -- a única forma de provar, no apply, que a linha não sumiu num refactor.
  IF position('assert_org_access' IN pg_get_functiondef(v_fn)) = 0 THEN
    RAISE EXCEPTION 'GUARDA: % é SECURITY DEFINER e não chama assert_org_access', v_fn;
  END IF;
END
$guard$;
