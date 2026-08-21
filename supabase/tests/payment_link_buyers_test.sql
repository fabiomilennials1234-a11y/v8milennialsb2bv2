-- supabase/tests/payment_link_buyers_test.sql
--
-- SCRUM-289 (Fatia 8 do billing) — o COMPRADOR da proposta, e a unicidade que
-- faltava em `payment_link_charges.provider_charge_id`.
--
-- AS DUAS ASSERÇÕES QUE MANDAM SÃO NEGATIVAS, e é de propósito.
--
-- 1. (ALCANCE) `payment_link_buyers` guarda PII — e-mail e documento fiscal de
--    quem paga. A tabela irmã só vale a pena se o PostgREST não a alcançar, e
--    isso é GRANT, não policy: `anon`, `authenticated` e `service_role` não têm
--    privilégio nenhum nela. Provar com "a policy nega" seria provar a coisa
--    errada — policy é o controle que a gente pode errar; a ausência de GRANT é
--    o que sobra quando a policy está errada.
--
-- 2. (PII) o documento fiscal não aparece em NENHUMA outra coluna de `public`
--    além da que existe para guardá-lo. A varredura é genérica nas duas
--    dimensões (tabela e coluna), pelo mesmo motivo da varredura de token da
--    Fatia 5: o vazamento provável não é a coluna óbvia, é a auditoria ou um
--    log registrando o que acabou de passar.
--
-- E o bloco (UNICIDADE) não é sobre esta fatia: é regressão de um caminho VIVO.
-- `asaas-webhook` resolve o link com `.eq("provider_charge_id", …).maybeSingle()`
-- e engole erro com 200. Duas linhas com o mesmo id de cobrança = organização
-- nunca ativada, em silêncio.
--
-- Run: supabase start && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

-- ===========================================================================
-- Fixtures — 1 org alvo, 1 plano, 1 master
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('28928928-aaaa-0000-0000-000000000289', 'Org alvo (SCRUM-289)', 'org-alvo-289', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscription_plans (id, name, display_name, base_price_monthly, included_users, extra_user_price)
VALUES ('28928928-9999-0000-0000-000000000289', 'scrum289-pacote', 'Pacote SCRUM-289', 100, 2, 50)
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
  ('28928928-0001-0000-0000-000000000289'::uuid, 'master-289@test.local'),
  ('28928928-0002-0000-0000-000000000289'::uuid, 'comum-289@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('28928928-0001-0000-0000-000000000289', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

SET LOCAL session_replication_role = origin;

-- Três propostas: A recebe comprador, B serve à colisão de id de cobrança, C é
-- a que não tem comprador nenhum (e é `existing_org`, que legitimamente não
-- precisa de um).
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"28928928-0001-0000-0000-000000000289","role":"authenticated"}', true);

CREATE TEMP TABLE _t_a AS
SELECT public.billing_create_payment_link(
         'new_org', NULL, 'Org Nova A (SCRUM-289)',
         '28928928-9999-0000-0000-000000000289', 3, 'annual', 'pix',
         now() + interval '7 days') AS r;

CREATE TEMP TABLE _t_b AS
SELECT public.billing_create_payment_link(
         'new_org', NULL, 'Org Nova B (SCRUM-289)',
         '28928928-9999-0000-0000-000000000289', 3, 'annual', 'pix',
         now() + interval '7 days') AS r;

CREATE TEMP TABLE _t_c AS
SELECT public.billing_create_payment_link(
         'existing_org', '28928928-aaaa-0000-0000-000000000289', NULL,
         '28928928-9999-0000-0000-000000000289', 5, 'annual', 'pix',
         now() + interval '7 days') AS r;

SET LOCAL role postgres;

-- ===========================================================================
-- (UNICIDADE) o id da cobrança no gateway é único — regressão de caminho VIVO.
-- ===========================================================================
SELECT is(
  (SELECT public.billing_attach_link_charge(
            (SELECT (r ->> 'link_id')::uuid FROM _t_a), 'pix', 'asaas', 'pay_289_AAA') ->> 'provider_charge_id'),
  'pay_289_AAA',
  '(UNICIDADE) controle positivo — a primeira cobrança entra normalmente');

SELECT throws_ok(
  format($$ SELECT public.billing_attach_link_charge(%L, 'pix', 'asaas', 'pay_289_AAA') $$,
         (SELECT r ->> 'link_id' FROM _t_b)),
  '23505', NULL,
  '(UNICIDADE) a MESMA cobrança do gateway em OUTRO link é recusada pelo banco — sem isto, asaas-webhook e Fatia 9 resolveriam o link (e o comprador) ERRADO, e o webhook engole o erro com 200: organização nunca ativada, em silêncio');

-- O matador desta: se alguém trocar o `ON CONFLICT ON CONSTRAINT` por um
-- `ON CONFLICT DO NOTHING` pelado para "resolver" a asserção acima, a violação
-- vira `ok: true` com `charge_id` NULO — resposta errada e silenciosa.
SELECT is(
  (SELECT count(*)::int FROM public.payment_link_charges
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_b)),
  0,
  '(UNICIDADE) e a recusa é PURA: nenhuma linha de cobrança ficou no link B');

