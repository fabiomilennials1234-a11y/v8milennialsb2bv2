-- 20270811000005_revoke_cross_tenant_rpc_surface_wave2.sql
--
-- APLICADA EM PRODUÇÃO em 2026-08-11 com autorização do CTO. Segunda onda; ver
-- `20270811000004` para a primeira e para o mecanismo do vetor.
--
-- ─── A AUDITORIA ────────────────────────────────────────────────────────────
--
-- Nove funções `SECURITY DEFINER` que recebem `organization_id` POR PARÂMETRO e
-- são executáveis por `authenticated` foram auditadas por DOIS engenheiros, em
-- medições independentes e às cegas (nenhum viu o mapa do outro antes de
-- concluir). Os dois chegaram ao mesmo veredito:
--
--   NENHUMA DAS NOVE TEM GATE. Zero `auth.uid()`, zero `assert_org_access`, zero
--   join de associação, nem no corpo nem em wrapper: AUSENTE.
--
-- Provado por execução — as nove escreveram sob `SET LOCAL ROLE authenticated`
-- sem JWT, com org_id de organização alheia, em transação revertida.
--
-- ─── ESTA MIGRATION REVOGA 5. DUAS FICAM ABERTAS DE PROPÓSITO ───────────────
--
-- `create_default_pipelines` e `ensure_pipeline_display_config` são chamadas
-- PELO FRONT (`usePipelineEntries.ts` e `usePipelineDisplayConfig.ts`), mandando
-- `p_org_id` vindo do cliente — o que viola a regra do próprio CLAUDE.md ("o
-- frontend nunca envia org_id; vem do auth context"). Revogar QUEBRARIA o
-- produto. Elas precisam do wrapper que autoriza, em fatia própria. São as de
-- menor impacto do grupo: recriar pipeline de sistema com `ON CONFLICT DO
-- NOTHING`, e criar linha de display config.
--
-- ─── O QUE CADA UMA PERMITIA ────────────────────────────────────────────────
--
-- `schedule_pipe_rule_steps_from_position` — O PIOR, mais grave que a
-- `fire_workflow_trigger` da primeira onda. INSERT arbitrário em
-- `scheduled_pipe_messages` com organização, lead e `whatsapp_instance_id`
-- escolhidos pelo atacante. E um SEGUNDO defeito no mesmo corpo: lê
-- `pipe_dispatch_rule_steps WHERE rule_id = p_rule_id` SEM FILTRO DE ORG, então
-- a regra da org A pode ser agendada na org B — leitura cross-tenant além da
-- escrita. O laço fecha em `pipe-rule-dispatch`, que seleciona
-- `status='scheduled' AND scheduled_at <= now()` sem checar origem e envia como
-- service_role. Resultado: mensagem com o texto do atacante saindo do número do
-- cliente. Cross-tenant E vetor de ban.
--
-- `resolve_wait_response` — vira `workflow_executions` da vítima de
-- `waiting_response` para `running` com `next_run_at = now()`, o que faz o
-- executor avançar o nó e MANDAR WhatsApp para os leads dela. Exige `lead_id`
-- real da vítima, então é grave sem ser crítica. É o caso exato de "o PostgREST
-- serve a FUNÇÃO, não o wrapper": o backend chama o irmão
-- `resolve_wait_response_by_phone`, mas quem está exposto é esta.
--
-- `advance_onboarding_state` — UPDATE em `organizations` de qualquer org, e
-- grava `onboarding_answers` com jsonb ARBITRÁRIO. Também é ORÁCULO: a exceção
-- "State mismatch: expected X, got Y" devolve o estado interno da vítima, então
-- dá para enumerar organização por organização sem escrever nada.
--
-- `acquire_copilot_lock` — o mais silencioso. `ON CONFLICT DO UPDATE ... WHERE
-- locked_at < now() - 60s`: um laço a cada 60 segundos segura o telefone e o
-- worker legítimo pula o processamento. SILENCIA a IA do cliente sem tocar em
-- dado nenhum — e para o operador parece apenas "o copilot não respondeu".
--
-- `get_next_round_robin_member` — gira o ponteiro de rodízio de workflow alheio
-- (sabotagem da distribuição de leads entre os vendedores da vítima) e insere
-- linha em `workflow_round_robin_state` com `organization_id` escolhido.
--
-- ─── POR QUE REVOGAR ESTAS 5 NÃO QUEBRA NADA ────────────────────────────────
--
-- Medido em produção antes de aplicar:
--   * nenhuma é chamada pelo front; só edge function, que usa `service_role`;
--   * chamadores internos: `schedule_pipe_rule_steps_from_position` tem 3
--     (`trigger_pipe_dispatch_rules`, `trigger_pipeline_entries_dispatch`,
--     `trigger_whatsapp_response_detection`), `resolve_wait_response` tem 1
--     (`resolve_wait_response_by_phone`), as outras três têm ZERO — e todos os
--     existentes são `SECURITY DEFINER` de dono `postgres`, que mantém EXECUTE.
--
-- ─── LIMITE ─────────────────────────────────────────────────────────────────
--
-- Contenção por grant, não conserto. `DROP+CREATE` reabre. O conserto durável é
-- `_unchecked` service_role-only + wrapper que autoriza, para as 9. Fatia própria.

REVOKE EXECUTE ON FUNCTION public.schedule_pipe_rule_steps_from_position(uuid, text, uuid, uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.resolve_wait_response(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.advance_onboarding_state(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.acquire_copilot_lock(text, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_next_round_robin_member(uuid, text, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
