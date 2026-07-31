BEGIN;
-- Obrigatório. pgTAP não é criado por migration nenhuma nem pelo config.toml, e
-- como toda suíte roda dentro de BEGIN/ROLLBACK ele nunca fica instalado entre
-- arquivos. Sem esta linha, `SELECT plan(...)` estoura com "function plan(integer)
-- does not exist".
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Prova o vínculo usuário↔instância na voz
-- (20270731000001_voip_reserve_instance_access.sql).
--
-- O DEFEITO que isto impede: `fn_voip_call_reserve` recebia `p_tc_session_id` do
-- front e validava organização, sessão aberta, `voice_calls_enabled`, lead e
-- consentimento — mas NUNCA se aquele usuário podia usar aquela instância. Como
-- a sessão carrega a instância, qualquer membro da org que conhecesse um id de
-- sessão discava pelo número de qualquer colega. Esconder o botão na interface
-- não fechava nada: o gate é aqui.
--
-- A regra é a MESMA do inbox (`useWhatsAppInstancesForUser`): instância sem
-- ninguém em `whatsapp_instance_allowed_members` é aberta à org; com lista, só a
-- lista; master, gestor e admin bypassam.
SELECT plan(33);

-- ===========================================================================
-- ANTI-REGRESSÃO — o que a recriação da função NÃO pode ter perdido
-- ===========================================================================
-- Esta migration recria `fn_voip_call_reserve` inteira, partindo da definição
-- VIVA extraída de produção por pg_get_functiondef (md5
-- 4b9762bc4217d3f8923623ec7a43fdf4). Montar sobre a versão errada é o erro que
-- este projeto já cometeu — e nenhuma asserção de comportamento abaixo pegaria,
-- porque a semente não encosta em limiar nenhum.

SELECT matches(
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure),
  'c_max_org_live\s+constant integer\s+:= 100',
  'sem-teto: c_max_org_live = 100 sobrevive'
);
SELECT matches(
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure),
  'c_max_per_minute\s+constant integer\s+:= 600',
  'sem-teto: c_max_per_minute = 600 sobrevive'
);
SELECT matches(
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure),
  'c_max_per_peer_day\s+constant integer\s+:= 1000',
  'sem-teto: c_max_per_peer_day = 1000 sobrevive'
);
SELECT matches(
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure),
  'c_peer_backoff\s+constant interval\s+:= interval ''0 seconds''',
  'sem-teto: c_peer_backoff = 0 seconds sobrevive'
);
-- O consentimento CONDICIONAL é decisão do CTO de 2026-07-31. Uma migration
-- montada sobre a fundação o traria de volta como trava dura, e voltaria a
-- recusar TODA ligação de saída com consent_missing.
SELECT matches(
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure),
  'require_voice_consent',
  'consentimento continua CONDICIONAL a organizations.require_voice_consent'
);
SELECT matches(
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure),
  'not_instance_member',
  'o gate de instância está no corpo da reserva'
);

-- ===========================================================================
-- GRANTS — o helper recebe identidade por PARÂMETRO
-- ===========================================================================
-- DEFINER + `p_user_id` por parâmetro + grant amplo é o desenho que já vazou
-- neste projeto: qualquer usuário sondaria "fulano pode usar a instância X?" e
-- enumeraria roster de outra org. Só service_role executa.

SELECT ok(
  NOT has_function_privilege('anon', 'public.fn_voip_can_use_instance(uuid,uuid)', 'EXECUTE'),
  'anon NÃO executa fn_voip_can_use_instance'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.fn_voip_can_use_instance(uuid,uuid)', 'EXECUTE'),
  'authenticated NÃO executa fn_voip_can_use_instance'
);
SELECT ok(
  has_function_privilege('service_role', 'public.fn_voip_can_use_instance(uuid,uuid)', 'EXECUTE'),
  'service_role executa fn_voip_can_use_instance'
);