-- ===========================================================================
-- (RETENTATIVA) o segundo clique continua reusando, COM a segunda restrição.
--
-- Esta é a regressão que o UNIQUE novo introduziria se ninguém olhasse:
-- `ON CONFLICT ON CONSTRAINT x` só absorve a restrição NOMEADA, e a retentativa
-- normal — mesmo link, mesmo método, MESMA cobrança — viola AS DUAS. Se o
-- Postgres reportar a outra, a função levanta exceção onde antes reusava.
-- ===========================================================================
CREATE TEMP TABLE _t_retry AS
SELECT public.billing_attach_link_charge(
         (SELECT (r ->> 'link_id')::uuid FROM _t_a), 'pix', 'asaas', 'pay_289_AAA') AS r;

SELECT is((SELECT (r ->> 'provider_charge_id') FROM _t_retry), 'pay_289_AAA',
  '(RETENTATIVA) a MESMA cobrança no MESMO par (link, método) reusa a linha em vez de estourar — é o segundo clique do cliente, caminho normal desta função');
SELECT is((SELECT (r ->> 'reused')::boolean FROM _t_retry), true,
  '(RETENTATIVA) e o retorno DIZ que reusou');
SELECT is(
  (SELECT count(*)::int FROM public.payment_link_charges
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_a)),
  1,
  '(RETENTATIVA) uma linha só — a idempotência por par sobreviveu à restrição nova');

-- ===========================================================================
-- (ALCANCE) a PII fica fora do PostgREST por GRANT, não por policy.
-- ===========================================================================
SELECT ok(NOT has_table_privilege('anon', 'public.payment_link_buyers', 'SELECT'),
  '(ALCANCE) anon não lê a tabela de comprador');
SELECT ok(NOT has_table_privilege('authenticated', 'public.payment_link_buyers', 'SELECT'),
  '(ALCANCE) authenticated não lê a tabela de comprador — é a diferença que motivou a tabela irmã em vez de colunas em payment_link_charges, que é servida a estas duas roles');
SELECT ok(NOT has_table_privilege('service_role', 'public.payment_link_buyers', 'SELECT'),
  '(ALCANCE) nem service_role lê a tabela direto: vazar a chave de serviço NÃO entrega um GET /payment_link_buyers?select=* — a PII sai só pelas funções DEFINER');
SELECT ok(NOT has_table_privilege('authenticated', 'public.payment_link_buyers', 'INSERT'),
  '(ALCANCE) e ninguém escreve direto');

SELECT ok((SELECT relrowsecurity FROM pg_class
            WHERE relname = 'payment_link_buyers' AND relnamespace = 'public'::regnamespace),
  '(ALCANCE) RLS ligada mesmo com o REVOKE — é a rede para o dia em que alguém der um GRANT achando que conserta um 401, e é o que faz a tabela passar no INV-5');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_link_buyers'),
  0,
  '(ALCANCE) e ZERO policies, de propósito: RLS ligada sem policy é negação total. Escrever policy aqui seria reintroduzir a superfície que a tabela existe para não ter');

-- Comportamento, não só catálogo: sem GRANT o Postgres recusa o comando.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"28928928-0002-0000-0000-000000000289","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT count(*) FROM public.payment_link_buyers $$,
  '42501', NULL,
  '(ALCANCE) na prática: um usuário logado tomando "permission denied", não uma lista vazia que dependeria da policy estar certa');
SET LOCAL role postgres;

