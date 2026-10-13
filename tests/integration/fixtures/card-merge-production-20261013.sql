CREATE OR REPLACE FUNCTION public._repontar_dependentes_do_card(p_de uuid, p_para uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_de   public.pipeline_entries%ROWTYPE;
  v_para public.pipeline_entries%ROWTYPE;
  v_uid  uuid := auth.uid();
BEGIN
  SELECT * INTO v_de   FROM public.pipeline_entries WHERE id = p_de;
  SELECT * INTO v_para FROM public.pipeline_entries WHERE id = p_para;

  IF v_de.id IS NULL OR v_para.id IS NULL OR p_de = p_para THEN
    RAISE EXCEPTION 'Card de origem ou de destino da fusão não encontrado.'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_de.organization_id <> v_para.organization_id
     OR v_de.lead_id IS DISTINCT FROM v_para.lead_id
     OR v_de.deal_id IS NOT NULL
     OR v_para.deal_id IS NOT NULL THEN
    RAISE EXCEPTION 'Só se funde card sem negócio em outro card sem negócio do mesmo lead.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Sem JWT (migration, service_role) passa; com JWT, a org tem de ser do
  -- chamador. anon nem chega aqui (sem EXECUTE).
  IF v_uid IS NOT NULL
     AND NOT public.is_master_user()
     AND v_de.organization_id NOT IN (SELECT public.get_my_organization_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a este card.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.follow_ups          SET pipeline_entry_id = p_para WHERE pipeline_entry_id = p_de;
  UPDATE public.workflow_executions SET pipeline_entry_id = p_para WHERE pipeline_entry_id = p_de;
  UPDATE public.acoes_do_dia        SET pipeline_entry_id = p_para WHERE pipeline_entry_id = p_de;
  UPDATE public.acoes_do_dia        SET proposta_id       = p_para WHERE proposta_id       = p_de;
  UPDATE public.acoes_do_dia        SET confirmacao_id    = p_para WHERE confirmacao_id    = p_de;
  UPDATE public.pipe_proposta_items SET pipe_proposta_id  = p_para WHERE pipe_proposta_id  = p_de;

  -- Três vínculos que o domínio NÃO deixa trocar de card. Ficam onde estão e,
  -- quando o card sai, o FK ON DELETE SET NULL solta só o link — o registro
  -- segue com lead, org e histórico (os gatilhos aceitam ir a NULL):
  --   comentário com anexo   — o caminho no storage carrega o id do card
  --                            (validate_deal_comment_documents);
  --   reunião de outro funil — guarda o funil em que foi marcada
  --                            (fn_meeting_bind_booking);
  --   comissão projetada     — imutável, ADR-0017 §6
  --                            (fn_commissions_protect_projection).
  UPDATE public.lead_comments SET pipeline_entry_id = p_para
   WHERE pipeline_entry_id = p_de
     AND attachments = '[]'::jsonb;
  UPDATE public.meetings SET pipeline_entry_id = p_para
   WHERE pipeline_entry_id = p_de
     AND (lead_id IS NULL
          OR (event_type IS NOT NULL AND event_type <> 'meeting')
          OR pipeline_id = v_para.pipeline_id);
  UPDATE public.commissions SET pipe_proposta_id = p_para
   WHERE pipe_proposta_id = p_de
     AND source IS DISTINCT FROM 'sale_event_projection';

  -- Únicos por card: só leva quando o destino ainda não tem. O que sobrar
  -- segue a FK do card que sai (CASCADE em checklists/tinyerp, SET NULL em
  -- upsell) — é a duplicata do que o destino já carrega.
  UPDATE public.checklists c SET pipeline_entry_id = p_para
   WHERE c.pipeline_entry_id = p_de
     AND (c.source_template_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.checklists w
           WHERE w.pipeline_entry_id = p_para AND w.source_template_id = c.source_template_id));
  UPDATE public.upsell_orders SET pipe_proposta_id = p_para
   WHERE pipe_proposta_id = p_de
     AND NOT EXISTS (SELECT 1 FROM public.upsell_orders WHERE pipe_proposta_id = p_para);
  UPDATE public.tinyerp_order_mappings SET pipe_proposta_id = p_para
   WHERE pipe_proposta_id = p_de
     AND NOT EXISTS (SELECT 1 FROM public.tinyerp_order_mappings WHERE pipe_proposta_id = p_para);
END;
$function$;

REVOKE ALL ON FUNCTION public._repontar_dependentes_do_card(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._repontar_dependentes_do_card(uuid,uuid) TO authenticated,service_role;
