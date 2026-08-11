-- 20270811160000_payment_links_package.sql
--
-- SCRUM-288 (Fatia 7) — o link passa a carregar o PACOTE MONTADO, o motivo do
-- desconto manual e o cadastro fiscal.
-- ROLLBACK pareado: rollback/20270811160000_payment_links_package.sql
--
-- POR QUE ESTA MIGRATION EXISTE, E POR QUE ELA NÃO É EMENDA DA FATIA 5
-- -------------------------------------------------------------------
-- A Fatia 5 (20270811140000) desenhou o link com `quote` — a saída literal de
-- `billing_quote_price` — achando que preço era tudo que a proposta precisava
-- carregar. A Fatia 7, que é a TELA que gera o link, mostrou que não é. Três
-- coisas que o operador monta não tinham onde morar:
--
--   1. o PACOTE: features ligadas/desligadas e limites ajustados em relação ao
--      plano base. É o produto inteiro da tela, e `quote` não tem lugar para
--      ele — `quote` é composição de PREÇO, e enfiar pacote lá quebraria a
--      promessa escrita na própria coluna ("saída literal do motor");
--   2. o MOTIVO e o AUTOR do desconto manual. O valor já entrava no `quote`
--      via `p_manual_final_cents`, mas concessão sem motivo registrado não é
--      auditável — e `org_subscriptions`, que é o destino, já tem
--      `manual_discount_reason` e `manual_discount_by` esperando;
--   3. o CADASTRO FISCAL (razão social, CNPJ, e-mail fiscal). Medido no schema
--      inteiro: o billing NÃO tem onde guardar isso. `upsell_clients.cnpj` e
--      `tinyerp_connections.tiny_cnpj` são outros contextos. E o `ensureCustomer`
--      do port de pagamento precisa do documento.
--
-- A lacuna apareceu quando a tela foi escrita, e é assim que ela deve aparecer
-- no repositório: migration própria, revisável em separado, em vez de reabrir
-- uma fatia já aprovada e fingir que o contrato nasceu completo.
--
-- POR QUE O FISCAL FICA NO LINK, E NÃO EM TABELA DE CLIENTE
-- --------------------------------------------------------
-- Tabela de cliente precisa de dono, e no alvo `new_org` A ORG AINDA NÃO
-- EXISTE — é o link que vai criá-la. O link é a única entidade que existe no
-- momento da proposta nos DOIS alvos, então é onde o dado cabe hoje.
--
-- Quando o pagamento cair, a fatia de confirmação copia isto para onde o
-- cadastro do cliente viver: é ela que sabe que a org passou a existir. Se um
-- dia houver tabela de cliente de verdade, estas colunas viram a ORIGEM do
-- backfill, não concorrentes dela.
--
-- Consequência aceita, e dita em voz alta: duas propostas para o mesmo cliente
-- repetem o cadastro, e corrigir um typo numa não corrige a outra. É o preço de
-- não inventar dono para um dado que ainda não tem um.

ALTER TABLE public.payment_links
  -- O pacote montado. Espelha `org_subscriptions.features` e `.limits`, que é o
  -- destino — gravar lá vira cópia direta, não recálculo, e é a mesma escolha
  -- que a Fatia 3 fez para os campos de preço.
  --
  -- DEFAULT '{}' e NOT NULL: pacote ausente é pacote VAZIO (herda tudo do
  -- plano), nunca desconhecido. Nulo aqui obrigaria todo leitor a decidir o que
  -- fazer com a ausência, e leitor que decide sozinho diverge.
  ADD COLUMN IF NOT EXISTS package_features jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS package_limits   jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Desconto manual: valor, MOTIVO e autor.
  --
  -- O CHECK amarra os três: ou não há desconto manual, ou há e o motivo existe.
  -- "Motivo obrigatório" escrito só na tela é motivo que some no primeiro
  -- caminho alternativo — aqui é constraint, e vale para qualquer escrita.
  ADD COLUMN IF NOT EXISTS manual_discount_cents  integer,
  ADD COLUMN IF NOT EXISTS manual_discount_reason text,
  ADD COLUMN IF NOT EXISTS manual_discount_by     uuid,

  -- Cadastro fiscal do cliente da proposta.
  ADD COLUMN IF NOT EXISTS customer_legal_name text,
  ADD COLUMN IF NOT EXISTS customer_tax_id     text,
  ADD COLUMN IF NOT EXISTS customer_email      text;

