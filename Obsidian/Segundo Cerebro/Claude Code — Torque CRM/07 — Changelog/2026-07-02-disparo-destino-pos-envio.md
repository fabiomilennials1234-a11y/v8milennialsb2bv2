# 2026-07-02 — Disparos: passo "Destino" (movimentação pós-envio)

## Mudanças

- **campaigns / disparo-wizard**: Wizard Linear de `/disparos/novo` passa de 5 pra **6 passos** — novo passo opcional **"Destino"** (`postsend`) entre "Mensagem" e "Velocidade". O usuário escolhe funil + etapa (system pipes ou funil custom) e cada lead é movido pra lá **no momento em que a mensagem dele é enviada** — por lote/por lead (Blast Plans drenam ao longo de dias), nunca tudo de uma vez. Default "Manter onde estão" (passa sem interação); modo "Mover" sem etapa bloqueia o Continuar.
- **DB**: coluna nova `blast_plans.post_send_target jsonb NULL` (migration `20270106000000`). Shape: `{funnelKind: "system"|"custom", pipelineType?|pipelineId?, stageKey, label}`. NULL = comportamento antigo intacto.
- **blast-plan-create**: valida o target **fail-closed** antes de persistir — system: `stage_key` ativo em `pipeline_stages` da org (pipeline_type match); custom: stage uuid em `custom_pipeline_stages` da org com `pipeline_id` match. Target inválido/cross-org → 400, plano nunca é criado com destino quebrado. Org do move vem SEMPRE do plano/caller, nunca do payload.
- **Core `_shared/quick-blast/blast-plan.ts`**: dep opcional injetada `onRecipientsSent(leadIds)` em `BlastPlanDeps`, invocada após **cada** `markRecipients(..., "sent")` — 4 call sites (lote 0 single-number, lote 0 multi-number, releaser multi-number, releaser legacy). **Best-effort**: try/catch no core, falha loga e nunca propaga (o lead já recebeu a mensagem; envio não falha por causa do move). Skipped (refinados) e deferred (pressão de budget) nunca chegam ao hook.
- **blast-plan-release**: reconstrói o mover por plano a partir de `plan.post_send_target` + `plan.organization_id` persistidos — lotes futuros movem quando enviados.
- **Mover** (`_shared/quick-blast/post-send-target.ts`): loop por lead chamando o motor canônico `moveStage()` (`_shared/action-handlers/move-stage.ts`) — system pipes via `upsertPipeEntry` (pipeline_entries), custom via `custom_pipe_entries`. Erro por lead: loga e continua.

## Arquivos tocados

- `src/modules/campaigns/components/disparo-wizard/wizard-machine.ts` — step `postsend` + 6 campos novos no draft + validação
- `src/modules/campaigns/components/disparo-wizard/StepPostSend.tsx` — **novo** (radio-cards + picker funil/etapa + confirmação + aviso mesmo-lugar)
- `src/modules/campaigns/components/disparo-wizard/use-funnel-stage-options.ts` — **novo** helper compartilhado (picker funil/etapa) usado por AudienceByStage + StepPostSend
- `src/modules/campaigns/components/disparo-wizard/{DisparoWizard,StepAudience,StepMessage,StepSpeed,StepReview,StepMonitor,AudienceByStage}.tsx` — wiring, kickers "de 6", Row "Depois do envio" no Review, nota no Monitor
- `src/modules/campaigns/hooks/useBlastPlans.ts` — `CreateBlastPlanInput.post_send_target` (`BlastPostSendTarget`)
- `supabase/functions/blast-plan-create/index.ts` — validação fail-closed + persistência + injeção do mover no lote 0
- `supabase/functions/blast-plan-release/index.ts` — injeção do mover por plano no releaser
- `supabase/functions/_shared/quick-blast/blast-plan.ts` — `onRecipientsSent` best-effort nos 4 caminhos de sent
- `supabase/functions/_shared/quick-blast/post-send-target.ts` — **novo** (parse/validate/buildPostSendMover)
- `supabase/migrations/20270106000000_blast_plans_post_send_target.sql` — **nova** coluna
- `tests/unit/disparo-wizard.test.ts` + `tests/unit/blast-plan-post-send.test.ts` (**novo**)

## Decisões

- Move é **best-effort por design**: a mensagem já saiu; falha no move não pode falhar envio nem release. Logado via `console.warn` (visível nos logs da edge fn).
- Fan-out de stage-change permanece o do motor existente: triggers PG em `pipeline_entries`/`custom_pipe_entries` disparam workflows `stage_changed` e history — nenhum fan-out novo adicionado.
- Auditoria: moves via service_role são logados em `lead_history` pelo trigger `trg_log_pipeline_stage_change_history` (só em UPDATE de stage_key). **Gap conhecido**: lead que ENTRA no pipe de destino (INSERT novo em pipeline_entries/custom_pipe_entries) não gera linha de history — mesmo comportamento de qualquer moveStage de automação hoje.

## Follow-ups

- Regen de `types.ts` após aplicar a migration (coluna nova não afeta o frontend atual — hooks usam `as any` na tabela).
- UI de edição do target em plano já criado ficou fora de escopo (blast-plan-edit intocado).
- Aplicar migration em dev (prod só com autorização CTO).
