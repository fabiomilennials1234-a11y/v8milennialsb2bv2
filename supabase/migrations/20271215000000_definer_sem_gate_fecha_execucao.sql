-- =============================================================================
-- DEFINER sem gate: fecha a execução por anon/authenticated
-- =============================================================================
--
-- NUMERAÇÃO: 20271215000000 é provisória. Renumerar IMEDIATAMENTE antes do
-- apply, acima do topo do ledger de prod daquele momento, e reensaiar.
-- (ver memória colisao-de-ledger-e-o-normal-agora)
--
-- O QUE É
-- Inventário de 23/10/2026 em prod (jsjsmuncfkbsbzqzqhfq): funções `public`
-- SECURITY DEFINER, executáveis por `authenticated` (algumas também por `anon`
-- e PUBLIC), cujo corpo não tem gate de org/papel nem delega a um helper que
-- tenha. Qualquer usuário logado de QUALQUER org as alcança via PostgREST
-- (`supabase.rpc(...)`), e DEFINER passa por cima da RLS.
--
-- Os piores, por dano:
--   * api_set_custom_fields_creating / api_create_custom_field: escrevem campo
--     customizado em lead de outra org (org e lead por parâmetro).
--   * api_list_team_members: devolve nome + e-mail da equipe de outra org.
--   * process_overdue_subscriptions: suspende toda org vencida do banco.
--   * claim_campaign_dispatch_batch / claim_pipe_dispatch_batch: põem em
--     'processing' o disparo de qualquer org (some da fila do dispatcher).
--   * convert_*_rule_to_workflow: criam workflow na org dona da regra.
--   * save_document_content: sobrescreve documento de Copilot por id.
--   * get_lead_write_instance: devolve a instância de WhatsApp do lead alheio.
--   * check_auth_rate_limit (anon): qualquer um enche o contador de um IP e
--     tranca o "esqueci a senha" e o link de pagamento da vítima.
--
-- DOIS TRATAMENTOS
--
-- A) Chamada só por service_role, cron (postgres) ou por outra função DEFINER
--    de dono postgres → REVOKE de PUBLIC, anon, authenticated + GRANT nominal a
--    service_role. Medido em prod antes de escolher:
--      - edge functions chamam com SUPABASE_SERVICE_ROLE_KEY
--        (campaign-rule-dispatch, pipe-rule-dispatch, semi-automatic-dispatch,
--        forgot-password, reset-password, billing-payment-link/status,
--        process-ai-actions, agent-message via _shared/copilot, API pública
--        _shared/api/routes/* — cujas irmãs api_list_pipelines, api_create_deal
--        e api_update_lead JÁ são service_role-only);
--      - cron 52 (cleanup-copilot-batching) roda como postgres;
--      - chamadores SQL internos são todos DEFINER de dono postgres
--        (fn_donos_do_lead, fn_avisos_pendentes_de_push, trg_upsell_order_
--        recalc_metrics, fn_carteira_admite_venda, carteira_list_orders,
--        carteira_update_order, ajustar_pedido_ganho, corrigir_venda_ganha) —
--        rodam como o DONO, então o REVOKE não os alcança;
--      - nenhuma policy, view, índice, CHECK ou DEFAULT referencia as funções.
--
-- B) Chamada pelo front com o JWT do usuário → gate de org DENTRO da função,
--    via CREATE OR REPLACE (preserva o proacl; DROP+CREATE resetaria grants
--    para PUBLIC/anon — memória drop-create-function-reseta-grants):
--      - create_default_pipelines(uuid)   ← usePipelineEntries (V5 e clássica)
--      - get_lead_write_instance(uuid)    ← useLeadWriteInstance + edge fns
--    Gate: service_role passa; master passa; senão a org precisa estar em
--    get_my_organization_ids(). Recusa = 42501 'access_denied'.
--    Consequências medidas: membro de org bloqueada (suspensa/cancelada)
--    passa a receber 42501, coerente com get_my_organization_ids; e quem
--    chamar como postgres SEM claims (Management API, backfill, migration)
--    também recebe 42501 — hoje não há chamador assim (pg_stat_statements
--    desde 05/10: só authenticated e service_role). get_lead_write_instance
--    responde LEAD_NOT_FOUND antes do gate, de propósito: preserva o contrato
--    e o oráculo de existência exige adivinhar um uuid v4.
--
-- FORA DE PROPÓSITO (inventário completo no PR): helpers usados por policy
-- (has_role, contact_has_links), helper chamado por função INVOKER
-- (fn_assert_member_in_org), as que delegam a gate real (cobranca_* →
-- private.cobranca_exigir; master_* → assert_master_full; *_guided_* →
-- can_administer_guided_workflow; get_pending_orders → assert_org_member;
-- get_unread_total → get_unread_counts; realtime_subscription_plan →
-- realtime_can_join), e as de vazamento desprezível com chamador no front
-- (metric_period_bounds, org_access_blocked, validate_coupon).
--
-- GUARDA
-- Antes de mudar, confere em cada alvo: existe, é DEFINER, md5(prosrc) é o
-- medido em prod em 23/10, e o proacl só tem os grantees conhecidos. Qualquer
-- divergência aborta com P0001 (NUNCA 40001: o PostgREST repete 40001 para
-- sempre). As duas do tratamento B também aceitam o corpo já com gate, para a
-- migration ser reaplicável.
--
-- Rollback: supabase/migrations/rollback/20271215000000_definer_sem_gate_fecha_execucao.sql
-- Teste:    tests/integration/definer-sem-gate-fecha-execucao.test.ts
-- =============================================================================

SET LOCAL lock_timeout = '3s';

-- -----------------------------------------------------------------------------
-- Guarda
-- -----------------------------------------------------------------------------
DO $guard$
DECLARE
  r record;
  v_oid regprocedure;
  v_definer boolean;
  v_owner text;
  v_src text;
  v_acl aclitem[];
  v_grantee text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.process_overdue_subscriptions(integer)',              '434f1900831a3d8a77bb19758985d7fe', false),
      ('public.save_document_content(uuid,text)',                    '555bf64cb11a22825072c02f45fcbc5e', false),
      ('public.claim_campaign_dispatch_batch(uuid,integer)',         '79a6b2654f65d3d081fc36fa25927dc7', false),
      ('public.claim_pipe_dispatch_batch(text,integer)',             'b50c22632ce2fbffc4d0f3bd65f0e0ea', false),
      ('public.convert_pipe_rule_to_workflow(uuid)',                 'fd856fa2a4c73387e0262ac1d935e82f', false),
      ('public.convert_campaign_rule_to_workflow(uuid)',             '27bce6f4c2dcc63c1aefdfc8a29e638e', false),
      ('public.increment_conversation_turn(uuid,text)',              'f17934025705a610a370da05d988bf20', false),
      ('public.recalc_upsell_client_metrics(uuid)',                  '5b1447fc0315cd584586cf30bec50520', false),
      ('public.increment(text,uuid,text)',                           '5ffcbec2812cd0ec90326faaa4d72085', false),
      ('public.api_create_custom_field(uuid,text,text,jsonb,boolean)','4a4cb038e87cd13e3482ab08c4172613', false),
      ('public.api_set_custom_fields_creating(uuid,uuid,jsonb)',     '2ef8d6f5392f6b90109f820b72e385d0', false),
      ('public.api_list_team_members(uuid)',                         'd765b4e017faa0b84530c7ef0ee1d26f', false),
      ('public.cleanup_copilot_message_queue()',                     '70fbcddf40f7fc4150f23db6557e5085', false),
      ('public.purge_expired_rate_limits()',                         '77da9c7d467af62ffd52eab7e003600f', false),
      ('public.check_auth_rate_limit(text,text,integer,interval)',   '0bf5b084eb47a5c965c374d90fc9ad3f', false),
      ('public.claim_password_reset_token(text)',                    '47d8572fd9919f7ac743b9ed4ea24bde', false),
      ('public.try_provision_lock(text)',                            '269216e07e1e7dcbfd3fd8711c3fa50c', false),
      ('public.has_concurrent_ai_action(uuid,text,uuid)',            '605b38916f116775a4d509e0c6b2f325', false),
      ('public.fn_medicao_de_ruido(integer)',                        '2413d3220c442621c0d90b8b93c77ba6', false),
      ('public.fn_pico_de_avisos_quentes(integer)',                  '4f27b252356e4940c6c7467951f9a83a', false),
      ('public.fn_preferencias_de_aviso(uuid,uuid)',                 'bbbd0f33c0de65291cbc06529952bc9e', false),
      ('public.fn_dono_do_lead(uuid)',                               '9dd739b635682281bd5c91a8a4b3bab2', false),
      ('public.carteira_erp_source(uuid,uuid,text,text)',            '2f71b6acf74be37ce8bc2bd70bcb47e6', false),
      ('public.create_default_pipelines(uuid)',                      '850ba54adbe282159511d1ceb7950b5c', true),
      ('public.get_lead_write_instance(uuid)',                       'f65940512259cab7b50264a8896f1856', true)
    ) AS t(sig, md5_prod, ganha_gate)
  LOOP
    v_oid := to_regprocedure(r.sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'guarda definer_sem_gate: % não existe', r.sig USING ERRCODE = 'P0001';
    END IF;

    SELECT p.prosecdef, p.prosrc, p.proacl, p.proowner::regrole::text
      INTO v_definer, v_src, v_acl, v_owner
      FROM pg_proc p WHERE p.oid = v_oid;

    IF NOT v_definer THEN
      RAISE EXCEPTION 'guarda definer_sem_gate: % deixou de ser SECURITY DEFINER', r.sig
        USING ERRCODE = 'P0001';
    END IF;

    -- O REVOKE só é seguro porque os chamadores internos são DEFINER de dono
    -- postgres, que mantém EXECUTE como dono. Outro dono invalida a premissa.
    IF v_owner <> 'postgres' THEN
      RAISE EXCEPTION 'guarda definer_sem_gate: % tem dono % (esperado postgres)', r.sig, v_owner
        USING ERRCODE = 'P0001';
    END IF;

    IF md5(v_src) <> r.md5_prod
       AND NOT (r.ganha_gate AND v_src LIKE '%gate definer_sem_gate_20271215%') THEN
      RAISE EXCEPTION 'guarda definer_sem_gate: corpo de % divergiu do medido em prod (md5 % <> %)',
        r.sig, md5(v_src), r.md5_prod
        USING ERRCODE = 'P0001',
              HINT = 'Alguém mudou a função depois do inventário. Reler o corpo e reavaliar o tratamento.';
    END IF;

    -- proacl NULL = default do Postgres (PUBLIC executa); tratado como conhecido.
    FOR v_grantee IN
      SELECT a.grantee::regrole::text
        FROM aclexplode(COALESCE(v_acl, '{}'::aclitem[])) AS a
       WHERE a.grantee <> 0
    LOOP
      IF v_grantee NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
        RAISE EXCEPTION 'guarda definer_sem_gate: % tem grantee inesperado %', r.sig, v_grantee
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END LOOP;
END
$guard$;

-- -----------------------------------------------------------------------------
-- A) REVOKE: só service_role (e o dono postgres) executa
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.process_overdue_subscriptions(integer),
  public.save_document_content(uuid,text),
  public.claim_campaign_dispatch_batch(uuid,integer),
  public.claim_pipe_dispatch_batch(text,integer),
  public.convert_pipe_rule_to_workflow(uuid),
  public.convert_campaign_rule_to_workflow(uuid),
  public.increment_conversation_turn(uuid,text),
  public.recalc_upsell_client_metrics(uuid),
  public.increment(text,uuid,text),
  public.api_create_custom_field(uuid,text,text,jsonb,boolean),
  public.api_set_custom_fields_creating(uuid,uuid,jsonb),
  public.api_list_team_members(uuid),
  public.cleanup_copilot_message_queue(),
  public.purge_expired_rate_limits(),
  public.check_auth_rate_limit(text,text,integer,interval),
  public.claim_password_reset_token(text),
  public.try_provision_lock(text),
  public.has_concurrent_ai_action(uuid,text,uuid),
  public.fn_medicao_de_ruido(integer),
  public.fn_pico_de_avisos_quentes(integer),
  public.fn_preferencias_de_aviso(uuid,uuid),
  public.fn_dono_do_lead(uuid),
  public.carteira_erp_source(uuid,uuid,text,text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.process_overdue_subscriptions(integer),
  public.save_document_content(uuid,text),
  public.claim_campaign_dispatch_batch(uuid,integer),
  public.claim_pipe_dispatch_batch(text,integer),
  public.convert_pipe_rule_to_workflow(uuid),
  public.convert_campaign_rule_to_workflow(uuid),
  public.increment_conversation_turn(uuid,text),
  public.recalc_upsell_client_metrics(uuid),
  public.increment(text,uuid,text),
  public.api_create_custom_field(uuid,text,text,jsonb,boolean),
  public.api_set_custom_fields_creating(uuid,uuid,jsonb),
  public.api_list_team_members(uuid),
  public.cleanup_copilot_message_queue(),
  public.purge_expired_rate_limits(),
  public.check_auth_rate_limit(text,text,integer,interval),
  public.claim_password_reset_token(text),
  public.try_provision_lock(text),
  public.has_concurrent_ai_action(uuid,text,uuid),
  public.fn_medicao_de_ruido(integer),
  public.fn_pico_de_avisos_quentes(integer),
  public.fn_preferencias_de_aviso(uuid,uuid),
  public.fn_dono_do_lead(uuid),
  public.carteira_erp_source(uuid,uuid,text,text)
TO service_role;

-- -----------------------------------------------------------------------------
-- B) Gate de org dentro das duas que o front chama
-- -----------------------------------------------------------------------------
-- Corpo = o de prod em 23/10 + bloco de gate no topo. Nada mais mudou.

CREATE OR REPLACE FUNCTION public.create_default_pipelines(p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- gate definer_sem_gate_20271215: a org vem do cliente, então quem chama
  -- precisa pertencer a ela. service_role (edge fns) e master passam.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_master_user()
     AND NOT EXISTS (
       SELECT 1 FROM public.get_my_organization_ids() AS t(org_id)
        WHERE t.org_id = p_org_id
     ) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

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

  -- gate definer_sem_gate_20271215: o lead é de uma org; quem chama precisa
  -- pertencer a ela. service_role (whatsapp-api-proxy, workflow-executor,
  -- whatsapp-dispatch) e master passam.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_master_user()
     AND NOT EXISTS (
       SELECT 1 FROM public.get_my_organization_ids() AS t(org_id)
        WHERE t.org_id = v_org_id
     ) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
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

-- CREATE OR REPLACE preserva o proacl; normaliza mesmo assim (anon nunca).
REVOKE EXECUTE ON FUNCTION
  public.create_default_pipelines(uuid),
  public.get_lead_write_instance(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.create_default_pipelines(uuid),
  public.get_lead_write_instance(uuid)
TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Asserções: divergência aborta a transação inteira
-- -----------------------------------------------------------------------------
DO $assert$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.process_overdue_subscriptions(integer)',
    'public.save_document_content(uuid,text)',
    'public.claim_campaign_dispatch_batch(uuid,integer)',
    'public.claim_pipe_dispatch_batch(text,integer)',
    'public.convert_pipe_rule_to_workflow(uuid)',
    'public.convert_campaign_rule_to_workflow(uuid)',
    'public.increment_conversation_turn(uuid,text)',
    'public.recalc_upsell_client_metrics(uuid)',
    'public.increment(text,uuid,text)',
    'public.api_create_custom_field(uuid,text,text,jsonb,boolean)',
    'public.api_set_custom_fields_creating(uuid,uuid,jsonb)',
    'public.api_list_team_members(uuid)',
    'public.cleanup_copilot_message_queue()',
    'public.purge_expired_rate_limits()',
    'public.check_auth_rate_limit(text,text,integer,interval)',
    'public.claim_password_reset_token(text)',
    'public.try_provision_lock(text)',
    'public.has_concurrent_ai_action(uuid,text,uuid)',
    'public.fn_medicao_de_ruido(integer)',
    'public.fn_pico_de_avisos_quentes(integer)',
    'public.fn_preferencias_de_aviso(uuid,uuid)',
    'public.fn_dono_do_lead(uuid)',
    'public.carteira_erp_source(uuid,uuid,text,text)'
  ] LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE')
       OR has_function_privilege('authenticated', v_sig, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'asserção definer_sem_gate: ACL de % não ficou service_role-only', v_sig
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.create_default_pipelines(uuid)',
    'public.get_lead_write_instance(uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_sig, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_sig, 'EXECUTE')
       OR NOT (SELECT p.prosecdef AND p.prosrc LIKE '%gate definer_sem_gate_20271215%'
                 FROM pg_proc p WHERE p.oid = v_sig::regprocedure) THEN
      RAISE EXCEPTION 'asserção definer_sem_gate: % sem gate ou com ACL errada', v_sig
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$assert$;
