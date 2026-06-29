-- ============================================================================
-- REVERT — Motor 100 day-of-week dispatch columns + clones
-- Removes the 5 INACTIVE clones and the 5 day stages, and restores the
-- original positions of the downstream stages. Safe to run if apply.sql ran.
-- Org: 1003870a-ceea-487b-8dd5-910018c7a7d7
-- ============================================================================

BEGIN;

-- 1) Drop the 5 INACTIVE clones (guarded to is_active=false so a manually
--    activated/edited workflow is never deleted by accident).
DELETE FROM public.workflows
WHERE organization_id='1003870a-ceea-487b-8dd5-910018c7a7d7'
  AND is_active = false
  AND name IN (
    'Reativação Inativos — Disparo Segunda',
    'Reativação Inativos — Disparo Terça',
    'Reativação Inativos — Disparo Quarta',
    'Reativação Inativos — Disparo Quinta',
    'Reativação Inativos — Disparo Sexta'
  );

-- 2) Restore original downstream positions.
UPDATE public.pipeline_stages SET position=2 WHERE organization_id='1003870a-ceea-487b-8dd5-910018c7a7d7' AND pipeline_type='whatsapp' AND stage_key='recebeu_disparo';
UPDATE public.pipeline_stages SET position=3 WHERE organization_id='1003870a-ceea-487b-8dd5-910018c7a7d7' AND pipeline_type='whatsapp' AND stage_key='respondeu';
UPDATE public.pipeline_stages SET position=4 WHERE organization_id='1003870a-ceea-487b-8dd5-910018c7a7d7' AND pipeline_type='whatsapp' AND stage_key='vendedor';
UPDATE public.pipeline_stages SET position=6 WHERE organization_id='1003870a-ceea-487b-8dd5-910018c7a7d7' AND pipeline_type='whatsapp' AND stage_key='nao_respondeu';

-- 3) Drop the 5 day stages. WARNING: only safe while no lead sits in them.
--    (If leads were placed, move them out first or this will orphan entries.)
DELETE FROM public.pipeline_stages
WHERE organization_id='1003870a-ceea-487b-8dd5-910018c7a7d7'
  AND pipeline_type='whatsapp'
  AND stage_key IN ('disparo_segunda','disparo_terca','disparo_quarta','disparo_quinta','disparo_sexta');

COMMIT;
