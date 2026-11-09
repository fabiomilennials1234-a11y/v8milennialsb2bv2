-- supabase/tests/funil_cursor_desempata_por_id_test.sql
--
-- get_pipeline_page com cursor composto (created_at, id)
-- (migration 20271230000100_funil_cursor_desempata_por_id.sql).
--
--   (EM) EMPATE NA BORDA: 95 cards numa coluna, dois grupos de 30 e 49 no MESMO
--        created_at, cruzando bordas de página de 20. A rolagem com cursor
--        composto entrega os 95, sem repetir nenhum.
--   (LG) LEGADO: chamada sem p_cursor_id (bundle antigo em cache) continua
--        respondendo — com o cursor estrito de antes, que perde as irmãs.
--   (OR) ORDEM TOTAL: created_at DESC, id DESC — determinística entre chamadas.
--   (SG) uma assinatura só (sem overload ambíguo pro PostgREST).
--   (GR) GRANTs: authenticated e service_role executam; anon e PUBLIC não.
--   (CF) SECURITY INVOKER e proconfig preservados.
--
-- Validado em PGlite com o corpo de prod (13/13). Roda inteiro em transação
-- revertida: `supabase test db` num preview.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(9);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('c0c0e5e1-0000-4000-8000-0000000000a0', 'Org Cursor', 'org-cursor-desempate')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug) VALUES
  ('c0c0e5e1-0000-4000-8000-0000000000b0', 'c0c0e5e1-0000-4000-8000-0000000000a0', 'Envase', 'envase-cursor');

-- 95 cards: 7 soltos, 30 empatados, 3 soltos, 49 empatados, 6 soltos.
CREATE TEMP TABLE _plano ON COMMIT DROP AS
WITH grupos(ordem, qtd, solto) AS (VALUES (1, 7, true), (2, 30, false), (3, 3, true), (4, 49, false), (5, 6, true)),
cards AS (
  SELECT g.ordem, g.solto, s.i,
         row_number() OVER (ORDER BY g.ordem, s.i) AS n
    FROM grupos g CROSS JOIN LATERAL generate_series(1, g.qtd) AS s(i)
)
SELECT ('c0c0e5e1-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid AS id,
       -- solto: um instante por card; empatado: um instante por grupo.
       timestamptz '2026-10-01 12:00:00+00'
         - make_interval(secs => CASE WHEN solto THEN n ELSE ordem * 1000 END) AS created_at
  FROM cards;

INSERT INTO public.leads (id, organization_id, name)
SELECT id, 'c0c0e5e1-0000-4000-8000-0000000000a0', 'Lead ' || id FROM _plano;

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, created_at, updated_at, metadata)
SELECT id, 'c0c0e5e1-0000-4000-8000-0000000000a0', 'c0c0e5e1-0000-4000-8000-0000000000b0', id, 'novo',
       created_at, created_at, '{}'::jsonb
  FROM _plano;

SET LOCAL session_replication_role = origin;

-- Rolagem completa da coluna, como o board faz (página de 20).
CREATE TEMP TABLE _vistos (id uuid, pagina int, usa_id boolean) ON COMMIT DROP;

DO $$
DECLARE
  v_modo boolean;
  v_cursor timestamptz;
  v_cursor_id uuid;
  v_pagina int;
  v_n int;