-- ===========================================================================
-- (ESCRITA) o comprador é gravado, normalizado, e um por PROPOSTA.
-- ===========================================================================
CREATE TEMP TABLE _t_w1 AS
SELECT public.billing_upsert_link_buyer(
         (SELECT (r ->> 'link_id')::uuid FROM _t_a),
         'asaas', 'cus_289_AAA',
         '  Fábrica Alfa LTDA ',
         '  Compras@Fabrica-Alfa.COM.BR ',
         '123.456.789-09') AS r;

SELECT is((SELECT (r ->> 'ok')::boolean FROM _t_w1), true, '(ESCRITA) o comprador entra');

SELECT is(
  (SELECT email FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_a)),
  'compras@fabrica-alfa.com.br',
  '(ESCRITA) e-mail normalizado na entrada — maiúscula ou espaço sobrando vira usuário que não consegue entrar na conta que acabou de pagar');

SELECT is(
  (SELECT tax_id FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_a)),
  '12345678909',
  '(ESCRITA) documento fiscal só com dígitos — a pontuação é do formulário, não do dado');

SELECT is(
  (SELECT tax_id_kind FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_a)),
  'cpf',
  '(ESCRITA) o tipo do documento é DERIVADO do valor, não recebido do chamador — parâmetro seria uma segunda fonte da mesma verdade e o CHECK só acusaria a divergência com a cobrança já criada no gateway');

-- Segunda escrita no mesmo link: atualiza, não acumula.
CREATE TEMP TABLE _t_w2 AS
SELECT public.billing_upsert_link_buyer(
         (SELECT (r ->> 'link_id')::uuid FROM _t_a),
         'asaas', 'cus_289_AAA',
         'Fábrica Alfa LTDA',
         'financeiro@fabrica-alfa.com.br',
         '11.222.333/0001-81') AS r;

SELECT is(
  (SELECT count(*)::int FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_a)),
  1,
  '(ESCRITA) UM comprador por proposta — corrigir o dado atualiza a linha, não cria uma segunda com o valor velho ao lado');

SELECT is(
  (SELECT tax_id_kind FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_a)),
  'cnpj',
  '(ESCRITA) e o tipo acompanha a correção — 14 dígitos viram cnpj sem ninguém avisar a função');

-- O ponteiro do cliente no gateway não é abandonado por uma escrita magra.
SELECT lives_ok(
  format($$ SELECT public.billing_upsert_link_buyer(%L, 'asaas', '', 'Fábrica Alfa LTDA', 'financeiro@fabrica-alfa.com.br', '11222333000181') $$,
         (SELECT r ->> 'link_id' FROM _t_a)),
  '(ESCRITA) escrita com METADE do ponteiro do gateway não estoura — o CHECK é avaliado sobre a tupla PROPOSTA, antes de o ON CONFLICT virar UPDATE, então normalizar o par só no CHECK mataria a chamada que só queria corrigir o e-mail');
SELECT is(
  (SELECT provider_customer_id FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_a)),
  'cus_289_AAA',
  '(ESCRITA) e NÃO apaga o cliente já criado no gateway — sobrescrever com vazio abandonaria o cadastro lá e a próxima cobrança nasceria em outro, que é o entulho que payment_link_charges existe para impedir, um nível acima');

-- ===========================================================================
-- (PRÉ-PREENCHIMENTO) o Master preenche o comprador na GERAÇÃO do link, e é
-- por isso que payment_links não precisa de coluna de PII.
--
-- Aqui não existe cobrança nem cliente no gateway ainda — então esta porta é a
-- única que grava com o ponteiro do gateway NULO, e a única que LEVANTA em vez
-- de devolver código: é entrada de formulário do Master dentro da transação que
-- cria o link, não escrituração de fato consumado.
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"28928928-0001-0000-0000-000000000289","role":"authenticated"}', true);
CREATE TEMP TABLE _t_pre AS
SELECT public.billing_create_payment_link(
         'new_org', NULL, 'Org Pre-preenchida (SCRUM-289)',
         '28928928-9999-0000-0000-000000000289', 3, 'annual', 'pix',
         now() + interval '7 days') AS r;
SET LOCAL role postgres;

SELECT is(
  (SELECT public.billing_prefill_link_buyer(
            (SELECT (r ->> 'link_id')::uuid FROM _t_pre),
            NULL, NULL, NULL) ->> 'code'),
  'noop',
  '(PRE) Master que não preenche nada não vira linha — pré-preencher é opcional, e linha vazia de comprador seria dado inventado');

