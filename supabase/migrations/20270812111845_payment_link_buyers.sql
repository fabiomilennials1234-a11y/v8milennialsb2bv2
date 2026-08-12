-- 20270812111845_payment_link_buyers.sql
--
-- SCRUM-289 — Fatia 8 do billing: o COMPRADOR da proposta.
-- ROLLBACK pareado: rollback/20270812111845_payment_link_buyers.sql
--
-- POR QUE ESTA MIGRATION EXISTE
-- ----------------------------
-- A Asaas EXIGE `cpfCnpj` para Pix e cartão no Brasil, então o checkout público
-- obrigatoriamente coleta e-mail, razão social e documento fiscal para a
-- cobrança sequer existir. E o dado NÃO PODE SÓ TRANSITAR: a Fatia 9 provisiona
-- DEPOIS do pagamento confirmar e precisa do e-mail para criar o admin da
-- organização nova. Sem persistir, o dado passa pelo nosso código, vai para o
-- gateway, e some — e o `new_org` fica sem como criar o admin.
--
-- TABELA IRMÃ, NÃO COLUNAS EM `payment_link_charges` — e o argumento decisivo
-- não é retenção, é ALCANCE.
-- --------------------------------------------------------------------------
-- `payment_link_charges` é servida pelo PostgREST: `anon` e `authenticated` têm
-- GRANT nela (o `ALTER DEFAULT PRIVILEGES` que o próprio Supabase instala — ver
-- 20270811120000), e a única coisa entre um usuário logado e a linha é a
-- policy. Pendurar CPF e e-mail de comprador nessa superfície é apostar a PII
-- em a policy estar certa para sempre — e em 11/08 este banco gastou o dia
-- fechando furo de policy e de grant, inclusive um `SELECT` como `anon` que
-- derrubava o Postgres no PLANEJAMENTO da query.
--
-- Aqui a PII fica fora do alcance do PostgREST por CONSTRUÇÃO, não por policy:
-- REVOKE de `anon`, `authenticated` **e `service_role`**, RLS ligada sem
-- policy nenhuma. Sobra um caminho só — as funções `SECURITY DEFINER` abaixo,
-- que rodam como `postgres` e por isso não precisam de GRANT de tabela.
-- Consequência deliberada: vazar a chave `service_role` NÃO entrega um
-- `GET /payment_link_buyers?select=*`. Quem "consertar" isso com um GRANT está
-- desfazendo o motivo da tabela existir separada.
--
-- CHAVEADA PELO LINK, NÃO PELA COBRANÇA
-- -------------------------------------
-- O Malho propôs `PK = charge_id`. Troquei por `PK = payment_link_id`, e a razão
-- é funcional, não estética:
--
--   1. O comprador é propriedade da PROPOSTA, não de cada cobrança. Um link
--      admite até uma cobrança por método (`payment_link_charges_um_por_metodo`),
--      então chavear por cobrança DUPLICA a PII quando alguém tenta Pix e
--      depois cartão — dois lugares para vazar, dois para apagar, e o segundo
--      guardando um CPF corrigido enquanto o primeiro guarda o errado.
--   2. `provider_customer_id` é do comprador, e o cliente da Asaas é REUTILIZÁVEL
--      entre cobranças. Chaveado pelo link, a segunda tentativa REUSA o cliente;
--      chaveado pela cobrança, ela cria um cliente novo no gateway a cada método
--      — exatamente o "entulho no gateway" que `payment_link_charges` foi criada
--      para impedir, um nível acima.
--
-- Custo para quem lê (Fatia 9): nenhum. Ele chega pela cobrança e a coluna
-- `payment_link_id` está na própria linha da cobrança — mesmo número de saltos.
-- E `billing_resolve_charge_buyer` abaixo faz o salto por ele.
--
-- O QUE ESTA MIGRATION NÃO FAZ: não cobra, não cria cliente no gateway, não
-- provisiona org. Ela abre o lugar onde o comprador é guardado e as três portas
-- de acesso a ele.