-- O motivo do desconto é constraint, não convenção de tela.
ALTER TABLE public.payment_links
  DROP CONSTRAINT IF EXISTS payment_links_desconto_manual_tem_motivo_check;
ALTER TABLE public.payment_links
  ADD CONSTRAINT payment_links_desconto_manual_tem_motivo_check CHECK (
    (manual_discount_cents IS NULL)
    OR (
      manual_discount_cents >= 0
      AND manual_discount_reason IS NOT NULL
      AND length(btrim(manual_discount_reason)) >= 3
      AND manual_discount_by IS NOT NULL
    )
  );

-- CNPJ/CPF só como dígitos, e a normalização é do gravador, não do leitor.
-- `ensureCustomer` do gateway é idempotente POR DOCUMENTO: se cada proposta
-- gravar o mesmo CNPJ num formato diferente, o mesmo cliente vira dois lá fora.
ALTER TABLE public.payment_links
  DROP CONSTRAINT IF EXISTS payment_links_tax_id_digitos_check;
ALTER TABLE public.payment_links
  ADD CONSTRAINT payment_links_tax_id_digitos_check CHECK (
    customer_tax_id IS NULL OR customer_tax_id ~ '^[0-9]{11}$|^[0-9]{14}$'
  );

COMMENT ON COLUMN public.payment_links.package_features IS
  'SCRUM-288: features ligadas/desligadas em relação ao plano base. Espelha org_subscriptions.features — gravar no snapshot é cópia direta.';
COMMENT ON COLUMN public.payment_links.package_limits IS
  'SCRUM-288: limites ajustados em relação ao plano base. Espelha org_subscriptions.limits.';
COMMENT ON COLUMN public.payment_links.manual_discount_reason IS
  'SCRUM-288: motivo do desconto manual. Obrigatório por CHECK quando há desconto — concessão sem motivo não é auditável.';
COMMENT ON COLUMN public.payment_links.customer_tax_id IS
  'SCRUM-288: CPF (11) ou CNPJ (14), só dígitos. Normalizado na escrita porque ensureCustomer do gateway é idempotente por documento.';

-- ---------------------------------------------------------------------------
-- A geração passa a receber o pacote, o desconto manual e o fiscal
--
-- ⚠️ ISTO É `DROP` + `CREATE`, NÃO `CREATE OR REPLACE`: acrescentar parâmetro
-- muda a ASSINATURA, e `CREATE OR REPLACE` com lista diferente criaria uma
-- SEGUNDA função sobrecarregada em vez de substituir a primeira — duas portas
-- para a mesma coisa, e a antiga sem os campos novos.
--
-- E `DROP` + `CREATE` DEVOLVE EXECUTE A PUBLIC. Os REVOKE/GRANT no fim deste
-- arquivo não são cerimônia: sem eles, `anon` passaria a poder gerar link de
-- pagamento. O teste confere com `has_function_privilege` nome por nome
-- justamente porque este é o caminho em que o grant se perde em silêncio.
--
-- O PREÇO CONTINUA SENDO DO MOTOR. O operador digita o preço FINAL que
-- negociou (`p_manual_final_cents`); quem calcula quanto isso representa de
-- desconto é `billing_quote_price`, e a coluna `manual_discount_cents` é
-- preenchida com o que ELE devolveu. Se a tela subtraísse, seria a tela
-- calculando preço — a regra que esta fatia mais precisa não quebrar.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz);

