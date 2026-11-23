-- ROLLBACK de 20280123003000_cobranca_promessa_destino_e_prazo.sql
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.cobranca_regua_salvar(p_org uuid, p_dados jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_etapa uuid := NULLIF(p_dados ->> 'etapa_apos_quebra_id', '')::uuid;
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  PERFORM private.cobranca_regua_semear(p_org);

  IF p_dados ? 'janela' AND NOT private.cobranca_janela_valida(p_dados -> 'janela') THEN
    RAISE EXCEPTION 'Horário de envio inválido: cada dia precisa de início antes do fim (HH:MM).'
      USING ERRCODE = 'PT422', DETAIL = 'janela_invalida';
  END IF;
  IF v_etapa IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cobranca_etapas
        WHERE id = v_etapa AND organization_id = p_org AND papel = 'aberta') THEN
    RAISE EXCEPTION 'Etapa inválida para a volta do compromisso quebrado.'
      USING ERRCODE = 'PT422', DETAIL = 'etapa_invalida';
  END IF;

  BEGIN
    UPDATE public.cobranca_regua SET
      janela                   = CASE WHEN p_dados ? 'janela' THEN p_dados -> 'janela' ELSE janela END,
      teto_diario              = COALESCE((p_dados ->> 'teto_diario')::int, teto_diario),
      intervalo_min_segundos   = COALESCE((p_dados ->> 'intervalo_min_segundos')::int, intervalo_min_segundos),
      intervalo_max_segundos   = COALESCE((p_dados ->> 'intervalo_max_segundos')::int, intervalo_max_segundos),
      pausa_apos_resposta_dias = COALESCE((p_dados ->> 'pausa_apos_resposta_dias')::int, pausa_apos_resposta_dias),
      intervalo_minimo_dias    = COALESCE((p_dados ->> 'intervalo_minimo_dias')::int, intervalo_minimo_dias),
      prazo_dias_uteis         = COALESCE((p_dados ->> 'prazo_dias_uteis')::int, prazo_dias_uteis),
      como_pagar               = CASE WHEN p_dados ? 'como_pagar'
                                      THEN NULLIF(btrim(p_dados ->> 'como_pagar'), '') ELSE como_pagar END,
      etapa_apos_quebra_id     = CASE WHEN p_dados ? 'etapa_apos_quebra_id' THEN v_etapa ELSE etapa_apos_quebra_id END,
      updated_at = now(), updated_by = auth.uid()
     WHERE organization_id = p_org;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Valores fora do permitido: teto de 1 a 300 por dia, intervalo de 30 s a 30 min (mínimo até o máximo), pausas de até 30 dias, prazo de retorno de 1 a 10 dias úteis, "como pagar" até 600 caracteres.'
      USING ERRCODE = 'PT422', DETAIL = 'valores_fora_do_permitido';
  END;
END
$fn$;


CREATE OR REPLACE FUNCTION public.cobranca_compromisso_registrar(
  p_caso uuid, p_tipo text, p_parcelas jsonb, p_observacao text DEFAULT NULL, p_mover_para uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso  public.cobranca_casos%ROWTYPE;
  v_id    uuid;
  v_p     jsonb;
  v_n     integer := 0;
  v_total numeric := 0;
  v_valor numeric;
  v_venc  date;
BEGIN
  SELECT * INTO v_caso FROM public.cobranca_casos WHERE id = p_caso FOR UPDATE;
  IF v_caso.id IS NULL OR v_caso.encerrado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Caso não encontrado ou já encerrado.' USING ERRCODE = 'PT404', DETAIL = 'caso_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_caso.organization_id, 'edit');

  IF p_tipo NOT IN ('promessa', 'acordo') THEN
    RAISE EXCEPTION 'Tipo de compromisso inválido.' USING ERRCODE = 'PT422', DETAIL = 'tipo_invalido';
  END IF;
  IF jsonb_typeof(p_parcelas) <> 'array' OR jsonb_array_length(p_parcelas) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma data e valor.' USING ERRCODE = 'PT422', DETAIL = 'parcelas_obrigatorias';
  END IF;
  IF p_tipo = 'promessa' AND jsonb_array_length(p_parcelas) <> 1 THEN
    RAISE EXCEPTION 'Promessa tem uma data só. Para várias, registre um acordo.'
      USING ERRCODE = 'PT422', DETAIL = 'promessa_uma_parcela';
  END IF;
  IF jsonb_array_length(p_parcelas) > 120 THEN
    RAISE EXCEPTION 'No máximo 120 parcelas.' USING ERRCODE = 'PT422', DETAIL = 'parcelas_demais';
  END IF;

  UPDATE public.cobranca_compromissos SET status = 'cancelado', encerrado_em = now()
   WHERE caso_id = p_caso AND status = 'ativo';

  INSERT INTO public.cobranca_compromissos (organization_id, caso_id, tipo, observacao)
  VALUES (v_caso.organization_id, p_caso, p_tipo, NULLIF(btrim(p_observacao), ''))
  RETURNING id INTO v_id;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    v_n := v_n + 1;
    BEGIN
      v_valor := round((v_p ->> 'valor')::numeric, 2);
      v_venc  := (v_p ->> 'vencimento')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Parcela % com valor ou data inválida.', v_n
        USING ERRCODE = 'PT422', DETAIL = 'parcela_invalida';
    END;
    IF v_valor IS NULL OR v_valor <= 0 OR v_venc IS NULL THEN
      RAISE EXCEPTION 'Parcela % precisa de valor maior que zero e data.', v_n
        USING ERRCODE = 'PT422', DETAIL = 'parcela_invalida';
    END IF;
    INSERT INTO public.cobranca_compromisso_parcelas (organization_id, compromisso_id, numero, vencimento, valor)
    VALUES (v_caso.organization_id, v_id, v_n, v_venc, v_valor);
    v_total := v_total + v_valor;
  END LOOP;

  PERFORM private.cobranca_evento(v_caso.organization_id, v_caso.inadimplente_id, p_caso,
    CASE p_tipo WHEN 'promessa' THEN 'promessa_registrada' ELSE 'acordo_registrado' END,
    jsonb_build_object('compromisso_id', v_id, 'parcelas', v_n, 'total', v_total,
                       'primeira', (SELECT min(vencimento) FROM public.cobranca_compromisso_parcelas
                                     WHERE compromisso_id = v_id)));

  IF p_mover_para IS NOT NULL AND p_mover_para <> v_caso.etapa_id THEN
    PERFORM public.cobranca_caso_mover(p_caso, p_mover_para, NULL);
  END IF;
  RETURN v_id;
END
$fn$;

ALTER TABLE public.cobranca_regua DROP COLUMN promessa_max_dias, DROP COLUMN etapa_promessa_id;

COMMIT;
