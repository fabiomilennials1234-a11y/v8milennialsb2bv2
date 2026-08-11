-- 20270811140000_payment_links.sql
--
-- SCRUM-286 — Fatia 5 do billing: link de pagamento (geração, hash, alvo,
-- revogação). Contrato fechado em #1383.
-- ROLLBACK pareado: rollback/20270811140000_payment_links.sql
--
-- O MOLDE É `generate_api_key`, E O PONTO É O QUE NÃO SE GUARDA
-- ------------------------------------------------------------
-- Só o SHA-256 de 16 bytes aleatórios entra na tabela. O texto do link existe
-- uma única vez: no retorno da função de geração, que o Master copia na hora.
-- Consequência que vale escrever: dump de banco NÃO entrega link vivo, e nem o
-- próprio Master consegue recuperar um link depois — se perdeu, gera outro e
-- revoga o anterior. Isso é desenho, não limitação.
--
-- UMA COBRANÇA POR (link, método), REAPROVEITADA
-- ----------------------------------------------
-- A idempotência mora no LINK, não no clique. Fecha três problemas de uma vez:
-- QR velho circulando, entulho de cobrança pendente no Asaas, e recarregar a
-- página virando gerador de cobrança.
--
-- AUTORIDADE
-- ----------
-- Gerar e revogar são de MASTER (`is_master_user()`), verificado no CORPO das
-- funções. Gestor de portfólio NÃO entra: o papel está inerte com zero
-- ocupantes, e não se desenha autoridade para papel vazio (ADR-0021).
--
-- ESTA MIGRATION NASCE DEPOIS DE 23 RPCs FECHADAS NO MESMO DIA
-- -----------------------------------------------------------
-- Todas eram SECURITY DEFINER, recebiam id por parâmetro e não confrontavam
-- nada com o contexto de autenticação — escrita e leitura cross-tenant. As
-- quatro funções abaixo seguem a regra que saiu daquilo:
--   1. DEFINER → autorização no CORPO, não no grant;
--   2. EXECUTE só para quem precisa, conferido com `has_function_privilege`
--      depois de criar, porque `DROP + CREATE` devolve EXECUTE a PUBLIC;
--   3. nenhum id vindo do chamador é usado sem ser confrontado com quem chama;
--   4. tabela com `organization_id` → RLS ligada e policy.
--
-- O QUE ESTA MIGRATION NÃO FAZ: não cobra, não provisiona org, não troca
-- snapshot de ninguém. Ela cria a PROPOSTA e o caminho de volta pelo hash. O
-- efeito no pagamento é fatia seguinte — e por isso gerar link para org
-- existente não toca em NENHUM dado operacional: ninguém perde lead, conversa
-- ou histórico por causa de uma proposta.

-- ---------------------------------------------------------------------------
-- 1. A proposta
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Só o hash. Nunca o texto. UNIQUE porque é por ele que se resolve.
  token_hash        text        NOT NULL UNIQUE,
  -- Prefixo curto para o Master reconhecer a proposta na lista sem que isso
  -- torne o link adivinhável: são 8 chars fixos de rótulo, não de segredo.
  token_prefix      text        NOT NULL,

  -- O ALVO. Criar org nova OU trocar o pacote de uma org existente.
  target_kind       text        NOT NULL,
  organization_id   uuid        REFERENCES public.organizations(id) ON DELETE CASCADE,
  new_org_name      text,

  -- O preço CONGELADO na geração, saída literal de `billing_quote_price`. A
  -- proposta não pode mudar de valor entre o envio e o pagamento porque alguém
  -- mexeu no catálogo no meio.
  quote             jsonb       NOT NULL,
  amount_cents      integer     NOT NULL CHECK (amount_cents >= 0),

  -- Validade definida pelo Master, não prazo fixo no código.
  expires_at        timestamptz NOT NULL,

  -- Revogação é ESTADO, não deleção: a proposta desatualizada continua no
  -- histórico, com quem revogou e por quê.
  revoked_at        timestamptz,
  revoked_by        uuid,
  revoked_reason    text,

  paid_at           timestamptz,

  created_by        uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_links_target_kind_check
    CHECK (target_kind IN ('new_org', 'existing_org')),

  -- O alvo é coerente por construção, não por disciplina de quem escreve:
  -- org existente exige a org e proíbe o nome novo, e vice-versa.
  CONSTRAINT payment_links_target_coerente_check CHECK (
    (target_kind = 'existing_org' AND organization_id IS NOT NULL AND new_org_name IS NULL)
    OR
    (target_kind = 'new_org' AND organization_id IS NULL AND new_org_name IS NOT NULL)
  )
);

