-- Rollback de 20271215000000_definer_sem_gate_fecha_execucao.sql
--
-- Devolve o estado medido em prod em 23/10/2026: proacl de cada função como
-- era (inclusive os EXECUTE de PUBLIC/anon onde existiam) e o corpo original,
-- sem gate, de create_default_pipelines e get_lead_write_instance.
--
-- ATENÇÃO: rollback REABRE o vetor cross-tenant. Só usar se o fechamento
-- quebrar um chamador legítimo não mapeado — e então reabrir SÓ a função
-- afetada, não o arquivo inteiro.

BEGIN;

SET LOCAL lock_timeout = '3s';

GRANT EXECUTE ON FUNCTION public.api_create_custom_field(uuid,text,text,jsonb,boolean) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.api_list_team_members(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.api_set_custom_fields_creating(uuid,uuid,jsonb) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.carteira_erp_source(uuid,uuid,text,text) TO anon, authenticated, service_role;  -- prod: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.check_auth_rate_limit(text,text,integer,interval) TO anon, authenticated, service_role;  -- prod: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.claim_campaign_dispatch_batch(uuid,integer) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.claim_password_reset_token(text) TO anon, authenticated, service_role;  -- prod: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.claim_pipe_dispatch_batch(text,integer) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.cleanup_copilot_message_queue() TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.convert_campaign_rule_to_workflow(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.convert_pipe_rule_to_workflow(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.create_default_pipelines(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.fn_dono_do_lead(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.fn_medicao_de_ruido(integer) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.fn_pico_de_avisos_quentes(integer) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.fn_preferencias_de_aviso(uuid,uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.get_lead_write_instance(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.has_concurrent_ai_action(uuid,text,uuid) TO PUBLIC, anon, authenticated, service_role;  -- prod: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.increment(text,uuid,text) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.increment_conversation_turn(uuid,text) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.process_overdue_subscriptions(integer) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.purge_expired_rate_limits() TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.recalc_upsell_client_metrics(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.save_document_content(uuid,text) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
GRANT EXECUTE ON FUNCTION public.try_provision_lock(text) TO PUBLIC, anon, authenticated, service_role;  -- prod: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

-- corpo original (prod, 23/10/2026)
CREATE OR REPLACE FUNCTION public.create_default_pipelines(p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.pipelines (organization_id, name, slug, type, display_order, icon, color)
  SELECT p_org_id, d.name, d.slug, 'system', d.display_order, d.icon, d.color
    FROM (VALUES
      ('Qualificação', 'whatsapp',    0, 'zap',         '#22c55e'),
      ('Confirmação',  'confirmacao', 1, 'calendar',    '#3b82f6'),
      ('Propostas',    'propostas',   2, 'dollar-sign', '#f59e0b')
    ) AS d(name, slug, display_order, icon, color)
   WHERE EXISTS (
     SELECT 1 FROM public.pipeline_display_config c
      WHERE c.organization_id = p_org_id
        AND c.pipe_type = d.slug
   )
  ON CONFLICT (organization_id, slug) DO NOTHING;
END;
$function$;

-- corpo original (prod, 23/10/2026)
CREATE OR REPLACE FUNCTION public.get_lead_write_instance(p_lead_id uuid)
 RETURNS TABLE(instance_id uuid, instance_name text, owner_team_member_id uuid, responsible_user_id uuid, error_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_resp_tm_id uuid;
BEGIN
  SELECT l.organization_id, l.responsible_user_id
    INTO v_org_id, v_resp_tm_id
  FROM private.leads l
  WHERE l.id = p_lead_id;

  IF v_org_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, 'LEAD_NOT_FOUND'::text;
    RETURN;
  END IF;

  IF v_resp_tm_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, 'NO_RESPONSIBLE'::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT wi.id, wi.instance_name, wi.owner_team_member_id, v_resp_tm_id, NULL::text
  FROM public.whatsapp_instances wi
  WHERE wi.organization_id = v_org_id
    AND wi.owner_team_member_id = v_resp_tm_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::uuid, v_resp_tm_id, 'NO_INSTANCE'::text;
  END IF;
END;
$function$;

COMMIT;
