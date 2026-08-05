-- supabase/tests/voip_foundation_test.sql
--
-- pgTAP: fundação TorqueCalls (S8/S9 — 20270730000000_torquecalls_voip_foundation).
--
-- Duas metades:
--   (1) ESTRUTURA — o que a migration promete existe e está fechado. Roda sem
--       fixture, contra o schema limpo.
--   (2) COMPORTAMENTO — a reserva nega pelos motivos certos, o consentimento de
--       voz não é auto-serviço, e a RLS de voip_calls respeita a fronteira do
--       lead. Exercida com `SET LOCAL ROLE authenticated`, NUNCA como postgres:
--       superusuário bypassa RLS e devolve verde falso.
--
-- Tudo dentro de transação com ROLLBACK: não muda nada no banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(38);

-- ===========================================================================
-- (1) ESTRUTURA
-- ===========================================================================

SELECT has_table('public', 'voip_sessions',   'voip_sessions existe');
SELECT has_table('public', 'voip_calls',      'voip_calls existe');
SELECT has_table('public', 'voip_call_usage', 'voip_call_usage existe');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.voip_sessions'::regclass),
  'voip_sessions com RLS ligada'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.voip_calls'::regclass),
  'voip_calls com RLS ligada'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.voip_call_usage'::regclass),
  'voip_call_usage com RLS ligada'
);

-- Nenhuma policy de escrita para authenticated: quem escreve é service_role.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('voip_sessions','voip_calls','voip_call_usage')
      AND cmd <> 'SELECT'),
  0,
  'tabelas voip_* não têm policy de escrita — escrita só por service_role'
);

-- O teto "uma chamada viva por operador" é invariante de armazenamento. Se este
-- índice sumir, duas reservas concorrentes do mesmo operador passam as duas.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'voip_calls'
       AND indexname = 'idx_voip_calls_one_live_per_operator'
       AND indexdef LIKE '%UNIQUE%'
  ),
  'índice único parcial por operador existe (teto de 1 chamada viva é estrutural)'
);

-- tc_call_id não pode ser chave global: no inbound quem escolhe é o peer remoto.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.voip_calls'::regclass
       AND conname = 'voip_calls_network_id_unique'
       AND contype = 'u'
  ),
  'tc_call_id é único apenas dentro da sessão, não globalmente'
);

-- Grants das funções de sistema. DROP+CREATE de função devolve EXECUTE para
-- PUBLIC — sem REVOKE explícito isto fica aberto sem ninguém notar.
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)', 'EXECUTE'),
  'authenticated NÃO executa fn_voip_call_reserve'
);
SELECT ok(
  NOT has_function_privilege('anon',
    'public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)', 'EXECUTE'),
  'anon NÃO executa fn_voip_call_reserve'
);
SELECT ok(
  has_function_privilege('service_role',
    'public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)', 'EXECUTE'),
  'service_role executa fn_voip_call_reserve'
);
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.fn_voip_consent_record(uuid,uuid,boolean,text,text,text,text,jsonb)', 'EXECUTE'),
  'authenticated NÃO executa fn_voip_consent_record'
);
SELECT ok(
  has_function_privilege('service_role',
    'public.fn_voip_consent_record(uuid,uuid,boolean,text,text,text,text,jsonb)', 'EXECUTE'),
  'service_role executa fn_voip_consent_record'
);

-- Desenho (C): as chaves de desligar ficam na instância, e nascem desligadas.
SELECT has_column('public', 'whatsapp_instances', 'voice_calls_enabled',
  'kill-switch de voz mora em whatsapp_instances (desenho C)');
SELECT has_column('public', 'whatsapp_instances', 'daily_call_cap',
  'teto diário de voz mora em whatsapp_instances (desenho C)');
SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_instances'
      AND column_name = 'voice_calls_enabled'),
  'false',
  'voice_calls_enabled nasce false — feature inerte até um humano ligar'
);

-- O desenho (C) proíbe uma segunda tabela de desligar coisa.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'voip_call_policies'),
  'voip_call_policies NÃO existe (desenho C: uma chave só, na instância)'
);

