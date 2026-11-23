-- 20280123003000_cobranca_promessa_destino_e_prazo.sql
--
-- Cobrança · promessa de pagamento: destino do card e prazo máximo, por organização.
-- ROLLBACK pareado: rollback/20280123003000_cobranca_promessa_destino_e_prazo.sql
--
--  · etapa_promessa_id: coluna para onde "Registrar promessa" leva o card. Antes o
--    front escolhia pelo NOME (/promessa|acordo/): quem personalizou as colunas caía
--    na coluna errada (ex.: "Proposta de Acordo"). Agora é uma escolha explícita
--    (mesmo molde de etapa_apos_quebra_id); NULL = não move. Backfill: a coluna
--    padrão "Promessa ou acordo", que era o destino de fato.
--  · promessa_max_dias: a promessa (uma data) não pode passar de hoje + N dias.
--    NULL = sem limite (comportamento de hoje).

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.cobranca_regua
  ADD COLUMN etapa_promessa_id uuid REFERENCES public.cobranca_etapas(id) ON DELETE SET NULL,
  ADD COLUMN promessa_max_dias integer CHECK (promessa_max_dias BETWEEN 1 AND 365);

UPDATE public.cobranca_regua r
   SET etapa_promessa_id = e.id
  FROM public.cobranca_etapas e
 WHERE e.organization_id = r.organization_id AND e.papel = 'aberta' AND e.nome = 'Promessa ou acordo';

CREATE OR REPLACE FUNCTION public.cobranca_regua_salvar(p_org uuid, p_dados jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_etapa uuid := NULLIF(p_dados ->> 'etapa_apos_quebra_id', '')::uuid;
  v_promessa uuid := NULLIF(p_dados ->> 'etapa_promessa_id', '')::uuid;
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

  IF v_promessa IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cobranca_etapas
        WHERE id = v_promessa AND organization_id = p_org AND papel = 'aberta') THEN
    RAISE EXCEPTION 'Etapa inválida para onde vai quem promete pagar.'
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
      etapa_promessa_id        = CASE WHEN p_dados ? 'etapa_promessa_id' THEN v_promessa ELSE etapa_promessa_id END,
      promessa_max_dias        = CASE WHEN p_dados ? 'promessa_max_dias'
                                      THEN NULLIF(p_dados ->> 'promessa_max_dias', '')::int ELSE promessa_max_dias END,
      updated_at = now(), updated_by = auth.uid()
     WHERE organization_id = p_org;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Valores fora do permitido: teto de 1 a 300 por dia, intervalo de 30 s a 30 min (mínimo até o máximo), pausas de até 30 dias, prazo de retorno de 1 a 10 dias úteis, prazo máximo da promessa de 1 a 365 dias, "como pagar" até 600 caracteres.'
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
  v_max   integer;
  v_hoje  date;
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

  -- Prazo máximo da promessa (por organização; sem valor = sem limite). Vale para a
  -- promessa de uma data só: o acordo em parcelas tem prazo próprio.
  IF p_tipo = 'promessa' THEN
    SELECT r.promessa_max_dias, (now() AT TIME ZONE o.timezone)::date INTO v_max, v_hoje
      FROM public.organizations o
      LEFT JOIN public.cobranca_regua r ON r.organization_id = o.id
     WHERE o.id = v_caso.organization_id;
    BEGIN
      v_venc := (p_parcelas -> 0 ->> 'vencimento')::date;
    EXCEPTION WHEN others THEN
      v_venc := NULL;
    END;
    IF v_max IS NOT NULL AND v_venc IS NOT NULL AND v_venc > v_hoje + v_max THEN
      RAISE EXCEPTION 'A promessa pode ser de até % dias a partir de hoje (até %).', v_max, to_char(v_hoje + v_max, 'DD/MM/YYYY')
        USING ERRCODE = 'PT422', DETAIL = 'promessa_prazo_maximo';
    END IF;
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

COMMIT;
