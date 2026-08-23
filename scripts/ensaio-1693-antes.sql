-- scripts/ensaio-1693-antes.sql — parte 1 do ensaio transacional do #1693.
--
-- NÃO rode este arquivo sozinho. Ele abre a transação e não a fecha.
-- Use `scripts/ensaio-1693.sh`, que concatena:
--     ensaio-1693-antes.sql
--   + supabase/migrations/20270820160000_find_leads_no_reply_enxerga_canal_oficial.sql
--   + ensaio-1693-depois.sql
-- e manda o conjunto como UMA transação contra produção, que termina em ROLLBACK.
--
-- A migration entra no meio por concatenação, e não copiada aqui, de propósito:
-- um ensaio que exercita uma cópia do DDL prova a cópia, não o que vai ser
-- aplicado.
--
-- Esta parte: congela o corte, mede o ANTES em TODAS as organizações, planta a
-- matriz de casos e prova o DEFEITO (o vermelho) com a definição vigente.

BEGIN;

SET LOCAL statement_timeout = '600s';
SET LOCAL lock_timeout = '5s';

-- Corte congelado: ANTES e DEPOIS precisam usar o MESMO instante, senão a
-- diferença entre os dois conjuntos mistura o efeito da mudança com a passagem
-- do tempo.
CREATE TEMP TABLE e_param AS
SELECT
  (now() - interval '24 hours')::timestamptz            AS cutoff,
  '38f3bea4-44c6-4732-bb20-065f547a7ed8'::uuid          AS org_fixture,   -- Chique Distribuidora (tem canal oficial)
  '8fcdf952-bfc5-4d66-895f-b1cee67926dd'::uuid          AS agent_fixture; -- agente "Chica" (conversations.agent_id é NOT NULL)

-- Universo: TODAS as organizações, não uma amostra.
CREATE TEMP TABLE e_orgs AS
SELECT
  o.id   AS org_id,
  o.name AS org_name,
  (SELECT count(*) FROM public.channel_messages cm WHERE cm.organization_id = o.id) AS cm_total
FROM public.organizations o;

-- ─── ANTES (definição vigente em produção) ──────────────────────────────────
CREATE TEMP TABLE e_antes AS
SELECT g.org_id, f.id AS lead_id
FROM e_orgs g, e_param p
CROSS JOIN LATERAL public.find_leads_no_reply(g.org_id, p.cutoff, 1000000) AS f(id);

-- ─── Matriz de casos ────────────────────────────────────────────────────────
-- Triggers desligados só para PLANTAR os dados: `leads` tem 21 triggers, entre
-- eles enfileiramento de webhook e disparo de workflow. O ensaio não pode
-- acordar o produto.
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE e_fix (
  tag              text primary key,
  lead_id          uuid,
  phone            text,
  esperado_antes   boolean,
  esperado_depois  boolean,
  porque           text
);

INSERT INTO e_fix (tag, lead_id, phone, esperado_antes, esperado_depois, porque) VALUES
 ('L1_oficial_por_telefone',   gen_random_uuid(), '5511990000001', true, false,
  'respondeu pelo canal oficial sem vinculo de lead — casa por telefone (a forma sem o nono digito)'),
 ('L2_oficial_por_vinculo',    gen_random_uuid(), '5511990000002', true, false,
  'respondeu pelo canal oficial com lead_id preenchido — casa por vinculo'),
 ('L3_oficial_saida',          gen_random_uuid(), '5511990000003', true, true,
  'a unica mensagem no canal oficial e de SAIDA — nossa mensagem nao e resposta dele'),
 ('L4_sem_resposta_nenhuma',   gen_random_uuid(), '5511990000004', true, true,
  'controle positivo: nao respondeu em canal nenhum, tem de continuar candidato'),
 ('L5_instagram_sem_vinculo',  gen_random_uuid(), '5511990000005', true, true,
  'mensagem de Instagram sem vinculo de lead — nao ha telefone, nao pode casar'),
 ('L6_instagram_com_vinculo',  gen_random_uuid(), '5511990000006', true, false,
  'mensagem de Instagram JA vinculada a um lead — vinculo vale em qualquer canal');

INSERT INTO public.leads (id, organization_id, name, phone, created_at, updated_at)
SELECT f.lead_id, p.org_fixture, 'ENSAIO 1693 ' || f.tag, f.phone,
       now() - interval '10 days', now()
FROM e_fix f, e_param p;

-- Sem esta linha o lead nem chega a ser candidato: a função faz INNER JOIN em
-- conversations e exige last_message_at anterior ao corte.
INSERT INTO public.conversations (lead_id, organization_id, agent_id, last_message_at, created_at, updated_at)
SELECT f.lead_id, p.org_fixture, p.agent_fixture,
       now() - interval '48 hours', now() - interval '10 days', now()
