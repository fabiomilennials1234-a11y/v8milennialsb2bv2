-- Produtor: lead novo com dono vira Aviso. Issue #1885, ADR-0035.
--
-- No banco porque o Lead entra por quatro portas — webhook de formulário,
-- importação de planilha, criação manual e n8n — e três delas esqueceriam de
-- avisar. Sem dono não nasce Aviso: lead órfão é problema de atribuição.

CREATE OR REPLACE FUNCTION public.fn_aviso_de_lead_novo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dono uuid;
BEGIN
  v_dono := public.fn_dono_do_lead(NEW.id);
  IF v_dono IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.fn_emit_aviso(
    p_organization_id => NEW.organization_id,
    p_user_id         => v_dono,
    p_type            => 'lead_new',
    p_group_key       => 'lead:' || NEW.id::text,
    p_title           => COALESCE(NULLIF(NEW.name, ''), 'Lead novo'),
    p_description     => NULLIF(concat_ws(' · ',
                           NULLIF(NEW.company, ''),
                           NULLIF(NEW.origin, '')), ''),
    p_link            => '/leads',
    p_lead_id         => NEW.id,
    p_entity_id       => NEW.id
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_aviso_de_lead_novo IS
  'Lead novo com dono vira Aviso de lead (#1885). Lead órfão não avisa ninguém.';

DROP TRIGGER IF EXISTS trg_aviso_de_lead_novo ON public.leads;
CREATE TRIGGER trg_aviso_de_lead_novo
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_aviso_de_lead_novo();
