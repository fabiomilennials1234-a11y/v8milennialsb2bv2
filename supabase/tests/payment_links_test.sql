-- supabase/tests/payment_links_test.sql
--
-- SCRUM-286 (Fatia 5 do billing) — link de pagamento: geração, hash, alvo e
-- revogação. Contrato fechado em #1383.
--
-- A ASSERÇÃO QUE MANDA É A PRIMEIRA, e ela é NEGATIVA: o link não é recuperável
-- do banco. O molde é `generate_api_key` — guarda-se o SHA-256 de 16 bytes
-- aleatórios, nunca o texto. Consequência: dump de banco não entrega link vivo,
-- e o Master copia o link UMA vez, na geração.
--
-- Provar isso com `is(token_hash, sha256(token))` seria fraco: mostraria que o
-- hash está certo, não que o texto está AUSENTE. Uma coluna extra guardando o
-- link — `raw_token`, um `details` de auditoria, um jsonb de payload — passaria
-- verde. Então a prova varre TODA coluna de texto e jsonb das tabelas novas E
-- de `master_audit_logs` procurando o token, porque o vazamento mais provável
-- não é a coluna óbvia: é a auditoria registrando o que acabou de gerar.
--
-- O RESTO DA SUÍTE ATACA O QUE ACABOU DE CUSTAR CARO NESTE BANCO: 23 RPCs
-- SECURITY DEFINER que recebiam id por parâmetro e não checavam nada foram
-- fechadas hoje por escrita e leitura cross-tenant. Toda função nova daqui é
-- exercida como `authenticated` NÃO-master e como `anon`, e os grants vão
-- conferidos nome por nome — `DROP + CREATE` devolve EXECUTE a PUBLIC, então
-- grant é estado a medir, não a supor.
--
-- Run: supabase start && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

-- ===========================================================================
-- Fixtures — 1 org alvo, 1 plano no catálogo, 2 atores (master e não-master)
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('28628628-aaaa-0000-0000-000000000286', 'Org alvo (SCRUM-286)', 'org-alvo-286', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscription_plans (id, name, display_name, base_price_monthly, included_users, extra_user_price)
VALUES ('28628628-9999-0000-0000-000000000286', 'scrum286-pacote', 'Pacote SCRUM-286', 100, 2, 50)
ON CONFLICT (name) DO NOTHING;

-- Os dois atores existem em `auth.users` de verdade: `master_audit_logs` tem FK
-- para lá, e escrever a auditoria é parte do que esta fatia promete. Fixture
-- que burlasse a FK provaria a geração sem provar o rastro.
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
  ('28628628-0001-0000-0000-000000000286'::uuid, 'master-286@test.local'),
  ('28628628-0002-0000-0000-000000000286'::uuid, 'comum-286@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('28628628-0001-0000-0000-000000000286', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- Geração, como MASTER. O token só existe aqui.
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"28628628-0001-0000-0000-000000000286","role":"authenticated"}', true);

CREATE TEMP TABLE _t_link AS
SELECT public.billing_create_payment_link(
         'existing_org',
         '28628628-aaaa-0000-0000-000000000286',
         NULL,
         '28628628-9999-0000-0000-000000000286',
         5,
         'annual',
         'pix',
         now() + interval '7 days'
       ) AS r;

SELECT ok((SELECT (r ->> 'token') IS NOT NULL FROM _t_link),
  '(GERAÇÃO) a função devolve o token — é a única vez que ele existe fora da cabeça de quem gerou');

-- ===========================================================================
-- (HASH-ONLY) o link NÃO é recuperável do banco.
--
-- Varredura dinâmica: toda coluna de texto/jsonb das duas tabelas novas e de
-- `master_audit_logs`. Não há lista de colunas escrita à mão aqui de propósito
-- — coluna nova nasceria fora de uma lista fixa, e é justamente a coluna nova
-- que vaza.
-- ===========================================================================
SET LOCAL role postgres;

CREATE OR REPLACE FUNCTION pg_temp._t_procura_token(p_token text)
RETURNS TABLE (tabela text, coluna text)
LANGUAGE plpgsql AS $fn$
DECLARE r RECORD; v_achou boolean;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name IN ('payment_links', 'payment_link_charges', 'master_audit_logs')
       AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I::text LIKE %L)',
      r.table_name, r.column_name, '%' || p_token || '%')
    INTO v_achou;
    IF v_achou THEN
      tabela := r.table_name; coluna := r.column_name; RETURN NEXT;
    END IF;
  END LOOP;
END
$fn$;

SELECT is(
  (SELECT count(*)::int FROM pg_temp._t_procura_token((SELECT r ->> 'token' FROM _t_link))),
  0,
  '(HASH-ONLY) o token não aparece em NENHUMA coluna de texto ou jsonb — nem na tabela do link, nem na auditoria');

