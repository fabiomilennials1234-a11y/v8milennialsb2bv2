-- Bateria FUNCIONAL das RPCs de identidade social (migration 20270817090000).
--
-- Uso:  node scripts/prod-sql.mjs --file scripts/verify/lead-social-identities-funcional.sql
--
-- ⚠️ RODA CONTRA PROD E TERMINA EM `ROLLBACK`. Nada persiste — o lead, a
--    identidade, a entry de funil e o backfill são criados e desfeitos dentro da
--    mesma transação. Foi assim que ela foi validada em 2026-08-15, com o estado
--    de prod conferido depois: 0 identidades, 0 leads, 0 mensagens tocadas.
--
-- ⚠️ RODA COMO ROLE `authenticated`, com claims de um usuário real. Rodar como
--    superusuário daria FALSO VERDE: postgres bypassa RLS, e metade do que esta
--    bateria mede é justamente gate de tenant.
--
-- DEPENDE DO DADO SINTÉTICO da org Milennials (canal `TESTE-ch-sintetico-001` e
-- as mensagens `TESTE-msg-%`, contato `igsid-1001` com DUAS mensagens — o
-- contato de duas mensagens é de propósito: com uma só, o teste de backfill não
-- distingue "atualizou a thread" de "atualizou uma linha"). Se esse dado for
-- apagado, trocar os uuids do topo de cada teste.
BEGIN;

CREATE TEMP TABLE t_res(ordem int, teste text, resultado text) ON COMMIT DROP;
CREATE TEMP TABLE t_ctx(k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON TABLE t_res TO authenticated;
GRANT ALL ON TABLE t_ctx TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"1d7c90bc-896c-4295-be75-79c559b40cab","role":"authenticated"}', true);

-- Controle: o contexto de auth é o que eu penso que é.
INSERT INTO t_res VALUES (0, 'contexto: auth.uid() e role',
  CASE WHEN auth.uid() = '1d7c90bc-896c-4295-be75-79c559b40cab'::uuid
        AND current_user = 'authenticated'
       THEN 'ok — uid + role authenticated'
       ELSE 'FALHA — uid=' || COALESCE(auth.uid()::text,'null') || ' role=' || current_user END);

-- T1 — gate 1: org que não é minha.
DO $$ BEGIN
  PERFORM public.link_social_conversation_to_lead(
    '9d0367c6-2ae8-40cf-9862-a225a5b19026'::uuid,
    'cbd15756-862e-4324-a24e-cd2ab021c1b1'::uuid, 'igsid-1001',
    '11ef016d-01bc-44b6-b892-b75c52688a84'::uuid);
  INSERT INTO t_res VALUES (1, 'gate org: org de outro tenant', 'FALHA — nao levantou');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t_res VALUES (1, 'gate org: org de outro tenant',
    CASE WHEN SQLSTATE = '42501' THEN 'ok — 42501: ' || SQLERRM
         ELSE 'FALHA — ' || SQLSTATE || ': ' || SQLERRM END);
END $$;

-- T2 — gate 2: canal que não é da org.
DO $$ BEGIN
  PERFORM public.link_social_conversation_to_lead(
    '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,
    '00000000-0000-0000-0000-0000000000ff'::uuid, 'igsid-1001',
    'f5dab538-bf9f-447b-9f88-343cc69ecf92'::uuid);
  INSERT INTO t_res VALUES (2, 'gate canal: canal fora da org', 'FALHA — nao levantou');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t_res VALUES (2, 'gate canal: canal fora da org',
    CASE WHEN SQLSTATE = '42501' THEN 'ok — 42501: ' || SQLERRM
         ELSE 'FALHA — ' || SQLSTATE || ': ' || SQLERRM END);
END $$;