-- ---------------------------------------------------------------------------
-- 1. A integridade que faltava em `payment_link_charges`
--
-- NÃO existe índice em `provider_charge_id` hoje, e portanto NADA impede duas
-- linhas com o mesmo id de cobrança do gateway. Isso não é ergonomia futura:
-- é furo em caminho VIVO. `supabase/functions/asaas-webhook/index.ts` já faz
--
--     .from("payment_link_charges").select("payment_link_id")
--     .eq("provider_charge_id", d.paymentId).maybeSingle()
--
-- e `maybeSingle()` com duas linhas devolve ERRO. O handler do webhook engole
-- erro e responde 200 (por desenho — 15 falhas seguidas pausam a fila do
-- Asaas). Ou seja: uma duplicata faria a organização nunca ser ativada, em
-- silêncio, para sempre — o modo de falha exato contra o qual a Fatia 6 inteira
-- foi desenhada. A Fatia 9 herda o mesmo caminho e resolveria o COMPRADOR
-- ERRADO para uma cobrança.
--
-- UNIQUE na coluna sozinha, e não em `(provider, provider_charge_id)`: os dois
-- leitores buscam pelo id do gateway SEM qualificar provedor, e um índice
-- composto com `provider` na frente não os serviria. Colisão de id entre dois
-- gateways é teórica hoje (existe um), e se um dia acontecer o resultado é
-- violação de unicidade ALTA na escrita, não comprador errado silencioso na
-- leitura. É a direção certa de falhar.
--
-- Se esta linha falhar ao aplicar, é porque a duplicata JÁ EXISTE — e aí o
-- conserto é dado, não schema. Falhar alto está certo; um índice não-único
-- esconderia o problema.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_link_charges
  ADD CONSTRAINT payment_link_charges_provider_charge_id_key UNIQUE (provider_charge_id);

COMMENT ON COLUMN public.payment_link_charges.provider_charge_id IS
  'Id da cobrança no gateway. ÚNICO: é por ele que o webhook (Fatia 6) e o provisionamento (Fatia 9) resolvem o link e o comprador, ambos com maybeSingle() — duplicata viraria organização nunca ativada, em silêncio.';

-- ---------------------------------------------------------------------------
-- 2. O comprador
--
-- Sem `organization_id` de propósito: no `new_org` a organização AINDA NÃO
-- EXISTE — é a Fatia 9 que a cria, com o e-mail que está aqui. O tenant é
-- alcançável pelo link quando existe (`payment_links.organization_id`), e a
-- ausência da coluna é o que impede alguém a acreditar que dá para escrever
-- policy de tenant nesta tabela. Aqui não tem policy: tem REVOKE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_link_buyers (
  -- Um comprador por PROPOSTA. A cascata resolve o ciclo de vida inteiro:
  -- apagar o link apaga a PII junto, sem ninguém precisar lembrar.
  payment_link_id      uuid PRIMARY KEY
                       REFERENCES public.payment_links(id) ON DELETE CASCADE,

  -- `CustomerInput.name` do port (`_shared/payments/types.ts`) é obrigatório —
  -- a Asaas não cria cliente sem nome. NOT NULL aqui é o mesmo fato, uma camada
  -- abaixo.
  --
  -- O NOME DESTA COLUNA INDUZ AO ERRO, e já induziu uma vez: ela NÃO guarda só
  -- razão social. No ramo `cpf` — comprador pessoa física — o que está aqui é o
  -- NOME CIVIL de alguém, que não é público em cadastro nenhum. Quem for tratar
  -- esta coluna como dado público (deixar de redigir em log, expor em tela,
  -- devolver numa porta) está certo para metade das linhas e errado para a
  -- outra metade.
  legal_name           text        NOT NULL,

  -- O CAMPO QUE JUSTIFICA A TABELA. É com ele que a Fatia 9 cria o usuário
  -- admin da organização nova.
  email                text        NOT NULL,

  -- Só dígitos, normalizado pela RPC. NENHUMA função devolve esta coluna — ver
  -- o bloco de portas na §4. Está persistida porque o documento fiscal do
  -- pagador é obrigação nossa (nota fiscal, reconciliação, estorno), e ter o
  -- gateway como ÚNICO custodiante de um identificador fiscal do nosso cliente
  -- é pior que guardá-lo numa tabela sem alcance de PostgREST.
  tax_id               text        NOT NULL,
  tax_id_kind          text        NOT NULL,

  -- O cliente no gateway. NULO ENQUANTO NÃO EXISTIR, e isso é desenho, não
  -- frouxidão.
  --
  -- A primeira versão tinha os dois NOT NULL, sob a premissa de que a linha só
  -- nasce depois de o cliente existir no gateway. A premissa caiu: a SCRUM-288
  -- deixa o Master PRÉ-PREENCHER o comprador na geração do link, e ali ainda
  -- não há cobrança nem cliente na Asaas. Com NOT NULL, o pré-preenchimento
  -- teria que inventar um valor ou morar noutro lugar — e "noutro lugar" era
  -- justamente três colunas de PII em `payment_links`, que é servida ao
  -- PostgREST. A mesma PII em dois lugares, uma das cópias atrás de policy, é
  -- pior que qualquer um dos dois desenhos sozinho.
  --
  -- O par é coerente por CHECK: ou os dois existem, ou nenhum. Meio ponteiro
  -- não aponta para nada.
  provider             text,
  provider_customer_id text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- `tax_id_kind` não pode MENTIR sobre `tax_id`: o CHECK amarra os dois, então
  -- a coerência é por construção e não por disciplina de quem escreve. É o
  -- mesmo desenho de `payment_links_target_coerente_check`.
  CONSTRAINT payment_link_buyers_tax_id_coerente_check CHECK (
    (tax_id_kind = 'cpf'  AND tax_id ~ '^[0-9]{11}$')
    OR
    (tax_id_kind = 'cnpj' AND tax_id ~ '^[0-9]{14}$')
  ),

  -- Normalizado na entrada, garantido aqui. E-mail com maiúscula ou espaço
  -- sobrando vira usuário que não consegue entrar na conta que acabou de pagar.
  CONSTRAINT payment_link_buyers_email_check CHECK (
    email = lower(btrim(email))
    AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),

  CONSTRAINT payment_link_buyers_legal_name_check CHECK (btrim(legal_name) <> ''),

  -- Ou os dois lados do ponteiro para o gateway existem, ou nenhum existe.
  CONSTRAINT payment_link_buyers_provider_coerente_check CHECK (
    (provider IS NULL) = (provider_customer_id IS NULL)
  )
);

