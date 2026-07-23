-- Onda 5 — Workflow Time-Aware Window backfill
-- Description: workflows com node `wait_business_window` legacy (sem windows[])
--              ganham 1 janela "Comercial" derivada de days/startTime/endTime
--              + action='pass' + mode='hold'. Comportamento idêntico ao anterior.
-- Date: 2026-04-27
-- Idempotente: skip nodes que já tem windows[].

-- Mapeamento de dias legacy (PT) → DayKey (EN) usado pelo resolver shared
CREATE OR REPLACE FUNCTION public.__map_legacy_days(legacy_days jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      CASE elem #>> '{}'
        WHEN 'seg' THEN 'mon' WHEN 'mon' THEN 'mon'
        WHEN 'ter' THEN 'tue' WHEN 'tue' THEN 'tue'
        WHEN 'qua' THEN 'wed' WHEN 'wed' THEN 'wed'
        WHEN 'qui' THEN 'thu' WHEN 'thu' THEN 'thu'
        WHEN 'sex' THEN 'fri' WHEN 'fri' THEN 'fri'
        WHEN 'sab' THEN 'sat' WHEN 'sat' THEN 'sat'
        WHEN 'dom' THEN 'sun' WHEN 'sun' THEN 'sun'
      END
    ),
    '["mon","tue","wed","thu","fri"]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(legacy_days, '[]'::jsonb)) AS elem
  WHERE elem #>> '{}' IS NOT NULL;
$$;

-- Backfill: para cada workflow.nodes[i] do tipo wait_business_window sem windows[],
-- inserir 1 janela "Comercial" + mode=hold preservando comportamento.
DO $$
DECLARE
  wf RECORD;
  updated_nodes jsonb;
  changed boolean;
  node_elem jsonb;
  wid uuid;
BEGIN
  FOR wf IN SELECT id, definition FROM public.workflows WHERE definition::text LIKE '%wait_business_window%' LOOP
    updated_nodes := '[]'::jsonb;
    changed := false;

    FOR node_elem IN SELECT * FROM jsonb_array_elements(COALESCE(wf.definition->'nodes', '[]'::jsonb)) LOOP
      IF node_elem->>'type' = 'wait_business_window'
         AND NOT (node_elem->'data' ? 'windows') THEN
        wid := gen_random_uuid();
        node_elem := jsonb_set(
          node_elem,
          '{data,windows}',
          jsonb_build_array(
            jsonb_build_object(
              'id', wid::text,
              'name', 'Comercial',
              'days', public.__map_legacy_days(node_elem->'data'->'days'),
              'start', COALESCE(node_elem->'data'->>'startTime', '09:00'),
              'end',   COALESCE(node_elem->'data'->>'endTime',   '18:00'),
              'action','pass'
            )
          )
        );
        IF NOT (node_elem->'data' ? 'mode') THEN
          node_elem := jsonb_set(node_elem, '{data,mode}', '"hold"'::jsonb);
        END IF;
        changed := true;
      END IF;
      updated_nodes := updated_nodes || jsonb_build_array(node_elem);
    END LOOP;

    IF changed THEN
      UPDATE public.workflows
        SET definition = jsonb_set(definition, '{nodes}', updated_nodes),
            updated_at = NOW()
        WHERE id = wf.id;
      RAISE NOTICE 'Backfilled workflow %', wf.id;
    END IF;
  END LOOP;
END$$;

-- Cleanup helper (não é parte do schema permanente)
DROP FUNCTION public.__map_legacy_days(jsonb);
