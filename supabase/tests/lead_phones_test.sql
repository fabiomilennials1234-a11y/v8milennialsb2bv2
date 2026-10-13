-- supabase/tests/lead_phones_test.sql
--
-- Chamado 82c50502: contatos nomeados do lead
-- (migration 20271112000000_lead_phones_contatos_nomeados.sql, ADR-0039).
--
--   (GR) GRANTs por pg_class.relacl; anon/PUBLIC fora; sem policy de DELETE.
--   (BF) backfill + espelho do principal (leads.phone → lead_phones).
--   (UQ) uniques: número por lead, principal por lead, erp_phone_id inclui
--        apagadas; mesmo número em dois leads é permitido.
--   (OG) guarda de org: org divergente do lead é recusada.
--   (XO) isolamento: usuário da org B não vê telefone da org A.
--   (SD) soft delete: salvar sem o telefone apaga (deleted_at), não DELETE;
--        authenticated não tem DELETE.
--   (LK) label_locked: nome editado no CRM trava; o sync do ERP não mexe nem
--        ressuscita apagado.
--   (NG) abrir_negocio: telefone de outro lead recusado; lead_phone_required com
--        2+ telefones e humano; 1 telefone é gravado sozinho; sem sobrecarga.
--   (WH) 4ª passada de resolve_message_lead_id: mensagem do telefone secundário
--        cai no lead; empate resolvido pelo negócio aberto com o telefone.
--   (AD) adoção de mensagem órfã quando o telefone entra no lead.
--
-- Roda inteiro em transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- (GR) GRANTs e RLS
-- ===========================================================================
SELECT is(
  (SELECT array_agg(DISTINCT a.privilege_type::text ORDER BY a.privilege_type::text)
     FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = 'public.lead_phones'::regclass AND a.grantee = 'authenticated'::regrole),
  ARRAY['SELECT'], 'GR1: authenticated só tem SELECT de tabela inteira (INSERT/UPDATE são por coluna) (relacl)');
SELECT is(
  (SELECT count(*)::int FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = 'public.lead_phones'::regclass AND a.grantee IN ('anon'::regrole, 0::oid)),
  0, 'GR2: anon e PUBLIC sem privilégio em lead_phones (relacl)');
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.lead_phones', 'source', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.lead_phones', 'erp_phone_id', 'UPDATE'),
  'GR3: cliente não altera source nem erp_phone_id');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lead_phones'::regclass),
  'GR4: RLS ligada em lead_phones');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lead_phones' AND cmd = 'DELETE'),
  0, 'GR5: nenhuma policy de DELETE (apagar é soft delete)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.aplicar_telefones_do_erp(uuid,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.aplicar_telefones_do_erp(uuid,jsonb)', 'EXECUTE'),
  'GR6: aplicar_telefones_do_erp é só do service_role (DEFINER com org por parâmetro)');