-- S9 — permissões semeadas.
SELECT is(
  (SELECT count(*)::int FROM public.feature_permissions WHERE key LIKE 'voip.%'),
  4,
  'as 4 permissões de voz estão semeadas'
);
SELECT ok(
  (SELECT is_admin_only FROM public.feature_permissions WHERE key = 'voip.session.manage'),
  'voip.session.manage é admin-only'
);
SELECT ok(
  NOT (SELECT default_value FROM public.feature_permissions WHERE key = 'voip.call.dial_manual'),
  'voip.call.dial_manual nasce negado — discar número avulso não é default'
);
SELECT ok(
  (SELECT default_value FROM public.feature_permissions WHERE key = 'voip.call.start'),
  'voip.call.start nasce liberado — a porta é o kill-switch da instância'
);

-- Consentimento de voz: tipo existe no CHECK e está fora do alcance do membro.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.consent_records'::regclass
       AND conname = 'consent_records_consent_type_check'
       AND pg_get_constraintdef(oid) LIKE '%voice_call_whatsapp%'
  ),
  'consent_records aceita voice_call_whatsapp'
);
SELECT ok(
  (SELECT bool_and(with_check LIKE '%voice_call_whatsapp%')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'consent_records' AND cmd IN ('INSERT','UPDATE')),
  'policies de escrita de consent_records barram voice_call_whatsapp'
);

-- ===========================================================================
-- (2) COMPORTAMENTO
-- ===========================================================================
--
-- `leads` tem 20 triggers (webhooks, workflows, sync de pipe). Fixture roda em
-- session_replication_role = replica para não disparar nada disso; volta para
-- origin ANTES das asserções, senão o que está sendo testado não é o runtime.

SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email)
VALUES ('11111111-1111-1111-1111-111111111111', 'dono@voip.test'),
       ('22222222-2222-2222-2222-222222222222', 'colega@voip.test'),
       ('33333333-3333-3333-3333-333333333333', 'inativo@voip.test');

INSERT INTO public.organizations (id, name, slug)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org VoIP Teste', 'org-voip-teste');

