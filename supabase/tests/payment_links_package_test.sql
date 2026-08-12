-- supabase/tests/payment_links_package_test.sql
--
-- SCRUM-288 (Fatia 7 do billing) — o link passa a carregar o PACOTE MONTADO e o
-- desconto manual auditável, e o comprador pré-preenchido pelo Master vai para
-- `payment_link_buyers` (Fatia 8), NÃO para coluna em `payment_links`.
--
-- AS ASSERÇÕES QUE MANDAM AQUI SÃO AS NEGATIVAS, e elas existem porque a
-- primeira versão desta fatia fazia o contrário: adicionava
-- `customer_legal_name`, `customer_tax_id` e `customer_email` em
-- `payment_links`. Medido no banco: essa tabela tem `relacl` com `anon=rxtm` e
-- `authenticated=arwdDxtm` (o `ALTER DEFAULT PRIVILEGES` do próprio Supabase), e
-- a única coisa entre um autenticado e a linha é a policy
-- `payment_links_master_read`. PII ali fica a UMA policy de distância; em
-- `payment_link_buyers` ela está fora do alcance do PostgREST por REVOKE.
--
-- Então este arquivo prova as três colunas AUSENTES, e não só o caminho novo
-- funcionando. Sem isso, alguém as recria em seis meses "para a tela não fazer
-- dois saltos" e nada fica vermelho.
--
-- A OUTRA PROVA QUE VALE O ARQUIVO É A ATOMICIDADE: `billing_prefill_link_buyer`
-- LEVANTA em vez de devolver código, e por isso comprador inválido tem que
-- derrubar a criação do link JUNTO. Um link que nasce com documento impossível
-- vira cobrança que não pode ser criada, descoberta na frente do cliente.
--
-- DEPENDE de `20270812111845_payment_link_buyers.sql` (Fatia 8) estar aplicada:
-- é dela a tabela e a porta.
--
-- Run: supabase start && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

-- ===========================================================================
-- Fixtures — 1 org alvo, 1 plano, 1 master. Namespace próprio (28828828…) para
-- não disputar linha com a suíte da Fatia 5, que roda no mesmo banco.
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('28828828-aaaa-0000-0000-000000000288', 'Org alvo (SCRUM-288)', 'org-alvo-288', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscription_plans (id, name, display_name, base_price_monthly, included_users, extra_user_price)
VALUES ('28828828-9999-0000-0000-000000000288', 'scrum288-pacote', 'Pacote SCRUM-288', 100, 2, 50)
ON CONFLICT (name) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT
  u.id, u.email, '', now(), '{}'::jsonb, now(), now(),
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '', '', '', '', '', '', '', ''
FROM (VALUES
  ('28828828-0001-0000-0000-000000000288'::uuid, 'master-288@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('28828828-0001-0000-0000-000000000288', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (PII) as três colunas NÃO existem em `payment_links` — asserção de regressão
--
-- É a prova da decisão desta fatia, e é negativa de propósito: provar que o
-- comprador chegou em `payment_link_buyers` NÃO prova que ele não chegou aqui
-- também. Duas cópias da mesma PII, uma delas atrás de policy, era exatamente o
-- desenho recusado.
-- ===========================================================================
SELECT hasnt_column('public', 'payment_links', 'customer_legal_name',
  '(PII) payment_links NÃO tem customer_legal_name — PII do comprador mora em payment_link_buyers, que é inalcançável pelo PostgREST por REVOKE');
SELECT hasnt_column('public', 'payment_links', 'customer_tax_id',
  '(PII) payment_links NÃO tem customer_tax_id — esta tabela tem GRANT para anon e authenticated e é protegida por UMA policy');
SELECT hasnt_column('public', 'payment_links', 'customer_email',
  '(PII) payment_links NÃO tem customer_email — e o e-mail é o dado com que a Fatia 9 cria o admin da org nova');

-- E o outro lado da mesma decisão: a tabela do comprador continua fora do
-- alcance de quem fala com o PostgREST. Se alguém "consertar" um 401 com um
-- GRANT aqui, esta linha cai.
SELECT ok(NOT has_table_privilege('authenticated', 'public.payment_link_buyers', 'SELECT'),
  '(PII) authenticated NÃO lê payment_link_buyers — o fechamento é REVOKE, não policy, então não depende de policy estar certa');

-- ===========================================================================
-- (PACOTE) geração como MASTER, sem comprador e sem pacote
--
-- Pacote ausente é pacote VAZIO, não NULL: leitor de `{}` sabe o que fazer, e
-- leitor de NULL decide sozinho — e decide diferente em cada tela.
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"28828828-0001-0000-0000-000000000288","role":"authenticated"}', true);

CREATE TEMP TABLE _t_pelado AS
SELECT public.billing_create_payment_link(
         'existing_org', '28828828-aaaa-0000-0000-000000000288', NULL,
         '28828828-9999-0000-0000-000000000288', 5, 'annual', 'pix',
         now() + interval '7 days') AS r;

SELECT is(
  (SELECT package_features FROM public.payment_links
    WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_pelado)),
  '{}'::jsonb,
  '(PACOTE) pacote não informado nasce {} e NOT NULL — ausência com significado escrito, em vez de NULL que cada leitor interpreta');
SELECT is(
  (SELECT package_limits FROM public.payment_links
    WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_pelado)),
  '{}'::jsonb,
  '(PACOTE) limites não informados nascem {} — mesma regra, e é o que a tela lê para dizer "herda tudo do plano base"');

