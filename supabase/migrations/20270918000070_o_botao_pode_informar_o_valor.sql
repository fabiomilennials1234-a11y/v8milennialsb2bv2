-- B2c (front) — o botão de ganho passa a poder informar o valor.
--
-- ── A lacuna que isto fecha ──────────────────────────────────────────────
-- A 20270916000010 pôs uma trava no banco: marcar um negócio como ganho sem
-- valor é recusado nas 86 orgs do rollout.
--
-- Mas o botão da UI (`DealCardPanel`) não tem como informar o valor. Ele chama
-- `definir_desfecho_da_entrada` e, quando a trava dispara, faz
-- `throw new Error(error.message)` — a mensagem do Postgres vira toast e o
-- usuário fica sem saída: a tela pede um valor que a tela não deixa digitar.
--
-- Travar sem oferecer o caminho é pior que não travar. Ensina a contornar.
--
-- ── Por que o valor tem de vir POR AQUI, e não numa escrita separada ─────
-- `fn_exige_valor_no_negocio` é BEFORE UPDATE OF outcome. Se o front gravasse
-- o valor num statement e o desfecho noutro, existiria a janela em que o valor
-- está salvo e o fechamento falhou — e, na ordem inversa, nada funcionaria.
--
-- Passando o valor como parâmetro, as duas coisas vivem ou morrem na mesma
-- transação. É a mesma exigência que `useSaleValueGuard` já documenta para o
-- caminho de arrastar: "thread enteredValue into the SAME mutation".
--
-- ── COALESCE, não sobrescrita ────────────────────────────────────────────
-- `value = COALESCE(value, p_valor)`: o parâmetro só PREENCHE lacuna. Um
-- negócio que já tem preço não o perde porque a tela mandou NULL — e a tela
-- manda NULL em todo clique normal, que é a esmagadora maioria.
--
-- ── ⚠️ DROP + CREATE, e os grants ────────────────────────────────────────
-- Acrescentar parâmetro muda a assinatura: `CREATE OR REPLACE` criaria uma
-- SEGUNDA função e a chamada de 3 argumentos ficaria ambígua. Então a antiga
-- é derrubada.
--
-- E DROP zera os grants — EXECUTE volta para PUBLIC. Os grants vigentes
-- (`authenticated=X`, `service_role=X`) são reemitidos explicitamente logo
-- abaixo, e a guarda confere. Sem isso a tela para de fechar negócio, ou pior:
-- anon ganha EXECUTE numa função SECURITY DEFINER.
--
-- Reaplicar é no-op.

DROP FUNCTION IF EXISTS public.definir_desfecho_da_entrada(uuid, text, text);

CREATE OR REPLACE FUNCTION public.definir_desfecho_da_entrada(p_entry_id uuid, p_outcome text, p_loss_reason text DEFAULT NULL::text, p_valor numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         -- O valor entra na MESMA escrita do desfecho. `fn_exige_valor_no_negocio`
         -- é BEFORE UPDATE OF outcome: gravar o valor num statement separado
         -- deixaria a janela em que o valor está salvo e o fechamento falhou —
         -- ou pior, a ordem inversa. Aqui as duas coisas vivem ou morrem juntas.
         --
         -- COALESCE com o valor existente: quem já tem preço informado não o
         -- perde porque a tela mandou NULL. O parâmetro só PREENCHE lacuna.
         value = COALESCE(value, p_valor),
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
$function$
;

-- Grants reemitidos: DROP levou os antigos junto.
--
-- 🚨 REVOKE de PUBLIC NÃO basta. O Supabase mantém
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,
-- authenticated, service_role`, então toda função criada aqui nasce com um
-- grant EXPLÍCITO para `anon` — que `FROM PUBLIC` não alcança.
--
-- A função de 3 argumentos NÃO tinha anon (`{postgres=X,authenticated=X,
-- service_role=X}`): alguém já havia revogado. Sem a linha abaixo, a de 4
-- argumentos entraria em prod com `anon` podendo EXECUTE numa SECURITY
-- DEFINER que fecha venda. A guarda no fim do arquivo pegou isso no ensaio.
REVOKE ALL ON FUNCTION public.definir_desfecho_da_entrada(uuid, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.definir_desfecho_da_entrada(uuid, text, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.definir_desfecho_da_entrada(uuid, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_desfecho_da_entrada(uuid, text, text, numeric) TO service_role;

-- ── Guardas ──────────────────────────────────────────────────────────────
DO $$
DECLARE v_antiga integer; v_nova integer; v_anon boolean; v_auth boolean;
BEGIN
  SELECT count(*) INTO v_antiga FROM pg_proc
   WHERE oid::regprocedure::text = 'definir_desfecho_da_entrada(uuid,text,text)';
  IF v_antiga > 0 THEN
    RAISE EXCEPTION 'a assinatura de 3 argumentos sobreviveu — a chamada ficaria ambigua';
  END IF;

  SELECT count(*) INTO v_nova FROM pg_proc
   WHERE oid::regprocedure::text = 'definir_desfecho_da_entrada(uuid,text,text,numeric)';
  IF v_nova <> 1 THEN
    RAISE EXCEPTION 'a assinatura de 4 argumentos nao existe';
  END IF;

  -- DROP devolve EXECUTE ao PUBLIC, e esta funcao e SECURITY DEFINER.
  SELECT has_function_privilege('anon', 'public.definir_desfecho_da_entrada(uuid,text,text,numeric)', 'EXECUTE'),
         has_function_privilege('authenticated', 'public.definir_desfecho_da_entrada(uuid,text,text,numeric)', 'EXECUTE')
    INTO v_anon, v_auth;
  IF v_anon THEN
    RAISE EXCEPTION 'anon ganhou EXECUTE numa funcao SECURITY DEFINER';
  END IF;
  IF NOT v_auth THEN
    RAISE EXCEPTION 'authenticated perdeu EXECUTE — a tela para de fechar negocio';
  END IF;
END $$;