FROM e_fix f, e_param p;

-- L1: entrada no canal oficial, SEM lead_id, telefone mascarado e SEM o nono
-- dígito ('+55 11 9000-0001' → 551190000001). Só casa se a normalização for a
-- mesma de resolve_wait_response_by_phone.
INSERT INTO public.channel_messages
  (organization_id, channel, external_id, direction, message_type, phone_number, lead_id, content, created_at, "timestamp")
SELECT p.org_fixture, 'whatsapp', 'ensaio-1693-L1', 'incoming', 'text',
       '+55 11 9000-0001', NULL, 'respondi pelo oficial',
       now() - interval '1 hour', now() - interval '1 hour'
FROM e_param p;

-- L2: entrada no canal oficial JÁ vinculada ao lead, sem telefone.
INSERT INTO public.channel_messages
  (organization_id, channel, external_id, direction, message_type, phone_number, lead_id, content, created_at, "timestamp")
SELECT p.org_fixture, 'whatsapp', 'ensaio-1693-L2', 'incoming', 'text',
       NULL, f.lead_id, 'respondi pelo oficial',
       now() - interval '1 hour', now() - interval '1 hour'
FROM e_fix f, e_param p WHERE f.tag = 'L2_oficial_por_vinculo';

-- L3: SAÍDA no canal oficial, do mesmo telefone. Não é resposta do cliente.
INSERT INTO public.channel_messages
  (organization_id, channel, external_id, direction, message_type, phone_number, lead_id, content, created_at, "timestamp")
SELECT p.org_fixture, 'whatsapp', 'ensaio-1693-L3', 'outgoing', 'text',
       '5511990000003', NULL, 'ola, tudo bem?',
       now() - interval '1 hour', now() - interval '1 hour'
FROM e_param p;

-- L5: Instagram sem vínculo. O Direct não tem telefone (medido: 721 entradas,
-- 0 com telefone); o identificador do remetente NÃO pode virar chave.
INSERT INTO public.channel_messages
  (organization_id, channel, external_id, direction, message_type, phone_number, sender_id, lead_id, content, created_at, "timestamp")
SELECT p.org_fixture, 'instagram', 'ensaio-1693-L5', 'incoming', 'text',
       NULL, '17841400000000005', NULL, 'quanto custa?',
       now() - interval '1 hour', now() - interval '1 hour'
FROM e_param p;

-- L6: Instagram JÁ vinculado por um humano.
INSERT INTO public.channel_messages
  (organization_id, channel, external_id, direction, message_type, phone_number, sender_id, lead_id, content, created_at, "timestamp")
SELECT p.org_fixture, 'instagram', 'ensaio-1693-L6', 'incoming', 'text',
       NULL, '17841400000000006', f.lead_id, 'respondi pelo direct',
       now() - interval '1 hour', now() - interval '1 hour'
FROM e_fix f, e_param p WHERE f.tag = 'L6_instagram_com_vinculo';

SET LOCAL session_replication_role = DEFAULT;

-- ─── VERMELHO: a definição vigente entrega os 6 como candidatos ─────────────
CREATE TEMP TABLE e_cand_fix_antes AS
SELECT x.id
FROM e_param p
CROSS JOIN LATERAL public.find_leads_no_reply(p.org_fixture, p.cutoff, 1000000) AS x(id);

CREATE TEMP TABLE e_fix_antes AS
SELECT f.tag, f.lead_id, f.esperado_antes, f.esperado_depois, f.porque,
       (f.lead_id IN (SELECT id FROM e_cand_fix_antes)) AS presente
FROM e_fix f;

DO $ensaio$
DECLARE
  v_faltando text;
BEGIN
  -- Controle: os 6 casos têm de estar plantados e visíveis. Um fixture que não
  -- aparece no ANTES tornaria a prova do DEPOIS vazia — verde por ausência.
  SELECT string_agg(tag, ', ') INTO v_faltando
  FROM e_fix_antes WHERE presente IS DISTINCT FROM esperado_antes;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1693 / VERMELHO NAO REPRODUZIDO: casos fora do esperado no ANTES: %', v_faltando;
  END IF;

  -- O defeito, dito em asserção: hoje L1, L2 e L6 responderam e mesmo assim
  -- são candidatos.
  IF NOT (SELECT bool_and(presente) FROM e_fix_antes
          WHERE tag IN ('L1_oficial_por_telefone','L2_oficial_por_vinculo','L6_instagram_com_vinculo')) THEN
    RAISE EXCEPTION 'ENSAIO 1693 / VERMELHO NAO REPRODUZIDO: quem respondeu pelo oficial ja nao era candidato antes da mudanca';
  END IF;
END
$ensaio$;