SELECT is((SELECT (r ->> 'buyer_prefilled')::boolean FROM _t_pelado), false,
  '(COMPRADOR) sem pré-preenchimento o retorno diz false — a tela precisa distinguir "não preenchi" de "preenchi", e sem carregar PII no retorno');
-- Ler `payment_link_buyers` exige sair de `authenticated` — e isso não é
-- inconveniência de teste, é a asserção 4 acontecendo de novo, agora como
-- consequência: como `authenticated` este SELECT dá "permission denied", então
-- as leituras da tabela do comprador daqui para baixo acontecem como `postgres`,
-- que é a dona. Se um dia elas passarem como `authenticated`, o fechamento caiu.
SET LOCAL role postgres;

SELECT is(
  (SELECT count(*)::int FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_pelado)),
  0,
  '(COMPRADOR) e NENHUMA linha de comprador é criada — pré-preencher é opcional, e linha vazia seria dado inventado');

-- ===========================================================================
-- (COMPRADOR) o pré-preenchimento do Master escreve na tabela do comprador
--
-- Esta é também a prova do CAMINHO DE GRANT: `billing_prefill_link_buyer` tem
-- EXECUTE só para `service_role`, e quem chama aqui é um `authenticated` (o
-- Master). Funciona porque `billing_create_payment_link` é `SECURITY DEFINER` de
-- dono `postgres` e a checagem acontece como `postgres`. Se alguém trocar esta
-- função para INVOKER, esta asserção cai — e é o aviso certo.
-- ===========================================================================
SET LOCAL role authenticated;

CREATE TEMP TABLE _t_comprador AS
SELECT public.billing_create_payment_link(
         'new_org', NULL, 'Org nova do SCRUM-288',
         '28828828-9999-0000-0000-000000000288', 3, 'monthly', 'credit_card',
         now() + interval '7 days',
         '{"ia_copilot": true}'::jsonb, '{"leads": 5000}'::jsonb,
         NULL, NULL, NULL,
         'Fábrica Exemplo LTDA', '  12.345.678/0001-95 ', '  Fiscal@Exemplo.COM.BR  ') AS r;

SET LOCAL role postgres;

SELECT is(
  (SELECT count(*)::int FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_comprador)),
  1,
  '(COMPRADOR) o pré-preenchimento cria a linha do comprador — e prova o caminho DEFINER: a porta é service_role-only e quem chamou foi um authenticated');

SELECT is((SELECT (r ->> 'buyer_prefilled')::boolean FROM _t_comprador), true,
  '(COMPRADOR) o retorno avisa que houve pré-preenchimento — estado, nunca o dado');

