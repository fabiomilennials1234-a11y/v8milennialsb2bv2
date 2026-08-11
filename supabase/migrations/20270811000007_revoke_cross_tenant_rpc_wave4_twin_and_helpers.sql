-- 20270811000007_revoke_cross_tenant_rpc_wave4_twin_and_helpers.sql
--
-- APLICADA EM PRODUÇÃO em 2026-08-11 com autorização do CTO. Ver 20270811000004,
-- ...005 e ...006 para o mecanismo do vetor.
--
-- ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
--
-- Repetição do MESMO erro de processo que o 20270811000004 veio corrigir, poucas
-- horas depois: apliquei estes nove REVOKE direto em produção e não criei a
-- migration. Resultado medido pela revisão: produção com 23 funções fechadas e
-- repositório com 14. `db reset`, branch efêmera e projeto novo nasciam com as
-- NOVE abertas — inclusive o gêmeo, que permite disparo de WhatsApp pela
-- instância da vítima.
--
-- A lição não é "lembrar de criar a migration". É que escrita de segurança em
-- produção e arquivo no repositório são UM movimento, não dois — porque o repo é
-- o que vai para o próximo ambiente, e um ambiente novo nascendo vulnerável é
-- indistinguível de nunca ter consertado.
--
-- ─── O GÊMEO DE CAMPANHA ────────────────────────────────────────────────────
--
-- `schedule_rule_steps_from_position` é a versão de CAMPANHA de
-- `schedule_pipe_rule_steps_from_position`, revogada em 20270811000005. Mesma
-- forma, mesma consequência: INSERT em `scheduled_campaign_messages` com
-- `p_whatsapp_instance_id` VINDO DO PARÂMETRO. Sessão logada da organização A
-- passa a instância da organização B e agenda disparo de WhatsApp PELO NÚMERO DA
-- VÍTIMA. Cross-tenant e vetor de ban.
--
-- ESCAPOU DE TRÊS VARREDURAS, e o motivo é o achado mais valioso da auditoria:
--   1. o nome não tem `pipe_`, então busca por nome não a alcançava;
--   2. ela NÃO recebe `organization_id` — recebe `whatsapp_instance_id`,
--      `campanha_id` e `lead_id`. O critério anterior filtrava por
--      `organization_id` nos parâmetros e era CEGO para função que deriva a
--      organização de OUTRO id controlável pelo cliente.
--
-- REGRA QUE FICA: listar a população por QUEM ALCANÇA (`prosecdef` + EXECUTE para
-- `authenticated` + ausência de gate no corpo), NUNCA por qual parâmetro recebe.
-- Um id de instância, de lead ou de campanha é volante tão bom quanto um org_id.
--
-- ─── OS OITO HELPERS ────────────────────────────────────────────────────────
--
-- Eu os havia deixado de fora presumindo que "provavelmente o front usa". A
-- revisão REFUTOU a premissa por medição: nenhum dos oito tem chamada `.rpc()`
-- em `src/`. Presunção não é medição, e eu tinha deixado oito funções expostas
-- por uma.
--
-- Verificado em três frentes antes de aplicar:
--   1. os 3 call sites em edge function usam client `service_role` — o
--      `_shared/assert-org-feature.ts` declara, e o `onboarding-advance` usa
--      `createEdgeFunction`, cujo framework injeta
--      `createClient(url, SUPABASE_SERVICE_ROLE_KEY)`;
--   2. uso INDIRETO (de dentro de outra função) é indiferente ao grant de
--      `authenticated`: a chamada interna corre com o privilégio do dono da
--      função externa;
--   3. ZERO chamadores `INVOKER` para os oito — medido função a função. Essa é a
--      checagem que decide, e ela NÃO é dedução: existe um chamador `INVOKER`
--      neste banco (`trigger_create_default_stages`), achado na revisão cruzada.
--
-- ─── LIMITE ─────────────────────────────────────────────────────────────────
--
-- Contenção por grant. `DROP+CREATE` reabre. O conserto durável é `_unchecked`
-- service_role-only + wrapper que autoriza — fatia SCRUM-339.
--
-- Restam DUAS abertas de propósito: `create_default_pipelines` e
-- `ensure_pipeline_display_config`, chamadas PELO FRONT com `p_org_id` do
-- cliente. Revogar quebraria o produto.

-- O gêmeo de campanha
REVOKE EXECUTE ON FUNCTION public.schedule_rule_steps_from_position(uuid, uuid, uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;

-- Os oito helpers
REVOKE EXECUTE ON FUNCTION public.org_has_feature(uuid, text)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.lead_excluded_from_metrics(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_write_instance(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.match_onboarding_templates(uuid, text)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public._resolve_plan_base_for_resource(uuid, text)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_composable_metrics_enabled(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.metric_stage_role(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