COMMENT ON TABLE public.payment_links IS
  'SCRUM-286: proposta de pagamento. Guarda o SHA-256 do token, nunca o texto — o link é irrecuperável depois da geração, por desenho.';
COMMENT ON COLUMN public.payment_links.quote IS
  'Saída literal de billing_quote_price na geração. Preço congelado: mexer no catálogo depois não muda proposta já enviada.';

CREATE INDEX IF NOT EXISTS idx_payment_links_org ON public.payment_links (organization_id)
  WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_links_abertos ON public.payment_links (expires_at)
  WHERE revoked_at IS NULL AND paid_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. A cobrança do link — uma por (link, método)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_link_charges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_link_id     uuid        NOT NULL REFERENCES public.payment_links(id) ON DELETE CASCADE,
  method              text        NOT NULL,
  provider            text        NOT NULL,
  provider_charge_id  text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_link_charges_method_check
    CHECK (method IN ('pix', 'boleto', 'credit_card')),

  -- A idempotência mora AQUI. Não é o chamador que lembra de não duplicar; é a
  -- chave que não deixa.
  CONSTRAINT payment_link_charges_um_por_metodo UNIQUE (payment_link_id, method)
);

COMMENT ON TABLE public.payment_link_charges IS
  'SCRUM-286: uma cobrança por (link, método), reaproveitada. Fecha QR velho, entulho de cobrança pendente no gateway e recarregar-a-página-gera-cobrança.';

-- ---------------------------------------------------------------------------
-- 3. RLS
--
-- `payment_links` tem `organization_id`, então é regra dura da casa. E
-- `payment_link_charges` liga também, mesmo sem a coluna: é linha derivada de
-- tenant, e sem RLS o INV-5 (20270811120000) a acusaria no dia seguinte — com
-- razão.
--
-- A policy é de MASTER e usa o helper SECURITY DEFINER, nunca um SELECT inline
-- numa tabela que também tem RLS: subquery inline causa recursão quando o
-- Realtime avalia `apply_rls()`.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_link_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_links_master_all ON public.payment_links;
CREATE POLICY payment_links_master_all ON public.payment_links
  FOR ALL TO authenticated
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

DROP POLICY IF EXISTS payment_link_charges_master_read ON public.payment_link_charges;
CREATE POLICY payment_link_charges_master_read ON public.payment_link_charges
  FOR SELECT TO authenticated
  USING (public.is_master_user());

-- ---------------------------------------------------------------------------
-- 4. Geração — autoridade de master
--
-- `search_path` inclui `extensions` porque `gen_random_bytes` e `digest` do
-- pgcrypto vivem lá no Supabase. Foi exatamente o defeito que quebrou
-- `generate_api_key` em TODAS as orgs (20260615153845) — o molde inclui a
-- correção dele, não só a forma.
-- ---------------------------------------------------------------------------
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
  v_token  text;
  v_quote  jsonb;
  v_id       uuid;
  v_actor    uuid := auth.uid();
  -- `master_audit_logs.master_user_id` referencia `master_users.id`, NÃO o
  -- `auth.uid()` — a coluna do usuário é `user_id`. A FK é quem ensina isso, e
  -- ela ensinou aqui.
  v_master_id uuid;