SELECT is(
  (SELECT tax_id FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_comprador)),
  '12345678000195',
  '(COMPRADOR) o documento é normalizado para só dígitos — ensureCustomer do gateway é idempotente POR DOCUMENTO, e o mesmo CNPJ em dois formatos viraria dois clientes lá fora');
SELECT is(
  (SELECT tax_id_kind FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_comprador)),
  'cnpj',
  '(COMPRADOR) o TIPO do documento é DERIVADO do tamanho, não recebido — parâmetro kind seria segunda fonte da mesma verdade');
SELECT is(
  (SELECT email FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_comprador)),
  'fiscal@exemplo.com.br',
  '(COMPRADOR) e-mail normalizado na entrada — maiúscula ou espaço sobrando vira usuário que não entra na conta que acabou de pagar');

-- ===========================================================================
-- (AUDITORIA) registra o FATO, e nunca o dado
--
-- `master_audit_logs` é lida por gente e é o lugar mais provável de vazamento
-- por descuido. A varredura procura o e-mail e o documento no `details` inteiro,
-- não só na chave onde eu os colocaria.
-- ===========================================================================
SELECT is(
  (SELECT (details ->> 'buyer_prefilled')::boolean FROM public.master_audit_logs
    WHERE action = 'payment_link_created'
      AND target_id = (SELECT (r ->> 'link_id')::uuid FROM _t_comprador)),
  true,
  '(AUDITORIA) o rastro diz QUE houve comprador pré-preenchido');

SELECT ok(
  (SELECT details::text NOT ILIKE '%fiscal@exemplo.com.br%'
          AND details::text NOT LIKE '%12345678000195%'
          AND details::text NOT ILIKE '%Fábrica Exemplo%'
     FROM public.master_audit_logs
    WHERE action = 'payment_link_created'
      AND target_id = (SELECT (r ->> 'link_id')::uuid FROM _t_comprador)),
  '(AUDITORIA) e NÃO carrega e-mail, documento nem nome — a varredura olha o details inteiro, porque o vazamento não vem da chave óbvia');

-- ===========================================================================
-- (ATOMICIDADE) comprador inválido derruba a criação do link
--
-- Aqui a porta LEVANTA em vez de devolver código, e a diferença é deliberada:
-- neste ponto da história nada aconteceu do lado de fora — não existe cobrança
-- nem cliente no gateway. É entrada de formulário. Falhar na geração é barato;
-- falhar no checkout, na frente do cliente, não é.
--
-- Cada caso mede as DUAS coisas: levantou E não deixou link órfão.
-- ===========================================================================
-- A contagem é feita como `postgres`: como `authenticated` ela passaria pela
-- policy e mediria o que o Master VÊ, não o que existe. Link órfão criado por
-- caminho que o master não enxerga passaria verde.
CREATE TEMP TABLE _t_antes AS
SELECT count(*)::int AS n FROM public.payment_links;

SET LOCAL role authenticated;

SELECT throws_ok($$
  SELECT public.billing_create_payment_link(
    'new_org', NULL, 'Org do comprador pela metade',
    '28828828-9999-0000-0000-000000000288', 3, 'annual', 'pix',
    now() + interval '7 days',
    '{}'::jsonb, '{}'::jsonb, NULL, NULL, NULL,
    'Só o nome', NULL, NULL)
$$, '22023',
  NULL,
  '(ATOMICIDADE) comprador PELA METADE recusa — a Asaas exige nome, e-mail e documento juntos, e aceitar dois só adiaria a falta para o momento da cobrança');

SELECT throws_ok($$
  SELECT public.billing_create_payment_link(
    'new_org', NULL, 'Org do documento impossível',
    '28828828-9999-0000-0000-000000000288', 3, 'annual', 'pix',
    now() + interval '7 days',
    '{}'::jsonb, '{}'::jsonb, NULL, NULL, NULL,
    'Nome Completo', '1234567890', 'valido@exemplo.com')
$$, '22023',
  NULL,
  '(ATOMICIDADE) documento que não é 11 nem 14 dígitos recusa — e a exceção NÃO ecoa o valor recusado, nem em prefixo');