SELECT ok(NOT has_function_privilege('anon', 'public.salvar_telefones_do_lead(uuid,jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.salvar_telefones_do_lead(uuid,jsonb)', 'EXECUTE'),
  'GR7: salvar_telefones_do_lead: authenticated sim, anon não');

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('82c50502-0000-4000-8000-00000000000a', 'Org LP A', 'org-lp-a', 'America/Sao_Paulo'),
  ('82c50502-0000-4000-8000-00000000000b', 'Org LP B', 'org-lp-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT u.id::uuid, u.email, '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '', '', '', '', '', '', '', ''
  FROM (VALUES
    ('82c50502-0000-4000-8000-0000000000a1', 'lp-admin-a@test.local'),
    ('82c50502-0000-4000-8000-0000000000b1', 'lp-admin-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('82c50502-0000-4000-8000-0000000001a1', '82c50502-0000-4000-8000-00000000000a', '82c50502-0000-4000-8000-0000000000a1', 'Admin A', 'admin', true),
  ('82c50502-0000-4000-8000-0000000001b1', '82c50502-0000-4000-8000-00000000000b', '82c50502-0000-4000-8000-0000000000b1', 'Admin B', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('82c50502-0000-4000-8000-0000000003a1', '82c50502-0000-4000-8000-00000000000a', 'Qualificação', 'whatsapp', 'system')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, is_active)
VALUES
  ('82c50502-0000-4000-8000-0000000003a2', '82c50502-0000-4000-8000-00000000000a',
   '82c50502-0000-4000-8000-0000000003a1', 'whatsapp', 'novo', 'Novo', 0, true)
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- Leads nascem com gatilhos ligados: o espelho do principal tem de agir.
INSERT INTO public.leads (id, organization_id, name, phone) VALUES
  ('82c50502-0000-4000-8000-0000000002a1', '82c50502-0000-4000-8000-00000000000a', 'Padaria Um', '48999750303'),
  ('82c50502-0000-4000-8000-0000000002a2', '82c50502-0000-4000-8000-00000000000a', 'Mercado Dois', '48988887777'),
  ('82c50502-0000-4000-8000-0000000002b1', '82c50502-0000-4000-8000-00000000000b', 'Lead Org B', '11977776666');

-- ===========================================================================
-- (BF) espelho do principal
-- ===========================================================================
SELECT is(
  (SELECT row(is_primary, source, normalized_phone)::text FROM public.lead_phones
    WHERE lead_id = '82c50502-0000-4000-8000-0000000002a1' AND deleted_at IS NULL),
  '(t,crm,48999750303)', 'BF1: lead novo com telefone ganha a linha principal em lead_phones');

-- ===========================================================================
-- (OG) guarda de org e (UQ) uniques
-- ===========================================================================
SELECT throws_ok(
  $$ INSERT INTO public.lead_phones (organization_id, lead_id, phone, source)
     VALUES ('82c50502-0000-4000-8000-00000000000b', '82c50502-0000-4000-8000-0000000002a1', '48911112222', 'crm') $$,
  '23514', 'lead_phones_org_mismatch',
  'OG1: telefone gravado com a org de OUTRO inquilino é recusado');

SELECT throws_ok(
  $$ INSERT INTO public.lead_phones (lead_id, phone, source)
     VALUES ('82c50502-0000-4000-8000-0000000002a1', '+55 (48) 99975-0303', 'crm') $$,
  '23505', NULL,
  'UQ1: o mesmo número (normalizado) duas vezes no mesmo lead é recusado');

SELECT throws_ok(
  $$ INSERT INTO public.lead_phones (lead_id, phone, source, is_primary)
     VALUES ('82c50502-0000-4000-8000-0000000002a1', '48933334444', 'crm', true) $$,
  '23505', NULL,
  'UQ2: dois principais no mesmo lead é recusado');

SELECT lives_ok(
  $$ INSERT INTO public.lead_phones (lead_id, phone, source, label)
     VALUES ('82c50502-0000-4000-8000-0000000002a2', '48999750303', 'crm', 'Compras') $$,
  'UQ3: o mesmo número em DOIS leads é permitido (o ERP tem isso)');

-- ===========================================================================
-- (XO) isolamento entre orgs
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"82c50502-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.lead_phones
    WHERE organization_id = '82c50502-0000-4000-8000-00000000000a'),
  0, 'XO1: usuário da org B não vê nenhum telefone da org A');
SELECT throws_ok(
  $$ SELECT public.salvar_telefones_do_lead('82c50502-0000-4000-8000-0000000002a1',
       '[{"phone":"48999750303","is_primary":true}]'::jsonb) $$,
  'P0002', 'lead_not_found',
  'XO2: usuário da org B não salva telefones de lead da org A');

-- ===========================================================================
-- (SD) soft delete e (LK) trava do nome — como admin da org A
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"82c50502-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.salvar_telefones_do_lead('82c50502-0000-4000-8000-0000000002a1',
       '[{"phone":"48999750303","is_primary":true},{"phone":"48955556666"}]'::jsonb) $$,
  '22023', 'label_required',
  'LK1: telefone novo criado no CRM exige o nome do contato');