BEGIN
  -- Autorização no CORPO. O grant deixa `authenticated` chamar porque o Master
  -- é um usuário autenticado; quem barra o não-master é esta linha.
  SELECT id INTO v_master_id
    FROM public.master_users
   WHERE user_id = v_actor AND is_active = true;

  -- Autorização no CORPO, e ela é a MESMA leitura que produz o id da
  -- auditoria: não há caminho em que o rastro exista sem o gate ter passado.
  --
  -- POR QUE ESTA FUNÇÃO TEM GRANT PARA `authenticated`, e por que isso NÃO é
  -- grant por omissão — leia antes de "consertar":
  --
  --   `is_master_user()` resolve por `auth.uid()`. O Master É um usuário
  --   autenticado, então o EXECUTE para `authenticated` PRECISA existir para
  --   que ele consiga chamar isto do front. Quem barra o não-master é a linha
  --   abaixo, não o grant.
  --
  --   Tirar o grant não deixa a função mais segura: deixa o Master sem
  --   caminho. E é exatamente a distinção que faltava nas 23 RPCs fechadas em
  --   2026-08-11 por escrita e leitura cross-tenant — elas tinham o mesmo
  --   grant e NÃO tinham este gate.
  IF v_master_id IS NULL THEN
    RAISE EXCEPTION 'Forbidden: geração de link de pagamento é autoridade de master';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Validade do link precisa ser futura';
  END IF;

  -- O preço é do MOTOR, não do chamador. Master escolhe pacote e prazo; quanto
  -- custa não é campo de formulário.
  v_quote := public.billing_quote_price(
               p_plan_id, p_user_count, p_billing_cycle, p_payment_method, NULL, NULL);

  -- 16 bytes aleatórios. O prefixo é rótulo, e por isso é fixo e não entra na
  -- conta da entropia.
  v_token := 'tq_pay_' || encode(gen_random_bytes(16), 'hex');

  INSERT INTO public.payment_links (
    token_hash, token_prefix, target_kind, organization_id, new_org_name,
    quote, amount_cents, expires_at, created_by)
  VALUES (
    encode(digest(v_token, 'sha256'), 'hex'),
    left(v_token, 11),
    p_target_kind,
    p_organization_id,
    p_new_org_name,
    v_quote,
    (v_quote ->> 'charge_cents')::integer,
    p_expires_at,
    v_actor)
  RETURNING id INTO v_id;

  -- Auditoria. O token NÃO entra aqui — a auditoria é o lugar mais provável de
  -- um vazamento por descuido, e o teste varre esta tabela procurando por ele.
  INSERT INTO public.master_audit_logs
    (master_user_id, user_id, action, target_type, target_id, target_name, details)
  VALUES (
    v_master_id, v_actor, 'payment_link_created', 'payment_link', v_id, left(v_token, 11),
    jsonb_build_object(
      'target_kind', p_target_kind,
      'organization_id', p_organization_id,
      'new_org_name', p_new_org_name,
      'amount_cents', (v_quote ->> 'charge_cents')::integer,
      'billing_cycle', p_billing_cycle,
      'expires_at', p_expires_at));

  -- O token sai daqui e nunca mais.
  RETURN jsonb_build_object(
    'link_id',      v_id,
    'token',        v_token,
    'prefix',       left(v_token, 11),
    'amount_cents', (v_quote ->> 'charge_cents')::integer,
    'expires_at',   p_expires_at);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Revogação — para proposta desatualizada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_revoke_payment_link(
  p_link_id uuid,
  p_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $fn$
DECLARE
  v_actor     uuid := auth.uid();
  v_master_id uuid;
  v_prefix    text;
BEGIN
  SELECT id INTO v_master_id
    FROM public.master_users
   WHERE user_id = v_actor AND is_active = true;

  -- Mesmo desenho da geração: grant para `authenticated` porque o Master é um
  -- usuário autenticado, e o gate é esta linha. Ver o bloco em
  -- `billing_create_payment_link` para o porquê completo.
  IF v_master_id IS NULL THEN
    RAISE EXCEPTION 'Forbidden: revogação de link de pagamento é autoridade de master';
  END IF;

  UPDATE public.payment_links
     SET revoked_at = now(), revoked_by = v_actor, revoked_reason = p_reason
   WHERE id = p_link_id
     AND revoked_at IS NULL
  RETURNING token_prefix INTO v_prefix;

  IF v_prefix IS NULL THEN
    -- Já revogado ou inexistente. Não é erro: revogar duas vezes é inofensivo.
    RETURN jsonb_build_object('ok', true, 'code', 'nothing_to_revoke');
  END IF;

  INSERT INTO public.master_audit_logs
    (master_user_id, user_id, action, target_type, target_id, target_name, details)
  VALUES (v_master_id, v_actor, 'payment_link_revoked', 'payment_link', p_link_id, v_prefix,
          jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'code', 'revoked');
END
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Resolução pelo hash — service_role only
--
-- A página de pagamento é pública, mas ela NÃO fala com o banco: fala com uma
-- edge function, que fala com o banco como `service_role`. Por isso nem `anon`
-- nem `authenticated` executam isto — quem tem o link não precisa de conta, e
-- quem tem conta não ganha nada por isso.
--
-- Devolve CÓDIGO, não exceção, para cada recusa: o chamador é código nosso e
-- precisa distinguir expirado de revogado para escolher a mensagem. Nada do que
-- volta identifica outra proposta nem outra organização.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_resolve_payment_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $fn$
DECLARE
  v_link public.payment_links%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'link_not_found');
  END IF;

  SELECT * INTO v_link
    FROM public.payment_links
   WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'link_not_found');
  END IF;

  IF v_link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'link_revoked');
  END IF;

  IF v_link.paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'link_already_paid');
  END IF;

  IF v_link.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'link_expired');
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'code',            'ok',
    'link_id',         v_link.id,
    'target_kind',     v_link.target_kind,
    'organization_id', v_link.organization_id,
    'new_org_name',    v_link.new_org_name,
    'quote',           v_link.quote,
    'amount_cents',    v_link.amount_cents,
    'expires_at',      v_link.expires_at);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Amarrar a cobrança ao link — idempotente por (link, método)
