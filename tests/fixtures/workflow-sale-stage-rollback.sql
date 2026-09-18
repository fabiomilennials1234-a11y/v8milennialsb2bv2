DROP TRIGGER IF EXISTS trg_zz_exige_valor_na_venda ON public.pipeline_entries;
CREATE OR REPLACE FUNCTION public.fn_exige_valor_na_venda()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exige boolean;
  v_valor text;
BEGIN
  -- Só na ENTRADA na etapa. Ver o cabeçalho: verificar na permanência
  -- transformaria qualquer edição de card vendido em erro.
  IF TG_OP = 'UPDATE' AND NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
    RETURN NEW;
  END IF;

  SELECT s.requires_sale_value INTO v_exige
    FROM public.pipeline_stages s
   WHERE s.organization_id = NEW.organization_id
     AND s.stage_key = NEW.stage_key
     AND s.stage_role = 'won'
     AND s.is_active;

  IF NOT COALESCE(v_exige, false) THEN
    RETURN NEW;
  END IF;

  v_valor := NULLIF(btrim(COALESCE(NEW.metadata->>'sale_value', '')), '');

  -- Zero é resposta válida: venda de cortesia, troca, ajuste. O que não pode
  -- é AUSÊNCIA — "não informei" e "informei zero" são coisas diferentes, e
  -- hoje as duas viram o mesmo NULL na conta do ticket médio.
  IF v_valor IS NULL THEN
    RAISE EXCEPTION
      'Informe o valor da venda antes de mover para "%".', NEW.stage_key
      USING ERRCODE = 'check_violation',
            HINT = 'Abra o card e preencha o valor da venda. Se a venda foi sem cobrança, informe 0.';
  END IF;

  IF v_valor !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION
      'O valor da venda ("%") não é um número.', v_valor
      USING ERRCODE = 'check_violation',
            HINT = 'Use apenas números, com ponto como separador decimal.';
  END IF;

  RETURN NEW;
END;
$function$
;
DROP TRIGGER IF EXISTS trg_exige_valor_na_venda ON public.pipeline_entries;
CREATE TRIGGER trg_exige_valor_na_venda BEFORE INSERT OR UPDATE OF stage_key ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION public.fn_exige_valor_na_venda();