INSERT INTO public.team_members (id, organization_id, user_id, name, email, role, is_active)
VALUES ('b1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111', 'Dono', 'dono@voip.test', 'member', true),
       ('b2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '22222222-2222-2222-2222-222222222222', 'Colega', 'colega@voip.test', 'member', true),
       ('b3333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '33333333-3333-3333-3333-333333333333', 'Inativo', 'inativo@voip.test', 'member', false);

-- Lead do "Dono".
INSERT INTO public.leads (id, organization_id, name, phone, sdr_id, closer_id)
VALUES ('c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Lead Alvo', '5548991005289',
        'b1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111');

-- has_feature_permission() devolve FALSE quando a linha de feature não existe.
-- Num banco sem os seeds de leads.* (aconteceu de verdade nesta bancada), a
-- asserção "colega não vê" ficaria verde pelo motivo errado — por ausência de
-- catálogo, não por fronteira. O fixture garante o catálogo; ON CONFLICT torna
-- isto um no-op onde os seeds já existem.
INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES ('leads.view_all', 'Leads', 'Ver todos os leads', 'fixture', false, true, 0),
       ('leads.view_subordinates', 'Leads', 'Ver leads de subordinados', 'fixture', false, true, 0),
       ('leads.view_unassigned', 'Leads', 'Ver leads sem responsável', 'fixture', false, true, 0)
ON CONFLICT (key) DO NOTHING;

-- leads.view_all nasce true para todo membro (default_value = true em prod), o
-- que é exatamente o cenário em que a fronteira do lead NÃO aparece. Aqui o
-- Colega é explicitamente restringido, que é o caso em que a fronteira precisa
-- valer — e é o caso que um teste ingênuo deixaria passar verde.
INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled)
VALUES ('b2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'leads.view_all', false),
       ('b2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'leads.view_subordinates', false),
       ('b2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'leads.view_unassigned', false);

INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, status)
VALUES ('d1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'voip-teste', 'connected');

INSERT INTO public.voip_sessions (id, organization_id, whatsapp_instance_id, tc_session_id, jid, status)
VALUES ('e1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'd1111111-1111-1111-1111-111111111111', 'tc-sess-teste',
        '554884334050@s.whatsapp.net', 'open');

SET LOCAL session_replication_role = origin;

-- Kill-switch fechado é a primeira negativa: nasce false.
SELECT is(
  public.fn_voip_call_reserve(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
    'tc-sess-teste', '554891005289', 'c1111111-1111-1111-1111-111111111111'
  ) ->> 'code',
  'voice_calls_disabled',
  'reserva nega enquanto voice_calls_enabled = false'
);

UPDATE public.whatsapp_instances
   SET voice_calls_enabled = true
 WHERE id = 'd1111111-1111-1111-1111-111111111111';

-- Com a chave ligada, o gate seguinte é o consentimento de voz — que não existe.
SELECT is(
  public.fn_voip_call_reserve(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
    'tc-sess-teste', '554891005289', 'c1111111-1111-1111-1111-111111111111'
  ) ->> 'code',
  'consent_missing',
  'reserva nega sem consentimento voice_call_whatsapp — opt-in de chamada é separado'
);

-- Outbound sem lead não passa: sem lead não há fronteira nem trilha.
SELECT is(
  public.fn_voip_call_reserve(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
    'tc-sess-teste', '554891005289', NULL
  ) ->> 'code',
  'lead_required',
  'outbound sem lead_id é negado'
);

-- O membro NÃO consegue se dar o próprio consentimento de chamada.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

SELECT throws_ok(
  $$INSERT INTO public.consent_records
      (organization_id, lead_id, consent_type, granted, source)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111',
            'voice_call_whatsapp', true, 'manual')$$,
  '42501',
  NULL,
  'membro NÃO insere consentimento de voz (gate não é auto-serviço)'
);

RESET ROLE;

-- Pelo caminho legítimo (service_role, origem carimbada) o consentimento entra.
SELECT ok(
  public.fn_voip_consent_record(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c1111111-1111-1111-1111-111111111111',
    true, 'form', '554891005289', '203.0.113.10', 'test-agent'
  ) IS NOT NULL,
  'fn_voip_consent_record grava o opt-in de voz'
);

SELECT throws_ok(
  $$SELECT public.fn_voip_consent_record(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111',
      true, 'manual')$$,
  '22023',
  NULL,
  'source manual é recusado — vendedor afirmando o consentimento não é consentimento'
);

-- Agora a reserva passa.
SELECT is(
  (public.fn_voip_call_reserve(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
    'tc-sess-teste', '5548 99100-5289', 'c1111111-1111-1111-1111-111111111111'
  ) ->> 'ok')::boolean,
  true,
  'reserva autoriza com kill-switch ligado + consentimento vivo'
);

-- Telefone entra com máscara e é gravado só com dígitos: teto por destino não
-- pode ser burlado trocando o formato.
SELECT is(
  (SELECT peer_phone FROM public.voip_calls LIMIT 1),
  '5548991005289',
  'peer_phone é normalizado para dígitos na gravação'
);

-- Segunda reserva do MESMO operador colide no índice único parcial.
SELECT is(
  public.fn_voip_call_reserve(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
    'tc-sess-teste', '554891892653', 'c1111111-1111-1111-1111-111111111111'
  ) ->> 'code',
  'operator_busy',
  'operador com chamada viva não reserva outra'
);

-- O contador do desenho (C) andou.
SELECT is(
  (SELECT calls_authorized FROM public.voip_call_usage
    WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'voip_call_usage contou a chamada autorizada'
);

-- ── RLS de voip_calls ──────────────────────────────────────────────────────
-- O dono do lead vê a chamada.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls),
  1,
  'responsável pelo lead vê a chamada'
);

-- O colega da mesma org, sem leads.view_all e sem ser responsável, não vê.
SET LOCAL request.jwt.claims TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls),
  0,
  'colega sem permissão de ver o lead não vê o número discado para ele'
);

-- Membro DESATIVADO não vê nada: get_my_organization_ids() filtra is_active.
SET LOCAL request.jwt.claims TO '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls),
  0,
  'membro desativado não lê chamada nenhuma'
);
SELECT is(
  (SELECT count(*)::int FROM public.voip_sessions),
  0,
  'membro desativado não lê sessão nenhuma'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
