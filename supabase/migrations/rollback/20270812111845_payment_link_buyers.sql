-- Rollback de 20270812111845_payment_link_buyers.sql
--
-- ATENÇÃO — este rollback DESTRÓI O COMPRADOR. `payment_link_buyers` é a única
-- cópia do e-mail com que a Fatia 9 cria o admin de uma organização nova, e o
-- gateway não devolve o vínculo com a NOSSA proposta. Derrubar a tabela deixa
-- toda proposta `new_org` já paga sem como provisionar.
--
-- Só use enquanto a fatia estiver INERTE (nenhuma cobrança criada pelo checkout
-- público). Depois disso, o caminho é parar de escrever, não apagar.
--
-- E o `DROP CONSTRAINT` da §1 REABRE um furo em caminho vivo: sem ele nada
-- impede duas linhas com o mesmo `provider_charge_id`, e o `asaas-webhook` faz
-- `maybeSingle()` nessa busca engolindo o erro com 200 — organização nunca
-- ativada, em silêncio. Se o motivo do rollback for outro, NÃO derrube a
-- restrição junto: ela é independente do resto deste arquivo.

-- ATENÇÃO ADICIONAL: `billing_create_payment_link` (SCRUM-288) CHAMA
-- `billing_prefill_link_buyer`. Derrubar esta função sem reverter a SCRUM-288
-- junto quebra a GERAÇÃO DE LINK, não só o checkout.
DROP FUNCTION IF EXISTS public.billing_prefill_link_buyer(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.billing_resolve_charge_buyer(text);
DROP FUNCTION IF EXISTS public.billing_get_link_customer(uuid);
DROP FUNCTION IF EXISTS public.billing_upsert_link_buyer(uuid, text, text, text, text, text);

DROP TABLE IF EXISTS public.payment_link_buyers;

ALTER TABLE public.payment_link_charges
  DROP CONSTRAINT IF EXISTS payment_link_charges_provider_charge_id_key;

-- `billing_attach_link_charge` volta ao corpo de 20270811140000. Sem a segunda
-- restrição única, o `ON CONFLICT ON CONSTRAINT` sozinho volta a ser completo —
-- deixar a versão nova de pé também funcionaria, mas rollback que deixa código
-- novo para trás mente sobre o que reverteu.
CREATE OR REPLACE FUNCTION public.billing_attach_link_charge(
  p_link_id            uuid,
  p_method             text,
  p_provider           text,
  p_provider_charge_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $fn$
DECLARE
  v_row      public.payment_link_charges%ROWTYPE;
  v_criada   boolean := false;
  v_link     public.payment_links%ROWTYPE;
  v_expirado boolean := false;
BEGIN
  SELECT * INTO v_link FROM public.payment_links WHERE id = p_link_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'link_not_found');
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'link_revoked');
  END IF;
  IF v_link.paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'link_already_paid');
  END IF;

  v_expirado := v_link.expires_at <= now();

  INSERT INTO public.payment_link_charges
    (payment_link_id, method, provider, provider_charge_id)
  VALUES (p_link_id, p_method, p_provider, p_provider_charge_id)
  ON CONFLICT ON CONSTRAINT payment_link_charges_um_por_metodo DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_criada := true;
  ELSE
    SELECT * INTO v_row
      FROM public.payment_link_charges
     WHERE payment_link_id = p_link_id AND method = p_method;
  END IF;

  RETURN jsonb_build_object(
    'ok',                 true,
    'code',               'ok',
    'charge_id',          v_row.id,
    'provider',           v_row.provider,
    'provider_charge_id', v_row.provider_charge_id,
    'reused',             NOT v_criada,
    'expired_at_attach',  v_expirado);
END
$fn$;

REVOKE ALL ON FUNCTION public.billing_attach_link_charge(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_attach_link_charge(uuid,text,text,text) TO service_role;