-- ===========================================================================
-- SEMENTE
-- ===========================================================================
-- whatsapp_instances tem trg_enforce_whatsapp_instance_limit BEFORE INSERT, que
-- chama org_resolve_quota -> assert_org_access(p_org_id). Rodando como postgres
-- via psql (sem JWT), isso levanta P0001 access_denied. Mesmo tratamento de
-- voip_reserve_inbound_requires_tc_call_id_test.sql:42.
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email) VALUES
  ('7b000000-0000-0000-0000-000000000001', 'aberta@voip.test'),    -- membro comum, instância aberta
  ('7b000000-0000-0000-0000-000000000002', 'nalista@voip.test'),   -- membro NA lista
  ('7b000000-0000-0000-0000-000000000003', 'forasteiro@voip.test'),-- membro FORA da lista
  ('7b000000-0000-0000-0000-000000000004', 'admin@voip.test'),     -- admin, fora da lista
  ('7b000000-0000-0000-0000-000000000005', 'inativo@voip.test'),   -- INATIVO, na lista
  ('7b000000-0000-0000-0000-000000000006', 'master@voip.test'),    -- master de plataforma
  ('7b000000-0000-0000-0000-000000000007', 'gestor@voip.test'),    -- gestor de portfólio
  ('7b000000-0000-0000-0000-000000000008', 'outraorg@voip.test'),  -- ativo em OUTRA org
  ('7b000000-0000-0000-0000-000000000009', 'nalista2@voip.test');  -- na lista, sem chamada viva

INSERT INTO public.organizations (id, name, slug) VALUES
  ('77777777-7777-7777-7777-777777777777', 'Org Voz Acesso', 'org-voz-acesso'),
  ('77777777-7777-7777-7777-777777777778', 'Org Vizinha',    'org-vizinha');

-- Duas instâncias com voz na MESMA org: a diferença entre elas é só a lista.
--   ABERTA   → zero allowed_members. É a forma da "Gipp teste" em produção
--              (owner_team_member_id NULL, zero allowed_members), a única
--              instância com voice_calls_enabled em 2026-07-31.
--   RESTRITA → tem lista.
INSERT INTO public.whatsapp_instances
  (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap, owner_team_member_id)
