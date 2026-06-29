-- ============================================================================
-- Motor 100 — Day-of-week dispatch columns + per-day reactivation clones
-- Org: 1003870a-ceea-487b-8dd5-910018c7a7d7
-- Source workflow: "Reativação Inativos — Onda 1" (59219742-ecc2-4b28-b110-c6041aedd064)
--
-- Creates 5 kanban columns (pipe whatsapp): disparo_segunda..disparo_sexta and
-- 5 INACTIVE workflow clones, byte-identical to the source except:
--   * trigger.stages rebound to the day's stage_key (column + trigger_config)
--   * the 4 wait_response timeouts set so each wave lands +3 BUSINESS days
--     (72h Mon/Tue-start, 120h Wed/Thu/Fri-start — weekends skipped)
--
-- Per-column wave timeline (4 sends + terminal move):
--   segunda: 72/120/72/120  -> Seg Qui Ter Sex | terminal Qua
--   terca:   72/120/120/72  -> Ter Sex Qua Seg | terminal Qui
--   quarta:  120/72/120/72  -> Qua Seg Qui Ter | terminal Sex
--   quinta:  120/72/120/120 -> Qui Ter Sex Qua | terminal Seg
--   sexta:   120/120/72/120 -> Sex Qua Seg Qui | terminal Ter
--
-- Idempotent (re-runnable). Reversible via revert.sql.
-- Workflows created INACTIVE on purpose: go live only after the org's WhatsApp
-- instance is re-paired (currently logged out -> no sends).
-- ============================================================================

BEGIN;

-- 1) Kanban columns (5 day stages), active so leads can be dropped in. ----------
INSERT INTO public.pipeline_stages
  (organization_id, pipeline_type, stage_key, name, color, position, is_active)
VALUES
  ('1003870a-ceea-487b-8dd5-910018c7a7d7','whatsapp','disparo_segunda','Disparo Segunda','#6366f1',2,true),
  ('1003870a-ceea-487b-8dd5-910018c7a7d7','whatsapp','disparo_terca',  'Disparo Terça',  '#6366f1',3,true),
  ('1003870a-ceea-487b-8dd5-910018c7a7d7','whatsapp','disparo_quarta', 'Disparo Quarta', '#6366f1',4,true),
  ('1003870a-ceea-487b-8dd5-910018c7a7d7','whatsapp','disparo_quinta', 'Disparo Quinta', '#6366f1',5,true),
  ('1003870a-ceea-487b-8dd5-910018c7a7d7','whatsapp','disparo_sexta',  'Disparo Sexta',  '#6366f1',6,true)
ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

-- 2) Re-order downstream active stages so the board reads left -> right. --------
UPDATE public.pipeline_stages SET position=7  WHERE organization_id='1003870a-ceea-487b-8dd5-910018c7a7d7' AND pipeline_type='whatsapp' AND stage_key='recebeu_disparo';
UPDATE public.pipeline_stages SET position=8  WHERE organization_id='1003870a-ceea-487b-8dd5-910018c7a7d7' AND pipeline_type='whatsapp' AND stage_key='respondeu';
UPDATE public.pipeline_stages SET position=9  WHERE organization_id='1003870a-ceea-487b-8dd5-910018c7a7d7' AND pipeline_type='whatsapp' AND stage_key='vendedor';
UPDATE public.pipeline_stages SET position=10 WHERE organization_id='1003870a-ceea-487b-8dd5-910018c7a7d7' AND pipeline_type='whatsapp' AND stage_key='nao_respondeu';

-- 3) Clone the source workflow per day (INACTIVE), faithful copy + mutations. ---
INSERT INTO public.workflows
  (organization_id, name, description, is_active, trigger_type, trigger_config,
   definition, loop_limit, created_by, enrollment_criteria,
   re_enrollment_enabled, re_enrollment_cooldown_days, re_enrollment_max_times)
SELECT
  src.organization_id,
  'Reativação Inativos — ' || d.label,
  d.descr,
  false,                                                   -- INACTIVE until go-live
  src.trigger_type,
  jsonb_set(src.trigger_config, '{stages}', to_jsonb(ARRAY[d.stage_key])),
  jsonb_set(src.definition, '{nodes}', (
    SELECT jsonb_agg(
      CASE elem->>'id'
        WHEN 'trigger' THEN jsonb_set(elem, '{data,config,stages}', to_jsonb(ARRAY[d.stage_key]))
        WHEN 'w1'      THEN jsonb_set(elem, '{data,timeoutHours}', to_jsonb(d.t1))
        WHEN 'w2'      THEN jsonb_set(elem, '{data,timeoutHours}', to_jsonb(d.t2))
        WHEN 'w3'      THEN jsonb_set(elem, '{data,timeoutHours}', to_jsonb(d.t3))
        WHEN 'w4'      THEN jsonb_set(elem, '{data,timeoutHours}', to_jsonb(d.t4))
        ELSE elem
      END ORDER BY ord)
    FROM jsonb_array_elements(src.definition->'nodes') WITH ORDINALITY AS t(elem, ord)
  )),
  src.loop_limit, src.created_by, src.enrollment_criteria,
  src.re_enrollment_enabled, src.re_enrollment_cooldown_days, src.re_enrollment_max_times
FROM (SELECT * FROM public.workflows WHERE id='59219742-ecc2-4b28-b110-c6041aedd064') src
CROSS JOIN (VALUES
  ('disparo_segunda','Disparo Segunda',72,120,72,120, 'Disparo Segunda — intervalos contam só dias úteis (pula fim de semana). Envios: Seg→Qui→Ter→Sex; timeout final→Não Respondeu na Qua. Clone fiel de Reativação Inativos — Onda 1.'),
  ('disparo_terca',  'Disparo Terça',  72,120,120,72, 'Disparo Terça — intervalos contam só dias úteis. Envios: Ter→Sex→Qua→Seg; timeout final→Não Respondeu na Qui. Clone fiel de Reativação Inativos — Onda 1.'),
  ('disparo_quarta', 'Disparo Quarta', 120,72,120,72, 'Disparo Quarta — intervalos contam só dias úteis. Envios: Qua→Seg→Qui→Ter; timeout final→Não Respondeu na Sex. Clone fiel de Reativação Inativos — Onda 1.'),
  ('disparo_quinta', 'Disparo Quinta', 120,72,120,120,'Disparo Quinta — intervalos contam só dias úteis. Envios: Qui→Ter→Sex→Qua; timeout final→Não Respondeu na Seg. Clone fiel de Reativação Inativos — Onda 1.'),
  ('disparo_sexta',  'Disparo Sexta',  120,120,72,120,'Disparo Sexta — intervalos contam só dias úteis. Envios: Sex→Qua→Seg→Qui; timeout final→Não Respondeu na Ter. Clone fiel de Reativação Inativos — Onda 1.')
) AS d(stage_key, label, t1, t2, t3, t4, descr)
WHERE NOT EXISTS (
  SELECT 1 FROM public.workflows w
  WHERE w.organization_id = src.organization_id
    AND w.name = 'Reativação Inativos — ' || d.label
);

COMMIT;