SELECT is(
  (SELECT token_hash FROM public.payment_links
    WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_link)),
  (SELECT encode(extensions.digest((SELECT r ->> 'token' FROM _t_link), 'sha256'), 'hex')),
  '(HASH-ONLY) o que está guardado é o SHA-256 do token — controle positivo, senão a asserção acima passaria com a tabela vazia');

-- ===========================================================================
-- (POLÍTICA) proposta impossível não vira link.
--
-- Pix não tem recorrência automática, então não se vende Pix mensal — e o motor
-- recusa ANTES de calcular, justamente porque "um valor devolvido para uma
-- combinação impossível vira proposta enviada". A geração herda essa recusa em
-- vez de reimplementá-la: regra de venda mora no motor, não em cada chamador.
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"28628628-0001-0000-0000-000000000286","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.billing_create_payment_link(
       'new_org', NULL, 'Org Impossível',
       '28628628-9999-0000-0000-000000000286', 3, 'monthly', 'pix', now() + interval '1 day') $$,
  '23514', NULL,
  '(POLÍTICA) Pix mensal é recusado na geração — a regra vem do motor de preço, não de uma cópia dela aqui');

SET LOCAL role postgres;
SELECT is(
  (SELECT count(*)::int FROM public.payment_links WHERE new_org_name = 'Org Impossível'),
  0,
  '(POLÍTICA) e a recusa é PURA: nenhuma linha de proposta ficou para trás');

-- ===========================================================================
-- (ALVO) o link aponta para onde foi mandado, e o alvo é coerente.
-- ===========================================================================
SELECT is(
  (SELECT organization_id FROM public.payment_links
    WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_link)),
  '28628628-aaaa-0000-0000-000000000286'::uuid,
  '(ALVO) link de org existente guarda a org');

SELECT throws_ok(
  $$ INSERT INTO public.payment_links
       (token_hash, token_prefix, target_kind, organization_id, new_org_name, quote, amount_cents, expires_at, created_by)
     VALUES ('h', 'p', 'new_org', '28628628-aaaa-0000-0000-000000000286', NULL, '{}'::jsonb, 1, now(), '28628628-0001-0000-0000-000000000286') $$,
  '23514', NULL,
  '(ALVO) new_org com organization_id é recusado — alvo incoerente não entra nem por escrita direta');

-- O alvo de org existente NÃO toca dado operacional: gerar link não escreve na
-- organização. Se um dia alguém "aproveitar" a geração para já trocar o plano,
-- esta asserção quebra.
SELECT is(
  (SELECT subscription_plan FROM public.organizations
    WHERE id = '28628628-aaaa-0000-0000-000000000286'),
  NULL,
  '(ALVO) gerar link para org existente NÃO mexe na assinatura dela — a troca é no pagamento, não na proposta');

-- ===========================================================================
-- (AUTORIZAÇÃO) quem não é master não gera e não revoga.
--
-- Este é o bloco que existe por causa das 23 RPCs fechadas hoje: DEFINER que
-- recebe id por parâmetro e não confronta com o contexto de autenticação.
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"28628628-0002-0000-0000-000000000286","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.billing_create_payment_link(
       'existing_org', '28628628-aaaa-0000-0000-000000000286', NULL,
       '28628628-9999-0000-0000-000000000286', 5, 'annual', 'pix', now() + interval '1 day') $$,
  NULL, NULL,
  '(AUTZ) authenticated NÃO-master não gera link');

SELECT throws_ok(
  format($$ SELECT public.billing_revoke_payment_link(%L, 'tentativa') $$,
         (SELECT r ->> 'link_id' FROM _t_link)),
  NULL, NULL,
  '(AUTZ) authenticated NÃO-master não revoga link');

-- E não LÊ: RLS ligada, e a policy é de master.
SELECT is(
  (SELECT count(*)::int FROM public.payment_links),
  0,
  '(AUTZ) authenticated NÃO-master não enxerga link nenhum — RLS, não obscuridade');

-- ===========================================================================
-- (REVOGAÇÃO) master revoga, e link revogado deixa de resolver.
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"28628628-0001-0000-0000-000000000286","role":"authenticated"}', true);

SELECT lives_ok(
  format($$ SELECT public.billing_revoke_payment_link(%L, 'proposta desatualizada') $$,
         (SELECT r ->> 'link_id' FROM _t_link)),
  '(REVOGAÇÃO) master revoga');

SET LOCAL role postgres;
SELECT ok(
  (SELECT revoked_at IS NOT NULL FROM public.payment_links
    WHERE id = (SELECT (r ->> 'link_id')::uuid FROM _t_link)),
  '(REVOGAÇÃO) o carimbo fica na linha — revogação é estado, não deleção; o histórico da proposta sobrevive');

SELECT is(
  (SELECT public.billing_resolve_payment_link((SELECT r ->> 'token' FROM _t_link)) ->> 'code'),
  'link_revoked',
  '(REVOGAÇÃO) link revogado não resolve mais');