SELECT is(
  (SELECT count(*)::int FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_pre)),
  0,
  '(PRE) e o noop é PURO: nenhuma linha ficou para trás');

SELECT throws_ok(
  format($$ SELECT public.billing_prefill_link_buyer(%L, 'Org Pre', 'contato@org-pre.com.br', NULL) $$,
         (SELECT r ->> 'link_id' FROM _t_pre)),
  '22023', NULL,
  '(PRE) preencher PELA METADE levanta e aborta a criação do link junto — a Asaas exige as três, e aceitar duas adiaria a descoberta da falta para o momento da cobrança, na frente do cliente');

SELECT throws_ok(
  format($$ SELECT public.billing_prefill_link_buyer(%L, 'Org Pre', 'contato@org-pre.com.br', '123456789') $$,
         (SELECT r ->> 'link_id' FROM _t_pre)),
  '22023', NULL,
  '(PRE) documento impossível levanta na GERAÇÃO — falhar aqui é barato, falhar no checkout não é');

SELECT lives_ok(
  format($$ SELECT public.billing_prefill_link_buyer(%L, ' Org Pre LTDA ', ' Contato@Org-Pre.COM.BR ', '11.222.333/0001-81') $$,
         (SELECT r ->> 'link_id' FROM _t_pre)),
  '(PRE) pré-preenchimento completo entra');

SELECT results_eq(
  format($$ SELECT legal_name, email, tax_id, tax_id_kind, provider, provider_customer_id
              FROM public.payment_link_buyers WHERE payment_link_id = %L $$,
         (SELECT r ->> 'link_id' FROM _t_pre)),
  $$ VALUES ('Org Pre LTDA'::text, 'contato@org-pre.com.br'::text, '11222333000181'::text,
             'cnpj'::text, NULL::text, NULL::text) $$,
  '(PRE) normalizado igual à porta do checkout — a derivação do tipo mora numa função só, senão a regra anda sozinha e diverge — e o ponteiro do gateway nasce NULO, porque o cliente da Asaas ainda não existe neste momento da história');

-- O ponteiro nulo tem que ser indistinguível de "não há comprador" para quem
-- vai criar a cobrança: os dois pedem a MESMA ação, criar o cliente agora.
SELECT is(
  (SELECT public.billing_get_link_customer((SELECT (r ->> 'link_id')::uuid FROM _t_pre)) ->> 'code'),
  'no_customer',
  '(PRE) linha pré-preenchida SEM cliente no gateway responde no_customer, igual a link sem comprador nenhum — códigos diferentes para desfechos que levam à mesma ação convidam o chamador a tratar um deles como erro');

-- E o carimbo do gateway COMPLETA a linha em vez de criar outra.
SELECT lives_ok(
  format($$ SELECT public.billing_upsert_link_buyer(%L, 'asaas', 'cus_289_PRE', 'Org Pre LTDA', 'contato@org-pre.com.br', '11222333000181') $$,
         (SELECT r ->> 'link_id' FROM _t_pre)),
  '(PRE) a criação da cobrança carimba o cliente do gateway na MESMA linha');

SELECT is(
  (SELECT count(*)::int FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_pre)),
  1,
  '(PRE) UMA linha — pré-preenchimento do Master e preenchimento do comprador são a mesma linha, e o que o cliente digitar corrige o que o Master chutou');

SELECT is(
  (SELECT provider_customer_id FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_pre)),
  'cus_289_PRE',
  '(PRE) e o ponteiro do gateway ficou');

-- Meio ponteiro não entra. O CHECK é quem impede, não a disciplina do chamador.
SELECT throws_ok(
  format($$ INSERT INTO public.payment_link_buyers
              (payment_link_id, legal_name, email, tax_id, tax_id_kind, provider)
            VALUES (%L, 'X', 'x@x.com.br', '12345678909', 'cpf', 'asaas') $$,
         (SELECT r ->> 'link_id' FROM _t_b)),
  '23514', NULL,
  '(PRE) provider sem provider_customer_id é recusado — meio ponteiro não aponta para nada, e a coerência é do CHECK, não de quem escreve');