SELECT lives_ok(
  $$ SELECT public.salvar_telefones_do_lead('82c50502-0000-4000-8000-0000000002a1',
       '[{"phone":"48999750303","is_primary":true,"label":"Recepção"},
         {"phone":"48955556666","label":"José Luiz - Compras"}]'::jsonb) $$,
  'LK2: salvar dois contatos nomeados');

SELECT is(
  (SELECT string_agg(label || ':' || label_locked::text, ',' ORDER BY label) FROM public.lead_phones
    WHERE lead_id = '82c50502-0000-4000-8000-0000000002a1' AND deleted_at IS NULL),
  'José Luiz - Compras:true,Recepção:true', 'LK3: nome escrito no CRM fica travado');

SELECT lives_ok(
  $$ SELECT public.salvar_telefones_do_lead('82c50502-0000-4000-8000-0000000002a1',
       '[{"phone":"48999750303","is_primary":true,"label":"Recepção"}]'::jsonb) $$,
  'SD1: salvar sem o segundo telefone');
SELECT is(
  (SELECT (deleted_at IS NOT NULL)::text || ',' || (deleted_by IS NOT NULL)::text FROM public.lead_phones
    WHERE lead_id = '82c50502-0000-4000-8000-0000000002a1' AND normalized_phone = '48955556666'),
  'true,true', 'SD2: o telefone que saiu foi apagado com soft delete (a linha continua)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.lead_phones', 'DELETE'),
  'SD3: authenticated não tem DELETE em lead_phones');

-- O sync do ERP (service_role) não mexe no nome travado nem ressuscita apagado.
RESET role;
SET LOCAL role postgres;
SELECT is(
  public.aplicar_telefones_do_erp('82c50502-0000-4000-8000-00000000000a', jsonb_build_array(
    jsonb_build_object('op','update','lead_id','82c50502-0000-4000-8000-0000000002a1',
                       'normalized_phone','48999750303','label','RECEPCAO DO ERP'),
    jsonb_build_object('op','insert','lead_id','82c50502-0000-4000-8000-0000000002a1',
                       'phone','48955556666','label','Do ERP','erp_phone_id','901'),
    jsonb_build_object('op','insert','lead_id','82c50502-0000-4000-8000-0000000002b1',
                       'phone','11900001111','label','Outra org','erp_phone_id','902'))),
  '{"inserted": 0, "updated": 1}'::jsonb,
  'LK4: ERP não insere telefone apagado nem em lead de outra org (update conta a linha, mas preserva o nome)');
SELECT is(
  (SELECT label FROM public.lead_phones
    WHERE lead_id = '82c50502-0000-4000-8000-0000000002a1' AND normalized_phone = '48999750303' AND deleted_at IS NULL),
  'Recepção', 'LK5: nome travado no CRM não muda pelo ERP');

-- Linha do ERP não travada acompanha o ERP.
SELECT is(
  public.aplicar_telefones_do_erp('82c50502-0000-4000-8000-00000000000a', jsonb_build_array(
    jsonb_build_object('op','insert','lead_id','82c50502-0000-4000-8000-0000000002a2',
                       'phone','48977778888','label','Maria - Financeiro','erp_phone_id','903')))->>'inserted',
  '1', 'LK6: telefone novo do ERP entra com source=erp');
SELECT public.aplicar_telefones_do_erp('82c50502-0000-4000-8000-00000000000a', jsonb_build_array(
  jsonb_build_object('op','update','lead_id','82c50502-0000-4000-8000-0000000002a2',
                     'normalized_phone','48977778888','label','Maria Souza - Financeiro')));
SELECT is(
  (SELECT row(label, source, erp_phone_id)::text FROM public.lead_phones
    WHERE lead_id = '82c50502-0000-4000-8000-0000000002a2' AND normalized_phone = '48977778888'),
  '("Maria Souza - Financeiro",erp,903)', 'LK7: nome de linha do ERP não travada acompanha o ERP');

-- ===========================================================================
-- (NG) abrir_negocio
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'abrir_negocio'),
  1, 'NG1: abrir_negocio tem UMA assinatura (sem sobrecarga)');

