-- Valor manual é orçamento: não muda desfecho, eventos de venda ou comissão.
CREATE OR REPLACE FUNCTION public.editar_valor_proposta(
  p_entry_id uuid, p_value numeric, p_expected_updated_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_entry public.pipeline_entries%ROWTYPE;
  v_deal public.deals%ROWTYPE;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;
  IF p_value IS NULL OR p_value::text IN ('NaN','Infinity','-Infinity') OR p_value < 0 OR p_value > 999999999999.99 THEN
    RAISE EXCEPTION 'Informe um valor válido, maior ou igual a zero' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_entry FROM public.pipeline_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card não encontrado ou sem permissão' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_org_access(v_entry.organization_id);
  IF NOT COALESCE(public.can_link_or_read_lead(v_entry.lead_id,v_entry.organization_id),false) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  -- Não materializar separadamente: a criação e o valor formam uma transação.
  IF v_entry.deal_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.pipeline_stages ps WHERE ps.pipeline_id=v_entry.pipeline_id
      AND ps.organization_id=v_entry.organization_id AND ps.stage_key=v_entry.stage_key
      AND (ps.is_final_positive OR ps.is_final_negative)) THEN
      RAISE EXCEPTION 'Somente propostas abertas podem receber valor manual' USING ERRCODE = '22023';
    END IF;
    IF p_expected_updated_at IS NOT NULL THEN RAISE EXCEPTION 'Atualize a ficha antes de salvar' USING ERRCODE = '40001'; END IF;
    v_id := public.garantir_negocio_da_entrada(p_entry_id);
  ELSE
    v_id := v_entry.deal_id;
  END IF;
  SELECT * INTO v_deal FROM public.deals WHERE id = v_id AND organization_id = v_entry.organization_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Negócio não encontrado ou sem permissão' USING ERRCODE = '42501'; END IF;
  IF v_deal.outcome IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Somente propostas abertas podem receber valor manual' USING ERRCODE = '22023';
  END IF;
  IF v_entry.deal_id IS NOT NULL AND (p_expected_updated_at IS NULL OR v_deal.updated_at IS DISTINCT FROM p_expected_updated_at) THEN
    RAISE EXCEPTION 'O negócio mudou. Atualize a ficha antes de salvar' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deal_items WHERE deal_id = v_id) THEN
    RAISE EXCEPTION 'Edite os produtos para alterar o total deste negócio' USING ERRCODE = '22023';
  END IF;
  UPDATE public.deals SET value = round(p_value,2), updated_at = clock_timestamp() WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sem permissão para editar o negócio' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.lead_history(organization_id,lead_id,action,description,created_by,metadata,source,entity_type,entity_id)
  VALUES(v_deal.organization_id,v_deal.source_lead_id,'proposal_value_updated','Valor da proposta atualizado',auth.uid(),
    jsonb_build_object('before_value',v_deal.value,'after_value',round(p_value,2),'deal_id',v_id),'manual','deal',v_id);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.editar_valor_proposta(uuid,numeric,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.editar_valor_proposta(uuid,numeric,timestamptz) TO authenticated;