-- T3 — gate 3: lead de outro tenant, org e canal corretos.
DO $$ BEGIN
  PERFORM public.link_social_conversation_to_lead(
    '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,
    'cbd15756-862e-4324-a24e-cd2ab021c1b1'::uuid, 'igsid-1001',
    '11ef016d-01bc-44b6-b892-b75c52688a84'::uuid);
  INSERT INTO t_res VALUES (3, 'gate lead: lead de outro tenant', 'FALHA — nao levantou');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t_res VALUES (3, 'gate lead: lead de outro tenant',
    CASE WHEN SQLSTATE = '42501' THEN 'ok — 42501: ' || SQLERRM
         ELSE 'FALHA — ' || SQLSTATE || ': ' || SQLERRM END);
END $$;

-- T4 — caminho feliz: criar lead a partir da conversa sintética.
DO $$
DECLARE v_lead uuid;
BEGIN
  v_lead := public.create_lead_from_social_conversation(
    '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,
    'cbd15756-862e-4324-a24e-cd2ab021c1b1'::uuid,
    'igsid-1001', 'QA detector — apagar', NULL, NULL, NULL, 'qualificacao');
  INSERT INTO t_ctx VALUES ('lead', v_lead);
  INSERT INTO t_res VALUES (4, 'criar lead da conversa', 'ok — lead ' || v_lead::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t_res VALUES (4, 'criar lead da conversa', 'FALHA — ' || SQLSTATE || ': ' || SQLERRM);
END $$;

INSERT INTO t_res
SELECT 5, 'lead nasce origin=instagram, nao-shadow',
       CASE WHEN l.origin::text = 'instagram' AND l.is_shadow IS FALSE
            THEN 'ok' ELSE 'FALHA — origin=' || l.origin::text || ' shadow=' || l.is_shadow::text END
  FROM public.leads l JOIN t_ctx c ON c.k = 'lead' AND l.id = c.v;

INSERT INTO t_res
SELECT 6, 'identidade social criada (1 linha)',
       CASE WHEN count(*) = 1 THEN 'ok' ELSE 'FALHA — ' || count(*)::text END
  FROM public.lead_social_identities si, t_ctx c
 WHERE c.k = 'lead' AND si.lead_id = c.v;

INSERT INTO t_res
SELECT 7, 'backfill do cache em channel_messages',
       CASE WHEN count(*) = 2 THEN 'ok — 2 de 2' ELSE 'FALHA — ' || count(*)::text || ' de 2' END
  FROM public.channel_messages m, t_ctx c
 WHERE c.k = 'lead' AND m.contact_external_id = 'igsid-1001' AND m.lead_id = c.v;

INSERT INTO t_res
SELECT 8, 'entrou no funil (pipeline_entries)',
       CASE WHEN count(*) = 1 THEN 'ok' ELSE 'FALHA — ' || count(*)::text END
  FROM public.pipeline_entries pe, t_ctx c
 WHERE c.k = 'lead' AND pe.lead_id = c.v;

INSERT INTO t_res
SELECT 9, 'trilha em lead_history (created + linked)',
       CASE WHEN count(*) = 2 THEN 'ok' ELSE 'FALHA — ' || count(*)::text END
  FROM public.lead_history lh, t_ctx c
 WHERE c.k = 'lead' AND lh.lead_id = c.v
   AND lh.action IN ('lead_created', 'social_identity_linked');

-- T10 — segunda criação na mesma conversa: a duplicata que a chave impede.
DO $$ BEGIN
  PERFORM public.create_lead_from_social_conversation(
    '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,
    'cbd15756-862e-4324-a24e-cd2ab021c1b1'::uuid,
    'igsid-1001', 'QA duplicata — apagar');
  INSERT INTO t_res VALUES (10, 'criar de novo na mesma conversa', 'FALHA — criou duplicata');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t_res VALUES (10, 'criar de novo na mesma conversa',
    CASE WHEN SQLERRM LIKE 'identity_already_linked:%' THEN 'ok — ' || SQLERRM
         ELSE 'FALHA — ' || SQLSTATE || ': ' || SQLERRM END);
END $$;

-- T11 — vincular ao MESMO lead: idempotente.
DO $$
DECLARE v_id uuid; v_lead uuid;
BEGIN
  SELECT v INTO v_lead FROM t_ctx WHERE k = 'lead';
  v_id := public.link_social_conversation_to_lead(
    '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,
    'cbd15756-862e-4324-a24e-cd2ab021c1b1'::uuid, 'igsid-1001', v_lead);
  INSERT INTO t_res VALUES (11, 'vincular ao mesmo lead (idempotente)',
    CASE WHEN v_id IS NOT NULL THEN 'ok — mesma identidade' ELSE 'FALHA — null' END);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t_res VALUES (11, 'vincular ao mesmo lead (idempotente)',
    'FALHA — ' || SQLSTATE || ': ' || SQLERRM);
END $$;

-- T12 — vincular a OUTRO lead: recusa, em vez de roubar a conversa.
DO $$ BEGIN
  PERFORM public.link_social_conversation_to_lead(
    '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,
    'cbd15756-862e-4324-a24e-cd2ab021c1b1'::uuid, 'igsid-1001',
    'f5dab538-bf9f-447b-9f88-343cc69ecf92'::uuid);
  INSERT INTO t_res VALUES (12, 'vincular a OUTRO lead', 'FALHA — sobrescreveu');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t_res VALUES (12, 'vincular a OUTRO lead',
    CASE WHEN SQLERRM LIKE 'identity_already_linked:%' THEN 'ok — ' || SQLERRM
         ELSE 'FALHA — ' || SQLSTATE || ': ' || SQLERRM END);
END $$;

-- T13 — a lista devolve o vínculo lendo a IDENTIDADE, não o cache.
INSERT INTO t_res
SELECT 13, 'lista traz lead_id + lead_name da conversa',
       CASE WHEN g.lead_id = c.v AND g.lead_name = 'QA detector — apagar'
            THEN 'ok — ' || g.lead_name
            ELSE 'FALHA — lead_id=' || COALESCE(g.lead_id::text,'null') || ' name=' || COALESCE(g.lead_name,'null') END
  FROM public.get_social_conversation_list(
         '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,
         'cbd15756-862e-4324-a24e-cd2ab021c1b1'::uuid, 50, NULL) g,
       t_ctx c
 WHERE c.k = 'lead' AND g.contact_external_id = 'igsid-1001';

-- T14 — RLS de leitura: eu vejo a linha da MINHA org.
INSERT INTO t_res
SELECT 14, 'RLS: membro da org LE a identidade',
       CASE WHEN count(*) = 1 THEN 'ok' ELSE 'FALHA — ' || count(*)::text END
  FROM public.lead_social_identities si
 WHERE si.organization_id = '6030520a-2ca7-477d-be89-55758e2cd808'::uuid;

-- T15 — desvincular: o cache volta a NULL e a identidade some.
DO $$ BEGIN
  PERFORM public.unlink_social_conversation_from_lead(
    '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,
    'cbd15756-862e-4324-a24e-cd2ab021c1b1'::uuid, 'igsid-1001');
  INSERT INTO t_res VALUES (15, 'desvincular', 'ok — sem erro');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t_res VALUES (15, 'desvincular', 'FALHA — ' || SQLSTATE || ': ' || SQLERRM);
END $$;

INSERT INTO t_res
SELECT 16, 'cache limpo apos desvincular',
       CASE WHEN count(*) = 0 THEN 'ok — 0 mensagens apontando'
            ELSE 'FALHA — ' || count(*)::text END
  FROM public.channel_messages m, t_ctx c
 WHERE c.k = 'lead' AND m.contact_external_id = 'igsid-1001' AND m.lead_id = c.v;

-- T17 — desvincular de novo: sucesso silencioso, não toast vermelho.
DO $$ BEGIN
  PERFORM public.unlink_social_conversation_from_lead(
    '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,
    'cbd15756-862e-4324-a24e-cd2ab021c1b1'::uuid, 'igsid-1001');
  INSERT INTO t_res VALUES (17, 'desvincular de novo (idempotente)', 'ok — silencioso');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t_res VALUES (17, 'desvincular de novo (idempotente)',
    'FALHA — ' || SQLSTATE || ': ' || SQLERRM);
END $$;

RESET ROLE;

SELECT ordem, teste, resultado FROM t_res ORDER BY ordem;

ROLLBACK;