-- ---------------------------------------------------------------------------
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
  v_row     public.payment_link_charges%ROWTYPE;
  v_criada  boolean := false;
BEGIN
  INSERT INTO public.payment_link_charges
    (payment_link_id, method, provider, provider_charge_id)
  VALUES (p_link_id, p_method, p_provider, p_provider_charge_id)
  ON CONFLICT ON CONSTRAINT payment_link_charges_um_por_metodo DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_criada := true;
  ELSE
    -- Já existia: devolve a MESMA cobrança. É isto que impede o QR velho e o
    -- entulho no gateway — o segundo clique não cria nada.
    SELECT * INTO v_row
      FROM public.payment_link_charges
     WHERE payment_link_id = p_link_id AND method = p_method;
  END IF;

  RETURN jsonb_build_object(
    'charge_id',          v_row.id,
    'provider',           v_row.provider,
    'provider_charge_id', v_row.provider_charge_id,
    'reused',             NOT v_criada);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 8. Grants
--
-- `CREATE OR REPLACE` preserva grant de versão anterior e `DROP + CREATE`
-- devolve EXECUTE a PUBLIC. Os REVOKE abaixo são explícitos por role para
-- fechar nos dois casos — e o teste confere com `has_function_privilege` nome
-- por nome, porque grant é estado a medir, não a supor.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.billing_revoke_payment_link(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_revoke_payment_link(uuid,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.billing_resolve_payment_link(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_resolve_payment_link(text) TO service_role;

REVOKE ALL ON FUNCTION public.billing_attach_link_charge(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_attach_link_charge(uuid,text,text,text) TO service_role;