-- ===========================================================================
-- (RESOLUÇÃO) o hash é o caminho de volta, e só ele.
-- ===========================================================================
SELECT is(
  (SELECT public.billing_resolve_payment_link('tq_pay_naoexiste') ->> 'code'),
  'link_not_found',
  '(RESOLUÇÃO) token inexistente não resolve, e com código PRÓPRIO — quem chama é código nosso (service_role) e precisa distinguir inexistente de revogado para escolher a mensagem; nada aqui identifica outra proposta');

-- ===========================================================================
-- (COBRANÇA) uma por (link, método), REAPROVEITADA.
--
-- Fecha três problemas de uma vez: QR velho, entulho de cobrança pendente no
-- Asaas, e recarregar a página virando gerador de cobrança.
-- ===========================================================================
CREATE TEMP TABLE _t_link2 AS
SELECT public.billing_create_payment_link(
         'new_org', NULL, 'Org Nova SCRUM-286',
         '28628628-9999-0000-0000-000000000286', 3, 'annual', 'pix',
         now() + interval '7 days') AS r;

SELECT is(
  (SELECT public.billing_attach_link_charge(
            (SELECT (r ->> 'link_id')::uuid FROM _t_link2), 'pix', 'asaas', 'pay_AAA') ->> 'provider_charge_id'),
  'pay_AAA',
  '(COBRANÇA) a primeira cobrança do par (link, pix) é criada');

SELECT is(
  (SELECT public.billing_attach_link_charge(
            (SELECT (r ->> 'link_id')::uuid FROM _t_link2), 'pix', 'asaas', 'pay_BBB') ->> 'provider_charge_id'),
  'pay_AAA',
  '(COBRANÇA) a segunda chamada do MESMO par devolve a cobrança EXISTENTE — recarregar a página não gera cobrança nova nem QR velho');

SELECT is(
  (SELECT public.billing_attach_link_charge(
            (SELECT (r ->> 'link_id')::uuid FROM _t_link2), 'boleto', 'asaas', 'pay_CCC') ->> 'provider_charge_id'),
  'pay_CCC',
  '(COBRANÇA) método DIFERENTE no mesmo link gera cobrança própria — a idempotência é por par, não por link');

-- ===========================================================================
-- (AUDITORIA) gerar e revogar deixam rastro em master_audit_logs.
-- ===========================================================================
SELECT ok(
  EXISTS (SELECT 1 FROM public.master_audit_logs
           WHERE action = 'payment_link_created'
             AND target_id = (SELECT (r ->> 'link_id')::uuid FROM _t_link)),
  '(AUDITORIA) a geração é registrada');

SELECT ok(
  EXISTS (SELECT 1 FROM public.master_audit_logs
           WHERE action = 'payment_link_revoked'
             AND target_id = (SELECT (r ->> 'link_id')::uuid FROM _t_link)),
  '(AUDITORIA) a revogação é registrada');

-- ===========================================================================
-- (RLS) as duas tabelas novas nascem com RLS ligada.
--
-- `payment_links` tem `organization_id`, então é regra dura da casa. E
-- `payment_link_charges` também liga, mesmo sem a coluna: ela é derivada de uma
-- linha de tenant, e sem RLS o INV-5 a acusaria no dia seguinte.
-- ===========================================================================
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE relname = 'payment_links'),
  '(RLS) payment_links com RLS habilitada');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE relname = 'payment_link_charges'),
  '(RLS) payment_link_charges com RLS habilitada');

-- ===========================================================================
-- (GRANTS) nome por nome. `DROP + CREATE` devolve EXECUTE a PUBLIC, então isto
-- é estado a medir, não a supor.
-- ===========================================================================
SELECT ok(NOT has_function_privilege('anon',
  'public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz)', 'EXECUTE'),
  '(GRANT) anon não gera link');
SELECT ok(has_function_privilege('authenticated',
  'public.billing_create_payment_link(text,uuid,text,uuid,integer,text,text,timestamptz)', 'EXECUTE'),
  '(GRANT) authenticated executa — o Master é um usuário autenticado, e quem barra o não-master é o corpo, não o grant');

SELECT ok(NOT has_function_privilege('anon',
  'public.billing_resolve_payment_link(text)', 'EXECUTE'),
  '(GRANT) anon não resolve link');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.billing_resolve_payment_link(text)', 'EXECUTE'),
  '(GRANT) authenticated não resolve link — a página de pagamento é pública e passa por edge function com service_role');
SELECT ok(has_function_privilege('service_role',
  'public.billing_resolve_payment_link(text)', 'EXECUTE'),
  '(GRANT) service_role resolve link');

SELECT ok(NOT has_function_privilege('anon',
  'public.billing_attach_link_charge(uuid,text,text,text)', 'EXECUTE'),
  '(GRANT) anon não amarra cobrança');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.billing_attach_link_charge(uuid,text,text,text)', 'EXECUTE'),
  '(GRANT) authenticated não amarra cobrança');

SELECT * FROM finish();
ROLLBACK;