CREATE OR REPLACE FUNCTION public.billing_create_payment_link(
  p_target_kind           text,
  p_organization_id       uuid,
  p_new_org_name          text,
  p_plan_id               uuid,
  p_user_count            integer,
  p_billing_cycle         text,
  p_payment_method        text,
  p_expires_at            timestamptz,
  p_package_features      jsonb   DEFAULT '{}'::jsonb,
  p_package_limits        jsonb   DEFAULT '{}'::jsonb,
  p_coupon_code           text    DEFAULT NULL,
  p_manual_final_cents    integer DEFAULT NULL,
  p_manual_discount_reason text   DEFAULT NULL,
  p_customer_legal_name   text    DEFAULT NULL,
  p_customer_tax_id       text    DEFAULT NULL,
  p_customer_email        text    DEFAULT NULL
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
  v_manual    integer;
  v_tax_id    text;
BEGIN
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

  -- Normalização do documento no GRAVADOR, não no leitor: `ensureCustomer` do
  -- gateway é idempotente por documento, então o mesmo CNPJ em dois formatos
  -- viraria dois clientes lá fora.
  v_tax_id := NULLIF(regexp_replace(COALESCE(p_customer_tax_id, ''), '[^0-9]', '', 'g'), '');

  -- O preço é do MOTOR, não do chamador. Master escolhe pacote, prazo e — se
  -- negociar — o preço final; quanto isso representa de desconto quem calcula é
  -- o motor.
  v_quote := public.billing_quote_price(
               p_plan_id, p_user_count, p_billing_cycle, p_payment_method,
               p_coupon_code, p_manual_final_cents);

  v_manual := NULLIF((v_quote ->> 'manual_discount_cents')::integer, 0);

  -- Rótulo da auditoria: o NOME de quem recebe a proposta.
  v_label := COALESCE(
    p_new_org_name,
    (SELECT name FROM public.organizations WHERE id = p_organization_id),
    '(sem nome)');

  v_token := 'tq_pay_' || encode(gen_random_bytes(16), 'hex');

  INSERT INTO public.payment_links (
    token_hash, target_kind, organization_id, new_org_name,
    quote, amount_cents, expires_at, created_by,
    package_features, package_limits,
    manual_discount_cents, manual_discount_reason, manual_discount_by,
    customer_legal_name, customer_tax_id, customer_email)
  VALUES (
    encode(digest(v_token, 'sha256'), 'hex'),
    p_target_kind,
    p_organization_id,
    p_new_org_name,
    v_quote,
    (v_quote ->> 'charge_cents')::integer,
    p_expires_at,
    v_actor,
    COALESCE(p_package_features, '{}'::jsonb),
    COALESCE(p_package_limits, '{}'::jsonb),
    v_manual,
    -- O autor do desconto é quem está gerando, resolvido do contexto de
    -- autenticação. Não é parâmetro: id de autor vindo do chamador é
    -- exatamente a forma das 23 RPCs fechadas hoje.
    CASE WHEN v_manual IS NOT NULL THEN p_manual_discount_reason END,
    CASE WHEN v_manual IS NOT NULL THEN v_actor END,
    p_customer_legal_name,
    v_tax_id,
    p_customer_email)
  RETURNING id INTO v_id;

  -- Auditoria. O token NÃO entra aqui — a auditoria é o lugar mais provável de
  -- um vazamento por descuido, e o teste varre esta tabela procurando por ele.
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
      'expires_at', p_expires_at,
      -- A concessão fica no rastro, com o motivo. É o ponto do "toda concessão
      -- fica auditável".
      'manual_discount_cents', v_manual,
      'manual_discount_reason', CASE WHEN v_manual IS NOT NULL THEN p_manual_discount_reason END,
      'package_features_alteradas', (SELECT count(*) FROM jsonb_object_keys(COALESCE(p_package_features, '{}'::jsonb))),
      'package_limits_alterados', (SELECT count(*) FROM jsonb_object_keys(COALESCE(p_package_limits, '{}'::jsonb)))));

  RETURN jsonb_build_object(
    'link_id',      v_id,
    'token',        v_token,
    'amount_cents', (v_quote ->> 'charge_cents')::integer,
    'quote',        v_quote,
    'expires_at',   p_expires_at);
END
$fn$;

-- Os grants, DE NOVO e por extenso, porque o DROP acima os levou.
REVOKE ALL ON FUNCTION public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz,jsonb,jsonb,text,integer,text,text,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz,jsonb,jsonb,text,integer,text,text,text,text) TO authenticated;