VALUES
  ('7a000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   'inst-aberta', true, NULL, NULL),
  ('7a000000-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777',
   'inst-restrita', true, NULL, NULL);

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('7c000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   '7b000000-0000-0000-0000-000000000001', 'Membro Aberta', 'member', true),
  ('7c000000-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777',
   '7b000000-0000-0000-0000-000000000002', 'Membro Na Lista', 'member', true),
  ('7c000000-0000-0000-0000-000000000003', '77777777-7777-7777-7777-777777777777',
   '7b000000-0000-0000-0000-000000000003', 'Membro Forasteiro', 'member', true),
  ('7c000000-0000-0000-0000-000000000004', '77777777-7777-7777-7777-777777777777',
   '7b000000-0000-0000-0000-000000000004', 'Admin da Org', 'admin', true),
  -- DESATIVADO, e mesmo assim listado na instância restrita — o caso do furo
  -- simétrico que este projeto já teve em assert_org_access.
  ('7c000000-0000-0000-0000-000000000005', '77777777-7777-7777-7777-777777777777',
   '7b000000-0000-0000-0000-000000000005', 'Membro Inativo', 'member', false),
  -- Ativo, mas na org VIZINHA.
  ('7c000000-0000-0000-0000-000000000008', '77777777-7777-7777-7777-777777777778',
   '7b000000-0000-0000-0000-000000000008', 'Membro Outra Org', 'member', true),
  -- Segundo membro da lista, mantido SEM chamada viva de propósito: o controle
  -- positivo do atendimento precisa de um operador livre, senão esbarraria em
  -- idx_voip_calls_one_live_per_operator e devolveria operator_busy — negativa
  -- pelo motivo errado.
  ('7c000000-0000-0000-0000-000000000009', '77777777-7777-7777-7777-777777777777',
   '7b000000-0000-0000-0000-000000000009', 'Membro Na Lista 2', 'member', true);

-- A lista da instância restrita: o membro "na lista" e o INATIVO.
INSERT INTO public.whatsapp_instance_allowed_members (whatsapp_instance_id, team_member_id) VALUES
  ('7a000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000002'),
  ('7a000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000005'),
  ('7a000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000009');

INSERT INTO public.master_users (user_id, is_active)
VALUES ('7b000000-0000-0000-0000-000000000006', true);

INSERT INTO public.gestores (id, user_id, is_active)
VALUES ('7e000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000007', true);
INSERT INTO public.gestor_organizations (gestor_id, organization_id)
VALUES ('7e000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777');

INSERT INTO public.voip_sessions (organization_id, whatsapp_instance_id, tc_session_id, name, status) VALUES
  ('77777777-7777-7777-7777-777777777777', '7a000000-0000-0000-0000-000000000001',
   'sess-aberta', 'TorqueCalls', 'open'),
  ('77777777-7777-7777-7777-777777777777', '7a000000-0000-0000-0000-000000000002',
   'sess-restrita', 'TorqueCalls', 'open');

INSERT INTO public.leads (id, organization_id, name)
VALUES ('7d000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'Lead Voz');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- A REGRA, isolada — fn_voip_can_use_instance
-- ===========================================================================
-- Testar o helper direto separa "a regra está certa" de "o gate consulta a
-- regra". E evita o UNIQUE parcial idx_voip_calls_one_live_per_operator, que
-- prenderia cada operador na primeira reserva bem-sucedida.

-- CASO 1 do brief. É também o caso 6: a forma da "Gipp teste".
SELECT ok(
  public.fn_voip_can_use_instance(
    '7b000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001'),
  'instância SEM allowed_members: membro comum PODE'
);

-- CASO 2.
SELECT ok(
  public.fn_voip_can_use_instance(
    '7b000000-0000-0000-0000-000000000002', '7a000000-0000-0000-0000-000000000002'),
  'instância COM lista, usuário NA lista: PODE'
);

-- CASO 3. MUTANTE QUE ISTO MATA: apagar o ramo da lista (ou devolver sempre
-- true) — o forasteiro passaria.
SELECT ok(
  NOT public.fn_voip_can_use_instance(
    '7b000000-0000-0000-0000-000000000003', '7a000000-0000-0000-0000-000000000002'),
  'instância COM lista, usuário FORA da lista: NÃO pode'
);

-- CASO 4. MUTANTE: remover o bypass de admin — o admin da org perderia o acesso
-- que o inbox já lhe dá, e o servidor divergiria da interface.
SELECT ok(
  public.fn_voip_can_use_instance(
    '7b000000-0000-0000-0000-000000000004', '7a000000-0000-0000-0000-000000000002'),
  'admin da org fora da lista: PODE (bypass, igual ao inbox)'
);

-- CASO 5. MUTANTE: tirar `AND tm.is_active = true` da tradução user→team_member.
-- Sem ele o desativado continua na lista e continua ligando — o mesmo furo que
-- assert_org_access teve, com 15 membros inativos em produção na época.
SELECT ok(
  NOT public.fn_voip_can_use_instance(
    '7b000000-0000-0000-0000-000000000005', '7a000000-0000-0000-0000-000000000002'),
  'membro INATIVO que está na lista: NÃO pode'
);

-- MUTANTE: remover o bypass de master.
SELECT ok(
  public.fn_voip_can_use_instance(
    '7b000000-0000-0000-0000-000000000006', '7a000000-0000-0000-0000-000000000002'),
  'master de plataforma: PODE'
);

-- MUTANTE: remover o ramo do gestor — ele vive FORA de team_members, então
-- resolver só por roster o negaria. A interface já o trata como master
-- (isVirtualTeamMember cobre "gestor-virtual-"), então negá-lo aqui seria
-- exatamente a divergência que esta feature existe para evitar.
SELECT ok(
  public.fn_voip_can_use_instance(
    '7b000000-0000-0000-0000-000000000007', '7a000000-0000-0000-0000-000000000002'),
  'gestor de portfólio vinculado: PODE'
);

-- MUTANTE: tirar `tm.organization_id = v_org_id` da tradução — um membro ativo
-- de QUALQUER org casaria por user_id e atravessaria tenant.
SELECT ok(
  NOT public.fn_voip_can_use_instance(
    '7b000000-0000-0000-0000-000000000008', '7a000000-0000-0000-0000-000000000001'),
  'membro ativo de OUTRA org: NÃO pode (nem na instância aberta)'
);

-- Fail-closed em entrada que não resolve.
SELECT ok(
  NOT public.fn_voip_can_use_instance(
    '7b000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-0000000000ff'),
  'instância inexistente: NÃO pode'
);
SELECT ok(
  NOT public.fn_voip_can_use_instance(
    NULL, '7a000000-0000-0000-0000-000000000001'),
  'usuário NULL: NÃO pode'
);

-- ===========================================================================
-- O GATE — fn_voip_call_reserve consulta a regra
-- ===========================================================================
-- As NEGATIVAS vêm primeiro, de propósito: assim a asserção de "não consumiu
-- cota" mede a ausência de linha, e o caso positivo logo abaixo prova que a
-- cota SOBE quando a reserva de fato acontece.

CREATE TEMP TABLE r_forasteiro AS
SELECT public.fn_voip_call_reserve(
  '77777777-7777-7777-7777-777777777777'::uuid,
  '7b000000-0000-0000-0000-000000000003'::uuid,   -- forasteiro
  'sess-restrita', '5548991005282',
  '7d000000-0000-0000-0000-000000000001'::uuid, 'outbound', NULL, NULL
) AS r;

SELECT is(
  (SELECT r ->> 'code' FROM r_forasteiro),
  'not_instance_member',
  'reserva pela instância restrita, usuário fora da lista: not_instance_member'
);

-- NEGATIVA PURA: nenhuma linha criada. Sem isto, o operador ficaria preso pelo
-- UNIQUE parcial idx_voip_calls_one_live_per_operator por uma chamada que nunca
-- foi autorizada.
SELECT is(
  (SELECT count(*) FROM public.voip_calls
    WHERE operator_user_id = '7b000000-0000-0000-0000-000000000003'),
  0::bigint,
  'SEM EFEITO COLATERAL: a negativa não cria linha em voip_calls'
);

SELECT is(
  (SELECT count(*) FROM public.voip_call_usage
    WHERE whatsapp_instance_id = '7a000000-0000-0000-0000-000000000002'),
  0::bigint,
  'SEM EFEITO COLATERAL: a negativa não consome cota da instância'
);

CREATE TEMP TABLE r_inativo AS
SELECT public.fn_voip_call_reserve(
  '77777777-7777-7777-7777-777777777777'::uuid,
  '7b000000-0000-0000-0000-000000000005'::uuid,   -- inativo, mas NA lista
  'sess-restrita', '5548991005283',
  '7d000000-0000-0000-0000-000000000001'::uuid, 'outbound', NULL, NULL
) AS r;

SELECT is(
  (SELECT r ->> 'code' FROM r_inativo),
  'not_instance_member',
  'membro desativado que está na lista também é recusado pelo gate'
);

-- CONTROLE POSITIVO. Sem ele, um bug que negasse SEMPRE passaria vacuamente.
CREATE TEMP TABLE r_nalista AS
SELECT public.fn_voip_call_reserve(
  '77777777-7777-7777-7777-777777777777'::uuid,
  '7b000000-0000-0000-0000-000000000002'::uuid,   -- na lista
  'sess-restrita', '5548991005284',
  '7d000000-0000-0000-0000-000000000001'::uuid, 'outbound', NULL, NULL
) AS r;

SELECT is(
  (SELECT (r ->> 'ok')::boolean FROM r_nalista),
  true,
  'a MESMA instância restrita autoriza quem está na lista'
);

SELECT is(
  (SELECT calls_authorized FROM public.voip_call_usage
    WHERE whatsapp_instance_id = '7a000000-0000-0000-0000-000000000002'),
  1,
  'a cota sobe SÓ na reserva autorizada — prova que o gate, e não outra coisa, barrou as duas anteriores'
);

CREATE TEMP TABLE r_admin AS
SELECT public.fn_voip_call_reserve(
  '77777777-7777-7777-7777-777777777777'::uuid,
  '7b000000-0000-0000-0000-000000000004'::uuid,   -- admin, fora da lista
  'sess-restrita', '5548991005285',
  '7d000000-0000-0000-0000-000000000001'::uuid, 'outbound', NULL, NULL
) AS r;

SELECT is(
  (SELECT (r ->> 'ok')::boolean FROM r_admin),
  true,
  'admin da org reserva pela instância restrita mesmo fora da lista'
);

-- CASO 6 do brief, no caminho completo: a forma da "Gipp teste" (zero
-- allowed_members). NINGUÉM da Milennials pode ser barrado por esta mudança
-- hoje — a instância é aberta, e continua aberta.
CREATE TEMP TABLE r_aberta AS
SELECT public.fn_voip_call_reserve(
  '77777777-7777-7777-7777-777777777777'::uuid,
  '7b000000-0000-0000-0000-000000000001'::uuid,   -- membro comum qualquer
  'sess-aberta', '5548991005286',
  '7d000000-0000-0000-0000-000000000001'::uuid, 'outbound', NULL, NULL
) AS r;

SELECT is(
  (SELECT (r ->> 'ok')::boolean FROM r_aberta),
  true,
  'INÉRCIA EM PRODUÇÃO: instância sem lista (forma da "Gipp teste") segue autorizando membro comum'
);

-- ===========================================================================
-- A CHAMADA DE ENTRADA NASCE SEM DONO
-- ===========================================================================
-- `p_operator_user_id` NULO é a criação da linha `ringing`: ninguém atendeu
-- ainda, então não há usuário a autorizar. `fn_voip_apply_vps_event` só ATUALIZA
-- linhas, nunca insere — se o gate barrasse aqui, NENHUMA chamada de entrada
-- chegaria a tocar.
--
-- MUTANTE QUE ISTO MATA: trocar a guarda por `IF NOT
-- fn_voip_can_use_instance(p_operator_user_id, v_instance)` sem o teste de NULL.
-- O helper devolve false para usuário NULL (asserção 19), então a entrada
-- inteira morreria — e nenhum outro caso deste arquivo perceberia.
CREATE TEMP TABLE r_entrada_nasce AS
SELECT public.fn_voip_call_reserve(
  '77777777-7777-7777-7777-777777777777'::uuid,
  NULL,                                           -- entrada nasce sem operador
  'sess-restrita', '5548991005287',
  NULL, 'inbound', NULL, NULL
) AS r;

SELECT is(
  (SELECT (r ->> 'ok')::boolean FROM r_entrada_nasce),
  true,
  'chamada de ENTRADA nasce sem operador e NÃO é barrada pelo gate de instância'
);

-- E o gate humano não foi pulado, só adiado: ATENDER aquela mesma linha, com um
-- operador que não está na lista, é recusado.
CREATE TEMP TABLE r_atende_forasteiro AS
SELECT public.fn_voip_call_reserve(
  '77777777-7777-7777-7777-777777777777'::uuid,
  '7b000000-0000-0000-0000-000000000003'::uuid,   -- forasteiro
  'sess-restrita', '5548991005287',
  NULL, 'inbound', NULL,
  (SELECT id FROM public.voip_calls WHERE peer_phone = '5548991005287')
) AS r;

SELECT is(
  (SELECT r ->> 'code' FROM r_atende_forasteiro),
  'not_instance_member',
  'ATENDER a chamada de entrada exige o vínculo — o gate foi adiado, não pulado'
);

-- SEM EFEITO COLATERAL no atendimento recusado: a linha continua sem dono, em
-- vez de ficar presa a um operador que nunca a atendeu (o mesmo defeito do
-- achado I1).
SELECT ok(
  (SELECT operator_user_id FROM public.voip_calls
    WHERE peer_phone = '5548991005287') IS NULL,
  'SEM EFEITO COLATERAL: a recusa no atendimento não grava operator_user_id'
);

-- ===========================================================================
-- AUTORIZAR POR UMA CHAVE E AGIR POR OUTRA
-- ===========================================================================
-- O gate resolve a instância a partir de `p_tc_session_id` — uma string que o
-- CHAMADOR nomeia. O UPDATE do atendimento casava por `id = p_existing_call_id
-- AND organization_id`, SEM a sessão. Quem quisesse atender uma chamada que
-- chegou numa instância restrita bastava nomear a sessão de uma instância
-- aberta: o gate aprovava sobre a instância errada, o UPDATE achava a chamada
-- certa, e o forasteiro virava operator_user_id dela — com os três tokens
-- assinados.
--
-- A irmã `renewCallControlToken` (call-plane.ts) já conferia `tc_session_id`. A
-- assimetria entre as duas é o que denuncia a omissão.
--
-- A correção amarra a chave que AUTORIZA à chave que AGE: o UPDATE passa a
-- exigir `tc_session_id = p_tc_session_id`.
CREATE TEMP TABLE r_atende_por_fora AS
SELECT public.fn_voip_call_reserve(
  '77777777-7777-7777-7777-777777777777'::uuid,
  '7b000000-0000-0000-0000-000000000003'::uuid,   -- forasteiro
  'sess-aberta',                                  -- <<< sessão da instância ABERTA
  '5548991005287',
  NULL, 'inbound', NULL,
  -- ...mas a chamada é a que nasceu na instância RESTRITA.
  (SELECT id FROM public.voip_calls WHERE peer_phone = '5548991005287')
) AS r;

SELECT isnt(
  (SELECT (r ->> 'ok')::boolean FROM r_atende_por_fora),
  true,
  'atender nomeando a sessão de OUTRA instância é RECUSADO (autorizar e agir usam a mesma chave)'
);

SELECT ok(
  (SELECT operator_user_id FROM public.voip_calls
    WHERE peer_phone = '5548991005287') IS NULL,
  'SEM EFEITO COLATERAL: a chamada da instância restrita não ganha dono por sessão emprestada'
);

-- CONTROLE POSITIVO. Sem ele, a asserção acima passaria vacuamente se o
-- atendimento tivesse simplesmente parado de funcionar. Um membro DA LISTA,
-- nomeando a sessão CERTA, atende e vira o operador.
CREATE TEMP TABLE r_atende_certo AS
SELECT public.fn_voip_call_reserve(
  '77777777-7777-7777-7777-777777777777'::uuid,
  '7b000000-0000-0000-0000-000000000009'::uuid,   -- na lista, e sem chamada viva
  'sess-restrita', '5548991005287',
  NULL, 'inbound', NULL,
  (SELECT id FROM public.voip_calls WHERE peer_phone = '5548991005287')
) AS r;

SELECT is(
  (SELECT operator_user_id FROM public.voip_calls
    WHERE peer_phone = '5548991005287'),
  '7b000000-0000-0000-0000-000000000009'::uuid,
  'quem está na lista atende pela sessão CERTA e vira o operador'
);

SELECT * FROM finish();
ROLLBACK;
