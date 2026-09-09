-- supabase/tests/avisos_coalescing_red_fixture.sql
--
-- Prova vermelha da suíte de Avisos (issue #1884, ADR-0035).
--
-- A suíte verde afirma que o Aviso coalesce enquanto não lido e fecha ao ser
-- lido. Uma suíte que passa por acaso não vale nada: este arquivo planta a
-- implementação ERRADA — o índice único sem o predicado `read_at IS NULL` —
-- e afirma que ela produz o comportamento errado.
--
-- Se um dia esta prova passar a falhar, é porque a asserção da suíte verde
-- deixou de discriminar: ela ficaria verde com implementação errada.
--
-- Roda dentro de transação revertida: o índice bom volta ao lugar no ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(1);

CREATE TEMP TABLE _av_red (org uuid, usr uuid) ON COMMIT DROP;

INSERT INTO _av_red (org, usr)
VALUES ('77777777-7777-7777-7777-777777777777'::uuid,
        '88888888-8888-8888-8888-888888888888'::uuid);

INSERT INTO auth.users (id, email)
SELECT usr, 'aviso-red@example.test' FROM _av_red;

INSERT INTO public.organizations (id, name, slug)
SELECT org, 'Aviso Red', 'aviso-red' FROM _av_red;

-- A implementação errada: unicidade que ignora o estado de leitura.
DROP INDEX IF EXISTS public.notifications_unread_group_key_uniq;
CREATE UNIQUE INDEX notifications_unread_group_key_uniq
  ON public.notifications (user_id, group_key)
  WHERE group_key IS NOT NULL;

SELECT public.fn_emit_aviso(
         p_organization_id => org, p_user_id => usr,
         p_type => 'lead_message', p_group_key => 'msg:red',
         p_title => 'Primeiro'
       )
FROM _av_red;

UPDATE public.notifications n
   SET read_at = now()
  FROM _av_red r
 WHERE n.user_id = r.usr AND n.group_key = 'msg:red';

SELECT public.fn_emit_aviso(
         p_organization_id => org, p_user_id => usr,
         p_type => 'lead_message', p_group_key => 'msg:red',
         p_title => 'Depois de lido'
       )
FROM _av_red;

-- Com o índice errado, o evento posterior à leitura ressuscita a linha morta:
-- uma linha só, ainda marcada como lida. É exatamente o que a suíte verde
-- proíbe — e é o que ela precisa ser capaz de enxergar.
SELECT is(
  (SELECT ARRAY[count(*)::int, count(*) FILTER (WHERE read_at IS NOT NULL)::int]
     FROM public.notifications n, _av_red r
    WHERE n.user_id = r.usr AND n.group_key = 'msg:red'),
  ARRAY[1, 1],
  'prova vermelha: sem o predicado de não-lido, o Aviso lido é ressuscitado em vez de nascer outro'
);

SELECT * FROM finish();

ROLLBACK;
