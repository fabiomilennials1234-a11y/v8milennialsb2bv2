-- 20280126000000_cobranca_pagamento_por_titulo.sql
--
-- Cobrança · registrar o pagamento de títulos escolhidos.
-- ROLLBACK pareado: rollback/20280126000000_cobranca_pagamento_por_titulo.sql
--
-- Pedido de cliente (24/11): "o cliente pagou dois títulos e o outro está
-- reagendando — como identifico o pagamento de cada título?". A RPC só baixava
-- do mais antigo para o mais novo (FIFO) ou UM título por vez; com vencimentos
-- iguais o FIFO desempatava pela ordem de cadastro, e o histórico não dizia
-- qual título o pagamento abateu.
--
--  · p_titulos uuid[]: os títulos que o cliente pagou, num lote só (atômico).
--    Valor menor que a soma dos saldos abate FIFO entre os escolhidos. Título
--    que não é deste inadimplente, não está em aberto ou é do ERP recusa o lote
--    INTEIRO — antes, um título fora do caso caía calado em "sem saldo".
--  · p_titulo fica: o front publicado o manda até o deploy deste. É atalho de
--    p_titulos (os dois juntos somam).
--  · O evento pagamento_registrado e o retorno passam a levar
--    `titulos` [{id, numero, valor, quitado}] — o histórico mostra QUAIS títulos
--    cada pagamento abateu, inclusive no FIFO.
--  · Trava os títulos ANTES de ler os saldos (antes lia, depois travava: um
--    cancelamento no meio passava pela conta).
--  · A recusa "passa do saldo" sai em formato brasileiro (R$ 1.234,50); o
--    to_char com G/D seguia o lc_numeric en_US de prod.
--
-- Assinatura muda (4 → 5 args): DROP + CREATE na mesma transação. As chamadas
-- antigas, por nome (p_caso, p_valor, p_pago_em[, p_titulo]), seguem casando.

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP FUNCTION public.cobranca_pagamento_registrar(uuid, numeric, date, uuid);