COMMENT ON TABLE public.payment_link_buyers IS
  'SCRUM-289: comprador da proposta (PII). Um por payment_link, não por cobrança — o cliente do gateway é reaproveitado entre métodos. Fora do alcance do PostgREST por REVOKE, não por policy: só as funções SECURITY DEFINER de billing chegam aqui.';
COMMENT ON COLUMN public.payment_link_buyers.legal_name IS
  'PII. NÃO é só razão social: no ramo cpf é o nome civil de uma pessoa física, que não é público em cadastro nenhum. Tratar como dado público acerta metade das linhas e erra a outra metade.';
COMMENT ON COLUMN public.payment_link_buyers.email IS
  'PII. É com este e-mail que a Fatia 9 cria o admin da organização nova. NUNCA em log, erro ou telemetria.';
COMMENT ON COLUMN public.payment_link_buyers.tax_id IS
  'PII. Só dígitos (11 = CPF, 14 = CNPJ). Persistido para obrigação fiscal e reconciliação; NENHUMA RPC o devolve, e isso é deliberado.';

-- ---------------------------------------------------------------------------
-- 3. O fechamento — REVOKE **e** RLS
--
-- Os dois, e não um. Não é redundância decorativa:
--   REVOKE  fecha o PostgREST hoje, inclusive para `service_role`.
--   RLS     é a rede para o dia em que alguém rodar um GRANT achando que
--           conserta um 401 — e é também o que faz esta tabela passar no INV-5,
--           que varre `public` procurando tabela sem RLS.
--
-- Sem policy NENHUMA de propósito: policy ausente com RLS ligada é negação
-- total. `service_role` tem BYPASSRLS, e é justamente por isso que o REVOKE
-- dele também precisa existir — RLS sozinha não o barraria.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.payment_link_buyers FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.payment_link_buyers ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. As portas
--
-- Quatro, e cada uma devolve o MENOS que serve ao seu chamador:
--
--   billing_prefill_link_buyer    o Master, na    Devolve ZERO PII. É a porta
--                                 GERAÇÃO do      da SCRUM-288, e existe para
--                                 link            que `payment_links` NÃO
--                                                 precise guardar PII.
--   billing_upsert_link_buyer     escreve.        Devolve ZERO PII.
--   billing_get_link_customer     nossa cobrança. Devolve só o id do cliente
--                                 no gateway — o suficiente para reusar o
--                                 cliente em vez de criar outro.
--   billing_resolve_charge_buyer  Fatia 9.        Única que devolve PII, e só
--                                 e-mail e razão social. `tax_id` NÃO sai.
--
-- Todas `service_role`-only, sem gate de `auth.uid()` no corpo — e essa é a
-- mesma exceção já escrita em `billing_resolve_payment_link`: aqui não existe
-- ator humano, o chamador é código nosso, e o GRANT `service_role`-only É a
-- autorização. Sob `service_role`, `auth.uid()` é NULL, então um gate de
-- usuário só quebraria a edge function sem fechar nada.
--
-- REGRA DURA, e ela vale mais que qualquer linha de schema deste arquivo:
-- NENHUMA mensagem de exceção destas funções interpola e-mail ou documento.
-- O `withErrorBoundary` das edge functions grava `error.message` inteiro em
-- `runtime_logs`, e o `redactSecrets` do logger redige por NOME DE CHAVE —
-- então texto livre com CPF dentro passa em claro. Para identificar a linha no
-- erro existe o id do link e o id da cobrança.
-- ---------------------------------------------------------------------------