-- Lead A2 tem 3 telefones ativos agora (principal, "Compras" do UQ3, "Maria").
SELECT throws_ok(
  $$ SELECT public.abrir_negocio('82c50502-0000-4000-8000-0000000002a2', 'whatsapp', 'novo',
       p_source => 'human') $$,
  '23514', 'lead_phone_required',
  'NG2: humano abrindo negócio em lead com 2+ telefones sem escolher é recusado');

SELECT throws_ok(
  format($$ SELECT public.abrir_negocio('82c50502-0000-4000-8000-0000000002a2', 'whatsapp', 'novo',
       p_source => 'human', p_lead_phone_id => %L) $$,
     (SELECT id FROM public.lead_phones WHERE lead_id = '82c50502-0000-4000-8000-0000000002a1'
         AND deleted_at IS NULL AND is_primary)),
  '23514', 'lead_phone_invalid',
  'NG3: telefone de OUTRO lead é recusado');

CREATE TEMP TABLE t_deal AS
SELECT public.abrir_negocio('82c50502-0000-4000-8000-0000000002a2', 'whatsapp', 'novo',
         p_source => 'human',
         p_lead_phone_id => (SELECT id FROM public.lead_phones
                              WHERE lead_id = '82c50502-0000-4000-8000-0000000002a2'
                                AND normalized_phone = '48999750303' AND deleted_at IS NULL)) AS id;
SELECT is(
  (SELECT lp.label FROM public.deals d JOIN public.lead_phones lp ON lp.id = d.lead_phone_id
    WHERE d.id = (SELECT id FROM t_deal)),
  'Compras', 'NG4: o negócio guarda com qual telefone (contato) é');

CREATE TEMP TABLE t_deal_wf AS
SELECT public.abrir_negocio('82c50502-0000-4000-8000-0000000002a2', 'whatsapp', 'novo', p_source => 'workflow') AS id;
SELECT is(
  (SELECT lead_phone_id FROM public.deals WHERE id = (SELECT id FROM t_deal_wf)),
  NULL::uuid,
  'NG5: workflow não exige telefone — com 2+ o negócio nasce sem escolha, e a UI pede depois');

-- Lead A1 tem 1 telefone ativo: grava sozinho, sem exigir.
CREATE TEMP TABLE t_deal_um AS
SELECT public.abrir_negocio('82c50502-0000-4000-8000-0000000002a1', 'whatsapp', 'novo', p_source => 'human') AS id;
SELECT is(
  (SELECT lp.normalized_phone FROM public.deals d JOIN public.lead_phones lp ON lp.id = d.lead_phone_id
    WHERE d.id = (SELECT id FROM t_deal_um)),
  '48999750303', 'NG6: lead com 1 telefone — o negócio grava esse sem perguntar');

-- ===========================================================================
-- (WH) 4ª passada e (AD) adoção de órfã
-- ===========================================================================
-- Mensagem do celular secundário "Maria" (só existe em lead_phones do A2).
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, direction, content, message_id, timestamp)
VALUES ('82c50502-0000-4000-8000-00000000000a', '5548977778888', '48977778888', 'incoming', 'oi', 'lp-wh-1', now());
SELECT is(
  (SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'lp-wh-1'),
  '82c50502-0000-4000-8000-0000000002a2'::uuid,
  'WH1: mensagem do telefone secundário cai no lead (4ª passada)');

-- Número em DOIS leads como secundário: vence o que tem negócio aberto com ele.
INSERT INTO public.lead_phones (lead_id, phone, source, label) VALUES
  ('82c50502-0000-4000-8000-0000000002a1', '48966665555', 'crm', 'Sócio'),
  ('82c50502-0000-4000-8000-0000000002a2', '48966665555', 'crm', 'Sócio');
UPDATE public.deals SET lead_phone_id = (SELECT id FROM public.lead_phones
  WHERE lead_id = '82c50502-0000-4000-8000-0000000002a1' AND normalized_phone = '48966665555')
 WHERE source_lead_id = '82c50502-0000-4000-8000-0000000002a1';