SELECT throws_ok($$
  SELECT public.billing_create_payment_link(
    'new_org', NULL, 'Org do e-mail torto',
    '28828828-9999-0000-0000-000000000288', 3, 'annual', 'pix',
    now() + interval '7 days',
    '{}'::jsonb, '{}'::jsonb, NULL, NULL, NULL,
    'Nome Completo', '12345678901', 'sem-arroba')
$$, '22023',
  NULL,
  '(ATOMICIDADE) e-mail sem formato recusa — é com ele que a Fatia 9 cria o admin da org nova');

SET LOCAL role postgres;

SELECT is(
  (SELECT count(*)::int FROM public.payment_links),
  (SELECT n FROM _t_antes),
  '(ATOMICIDADE) e NENHUM dos três deixou link para trás — a porta levanta DENTRO da transação que cria o link, então o link não nasce sem comprador válido');

-- ===========================================================================
-- (DESCONTO) o valor é do MOTOR, o motivo é obrigatório, o autor vem do JWT
-- ===========================================================================
SET LOCAL role authenticated;

CREATE TEMP TABLE _t_desconto AS
SELECT public.billing_create_payment_link(
         'existing_org', '28828828-aaaa-0000-0000-000000000288', NULL,
         '28828828-9999-0000-0000-000000000288', 5, 'annual', 'pix',
         now() + interval '7 days',
         '{}'::jsonb, '{}'::jsonb, NULL,
         -- ATENÇÃO, e isto me custou duas asserções vermelhas: o motor lê
         -- `p_manual_final_cents` como o preço MENSAL negociado, não o total da
         -- cobrança. Passar o total (`charge_cents`) de um ciclo anual não gera
         -- desconto nenhum — gera AUMENTO de 12x, e `manual_discount_cents` volta
         -- 0. A tela tem que enviar o mensal; o nome do parâmetro não diz isso.
         (SELECT ((r -> 'quote') ->> 'monthly_cents')::integer - 1250 FROM _t_pelado),
         'Negociado na renovação anual') AS r;

SELECT is(
  (SELECT manual_discount_cents FROM public.payment_links
    WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_desconto)),
  (SELECT ((r -> 'quote') ->> 'manual_discount_cents')::integer FROM _t_desconto),
  '(DESCONTO) o valor gravado é o que o MOTOR devolveu, não subtração de quem chamou — se a tela calculasse, seria a tela definindo preço');

-- CONTROLE POSITIVO da asserção acima, e ela precisa de um: comparar a coluna
-- com o próprio `quote` passa verde quando os DOIS são 0 — que foi exatamente o
-- estado em que a primeira versão deste teste ficou, com o motor recusando o
-- desconto em silêncio. Um número concreto tem matador próprio.
SELECT is(
  (SELECT manual_discount_cents FROM public.payment_links
    WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_desconto)),
  1250,
  '(DESCONTO) e é um desconto DE VERDADE, 1250 centavos ao mês — sem isto, quote 0 contra coluna 0 passaria verde e nada estaria sendo concedido');

SELECT is(
  (SELECT manual_discount_by FROM public.payment_links
    WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_desconto)),
  '28828828-0001-0000-0000-000000000288'::uuid,
  '(DESCONTO) o AUTOR vem de auth.uid(), não de parâmetro — id de autor vindo do chamador é a forma exata das 23 RPCs fechadas em 2026-08-11');

SELECT throws_ok($$
  SELECT public.billing_create_payment_link(
    'existing_org', '28828828-aaaa-0000-0000-000000000288', NULL,
    '28828828-9999-0000-0000-000000000288', 5, 'annual', 'pix',
    now() + interval '7 days',
    '{}'::jsonb, '{}'::jsonb, NULL, 100, NULL)
$$, '23514',
  NULL,
  '(DESCONTO) concessão SEM motivo é recusada pelo CHECK, não pela tela — "obrigatório" escrito só no formulário some no primeiro caminho alternativo');

SELECT * FROM finish();
ROLLBACK;
