-- Created by Supabase CLI as 20261013190704; ordered after the repository's
-- future-dated card merge prerequisite 20271119000000.
-- Preserve production trigger-safe handling of attachments, meetings and
-- projected commissions. No cleanup/backfill: already completed in production.
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
  v_strict_access boolean;
BEGIN
  -- Lock both cards in stable order, including direct RPC calls.
  PERFORM id FROM public.pipeline_entries WHERE id IN (p_de, p_para) ORDER BY id FOR UPDATE;
  SELECT * INTO v_de   FROM public.pipeline_entries WHERE id = p_de;
  SELECT * INTO v_para FROM public.pipeline_entries WHERE id = p_para;

  IF v_de.id IS NULL OR v_para.id IS NULL OR p_de = p_para THEN
    RAISE EXCEPTION 'Card de origem ou de destino da fusão não encontrado.'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_de.organization_id <> v_para.organization_id
     OR v_de.lead_id IS NULL
     OR v_para.lead_id IS NULL
     OR v_de.closed_at IS NOT NULL
     OR v_para.closed_at IS NOT NULL
     OR v_de.lead_id IS DISTINCT FROM v_para.lead_id
     OR v_de.deal_id IS NOT NULL
     OR v_para.deal_id IS NOT NULL THEN
    RAISE EXCEPTION 'Só se funde card sem negócio em outro card sem negócio do mesmo lead.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A missing JWT is trusted only for a real backend/operator DB role.
  -- current_user is the definer here, so inspect the caller's SET ROLE instead.
  IF v_uid IS NULL THEN
    IF NOT (
      current_setting('role', true) = 'service_role'
      OR (session_user IN ('postgres', 'supabase_admin')
          AND current_setting('role', true) IN ('none', 'postgres', 'supabase_admin'))
    ) THEN
      RAISE EXCEPTION 'Sem acesso a este card.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NOT (COALESCE(public.is_master_user(), false)
            OR EXISTS (SELECT 1 FROM public.get_my_organization_ids() AS org(id)
                       WHERE org.id = v_de.organization_id)) THEN
      RAISE EXCEPTION 'Sem acesso a este card.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Owner-only visibility is opt-in and may be deployed independently.
    -- Reuse exactly the restrictive pipeline_entries policy when installed.
    IF to_regprocedure('private.strict_lead_member_orgs()') IS NOT NULL THEN
      EXECUTE 'SELECT
        (NOT ($1 = ANY(private.strict_lead_member_orgs())) OR private.strict_lead_is_owned($1,$2))
        AND (NOT ($3 = ANY(private.strict_lead_member_orgs())) OR private.strict_lead_is_owned($3,$4))'
        INTO v_strict_access
        USING v_de.organization_id, v_de.lead_id, v_para.organization_id, v_para.lead_id;
      IF NOT COALESCE(v_strict_access, false) THEN
        RAISE EXCEPTION 'Sem acesso a este card.' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  -- A shared template is not proof of identical answers, and two external
  -- orders are not interchangeable. Abort before touching any dependent row.
  IF EXISTS (
    SELECT 1 FROM public.checklists source JOIN public.checklists target
      ON target.pipeline_entry_id=p_para AND target.source_template_id=source.source_template_id
    WHERE source.pipeline_entry_id=p_de AND source.source_template_id IS NOT NULL
  ) OR (
    EXISTS(SELECT 1 FROM public.tinyerp_order_mappings WHERE pipe_proposta_id=p_de)
    AND EXISTS(SELECT 1 FROM public.tinyerp_order_mappings WHERE pipe_proposta_id=p_para)
  ) OR (
    EXISTS(SELECT 1 FROM public.upsell_orders WHERE pipe_proposta_id=p_de)
    AND EXISTS(SELECT 1 FROM public.upsell_orders WHERE pipe_proposta_id=p_para)
  ) THEN
    RAISE EXCEPTION 'Os cards possuem checklists ou pedidos distintos. Revise os vínculos antes de unir.'
      USING ERRCODE = 'check_violation';
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

  -- Conflicts also fail on the tables' unique constraints if a concurrent
  -- writer adds one after preflight. Never skip then cascade-delete a row.
  UPDATE public.checklists SET pipeline_entry_id=p_para WHERE pipeline_entry_id=p_de;
  UPDATE public.upsell_orders SET pipe_proposta_id=p_para WHERE pipe_proposta_id=p_de;
  UPDATE public.tinyerp_order_mappings SET pipe_proposta_id=p_para WHERE pipe_proposta_id=p_de;
END;
$function$;

REVOKE ALL ON FUNCTION public._repontar_dependentes_do_card(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._repontar_dependentes_do_card(uuid,uuid) TO authenticated,service_role;
