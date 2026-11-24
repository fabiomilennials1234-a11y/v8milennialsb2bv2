-- ROLLBACK de 20280126000000_cobranca_pagamento_por_titulo.sql
-- Volta a RPC de pagamento para a assinatura de 4 argumentos (20271212000000),
-- verbatim. Os pagamentos já registrados ficam; o campo `titulos` dos eventos
-- gravados também (o histórico do front antigo o ignora).
BEGIN;
SET LOCAL lock_timeout = '3s';

DROP FUNCTION public.cobranca_pagamento_registrar(uuid, numeric, date, uuid, uuid[]);

-- Registra um pagamento recebido fora do ERP (decisão 7). Abate os títulos em
-- aberto do mais antigo para o mais novo (ou só o título indicado). Saldo zero
-- fecha o caso em Recuperado. Título do ERP não baixa aqui — baixa pelo ERP.
CREATE FUNCTION public.cobranca_pagamento_registrar(
  p_caso uuid, p_valor numeric, p_pago_em date, p_titulo uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso     public.cobranca_casos%ROWTYPE;
  v_restante numeric := round(p_valor, 2);
  v_lote     uuid := gen_random_uuid();
  v_t        record;
  v_parte    numeric;
  v_saldo    numeric;
  v_quitado  boolean := false;
BEGIN
  SELECT * INTO v_caso FROM public.cobranca_casos WHERE id = p_caso FOR UPDATE;
  IF v_caso.id IS NULL OR v_caso.encerrado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Caso não encontrado ou já encerrado.' USING ERRCODE = 'PT404', DETAIL = 'caso_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_caso.organization_id, 'edit');

  IF v_restante IS NULL OR v_restante <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = 'PT422', DETAIL = 'valor_invalido';
  END IF;
  IF p_pago_em IS NULL OR p_pago_em > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'Informe a data do pagamento (não pode ser futura).' USING ERRCODE = 'PT422', DETAIL = 'data_invalida';
  END IF;

  SELECT COALESCE(sum(ts.saldo), 0) INTO v_saldo
    FROM public.cobranca_titulos_saldo ts
   WHERE ts.inadimplente_id = v_caso.inadimplente_id AND ts.origem <> 'erp'
     AND (p_titulo IS NULL OR ts.id = p_titulo);
  IF v_saldo = 0 THEN
    RAISE EXCEPTION 'Não há saldo em aberto para baixar aqui.' USING ERRCODE = 'PT422', DETAIL = 'sem_saldo';
  END IF;
  IF v_restante > v_saldo THEN
    RAISE EXCEPTION 'O valor passa do saldo em aberto (R$ %).', to_char(v_saldo, 'FM999G999G990D00')
      USING ERRCODE = 'PT422', DETAIL = 'valor_maior_que_saldo';
  END IF;

  -- O caso já está travado; trava também os títulos antes de ler os saldos.
  PERFORM 1 FROM public.cobranca_titulos
   WHERE inadimplente_id = v_caso.inadimplente_id AND status = 'aberto'
   FOR UPDATE;

  FOR v_t IN
    SELECT ts.id, ts.saldo
      FROM public.cobranca_titulos_saldo ts
     WHERE ts.inadimplente_id = v_caso.inadimplente_id AND ts.origem <> 'erp' AND ts.saldo > 0
       AND (p_titulo IS NULL OR ts.id = p_titulo)
     ORDER BY ts.vencimento, ts.created_at
  LOOP
    EXIT WHEN v_restante <= 0;
    v_parte := LEAST(v_t.saldo, v_restante);
    INSERT INTO public.cobranca_pagamentos (organization_id, caso_id, titulo_id, valor, pago_em, lote)
    VALUES (v_caso.organization_id, p_caso, v_t.id, v_parte, p_pago_em, v_lote);
    IF v_parte = v_t.saldo THEN
      UPDATE public.cobranca_titulos SET status = 'pago', pago_em = p_pago_em WHERE id = v_t.id;
    END IF;
    v_restante := v_restante - v_parte;
  END LOOP;

  SELECT COALESCE(sum(saldo), 0) INTO v_saldo
    FROM public.cobranca_titulos_saldo WHERE inadimplente_id = v_caso.inadimplente_id;

  PERFORM private.cobranca_evento(v_caso.organization_id, v_caso.inadimplente_id, p_caso,
    'pagamento_registrado',
    jsonb_build_object('lote', v_lote, 'valor', round(p_valor, 2), 'pago_em', p_pago_em, 'saldo_restante', v_saldo));

  IF v_saldo = 0 THEN
    PERFORM private.cobranca_encerrar_caso(p_caso, 'recuperado');
    v_quitado := true;
  END IF;

  RETURN jsonb_build_object('lote', v_lote, 'saldo_restante', v_saldo, 'quitado', v_quitado);
END
$fn$;

REVOKE ALL ON FUNCTION public.cobranca_pagamento_registrar(uuid, numeric, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_pagamento_registrar(uuid, numeric, date, uuid) TO authenticated, service_role;

COMMIT;
