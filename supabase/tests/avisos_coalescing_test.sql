-- supabase/tests/avisos_coalescing_test.sql
--
-- pgTAP suite: o Aviso é uma linha viva (issue #1884, ADR-0035).
--
-- Um Aviso nasce de um evento e absorve os seguintes que carregam a mesma
-- chave de agrupamento, enquanto não for lido. O vocabulário está em
-- CONTEXT.md, seção "Avisos".
--
-- Rodar com o runner do repo ou direto:
--   bash supabase/tests/run.sh
--   pg_prove --ext .sql -d "$DATABASE_URL" supabase/tests/avisos_coalescing_test.sql
--
-- Sem efeito colateral: tudo roda dentro de uma transação revertida no fim.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(4);

-- ---------------------------------------------------------------------------
-- Fixtures — uma organização, um destinatário.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _av_fix (org uuid, usr uuid) ON COMMIT DROP;

INSERT INTO _av_fix (org, usr)
VALUES ('11111111-1111-1111-1111-111111111111'::uuid,
        '22222222-2222-2222-2222-222222222222'::uuid);

INSERT INTO auth.users (id, email)
SELECT usr, 'aviso-fixture@example.test' FROM _av_fix;

INSERT INTO public.organizations (id, name, slug)
SELECT org, 'Aviso Fixture', 'aviso-fixture' FROM _av_fix;

-- ---------------------------------------------------------------------------
-- Dois eventos, mesma chave de agrupamento, destinatário ainda sem ler.
-- ---------------------------------------------------------------------------
SELECT public.fn_emit_aviso(
         p_organization_id => org,
         p_user_id         => usr,
         p_type            => 'lead_message',
         p_group_key       => 'msg:33333333-3333-3333-3333-333333333333',
         p_title           => 'Marcos Andrade',
         p_description     => 'Consigo fechar hoje'
       )
FROM _av_fix;

SELECT public.fn_emit_aviso(
         p_organization_id => org,
         p_user_id         => usr,
         p_type            => 'lead_message',
         p_group_key       => 'msg:33333333-3333-3333-3333-333333333333',
         p_title           => 'Marcos Andrade',
         p_description     => 'Se entregarem até sexta'
       )
FROM _av_fix;

-- Uma linha viva, contando dois eventos — não duas linhas.
SELECT is(
  (SELECT ARRAY[count(*)::int, coalesce(max(event_count), 0)]
     FROM public.notifications n, _av_fix f
    WHERE n.user_id = f.usr
      AND n.group_key = 'msg:33333333-3333-3333-3333-333333333333'),
  ARRAY[1, 2],
  'dois eventos com a mesma chave viram um Aviso com event_count = 2'
);

-- ---------------------------------------------------------------------------
-- Lido fecha o Aviso: o evento seguinte não pode ressuscitar a linha morta.
-- ---------------------------------------------------------------------------
UPDATE public.notifications n
   SET read_at = now()
  FROM _av_fix f
 WHERE n.user_id = f.usr
   AND n.group_key = 'msg:33333333-3333-3333-3333-333333333333';

SELECT public.fn_emit_aviso(
         p_organization_id => org,
         p_user_id         => usr,
         p_type            => 'lead_message',
         p_group_key       => 'msg:33333333-3333-3333-3333-333333333333',
         p_title           => 'Marcos Andrade',
         p_description     => 'Fechado, manda o boleto'
       )
FROM _av_fix;

SELECT is(
  (SELECT ARRAY[count(*)::int,
                count(*) FILTER (WHERE n.read_at IS NULL)::int,
                coalesce(max(n.event_count) FILTER (WHERE n.read_at IS NULL), 0)]
     FROM public.notifications n, _av_fix f
    WHERE n.user_id = f.usr
      AND n.group_key = 'msg:33333333-3333-3333-3333-333333333333'),
  ARRAY[2, 1, 1],
  'evento após a leitura nasce como Aviso novo, com o contador zerado em 1'
);

-- ---------------------------------------------------------------------------
-- O Aviso é endereçado: a mesma chave para dois donos são dois Avisos.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES ('44444444-4444-4444-4444-444444444444'::uuid, 'aviso-fixture-2@example.test');

SELECT public.fn_emit_aviso(
         p_organization_id => org,
         p_user_id         => '44444444-4444-4444-4444-444444444444'::uuid,
         p_type            => 'lead_message',
         p_group_key       => 'msg:55555555-5555-5555-5555-555555555555',
         p_title           => 'Renata Bittencourt'
       )
FROM _av_fix;

SELECT public.fn_emit_aviso(
         p_organization_id => org,
         p_user_id         => usr,
         p_type            => 'lead_message',
         p_group_key       => 'msg:55555555-5555-5555-5555-555555555555',
         p_title           => 'Renata Bittencourt'
       )
FROM _av_fix;

SELECT is(
  (SELECT count(*)::int
     FROM public.notifications
    WHERE group_key = 'msg:55555555-5555-5555-5555-555555555555'
      AND read_at IS NULL),
  2,
  'a mesma chave para dois destinatários produz dois Avisos vivos'
);

-- ---------------------------------------------------------------------------
-- Sem dono não nasce Aviso — lead órfão é problema de atribuição, não de ruído.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT ARRAY[
     (SELECT count(*)::int FROM public.notifications
       WHERE group_key = 'msg:66666666-6666-6666-6666-666666666666'),
     CASE WHEN (SELECT public.fn_emit_aviso(
                  p_organization_id => org,
                  p_user_id         => NULL,
                  p_type            => 'lead_message',
                  p_group_key       => 'msg:66666666-6666-6666-6666-666666666666',
                  p_title           => 'Lead sem dono'
                ) FROM _av_fix) IS NULL THEN 0 ELSE 1 END,
     (SELECT count(*)::int FROM public.notifications
       WHERE group_key = 'msg:66666666-6666-6666-6666-666666666666')
   ]),
  ARRAY[0, 0, 0],
  'emitir sem destinatário não cria linha e devolve nulo'
);

SELECT * FROM finish();

ROLLBACK;
