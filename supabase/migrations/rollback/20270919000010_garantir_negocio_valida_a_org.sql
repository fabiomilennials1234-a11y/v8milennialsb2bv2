-- ROLLBACK de 20270919000010_garantir_negocio_valida_a_org.sql
--
-- Volta `garantir_negocio_da_entrada` ao corpo SEM a checagem de org. Cópia
-- verbatim do que estava vivo em prod em 2026-09-03, lida por `pg_proc.prosrc`.
--
-- ⚠ Reverter REABRE a brecha: a função é SECURITY DEFINER, `authenticated` tem
-- EXECUTE, e sem `assert_org_access` um usuário de qualquer org materializa
-- Negócio em org alheia passando um `p_entry_id` que não é dele.

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
