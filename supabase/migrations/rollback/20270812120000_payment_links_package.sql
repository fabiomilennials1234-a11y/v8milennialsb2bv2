-- Rollback de 20270812120000_payment_links_package.sql
--
-- ATENÇÃO — este rollback DESTRÓI DADO DE PROPOSTA: o pacote montado, o motivo
-- do desconto concedido e o cadastro fiscal. O `quote` e o hash sobrevivem
-- (são da Fatia 5), mas uma proposta que já circulou perde o que o operador
-- montou, e não há de onde reconstruir.
--
-- Só use enquanto a fatia estiver INERTE — nenhum link gerado com pacote. Se
-- já houver, o caminho é revogar os links e deixar as colunas de pé.
--
-- A função volta à assinatura da Fatia 5, e os grants dela vão RECOLOCADOS
-- explicitamente: `DROP` + `CREATE` devolve EXECUTE a PUBLIC, e um rollback que
-- esquecesse isso deixaria `anon` gerando link de pagamento — pior que o
-- estado que se queria desfazer.

DROP FUNCTION IF EXISTS public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz,jsonb,jsonb,text,integer,text,text,text,text);

CREATE OR REPLACE FUNCTION public.billing_create_payment_link(
  p_target_kind      text,
  p_organization_id  uuid,
  p_new_org_name     text,
  p_plan_id          uuid,
  p_user_count       integer,
  p_billing_cycle    text,
  p_payment_method   text,
  p_expires_at       timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $fn$
DECLARE
  v_token     text;
  v_quote     jsonb;
  v_id        uuid;
  v_actor     uuid := auth.uid();
  v_master_id uuid;
  v_label     text;
BEGIN
  SELECT id INTO v_master_id
    FROM public.master_users
   WHERE user_id = v_actor AND is_active = true;

  IF v_master_id IS NULL THEN
    RAISE EXCEPTION 'Forbidden: geração de link de pagamento é autoridade de master';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Validade do link precisa ser futura';
  END IF;

  v_quote := public.billing_quote_price(
               p_plan_id, p_user_count, p_billing_cycle, p_payment_method, NULL, NULL);

  v_label := COALESCE(
    p_new_org_name,
    (SELECT name FROM public.organizations WHERE id = p_organization_id),
    '(sem nome)');

  v_token := 'tq_pay_' || encode(gen_random_bytes(16), 'hex');

  INSERT INTO public.payment_links (
    token_hash, target_kind, organization_id, new_org_name,
    quote, amount_cents, expires_at, created_by)
  VALUES (
    encode(digest(v_token, 'sha256'), 'hex'),
    p_target_kind, p_organization_id, p_new_org_name, v_quote,
    (v_quote ->> 'charge_cents')::integer, p_expires_at, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.master_audit_logs
    (master_user_id, user_id, action, target_type, target_id, target_name, details)
  VALUES (
    v_master_id, v_actor, 'payment_link_created', 'payment_link', v_id, v_label,
    jsonb_build_object(
      'target_kind', p_target_kind,
      'organization_id', p_organization_id,
      'new_org_name', p_new_org_name,
      'amount_cents', (v_quote ->> 'charge_cents')::integer,
      'billing_cycle', p_billing_cycle,
      'expires_at', p_expires_at));

  RETURN jsonb_build_object(
    'link_id',      v_id,
    'token',        v_token,
    'amount_cents', (v_quote ->> 'charge_cents')::integer,
    'expires_at',   p_expires_at);
END
$fn$;

REVOKE ALL ON FUNCTION public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz) TO authenticated;

ALTER TABLE public.payment_links
  DROP CONSTRAINT IF EXISTS payment_links_desconto_manual_tem_motivo_check,
  DROP CONSTRAINT IF EXISTS payment_links_tax_id_digitos_check;

ALTER TABLE public.payment_links
  DROP COLUMN IF EXISTS package_features,
  DROP COLUMN IF EXISTS package_limits,
  DROP COLUMN IF EXISTS manual_discount_cents,
  DROP COLUMN IF EXISTS manual_discount_reason,
  DROP COLUMN IF EXISTS manual_discount_by,
  DROP COLUMN IF EXISTS customer_legal_name,
  DROP COLUMN IF EXISTS customer_tax_id,
  DROP COLUMN IF EXISTS customer_email;
