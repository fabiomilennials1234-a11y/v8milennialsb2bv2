-- supabase/tests/avisos_produtores_test.sql
--
-- pgTAP: os eventos que hoje não avisam ninguém passam a nascer como Aviso
-- (issue #1885, ADR-0035). Vocabulário em CONTEXT.md, seção "Avisos".
--
-- O Aviso nasce no banco, não na função de borda: mensagem entra por webhook,
-- por sincronização de histórico ou por replay da fila morta, e o dono precisa
-- ser avisado em todos os caminhos.
--
-- Sem efeito colateral: transação revertida no fim.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

-- Fixtures entram com os gatilhos de aplicação desligados (idioma das outras
-- suítes deste diretório): o limite de assentos exige contexto de organização
-- que um teste não tem. Voltam a ligar antes do comportamento sob teste.
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

-- O Closer é um Team Member; o Aviso é endereçado à conta de usuário dele.
CREATE TEMP TABLE _p_fix (org uuid, dono uuid, membro uuid, lead uuid) ON COMMIT DROP;

INSERT INTO _p_fix (org, dono, membro, lead)
VALUES ('a1111111-1111-1111-1111-111111111111'::uuid,
        'a2222222-2222-2222-2222-222222222222'::uuid,
        'a4444444-4444-4444-4444-444444444444'::uuid,
        'a3333333-3333-3333-3333-333333333333'::uuid);

INSERT INTO auth.users (id, email)
SELECT dono, 'produtor-dono@example.test' FROM _p_fix;

INSERT INTO public.organizations (id, name, slug)
SELECT org, 'Produtores Fixture', 'produtores-fixture' FROM _p_fix;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
SELECT membro, org, dono, 'Carla Menezes', 'member', true FROM _p_fix;

INSERT INTO public.leads (id, organization_id, name, sale_responsible_id)
SELECT lead, org, 'Marcos Andrade', membro FROM _p_fix;

-- Gatilhos de volta: daqui para baixo é comportamento sob teste.
SET LOCAL session_replication_role = DEFAULT;

-- ---------------------------------------------------------------------------
-- Mensagem recebida de um lead com dono → Aviso de conversa para esse dono.
-- ---------------------------------------------------------------------------
INSERT INTO public.whatsapp_messages
  (organization_id, message_id, remote_jid, phone_number, direction, lead_id, content)
SELECT org, 'msg-fixture-1', '5511999990001@s.whatsapp.net', '5511999990001',
       'incoming', lead, 'Consigo fechar hoje'
FROM _p_fix;

SELECT is(
  (SELECT ARRAY[n.user_id::text, n.type, n.group_key, n.event_count::text]
     FROM public.notifications n, _p_fix f
    WHERE n.group_key = 'msg:' || f.lead::text),
  (SELECT ARRAY[dono::text, 'lead_message', 'msg:' || lead::text, '1'] FROM _p_fix),
  'mensagem recebida de lead com dono gera Aviso de conversa para o dono'
);

-- ---------------------------------------------------------------------------
-- Rajada: a segunda mensagem engorda o mesmo Aviso, não cria outro.
-- ---------------------------------------------------------------------------
INSERT INTO public.whatsapp_messages
  (organization_id, message_id, remote_jid, phone_number, direction, lead_id, content)
SELECT org, 'msg-fixture-2', '5511999990001@s.whatsapp.net', '5511999990001',
       'incoming', lead, 'Se entregarem até sexta'
FROM _p_fix;

SELECT is(
  (SELECT ARRAY[count(*)::int, max(n.event_count)]
     FROM public.notifications n, _p_fix f
    WHERE n.group_key = 'msg:' || f.lead::text),
  ARRAY[1, 2],
  'segunda mensagem da mesma conversa engorda o Aviso em vez de criar outro'
);

-- ---------------------------------------------------------------------------
-- O que NÃO avisa: saída, grupo, mensagem de IA e lead sem dono.
-- Cada um destes já custou atenção de vendedor em algum produto.
-- ---------------------------------------------------------------------------
INSERT INTO public.leads (id, organization_id, name)
SELECT 'a5555555-5555-5555-5555-555555555555'::uuid, org, 'Lead órfão' FROM _p_fix;

INSERT INTO public.whatsapp_messages
  (organization_id, message_id, remote_jid, phone_number, direction, lead_id, content, is_group, sent_by_ai)
SELECT org, 'msg-saida',  '5511999990002@s.whatsapp.net', '5511999990002', 'outgoing', lead, 'oi',  false, false FROM _p_fix
UNION ALL
SELECT org, 'msg-grupo',  '120363000000000000@g.us',      '5511999990003', 'incoming', lead, 'oi',  true,  false FROM _p_fix
UNION ALL
SELECT org, 'msg-da-ia',  '5511999990004@s.whatsapp.net', '5511999990004', 'incoming', lead, 'oi',  false, true  FROM _p_fix
UNION ALL
SELECT org, 'msg-orfao',  '5511999990005@s.whatsapp.net', '5511999990005', 'incoming',
       'a5555555-5555-5555-5555-555555555555'::uuid, 'oi', false, false FROM _p_fix;

SELECT is(
  (SELECT ARRAY[
     (SELECT max(n.event_count) FROM public.notifications n, _p_fix f
       WHERE n.group_key = 'msg:' || f.lead::text),
     (SELECT count(*)::int FROM public.notifications
       WHERE group_key = 'msg:a5555555-5555-5555-5555-555555555555')
   ]),
  ARRAY[2, 0],
  'saída, grupo, mensagem de IA e lead sem dono não produzem Aviso'
);

-- ---------------------------------------------------------------------------
-- Lead novo atribuído: velocidade de primeira resposta é o que converte.
-- ---------------------------------------------------------------------------
INSERT INTO public.leads (id, organization_id, name, company, origin, sale_responsible_id)
SELECT 'a6666666-6666-6666-6666-666666666666'::uuid, org, 'Dagoberto Silva',
       'Metalúrgica Cruzeiro', 'meta_ads', membro
FROM _p_fix;

SELECT is(
  (SELECT ARRAY[n.user_id::text, n.type, n.title]
     FROM public.notifications n
    WHERE n.group_key = 'lead:a6666666-6666-6666-6666-666666666666'),
  (SELECT ARRAY[dono::text, 'lead_new', 'Dagoberto Silva'] FROM _p_fix),
  'lead novo com dono gera Aviso de lead para o dono'
);

-- ---------------------------------------------------------------------------
-- Reunião marcada: o evento já existe desde a ADR-0007 e ninguém escutava.
-- Quem marcou não se notifica — o ator vem da sessão, porque o evento de
-- reunião não registra autor nenhum (medido em produção: metadata vazio).
-- ---------------------------------------------------------------------------
INSERT INTO public.meeting_events
  (organization_id, lead_id, event_type, meeting_date, source)
SELECT org, lead, 'meeting_booked', now() + interval '1 day', 'pipeline:confirmacao'
FROM _p_fix;

-- Agora o próprio dono marca: não pode chegar Aviso da própria ação.
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', dono::text, 'role', 'authenticated')::text,
                  true)
FROM _p_fix;

INSERT INTO public.meeting_events
  (organization_id, lead_id, event_type, meeting_date, source)
SELECT org, 'a6666666-6666-6666-6666-666666666666'::uuid, 'meeting_booked',
       now() + interval '2 days', 'pipeline:confirmacao'
FROM _p_fix;

SELECT set_config('request.jwt.claims', NULL, true);

SELECT is(
  (SELECT ARRAY[
     (SELECT count(*)::int FROM public.notifications n, _p_fix f
       WHERE n.group_key = 'meet:' || f.lead::text AND n.type = 'meeting_booked'),
     (SELECT count(*)::int FROM public.notifications
       WHERE group_key = 'meet:a6666666-6666-6666-6666-666666666666')
   ]),
  ARRAY[1, 0],
  'reunião marcada avisa o dono do lead, e quem marcou não se notifica'
);

SELECT * FROM finish();

ROLLBACK;