-- 4.1 Escrita — idempotente por link, e é a idempotência que reusa o cliente
CREATE OR REPLACE FUNCTION public.billing_upsert_link_buyer(
  p_link_id              uuid,
  p_provider             text,
  p_provider_customer_id text,
  p_legal_name           text,
  p_email                text,
  p_tax_id               text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_link     public.payment_links%ROWTYPE;
  v_email    text := lower(btrim(COALESCE(p_email, '')));
  v_tax      text := regexp_replace(COALESCE(p_tax_id, ''), '[^0-9]', '', 'g');
  v_kind     text;
  v_name     text := btrim(COALESCE(p_legal_name, ''));
  v_prov     text := NULLIF(btrim(COALESCE(p_provider, '')), '');
  v_cust     text := NULLIF(btrim(COALESCE(p_provider_customer_id, '')), '');
  v_expirado boolean := false;
BEGIN
  -- MEIO PONTEIRO É NENHUM PONTEIRO, e a normalização tem que acontecer AQUI,
  -- não no CHECK. Motivo medido, não teórico: o Postgres avalia CHECK sobre a
  -- tupla PROPOSTA, antes de o `ON CONFLICT` decidir que vai virar UPDATE. Uma
  -- chamada com provider preenchido e customer_id vazio levantava 23514 mesmo
  -- quando a linha existente já tinha o ponteiro certo e o UPDATE o preservaria
  -- — ou seja, a chamada que só queria corrigir o e-mail morria. O teste pegou.
  IF v_prov IS NULL OR v_cust IS NULL THEN
    v_prov := NULL;
    v_cust := NULL;
  END IF;

  -- Mesma divisão de `billing_attach_link_charge`, e pelo mesmo motivo: isto é
  -- ESCRITURAÇÃO de um fato que já aconteceu do lado de fora (o cliente já
  -- existe no gateway), não portão. Revogado e pago são decisões DELIBERADAS e
  -- recusam; expirado é evento de RELÓGIO entre o resolve e aqui, e recusar
  -- destruiria o único registro do comprador de uma cobrança real por causa de
  -- 40 segundos. Grava, e AVISA.
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

  -- O TIPO DO DOCUMENTO É DERIVADO, NÃO RECEBIDO. Um parâmetro `kind` vindo do
  -- chamador é uma segunda fonte da mesma verdade, e o CHECK da tabela recusaria
  -- a divergência tarde demais — com a cobrança já criada no gateway.
  v_kind := CASE length(v_tax) WHEN 11 THEN 'cpf' WHEN 14 THEN 'cnpj' ELSE NULL END;

  -- As recusas abaixo NÃO ecoam o valor recebido. Nem em parte, nem mascarado:
  -- prefixo de CPF em log é PII em log.
  IF v_kind IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'tax_id_invalid');
  END IF;
  IF v_email = '' OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'email_invalid');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'legal_name_missing');
  END IF;
  -- O ponteiro para o gateway NÃO é exigido aqui. Era, e a exigência caiu junto
  -- com o NOT NULL da coluna: o pré-preenchimento do Master acontece antes de
  -- existir cliente na Asaas. Quem exige o ponteiro é o CHECK de coerência —
  -- meio ponteiro não entra, nenhum entra.

  INSERT INTO public.payment_link_buyers AS b
    (payment_link_id, legal_name, email, tax_id, tax_id_kind, provider, provider_customer_id)
  VALUES
    (p_link_id, v_name, v_email, v_tax, v_kind, v_prov, v_cust)
  ON CONFLICT (payment_link_id) DO UPDATE
     SET legal_name           = EXCLUDED.legal_name,
         email                = EXCLUDED.email,
         tax_id               = EXCLUDED.tax_id,
         tax_id_kind          = EXCLUDED.tax_id_kind,
         -- O ponteiro do gateway NÃO é sobrescrito por vazio, e o primeiro que
         -- gravou vence: reescrevê-lo abandonaria o cliente já criado lá e a
         -- próxima cobrança nasceria em outro cadastro. Os dois lados andam
         -- JUNTOS, senão o CHECK de coerência recusa — e recusar está certo.
         provider             = COALESCE(EXCLUDED.provider,             b.provider),
         provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, b.provider_customer_id),
         updated_at           = now();

  -- Devolve ESTADO, nunca o dado. Quem escreveu já tem o que escreveu.
  RETURN jsonb_build_object(
    'ok',                true,
    'code',              'ok',
    'payment_link_id',   p_link_id,
    'expired_at_write',  v_expirado);