-- Registra um pagamento recebido fora do ERP (decisão 7). Abate os títulos
-- escolhidos (ou todos os em aberto) do mais antigo para o mais novo. Saldo
-- zero fecha o caso em Recuperado. Título do ERP não baixa aqui — baixa pelo ERP.
CREATE FUNCTION public.cobranca_pagamento_registrar(
  p_caso     uuid,
  p_valor    numeric,
  p_pago_em  date,
  p_titulo   uuid DEFAULT NULL,
  p_titulos  uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso      public.cobranca_casos%ROWTYPE;
  v_restante  numeric := round(p_valor, 2);
  v_lote      uuid := gen_random_uuid();
  v_escolha   uuid[];
  v_validos   integer;
  v_t         record;
  v_parte     numeric;
  v_saldo     numeric;
  v_baixas    jsonb := '[]'::jsonb;
  v_quitado   boolean := false;
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
  IF p_titulos IS NOT NULL AND (cardinality(p_titulos) = 0 OR array_position(p_titulos, NULL) IS NOT NULL) THEN
    RAISE EXCEPTION 'Escolha ao menos um título.' USING ERRCODE = 'PT422', DETAIL = 'titulos_vazios';
  END IF;

  -- NULL = todos os títulos em aberto (FIFO). Senão, a união sem repetição.
  IF p_titulos IS NOT NULL OR p_titulo IS NOT NULL THEN
    v_escolha := ARRAY(
      SELECT DISTINCT x
        FROM unnest(COALESCE(p_titulos, '{}'::uuid[])
                    || CASE WHEN p_titulo IS NULL THEN '{}'::uuid[] ELSE ARRAY[p_titulo] END) AS x);
  END IF;

  -- O caso já está travado; trava os títulos antes de ler os saldos.
  PERFORM 1 FROM public.cobranca_titulos
   WHERE inadimplente_id = v_caso.inadimplente_id AND status = 'aberto'
   ORDER BY id
   FOR UPDATE;

  IF v_escolha IS NOT NULL THEN
    SELECT count(*) INTO v_validos
      FROM public.cobranca_titulos_saldo ts
     WHERE ts.id = ANY (v_escolha)
       AND ts.inadimplente_id = v_caso.inadimplente_id
       AND ts.origem <> 'erp'
       AND ts.saldo > 0;
    IF v_validos <> cardinality(v_escolha) THEN
      IF EXISTS (SELECT 1 FROM public.cobranca_titulos
                  WHERE id = ANY (v_escolha) AND inadimplente_id = v_caso.inadimplente_id AND origem = 'erp') THEN
        RAISE EXCEPTION 'Título do ERP baixa pelo ERP, não por aqui.' USING ERRCODE = 'PT422', DETAIL = 'titulo_do_erp';
      END IF;
      RAISE EXCEPTION 'Um dos títulos escolhidos não está mais em aberto. Atualize a ficha e tente de novo.'
        USING ERRCODE = 'PT422', DETAIL = 'titulo_indisponivel';
    END IF;
  END IF;

  SELECT COALESCE(sum(ts.saldo), 0) INTO v_saldo
    FROM public.cobranca_titulos_saldo ts
   WHERE ts.inadimplente_id = v_caso.inadimplente_id AND ts.origem <> 'erp'
     AND (v_escolha IS NULL OR ts.id = ANY (v_escolha));
  IF v_saldo = 0 THEN
    RAISE EXCEPTION 'Não há saldo em aberto para baixar aqui.' USING ERRCODE = 'PT422', DETAIL = 'sem_saldo';
  END IF;
  IF v_restante > v_saldo THEN
    -- Formato brasileiro à mão: G/D do to_char seguem o lc_numeric, que em prod é
    -- en_US (a recusa saía "R$ 1,234.50").
    RAISE EXCEPTION 'O valor passa do saldo em aberto (R$ %).',
      translate(to_char(v_saldo, 'FM999,999,990.00'), ',.', '.,')
      USING ERRCODE = 'PT422', DETAIL = 'valor_maior_que_saldo';
  END IF;

  FOR v_t IN
    SELECT ts.id, ts.numero, ts.saldo
      FROM public.cobranca_titulos_saldo ts
     WHERE ts.inadimplente_id = v_caso.inadimplente_id AND ts.origem <> 'erp' AND ts.saldo > 0
       AND (v_escolha IS NULL OR ts.id = ANY (v_escolha))
     ORDER BY ts.vencimento, ts.created_at, ts.id
  LOOP
    EXIT WHEN v_restante <= 0;
    v_parte := LEAST(v_t.saldo, v_restante);
    INSERT INTO public.cobranca_pagamentos (organization_id, caso_id, titulo_id, valor, pago_em, lote)
    VALUES (v_caso.organization_id, p_caso, v_t.id, v_parte, p_pago_em, v_lote);
    IF v_parte = v_t.saldo THEN
      UPDATE public.cobranca_titulos SET status = 'pago', pago_em = p_pago_em WHERE id = v_t.id;
    END IF;
    v_baixas := v_baixas || jsonb_build_object(
      'id', v_t.id, 'numero', v_t.numero, 'valor', v_parte, 'quitado', v_parte = v_t.saldo);
    v_restante := v_restante - v_parte;
  END LOOP;

  SELECT COALESCE(sum(saldo), 0) INTO v_saldo
    FROM public.cobranca_titulos_saldo WHERE inadimplente_id = v_caso.inadimplente_id;

  PERFORM private.cobranca_evento(v_caso.organization_id, v_caso.inadimplente_id, p_caso,
    'pagamento_registrado',
    jsonb_build_object('lote', v_lote, 'valor', round(p_valor, 2), 'pago_em', p_pago_em,
                       'saldo_restante', v_saldo, 'titulos', v_baixas));

  IF v_saldo = 0 THEN
    PERFORM private.cobranca_encerrar_caso(p_caso, 'recuperado');
    v_quitado := true;
  END IF;

  RETURN jsonb_build_object('lote', v_lote, 'saldo_restante', v_saldo, 'quitado', v_quitado, 'titulos', v_baixas);
END
$fn$;

REVOKE ALL ON FUNCTION public.cobranca_pagamento_registrar(uuid, numeric, date, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_pagamento_registrar(uuid, numeric, date, uuid, uuid[]) TO authenticated, service_role;

COMMIT;