-- ===========================================================================
-- (RECUSA) documento e e-mail inválidos não entram — e a recusa não ecoa nada.
-- ===========================================================================
CREATE TEMP TABLE _t_bad AS
SELECT public.billing_upsert_link_buyer(
         (SELECT (r ->> 'link_id')::uuid FROM _t_c),
         'asaas', 'cus_289_CCC', 'Org C', 'contato@org-c.com.br', '123456789') AS r;

SELECT is((SELECT (r ->> 'code') FROM _t_bad), 'tax_id_invalid',
  '(RECUSA) documento com 9 dígitos não é CPF nem CNPJ, e a função recusa ANTES de tocar a tabela');
SELECT is(
  (SELECT count(*)::int FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_c)),
  0,
  '(RECUSA) e a recusa é PURA: nenhuma linha ficou para trás');

SELECT is(
  (SELECT public.billing_upsert_link_buyer(
            (SELECT (r ->> 'link_id')::uuid FROM _t_c),
            'asaas', 'cus_289_CCC', 'Org C', 'nao-e-email', '12345678909') ->> 'code'),
  'email_invalid',
  '(RECUSA) e-mail sem formato não entra — é ele que a Fatia 9 usa para criar o admin, e um e-mail torto vira organização paga sem dono');

-- ===========================================================================
-- (PII) o que a recusa devolve e o que o banco guarda.
--
-- O `withErrorBoundary` grava `error.message` inteiro em `runtime_logs`, e o
-- `redactSecrets` redige por NOME DE CHAVE — texto livre com CPF dentro passa
-- em claro. Então a regra é que a função não interpole o valor em lugar nenhum.
-- ===========================================================================
SELECT ok(
  (SELECT (r::text) NOT LIKE '%123456789%' FROM _t_bad),
  '(PII) a recusa devolve CÓDIGO, não eco do documento — nem inteiro nem em prefixo, porque prefixo de CPF em log é PII em log');

CREATE OR REPLACE FUNCTION pg_temp._t_procura_valor(p_valor text)
RETURNS TABLE (tabela text, coluna text)
LANGUAGE plpgsql AS $fn$
DECLARE r RECORD; v_achou boolean;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
       AND EXISTS (SELECT 1 FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
                    WHERE n.nspname = 'public' AND k.relname = c.table_name AND k.relkind = 'r')
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I::text LIKE %L)',
      r.table_name, r.column_name, '%' || p_valor || '%')
    INTO v_achou;
    IF v_achou THEN
      tabela := r.table_name; coluna := r.column_name; RETURN NEXT;
    END IF;
  END LOOP;
END
$fn$;

-- Varredura genérica nas duas dimensões: tabela nova e coluna nova nascem
-- cobertas, e é justamente o que ainda não existe que vaza.
SELECT results_eq(
  $$ SELECT tabela, coluna FROM pg_temp._t_procura_valor('11222333000181') ORDER BY tabela, coluna $$,
  $$ VALUES ('payment_link_buyers'::text, 'tax_id'::text) $$,
  '(PII) o documento fiscal existe em UMA coluna de public — a que existe para guardá-lo. Em nenhuma auditoria, nenhum jsonb de proposta, nenhum log');

-- ===========================================================================
-- (ESTADO) proposta revogada não recebe comprador; expirada recebe e AVISA.
--
-- Mesma divisão de `billing_attach_link_charge`, e pelo mesmo motivo: revogado
-- é decisão deliberada; expirar é evento de relógio entre o resolve e aqui.
-- ===========================================================================
UPDATE public.payment_links SET revoked_at = now(), revoked_by = '28928928-0001-0000-0000-000000000289'
 WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_b);

SELECT is(
  (SELECT public.billing_upsert_link_buyer(
            (SELECT (r ->> 'link_id')::uuid FROM _t_b),
            'asaas', 'cus_289_BBB', 'Org B', 'contato@org-b.com.br', '12345678909') ->> 'code'),
  'link_revoked',
  '(ESTADO) proposta REVOGADA não recebe comprador — quem chamou ignorou o resolve');

UPDATE public.payment_links SET expires_at = now() - interval '1 minute'
 WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_c);

CREATE TEMP TABLE _t_exp AS
SELECT public.billing_upsert_link_buyer(
         (SELECT (r ->> 'link_id')::uuid FROM _t_c),
         'asaas', 'cus_289_CCC', 'Org C', 'contato@org-c.com.br', '12345678909') AS r;