BEGIN
  FOREACH v_modo IN ARRAY ARRAY[true, false] LOOP
    v_cursor := NULL; v_cursor_id := NULL; v_pagina := 0;
    LOOP
      v_pagina := v_pagina + 1;
      IF v_modo THEN
        INSERT INTO _vistos
        SELECT r.id, v_pagina, true FROM public.get_pipeline_page(
          p_org_id => 'c0c0e5e1-0000-4000-8000-0000000000a0',
          p_pipeline_id => 'c0c0e5e1-0000-4000-8000-0000000000b0',
          p_stage_id => 'novo', p_page_size => 20,
          p_cursor => v_cursor, p_cursor_id => v_cursor_id) r;
      ELSE
        INSERT INTO _vistos
        SELECT r.id, v_pagina, false FROM public.get_pipeline_page(
          p_org_id => 'c0c0e5e1-0000-4000-8000-0000000000a0',
          p_pipeline_id => 'c0c0e5e1-0000-4000-8000-0000000000b0',
          p_stage_id => 'novo', p_page_size => 20,
          p_cursor => v_cursor) r;
      END IF;
      SELECT count(*) INTO v_n FROM _vistos WHERE pagina = v_pagina AND usa_id = v_modo;
      EXIT WHEN v_n < 20 OR v_pagina > 50;
      -- Último da página na ordem total.
      SELECT p.created_at, p.id INTO v_cursor, v_cursor_id
        FROM _vistos v JOIN _plano p ON p.id = v.id
       WHERE v.pagina = v_pagina AND v.usa_id = v_modo
       ORDER BY p.created_at ASC, p.id ASC LIMIT 1;
    END LOOP;
  END LOOP;
END $$;

-- (EM)
SELECT is((SELECT count(DISTINCT id)::int FROM _vistos WHERE usa_id), 95,
  'EM: cursor composto entrega os 95 cards, empates na borda inclusos');
SELECT is((SELECT count(*)::int FROM _vistos WHERE usa_id), 95,
  'EM: nenhum card repetido entre páginas');

-- (LG)
SELECT cmp_ok((SELECT count(DISTINCT id)::int FROM _vistos WHERE NOT usa_id), '<', 95,
  'LG: sem p_cursor_id a chamada responde, com o cursor estrito de antes');

-- (OR)
SELECT results_eq(
  $$SELECT id FROM public.get_pipeline_page(p_org_id => 'c0c0e5e1-0000-4000-8000-0000000000a0',
      p_pipeline_id => 'c0c0e5e1-0000-4000-8000-0000000000b0', p_stage_id => 'novo', p_page_size => 95)$$,
  $$SELECT id FROM _plano ORDER BY created_at DESC, id DESC$$,
  'OR: ordem total created_at DESC, id DESC');

-- (SG)
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'get_pipeline_page'), 1,
  'SG: uma assinatura só de get_pipeline_page');

-- (GR)
SELECT ok(has_function_privilege('authenticated', 'public.get_pipeline_page(text, text, uuid, integer, timestamp with time zone, text, uuid, uuid[], text[], integer, integer, integer, integer, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, text[], timestamp with time zone, text[], text[], boolean, text[], text[], integer, integer, uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_pipeline_page(text, text, uuid, integer, timestamp with time zone, text, uuid, uuid[], text[], integer, integer, integer, integer, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, text[], timestamp with time zone, text[], text[], boolean, text[], text[], integer, integer, uuid, uuid)', 'EXECUTE'),
  'GR: authenticated e service_role executam');
SELECT ok(NOT has_function_privilege('anon', 'public.get_pipeline_page(text, text, uuid, integer, timestamp with time zone, text, uuid, uuid[], text[], integer, integer, integer, integer, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, text[], timestamp with time zone, text[], text[], boolean, text[], text[], integer, integer, uuid, uuid)', 'EXECUTE'),
  'GR: anon NÃO executa (DROP+CREATE não devolveu o default)');
SELECT ok(NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.get_pipeline_page'::regproc AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
  'GR: PUBLIC sem EXECUTE');

-- (CF)
SELECT ok((SELECT NOT p.prosecdef
              AND p.proconfig @> ARRAY['search_path=""', 'plan_cache_mode=force_generic_plan']
             FROM pg_proc p WHERE p.oid = 'public.get_pipeline_page'::regproc),
  'CF: SECURITY INVOKER, search_path vazio e plano genérico preservados');

SELECT * FROM finish();

ROLLBACK;