END
$fn$;

-- 4.1-b Pré-preenchimento pelo Master, na GERAÇÃO do link (SCRUM-288)
--
-- Existe para que `payment_links` NÃO precise de coluna de PII. A SCRUM-288
-- adicionava `customer_legal_name`, `customer_tax_id` e `customer_email` lá —
-- e `payment_links` é servida pelo PostgREST, com GRANT para `anon` e
-- `authenticated`, atrás de UMA policy. O mesmo documento em dois lugares, uma
-- das cópias alcançável por policy, anula a razão de esta tabela existir.
--
-- Chamada de DENTRO de `billing_create_payment_link`, que é DEFINER de dono
-- `postgres`, na MESMA transação — então grant de tabela não entra na conta e o
-- link e o comprador nascem juntos ou não nascem.
--
-- DOIS DESFECHOS, e a diferença entre eles é o ponto:
--   nada preenchido  → `noop`, e NENHUMA linha. Pré-preencher é opcional; linha
--                      vazia de comprador seria dado inventado.
--   valor inválido   → LEVANTA, abortando a criação do link junto. Aqui não é
--                      escrituração de fato consumado (não existe cobrança nem
--                      cliente no gateway ainda): é ENTRADA de formulário do
--                      Master, e link que nasce com documento impossível vira
--                      cobrança que não pode ser criada, descoberta na frente
--                      do cliente. Falhar na geração é barato; falhar no
--                      checkout não é.
--
-- A exceção NÃO carrega o valor recusado — nem inteiro, nem em prefixo.
CREATE OR REPLACE FUNCTION public.billing_prefill_link_buyer(
  p_link_id    uuid,
  p_legal_name text,
  p_email      text,
  p_tax_id     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_tax   text := regexp_replace(COALESCE(p_tax_id, ''), '[^0-9]', '', 'g');
  v_name  text := btrim(COALESCE(p_legal_name, ''));
  v_kind  text;
BEGIN
  -- Master não preencheu nada: não é erro, e não vira linha.
  IF v_email = '' AND v_tax = '' AND v_name = '' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'noop');
  END IF;

  -- Preencheu PELA METADE também não vira linha meia-boca. As três colunas são
  -- NOT NULL porque a Asaas exige as três para criar cliente; aceitar duas
  -- adiaria a descoberta da falta para o momento da cobrança.
  IF v_email = '' OR v_tax = '' OR v_name = '' THEN
    RAISE EXCEPTION 'Comprador incompleto: nome, e-mail e documento fiscal andam juntos (link %)', p_link_id
      USING ERRCODE = '22023';
  END IF;

  v_kind := CASE length(v_tax) WHEN 11 THEN 'cpf' WHEN 14 THEN 'cnpj' ELSE NULL END;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Documento fiscal do comprador inválido (link %)', p_link_id
      USING ERRCODE = '22023';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'E-mail do comprador inválido (link %)', p_link_id
      USING ERRCODE = '22023';
  END IF;

  -- Sem ponteiro de gateway: ele não existe neste momento da história.
  INSERT INTO public.payment_link_buyers
    (payment_link_id, legal_name, email, tax_id, tax_id_kind)
  VALUES (p_link_id, v_name, v_email, v_tax, v_kind)
  ON CONFLICT (payment_link_id) DO UPDATE
     SET legal_name  = EXCLUDED.legal_name,
         email       = EXCLUDED.email,
         tax_id      = EXCLUDED.tax_id,
         tax_id_kind = EXCLUDED.tax_id_kind,
         updated_at  = now();

  RETURN jsonb_build_object('ok', true, 'code', 'ok');
