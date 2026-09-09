-- 20270919000010_garantir_negocio_valida_a_org.sql
--
-- `garantir_negocio_da_entrada` passa a VALIDAR o acesso à org antes de
-- materializar o Negócio da entrada.
--
-- POR QUE, E POR QUE AGORA
--
-- 🚨 Ela é a ÚNICA das RPCs deste fluxo que é SECURITY DEFINER — portanto
-- bypassa RLS — e a única que não validava org. Medido em prod:
--
--   proname                      security_definer  valida_org  grants
--   garantir_negocio_da_entrada  true              false       authenticated=X
--   abrir_negocio                false             false       authenticated=X
--   mover_negocio                false             false       authenticated=X
--   deal_item_lancar             false             false       authenticated=X
--   deal_item_atualizar          false             false       authenticated=X
--   deal_item_remover            false             false       authenticated=X
--
-- As outras cinco são SECURITY INVOKER: rodam com o privilégio de quem chama,
-- então a RLS de `pipeline_entries`/`deals` já as protege e elas não precisam
-- de checagem própria. Esta não — ela lê a entrada e insere o `deals` com os
-- privilégios do dono da função, sem olhar de quem é a entrada.
--
-- Consequência, hoje, em produção: um usuário autenticado de QUALQUER org pode
-- passar um `p_entry_id` de outra organização e materializar um Negócio lá
-- dentro. Não vaza leitura (o retorno é só o uuid do `deals` criado), mas
-- escreve na org alheia — é falha de integridade multi-tenant, não de sigilo.
--
-- ⚠ A brecha JÁ EXISTE e é anterior a esta fatia. O que muda é que o
-- "+ Adicionar produto" passa a chamá-la a partir do painel, em todo card sem
-- Negócio, então a porta sai de "só edge function e backfill" para "toda a
-- base clicando". Alargar o uso sem fechar a checagem seria irresponsável.
--
-- 🚨 O GRANT do arquivo NÃO era o grant vivo. A migration que a criou
-- (`20270904000000_desfecho_do_negocio.sql:522-523`) faz
-- `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO service_role`; o `proacl` em
-- prod mostra `authenticated=X/postgres`. Alguém concedeu depois. Por isso a
-- checagem vai no CORPO, e não em confiança sobre quem pode executar.
--
-- O QUE NÃO MUDA
--
-- A assinatura, o retorno, a idempotência e o `source = 'entrada_materializada'`
-- são os mesmos — o corpo abaixo é o vivo em prod com DUAS linhas a mais. Quem
-- já chama (a edge function `deal-operations.ts`, o `desfecho_pela_ui` e o
-- backfill da `20270908005010`) roda como `service_role`, e `assert_org_access`
-- deixa `service_role` passar; nenhum caminho existente quebra.

CREATE OR REPLACE FUNCTION public.garantir_negocio_da_entrada(p_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry public.pipeline_entries%ROWTYPE;
  v_deal_id uuid; v_titulo text; v_valor numeric;
BEGIN
  SELECT * INTO v_entry FROM public.pipeline_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entrada % não existe', p_entry_id USING ERRCODE = '22023';
  END IF;

  -- A checagem que faltava. Vem DEPOIS do SELECT porque a org é da entrada, e
  -- ANTES de qualquer escrita. `assert_org_access` libera service_role e
  -- master, que é como os chamadores de servidor continuam passando.
  PERFORM public.assert_org_access(v_entry.organization_id);

  IF v_entry.deal_id IS NOT NULL THEN
    RETURN v_entry.deal_id;
  END IF;

  SELECT COALESCE(NULLIF(l.name, ''), 'Negócio sem título') INTO v_titulo
    FROM public.leads l WHERE l.id = v_entry.lead_id;

  BEGIN
    v_valor := NULLIF(v_entry.metadata->>'sale_value', '')::numeric;
  EXCEPTION WHEN OTHERS THEN v_valor := NULL;
  END;

  INSERT INTO public.deals (organization_id, title, value, source_lead_id, owner_id, source)
  VALUES (v_entry.organization_id, COALESCE(v_titulo, 'Negócio'), v_valor,
          v_entry.lead_id, v_entry.assigned_to, 'entrada_materializada')
  RETURNING id INTO v_deal_id;

  UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = p_entry_id;
  RETURN v_deal_id;
END;
$function$;

-- O grant é reafirmado de propósito: o painel chama como `authenticated`, e a
-- checagem no corpo é o que torna isso seguro. `anon` continua de fora.
REVOKE EXECUTE ON FUNCTION public.garantir_negocio_da_entrada(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.garantir_negocio_da_entrada(uuid) TO authenticated, service_role;
