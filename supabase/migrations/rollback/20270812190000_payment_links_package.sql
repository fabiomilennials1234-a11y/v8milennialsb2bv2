-- Rollback de 20270812190000_payment_links_package.sql
--
-- ATENÇÃO — este rollback DESTRÓI DADO DE PROPOSTA: o pacote montado e o motivo
-- do desconto concedido. O `quote` e o hash sobrevivem (são da Fatia 5), mas uma
-- proposta que já circulou perde o que o operador montou, e não há de onde
-- reconstruir.
--
-- E O QUE ELE DESTRÓI QUE NÃO É ÓBVIO: `manual_discount_reason` e
-- `manual_discount_by`. Cai o MOTIVO e o AUTOR de toda concessão registrada
-- enquanto a fatia esteve viva. É recuperável — `master_audit_logs` grava os
-- dois no `details` de `payment_link_created` —, mas recuperar é trabalho
-- manual, e quem roda isto às pressas não vai saber que precisa.
--
-- O COMPRADOR NÃO É TOCADO AQUI, de propósito. Ele vive em
-- `payment_link_buyers` (Fatia 8) e desfazer aquela tabela é do rollback dela.
-- E não há PII órfã por um motivo mais simples do que a cascata: este arquivo
-- NÃO apaga link nenhum. Ele derruba cinco colunas e restaura a função de 8
-- parâmetros. Sem link morrendo, não há o que orfanar. (A FK de lá é
-- `ON DELETE CASCADE`, então nem no cenário de deleção haveria — mas esse
-- cenário não é este. Correção do Sentinela: decisão certa, argumento errado.)
--
-- Este arquivo é o inverso EXATO da migration, e nada além. Banco que aplicou a
-- versão pré-contrato (a que adicionava `customer_legal_name`, `customer_tax_id`
-- e `customer_email` em `payment_links`) tem essas três colunas sobrando, e
-- limpá-las é ato à parte, na mão, com quem for dono do banco — não trabalho de
-- rollback, que não deve derrubar coluna que a sua migration não criou.
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
  DROP CONSTRAINT IF EXISTS payment_links_desconto_manual_tem_motivo_check;

ALTER TABLE public.payment_links
  DROP COLUMN IF EXISTS package_features,
  DROP COLUMN IF EXISTS package_limits,
  DROP COLUMN IF EXISTS manual_discount_cents,
  DROP COLUMN IF EXISTS manual_discount_reason,
  DROP COLUMN IF EXISTS manual_discount_by;

-- O COMMENT ON TABLE volta ao que a Fatia 5 escreveu, senão o rollback deixa a
-- tabela anunciando um contrato de PII que este arquivo acabou de desfazer.
COMMENT ON TABLE public.payment_links IS
  'SCRUM-286: proposta de pagamento. Guarda o SHA-256 do token, nunca o texto — o link é irrecuperável depois da geração, por desenho.';