END
$fn$;

-- 4.2 Leitura da NOSSA cobrança — só o ponteiro do cliente no gateway
CREATE OR REPLACE FUNCTION public.billing_get_link_customer(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_provider    text;
  v_customer_id text;
BEGIN
  SELECT provider, provider_customer_id INTO v_provider, v_customer_id
    FROM public.payment_link_buyers
   WHERE payment_link_id = p_link_id;

  -- DUAS ausências, UM código, e é de propósito: "não há linha de comprador" e
  -- "há linha, pré-preenchida pelo Master, mas ainda sem cliente no gateway"
  -- pedem exatamente a mesma ação de quem chama — criar o cliente agora. Dar
  -- códigos diferentes para desfechos que levam à mesma ação convida o chamador
  -- a tratar um deles como erro.
  IF NOT FOUND OR v_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'no_customer');
  END IF;

  -- Nada de e-mail, nome ou documento aqui. Quem cria a cobrança precisa do
  -- PONTEIRO para não duplicar cliente no gateway; não precisa da PII de volta.
  RETURN jsonb_build_object(
    'ok',                   true,
    'code',                 'ok',
    'provider',             v_provider,
    'provider_customer_id', v_customer_id);
END
$fn$;

-- 4.3 A porta da Fatia 9 — da cobrança do gateway ao comprador, num salto
CREATE OR REPLACE FUNCTION public.billing_resolve_charge_buyer(p_provider_charge_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_row record;
BEGIN
  IF p_provider_charge_id IS NULL OR btrim(p_provider_charge_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'charge_not_found');
  END IF;

  SELECT c.id            AS charge_id,
         c.payment_link_id,
         c.method,
         l.target_kind,
         l.organization_id,
         l.new_org_name,
         b.email         AS buyer_email,
         b.legal_name    AS buyer_legal_name,
         b.provider      AS buyer_provider,
         b.provider_customer_id
    INTO v_row
    FROM public.payment_link_charges c
    JOIN public.payment_links        l ON l.id = c.payment_link_id
    LEFT JOIN public.payment_link_buyers b ON b.payment_link_id = c.payment_link_id
   WHERE c.provider_charge_id = btrim(p_provider_charge_id);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'charge_not_found');
  END IF;

  -- Comprador ausente NÃO é o mesmo que cobrança inexistente, e a diferença
  -- importa para quem provisiona: o contexto do alvo volta mesmo assim, então
  -- a Fatia 9 sabe se está diante de um `existing_org` (que não precisa de
  -- comprador para nada) ou de um `new_org` que ficou sem e-mail — este último
  -- é incidente, e some se os dois desfechos vierem com o mesmo código.
  IF v_row.buyer_email IS NULL THEN
    RETURN jsonb_build_object(
      'ok',              true,
      'code',            'buyer_missing',
      'charge_id',       v_row.charge_id,
      'payment_link_id', v_row.payment_link_id,
      'method',          v_row.method,
      'target_kind',     v_row.target_kind,
      'organization_id', v_row.organization_id,
      'new_org_name',    v_row.new_org_name);
  END IF;

  -- `tax_id` NÃO sai daqui. Provisionar organização precisa de e-mail e nome;
  -- documento fiscal não entra em nada do caminho da Fatia 9, e o menor
  -- conjunto que serve é o conjunto certo.
  RETURN jsonb_build_object(
    'ok',                   true,
    'code',                 'ok',
    'charge_id',            v_row.charge_id,
    'payment_link_id',      v_row.payment_link_id,
    'method',               v_row.method,
    'target_kind',          v_row.target_kind,
    'organization_id',      v_row.organization_id,
    'new_org_name',         v_row.new_org_name,
    'buyer_email',          v_row.buyer_email,
    'buyer_legal_name',     v_row.buyer_legal_name,
    'provider',             v_row.buyer_provider,
    'provider_customer_id', v_row.provider_customer_id);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 5. `billing_attach_link_charge` — consertada pelo UNIQUE que a §1 criou