SELECT is((SELECT (r ->> 'ok')::boolean FROM _t_exp), true,
  '(ESTADO) proposta EXPIRADA grava assim mesmo — o cliente já existe no gateway quando esta função é chamada, e recusar perderia o único vínculo dele com a nossa proposta por causa de 40 segundos');
SELECT is((SELECT (r ->> 'expired_at_write')::boolean FROM _t_exp), true,
  '(ESTADO) e AVISA que expirou — quem chama precisa cancelar no gateway');

-- ===========================================================================
-- (PONTEIRO) a nossa cobrança pega o cliente do gateway, e SÓ ele.
-- ===========================================================================
CREATE TEMP TABLE _t_cust AS
SELECT public.billing_get_link_customer((SELECT (r ->> 'link_id')::uuid FROM _t_a)) AS r;

SELECT is((SELECT (r ->> 'provider_customer_id') FROM _t_cust), 'cus_289_AAA',
  '(PONTEIRO) devolve o cliente já criado no gateway — é isso que faz o segundo método do mesmo link REUSAR o cliente em vez de criar outro');
SELECT ok((SELECT (r ? 'buyer_email') = false AND (r ? 'tax_id') = false FROM _t_cust),
  '(PONTEIRO) e NÃO devolve PII: quem cria cobrança precisa do ponteiro, não do dado de volta');
SELECT is(
  (SELECT public.billing_get_link_customer((SELECT (r ->> 'link_id')::uuid FROM _t_b)) ->> 'code'),
  'no_customer',
  '(PONTEIRO) link sem comprador tem código PRÓPRIO — quem chama precisa distinguir "criar cliente agora" de "erro"');

-- ===========================================================================
-- (RESOLUÇÃO) a porta da Fatia 9: da cobrança do gateway ao comprador.
-- ===========================================================================
CREATE TEMP TABLE _t_res AS
SELECT public.billing_resolve_charge_buyer('pay_289_AAA') AS r;

SELECT is((SELECT (r ->> 'buyer_email') FROM _t_res), 'financeiro@fabrica-alfa.com.br',
  '(RESOLUÇÃO) o e-mail chega pela cobrança, num salto — é com ele que a Fatia 9 cria o admin da organização nova');
SELECT is((SELECT (r ->> 'target_kind') FROM _t_res), 'new_org',
  '(RESOLUÇÃO) e o alvo vem junto: provisionar org nova e trocar o pacote de uma existente são caminhos diferentes');
SELECT is((SELECT (r ->> 'new_org_name') FROM _t_res), 'Org Nova A (SCRUM-289)',
  '(RESOLUÇÃO) com o nome que o Master digitou na proposta');

SELECT ok((SELECT (r ? 'tax_id') = false AND (r ? 'buyer_tax_id') = false FROM _t_res),
  '(RESOLUÇÃO) o documento fiscal NÃO sai por esta porta. Provisionar precisa de e-mail e nome; o menor conjunto que serve é o conjunto certo, e ampliá-lo é uma linha de código que ninguém revisa depois');

SELECT is(
  (SELECT public.billing_resolve_charge_buyer('pay_289_INEXISTENTE') ->> 'code'),
  'charge_not_found',
  '(RESOLUÇÃO) cobrança desconhecida tem código próprio e não identifica nada de ninguém');

-- Cobrança que existe e comprador que não: os dois desfechos precisam ser
-- distinguíveis, senão o `new_org` sem e-mail — que é incidente — some junto
-- com o `existing_org`, que legitimamente não tem comprador.
SELECT is(
  (SELECT public.billing_attach_link_charge(
            (SELECT (r ->> 'link_id')::uuid FROM _t_b), 'credit_card', 'asaas', 'pay_289_BBB') ->> 'code'),
  'link_revoked',
  '(RESOLUÇÃO) controle: o link B está revogado e não recebe cobrança');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"28928928-0001-0000-0000-000000000289","role":"authenticated"}', true);
CREATE TEMP TABLE _t_d AS
SELECT public.billing_create_payment_link(
         'existing_org', '28928928-aaaa-0000-0000-000000000289', NULL,
         '28928928-9999-0000-0000-000000000289', 5, 'annual', 'pix',
         now() + interval '7 days') AS r;
SET LOCAL role postgres;

SELECT lives_ok(
  format($$ SELECT public.billing_attach_link_charge(%L, 'pix', 'asaas', 'pay_289_DDD') $$,
         (SELECT r ->> 'link_id' FROM _t_d)),
  '(RESOLUÇÃO) cobrança criada num link SEM comprador');