-- O outro foi tocado por último: sem a regra do negócio, ele venceria.
UPDATE public.lead_phones SET label = 'Sócio (atualizado)'
 WHERE lead_id = '82c50502-0000-4000-8000-0000000002a2' AND normalized_phone = '48966665555';
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, direction, content, message_id, timestamp)
VALUES ('82c50502-0000-4000-8000-00000000000a', '5548966665555', '48966665555', 'incoming', 'oi', 'lp-wh-2', now());
SELECT is(
  (SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'lp-wh-2'),
  '82c50502-0000-4000-8000-0000000002a1'::uuid,
  'WH2: ambiguidade resolvida pelo negócio aberto com aquele telefone');

-- Órfã: mensagem antes de o número existir em qualquer lead.
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, direction, content, message_id, timestamp)
VALUES ('82c50502-0000-4000-8000-00000000000a', '5548912340000', '48912340000', 'incoming', 'oi', 'lp-ad-1', now());
SELECT ok((SELECT lead_id IS NULL FROM public.whatsapp_messages WHERE message_id = 'lp-ad-1'),
  'AD1: controle — a mensagem nasce órfã');
INSERT INTO public.lead_phones (lead_id, phone, source, label)
VALUES ('82c50502-0000-4000-8000-0000000002a1', '48912340000', 'crm', 'Gerente');
SELECT is(
  (SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'lp-ad-1'),
  '82c50502-0000-4000-8000-0000000002a1'::uuid,
  'AD2: o telefone novo do lead adota a mensagem órfã do mesmo número');

-- Espelho: trocar o principal mantém o número antigo como contato.
UPDATE public.leads SET phone = '48912340000' WHERE id = '82c50502-0000-4000-8000-0000000002a1';
SELECT is(
  (SELECT string_agg(normalized_phone || ':' || is_primary::text, ',' ORDER BY normalized_phone) FROM public.lead_phones
    WHERE lead_id = '82c50502-0000-4000-8000-0000000002a1' AND deleted_at IS NULL
      AND normalized_phone IN ('48912340000', '48999750303')),
  '48912340000:true,48999750303:false', 'BF2: trocar leads.phone move o principal e mantém o número antigo');

-- ===========================================================================
-- (MS) master escreve contato (20271114000000) — sem ser membro da org A
-- ===========================================================================
RESET role;
SET LOCAL role postgres;
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES (
  '82c50502-0000-4000-8000-0000000000c1', 'lp-master@test.local', '', now(), '{}'::jsonb, now(), now(),
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '', '', '', '', '', '', '', ''
) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.master_users (user_id, is_active)
VALUES ('82c50502-0000-4000-8000-0000000000c1', true);

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"82c50502-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.salvar_telefones_do_lead('82c50502-0000-4000-8000-0000000002a2',
       '[{"phone":"48988887777","is_primary":true,"label":"Dono"},
         {"phone":"48977776666","label":"Financeiro"}]'::jsonb) $$,
  'MS1: master salva contato novo em lead de org onde não é membro');
SELECT is(
  (SELECT string_agg(label || ':' || label_locked::text, ',' ORDER BY label) FROM public.lead_phones
    WHERE lead_id = '82c50502-0000-4000-8000-0000000002a2' AND deleted_at IS NULL),
  'Dono:true,Financeiro:true', 'MS2: o UPDATE do master pega a linha (nome do principal gravado e travado)');
SELECT is(
  (SELECT organization_id FROM public.lead_phones
    WHERE lead_id = '82c50502-0000-4000-8000-0000000002a2' AND normalized_phone = '48977776666'),
  '82c50502-0000-4000-8000-00000000000a'::uuid, 'MS3: a org da linha do master é a do lead');

-- Controle: membro da org B continua sem escrever em lead da org A.
SELECT set_config('request.jwt.claims',
  '{"sub":"82c50502-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT throws_ok(
  $$ INSERT INTO public.lead_phones (organization_id, lead_id, phone, source, label)
     VALUES ('82c50502-0000-4000-8000-00000000000a', '82c50502-0000-4000-8000-0000000002a2', '48966665555', 'crm', 'X') $$,
  '42501', NULL,
  'MS4: membro de outra org segue barrado pela RLS de INSERT');

SELECT * FROM finish();
ROLLBACK;