--
-- A versão de 20270811140000 faz
--     ON CONFLICT ON CONSTRAINT payment_link_charges_um_por_metodo DO NOTHING
-- e cai num SELECT quando nada entrou. Isso era completo enquanto existia UMA
-- restrição única. Agora existem duas, e a retentativa normal — mesmo link,
-- mesmo método, mesma cobrança do gateway — viola AS DUAS. `ON CONFLICT ON
-- CONSTRAINT` só absorve a restrição NOMEADA: se o Postgres reportar a outra,
-- a função levanta exceção onde antes reusava a linha em silêncio. Retentativa
-- é o caminho normal desta função (é o segundo clique do cliente), então isso
-- seria uma regressão introduzida pela §1 — e é minha para consertar junto.
--
-- Conserto: procurar ANTES. Preserva os dois desfechos certos —
--   mesma cobrança, de novo        → reusa, sem exceção;
--   mesma cobrança em OUTRO link   → violação de unicidade, ALTA. É bug nosso
--                                    (mandamos a mesma cobrança para duas
--                                    propostas) e tem que aparecer.
-- Trocar por um `ON CONFLICT DO NOTHING` pelado faria o segundo caso devolver
-- `ok: true` com `charge_id` NULO — resposta errada e silenciosa, que é
-- exatamente o que não se faz em tabela de dinheiro.
--
-- Corpo idêntico ao original em tudo o mais. `CREATE OR REPLACE` preserva os
-- grants; o teste confere de novo mesmo assim.
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

  -- Reuso ANTES da inserção: é o caminho comum (segundo clique) e é o que
  -- mantém a retentativa fora da colisão entre as duas restrições únicas.
  SELECT * INTO v_row
    FROM public.payment_link_charges
   WHERE payment_link_id = p_link_id AND method = p_method;

  IF NOT FOUND THEN
    INSERT INTO public.payment_link_charges
      (payment_link_id, method, provider, provider_charge_id)
    VALUES (p_link_id, p_method, p_provider, p_provider_charge_id)
    ON CONFLICT ON CONSTRAINT payment_link_charges_um_por_metodo DO NOTHING
    RETURNING * INTO v_row;

    IF FOUND THEN
      v_criada := true;
    ELSE
      -- Corrida: outra transação criou entre o SELECT e o INSERT. A idempotência
      -- continua sendo do banco, não da ordem em que as chamadas chegam.
      SELECT * INTO v_row
        FROM public.payment_link_charges
       WHERE payment_link_id = p_link_id AND method = p_method;
    END IF;
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

-- ---------------------------------------------------------------------------
-- 6. Grants
--
-- Explícitos por role, e não só `FROM PUBLIC`: o `ALTER DEFAULT PRIVILEGES` do
-- Supabase concede EXECUTE a `anon` DIRETAMENTE, e `REVOKE FROM PUBLIC` sozinho
-- não remove privilégio concedido direto. O teste confere nome por nome com
-- `has_function_privilege`, porque grant é estado a medir, não a supor.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.billing_upsert_link_buyer(uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_upsert_link_buyer(uuid,text,text,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.billing_prefill_link_buyer(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_prefill_link_buyer(uuid,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.billing_get_link_customer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_get_link_customer(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.billing_resolve_charge_buyer(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_resolve_charge_buyer(text) TO service_role;

-- Reafirmada porque `CREATE OR REPLACE` acima não a mudou, e porque repetir o
-- estado desejado custa uma linha e evita depender do que veio antes.
REVOKE ALL ON FUNCTION public.billing_attach_link_charge(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_attach_link_charge(uuid,text,text,text) TO service_role;