CREATE TEMP TABLE _t_semcomprador AS
SELECT public.billing_resolve_charge_buyer('pay_289_DDD') AS r;

SELECT is((SELECT (r ->> 'code') FROM _t_semcomprador), 'buyer_missing',
  '(RESOLUÇÃO) cobrança sem comprador é buyer_missing, NÃO charge_not_found — a diferença é entre "essa cobrança não é nossa" e "é nossa e ficou sem e-mail", e a segunda é incidente');
SELECT is((SELECT (r ->> 'target_kind') FROM _t_semcomprador), 'existing_org',
  '(RESOLUÇÃO) e o contexto do alvo volta assim mesmo — é ele que diz se a ausência do comprador é normal (existing_org) ou incidente (new_org)');

-- ===========================================================================
-- (CASCATA) apagar a proposta apaga a PII junto.
--
-- O ciclo de vida do dado de comprador não depende de alguém lembrar de quais
-- colunas zerar: é DELETE, não UPDATE. Foi o argumento de retenção que veio de
-- brinde na escolha por tabela irmã.
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_a)),
  1,
  '(CASCATA) controle positivo — o comprador está lá antes de apagar');

DELETE FROM public.payment_links WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_a);

SELECT is(
  (SELECT count(*)::int FROM public.payment_link_buyers
    WHERE payment_link_id = (SELECT (r ->> 'link_id')::uuid FROM _t_a)),
  0,
  '(CASCATA) apagar a proposta apaga o comprador — retenção por construção, não por disciplina de lembrar quais colunas zerar');

-- ===========================================================================
-- (GRANTS) nome por nome. `DROP + CREATE` devolve EXECUTE a PUBLIC, então isto
-- é estado a medir, não a supor.
-- ===========================================================================
SELECT ok(NOT has_function_privilege('anon',
  'public.billing_upsert_link_buyer(uuid,text,text,text,text,text)', 'EXECUTE'),
  '(GRANT) anon não escreve comprador');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.billing_upsert_link_buyer(uuid,text,text,text,text,text)', 'EXECUTE'),
  '(GRANT) authenticated não escreve comprador — a página é pública e fala por edge function com service_role');
SELECT ok(has_function_privilege('service_role',
  'public.billing_upsert_link_buyer(uuid,text,text,text,text,text)', 'EXECUTE'),
  '(GRANT) service_role escreve comprador');

SELECT ok(NOT has_function_privilege('anon',
  'public.billing_prefill_link_buyer(uuid,text,text,text)', 'EXECUTE'),
  '(GRANT) anon não pré-preenche comprador');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.billing_prefill_link_buyer(uuid,text,text,text)', 'EXECUTE'),
  '(GRANT) authenticated não pré-preenche comprador — e isso NÃO tira o Master do caminho: billing_create_payment_link é DEFINER de dono postgres, então a checagem de EXECUTE acontece como postgres. O Master chega pela geração do link, não por esta porta');
SELECT ok(has_function_privilege('service_role',
  'public.billing_prefill_link_buyer(uuid,text,text,text)', 'EXECUTE'),
  '(GRANT) service_role pré-preenche comprador');

SELECT ok(NOT has_function_privilege('anon',
  'public.billing_get_link_customer(uuid)', 'EXECUTE'),
  '(GRANT) anon não lê o ponteiro do cliente');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.billing_get_link_customer(uuid)', 'EXECUTE'),
  '(GRANT) authenticated não lê o ponteiro do cliente');
SELECT ok(has_function_privilege('service_role',
  'public.billing_get_link_customer(uuid)', 'EXECUTE'),
  '(GRANT) service_role lê o ponteiro do cliente');

SELECT ok(NOT has_function_privilege('anon',
  'public.billing_resolve_charge_buyer(text)', 'EXECUTE'),
  '(GRANT) anon não resolve comprador');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.billing_resolve_charge_buyer(text)', 'EXECUTE'),
  '(GRANT) authenticated não resolve comprador — esta é a única função que devolve PII, e ela não é alcançável por usuário logado');
SELECT ok(has_function_privilege('service_role',
  'public.billing_resolve_charge_buyer(text)', 'EXECUTE'),
  '(GRANT) service_role resolve comprador');

SELECT * FROM finish();
ROLLBACK;
