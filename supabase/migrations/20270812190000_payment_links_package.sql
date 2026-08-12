-- 20270812190000_payment_links_package.sql
--
-- RENUMERADA de 20270811160000 → 20270812190000. O prefixo antigo já existia na
-- `main` E no ledger de produção sob outro nome
-- (20270811160000_payment_history_receipt_period_method.sql): `supabase db push`
-- teria PULADO este arquivo em silêncio. O guarda
-- `scripts/check-migration-versions.sh` (#1538) reprova essa colisão — mas só
-- depois de rebase, porque quem roda é o script do checkout.
--
-- SCRUM-288 (Fatia 7) — o link passa a carregar o PACOTE MONTADO e o motivo do
-- desconto manual. O cadastro fiscal do comprador, que a primeira versão desta
-- migration guardava em coluna aqui, passou a ir para `payment_link_buyers`
-- (Fatia 8) — ver o bloco "O CADASTRO FISCAL NÃO MORA AQUI" abaixo.
--
-- DEPENDÊNCIA DURA: esta migration CHAMA `billing_prefill_link_buyer`, criada em
-- `20270812111845_payment_link_buyers.sql` (PR #1553). Ela precisa estar aplicada
-- ANTES. A ordem numérica já garante isso; aplicar fora de ordem dá "function
-- does not exist", que é o jeito certo de falhar.
-- ROLLBACK pareado: rollback/20270812190000_payment_links_package.sql
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
--   3. o CADASTRO FISCAL do comprador (nome, documento, e-mail). Medido no
--      schema inteiro na época: o billing não tinha onde guardar isso.
--      `upsell_clients.cnpj` e `tinyerp_connections.tiny_cnpj` são outros
--      contextos. E o `ensureCustomer` do port de pagamento precisa do documento.
--
-- A lacuna apareceu quando a tela foi escrita, e é assim que ela deve aparecer
-- no repositório: migration própria, revisável em separado, em vez de reabrir
-- uma fatia já aprovada e fingir que o contrato nasceu completo.
--
-- O item 3 MUDOU DE DESTINO, não de existência
-- --------------------------------------------
-- A primeira versão desta migration resolveu o item 3 com três colunas AQUI,
-- argumentando que o link é a única entidade que existe nos dois alvos no
-- momento da proposta. O argumento sobre DONO estava certo; o que ele não pesou
-- foi ALCANCE — e alcance é o que decide onde PII mora.
--
-- A Fatia 8 abriu `payment_link_buyers`, chaveada por `payment_link_id` — ou
-- seja, o mesmo dono, e sem os grants do PostgREST. Então o item 3 continua
-- resolvido, no lugar certo, e ainda ganha uma coisa que a coluna aqui não
-- daria: pré-preenchimento do Master e preenchimento do comprador no checkout
-- são a MESMA linha, então o cliente corrige o que o Master chutou em vez de
-- criar uma segunda verdade.

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
  ADD COLUMN IF NOT EXISTS manual_discount_by     uuid;

-- O CADASTRO FISCAL NÃO MORA AQUI, e a decisão é o oposto da primeira versão
-- desta migration — que adicionava `customer_legal_name`, `customer_tax_id` e
-- `customer_email` nesta tabela.
--
-- Por que saiu, medido no banco local e não deduzido: `payment_links` tem
-- `relacl` com `anon=rxtm` e `authenticated=arwdDxtm` (o `ALTER DEFAULT
-- PRIVILEGES` que o próprio Supabase instala), e a ÚNICA coisa entre um usuário
-- logado e a linha é a policy `payment_links_master_read` (`is_master_user()`).
-- PII aqui fica a UMA policy de distância de qualquer autenticado.
--
-- A Fatia 8 (SCRUM-289) criou `payment_link_buyers` exatamente para isso não
-- acontecer: REVOKE de `anon`, `authenticated` E `service_role`, RLS ligada sem
-- policy nenhuma — fora do alcance do PostgREST por CONSTRUÇÃO. Guardar o mesmo
-- documento nos dois lugares anularia a razão de a tabela dela existir: a
-- inalcançável não vale nada se o mesmo CPF está na tabela ao lado, e ainda
-- criaria duas fontes de verdade para o mesmo comprador.
--
-- Os três PARÂMETROS continuam existindo em `billing_create_payment_link` — o
-- Master pré-preenche o comprador na geração, que é requisito do PRD — mas
-- escrevem em `payment_link_buyers` via `billing_prefill_link_buyer`. A chave de
-- lá é `payment_link_id`, então o pré-preenchimento do Master e o preenchimento
-- do comprador no checkout são a MESMA linha: o que o cliente digita corrige o
-- que o Master chutou, sem merge de dado.
--
-- Achado do Fole, aceito sem ressalva. Contrato fechado com ele em 2026-08-12.

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

-- O CHECK de dígitos do documento saiu junto com as colunas. Quem normaliza e
-- valida o documento é `billing_prefill_link_buyer`, e o CHECK de coerência
-- (`tax_id_kind` amarrado a `tax_id`) é da tabela do comprador. Uma regra, um
-- lugar: cópia da mesma validação em duas tabelas anda sozinha e diverge.

COMMENT ON COLUMN public.payment_links.package_features IS
  'SCRUM-288: features ligadas/desligadas em relação ao plano base. Espelha org_subscriptions.features — gravar no snapshot é cópia direta.';
COMMENT ON COLUMN public.payment_links.package_limits IS
  'SCRUM-288: limites ajustados em relação ao plano base. Espelha org_subscriptions.limits.';
COMMENT ON COLUMN public.payment_links.manual_discount_reason IS
  'SCRUM-288: motivo do desconto manual. Obrigatório por CHECK quando há desconto — concessão sem motivo não é auditável.';
COMMENT ON TABLE public.payment_links IS
  'Proposta de pagamento gerada pelo Master. NÃO guarda PII do comprador: nome, e-mail e documento fiscal moram em payment_link_buyers (SCRUM-289), que é inalcançável pelo PostgREST por REVOKE. Esta tabela tem GRANT para anon e authenticated e é protegida por policy — PII aqui ficaria a uma policy de distância.';

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

-- E a de 16 parâmetros também, que é a que ESTE arquivo cria. Não é paranoia,
-- é erro medido: `CREATE OR REPLACE` recusa RENOMEAR parâmetro —
--
--   ERROR: cannot change name of input parameter "p_customer_legal_name"
--
-- e a primeira versão desta migration chamava os três de `p_customer_*`. Em
-- produção a de 16 nunca existiu, então esta linha é no-op lá; em qualquer banco
-- que aplicou a versão pré-contrato (o local compartilhado, por exemplo) ela é a
-- diferença entre aplicar e morrer no meio. Os tipos são idênticos nas duas
-- versões — só os nomes mudaram —, então uma assinatura cobre as duas.
DROP FUNCTION IF EXISTS public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz,jsonb,jsonb,text,integer,text,text,text,text);

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
  -- `p_buyer_*` e não `p_customer_*`: neste codebase `customer` já significa o
  -- CADASTRO NO GATEWAY (`provider_customer_id`, `ProviderCustomer`,
  -- `CustomerInput` do port). Nomear a pessoa de `customer_*` faria
  -- `customer_tax_id` e `provider_customer_id` parecerem a mesma família, e não
  -- são: um é o comprador, o outro é o registro dele na Asaas. Renomeado a
  -- pedido do Fole, antes de mergear — depois seria caro.
  p_buyer_legal_name      text    DEFAULT NULL,
  p_buyer_tax_id          text    DEFAULT NULL,
  p_buyer_email           text    DEFAULT NULL
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
  v_buyer     jsonb;
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
    manual_discount_cents, manual_discount_reason, manual_discount_by)
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
    CASE WHEN v_manual IS NOT NULL THEN v_actor END)
  RETURNING id INTO v_id;

  -- O COMPRADOR VAI PARA A TABELA DELE, na mesma transação.
  --
  -- O QUE TORNA ISTO SEGURO É QUE O ALVO NÃO VEM DO CHAMADOR.
  --
  -- `v_id` é o id que o `RETURNING` acima acabou de cunhar. Quem chama a RPC não
  -- escolhe em qual link o comprador é gravado. Se este parâmetro viesse de
  -- fora, isto seria a 24ª da família fechada em 2026-08-11: `authenticated`
  -- escrevendo comprador no link de outro. A composição é
  -- `authenticated` → [gate de master] → `postgres` → porta, com o gate ANTES e
  -- o alvo não-controlável — autorização separada de execução, como a casa já
  -- adotou. Achado do Sentinela: o comentário anterior explicava por que
  -- FUNCIONA, e não por que é SEGURO.
  --
  -- O mecanismo, para quem precisar dele: EXECUTE é conferido contra o usuário
  -- EFETIVO, e dentro de `SECURITY DEFINER` esse usuário é o dono (`postgres`).
  -- Por isso o grant `service_role`-only da porta não barra este caminho e
  -- continua barrando o PostgREST. Chamada DEPOIS do INSERT porque a PK de
  -- `payment_link_buyers` é FK deste `id`.
  --
  -- ELA LEVANTA em vez de devolver código, e isso ABORTA A CRIAÇÃO DO LINK
  -- junto. É o desfecho certo: aqui nada aconteceu do lado de fora ainda
  -- (não existe cobrança nem cliente no gateway), é entrada de formulário do
  -- Master. Link que nasce com documento impossível vira cobrança que não pode
  -- ser criada, descoberta na frente do cliente. Falhar na geração é barato.
  --
  -- Master que não preencheu nada recebe `noop` e NENHUMA linha de comprador —
  -- pré-preencher é opcional, e linha vazia seria dado inventado.
  v_buyer := public.billing_prefill_link_buyer(
               v_id, p_buyer_legal_name, p_buyer_email, p_buyer_tax_id);

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
      'package_limits_alterados', (SELECT count(*) FROM jsonb_object_keys(COALESCE(p_package_limits, '{}'::jsonb))),
      -- FATO, não dado: registra que houve pré-preenchimento de comprador, e
      -- nada do que foi preenchido. Nome, e-mail e documento NUNCA entram em
      -- master_audit_logs — a auditoria é tabela lida por gente e é o lugar
      -- mais provável de um vazamento por descuido.
      'buyer_prefilled', (v_buyer ->> 'code') = 'ok'));

  RETURN jsonb_build_object(
    'link_id',        v_id,
    'token',          v_token,
    'amount_cents',   (v_quote ->> 'charge_cents')::integer,
    'quote',          v_quote,
    'expires_at',     p_expires_at,
    -- Estado, não dado: a tela precisa saber se o comprador foi pré-preenchido
    -- para não oferecer "preencher" duas vezes. Devolver o que foi preenchido
    -- traria PII de volta pelo retorno da RPC — o caminho que esta fatia acabou
    -- de fechar.
    'buyer_prefilled', (v_buyer ->> 'code') = 'ok');
