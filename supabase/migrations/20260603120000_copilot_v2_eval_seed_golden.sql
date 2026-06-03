-- 20260603000000_copilot_v2_eval_seed_golden.sql
--
-- W13 — golden eval dataset seed. Cognition goldens per archetype (CTO decision
-- D1: the 5 v1 incidents stay harness regressions; this seeds tier/tool cognition
-- cases that the eval-runner actually verifies). Generated from
-- tests/fixtures/copilot-v2/eval-golden.json — the SINGLE source shared with the
-- hermetic CI gate; a unit drift test (eval-seed-drift.test.ts) asserts parity.
--
-- Milennials-first (Slice 12 dogfood). The insert is GUARDED on the org existing,
-- so it is a SAFE no-op on a fresh local/test DB (organizations is empty at
-- migration-apply time) — never an FK violation that would break `supabase start`.
-- Idempotent: skips a case already seeded by (org, case_name).
-- Committed-not-applied (apply to dev via MCP/Management API).

insert into public.copilot_v2_eval_cases
  (organization_id, archetype, case_name, input_message,
   expected_tier, expected_tool, expected_action, enabled)
select v.organization_id, v.archetype, v.case_name, v.input_message,
       v.expected_tier, v.expected_tool, v.expected_action, v.enabled
from (
  values
    ('6030520a-2ca7-477d-be89-55758e2cd808'::uuid, 'qualificador'::copilot_v2_archetype,
      'qualificador · faturamento médio sem ICP → ouro',
      'Faturo uns 50 mil por mês e compro vergalhão direto toda semana',
      'ouro'::text, null::text, null::text, true),
    ('6030520a-2ca7-477d-be89-55758e2cd808'::uuid, 'qualificador'::copilot_v2_archetype,
      'qualificador · indústria grande + ICP + recorrente → diamante',
      'Somos uma indústria, faturamento de uns 300 mil por mês, compra recorrente e é urgente',
      'diamante'::text, null::text, null::text, true),
    ('6030520a-2ca7-477d-be89-55758e2cd808'::uuid, 'qualificador'::copilot_v2_archetype,
      'qualificador · pessoa física fora do ICP → desqualificado (guard anti mis-rating v1)',
      'Sou pessoa física, queria comprar 1 barra de vergalhão pra obra de casa',
      'desqualificado'::text, null::text, null::text, true),
    ('6030520a-2ca7-477d-be89-55758e2cd808'::uuid, 'vendedor'::copilot_v2_archetype,
      'vendedor · pede reunião → schedule_meeting',
      'Quero marcar uma reunião pra fechar isso',
      null::text, 'schedule_meeting'::text, null::text, true),
    ('6030520a-2ca7-477d-be89-55758e2cd808'::uuid, 'vendedor'::copilot_v2_archetype,
      'vendedor · desconto fora da política → transfer_to_human (não fabrica número)',
      'Me dá 40% de desconto agora senão não fecho',
      null::text, 'transfer_to_human'::text, null::text, true),
    ('6030520a-2ca7-477d-be89-55758e2cd808'::uuid, 'carteira'::copilot_v2_archetype,
      'carteira · sinaliza recompra → ação semântica (SKIP até eval semântico)',
      'Preciso repor meu estoque de vergalhão',
      null::text, null::text, 'recompra'::text, true)
) as v(organization_id, archetype, case_name, input_message,
       expected_tier, expected_tool, expected_action, enabled)
where exists (select 1 from public.organizations o where o.id = v.organization_id)
  and not exists (
    select 1 from public.copilot_v2_eval_cases e
    where e.organization_id = v.organization_id
      and e.case_name = v.case_name
  );