END
$fn$;

-- O CONTRATO DA FUNÇÃO FICA NO CATÁLOGO, não só neste arquivo. Quem chama lê
-- `\df+` ou o Studio, não a migration de seis meses atrás.
--
-- E a linha do MENSAL está aqui porque o nome do parâmetro mente por omissão:
-- `p_manual_final_cents` é o preço MENSAL negociado, e mandar o total de um
-- ciclo anual não gera desconto — gera cobrança 12x maior, em silêncio. Custou
-- duas asserções vermelhas para aparecer, e numa tela apareceria no extrato do
-- cliente. Renomear é fatia própria (o parâmetro é de `billing_quote_price`,
-- #1381), e enquanto não for, o aviso vive onde o chamador olha.
COMMENT ON FUNCTION public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz,jsonb,jsonb,text,integer,text,text,text,text) IS
  'SCRUM-288: gera a proposta com pacote montado e desconto manual auditável. p_manual_final_cents é o preço MENSAL negociado, NÃO o total da cobrança — mandar o total de um ciclo anual devolve desconto 0 e cobra 12x. Os três p_buyer_* NÃO viram coluna em payment_links: vão para payment_link_buyers via billing_prefill_link_buyer, que LEVANTA em dado inválido e derruba a criação do link junto. Autorização no corpo (master), grant para authenticated porque o Master é um usuário autenticado.';

-- O mesmo aviso na origem do parâmetro. Comentário não muda comportamento e não
-- disputa arquivo com ninguém; o objeto é da Fatia 3 (#1381) e o texto anterior
-- dele fica preservado, só ganha a linha que faltava.
COMMENT ON FUNCTION public.billing_quote_price(uuid,integer,text,text,text,integer) IS
  'Motor de preço do checkout (#1381). Cascata multiplicativa: base+assentos → ciclo → cupom → override manual. Centavos inteiros. EXECUTE apenas service_role: a edge function do link é quem autoriza. ATENÇÃO: p_manual_final_cents é o preço MENSAL, não o total do ciclo — passar o total devolve manual_discount_cents = 0 e multiplica a cobrança pelo número de meses, sem erro. Medido em 2026-08-12 (SCRUM-288).';

-- Os grants, DE NOVO e por extenso, porque o DROP acima os levou.
REVOKE ALL ON FUNCTION public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz,jsonb,jsonb,text,integer,text,text,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz,jsonb,jsonb,text,integer,text,text,text,text) TO authenticated;
