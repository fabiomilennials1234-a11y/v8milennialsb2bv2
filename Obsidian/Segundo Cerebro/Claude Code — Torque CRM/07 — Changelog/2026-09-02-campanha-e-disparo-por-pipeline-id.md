# 2026-09-02 — Campanha e Disparo apontam pra qualquer funil (Fatia B · Funil é Funil)

**Branch:** `feat/funis-unificacao` (worktree wave2) · **Não aplicado em prod** (migration 20270917000000 aguarda janela; ensaio abortável ENSAIO_OK em 2026-09-02).

## O que mudou

- **Destino de campanha é (pipeline_id, stage_id)** — `campanhas.target_pipeline_id`/`target_stage_id` (FK `ON DELETE SET NULL`), backfilladas do formato legado por (org, slug): 8/12 campanhas de prod ganham o par canônico; as 4 `livre` sem destino ficam NULL (comportamento preservado). `objective`/`free_target_pipe` viram formato legado lido pra sempre.
- **`resolveExtractionTarget` id-first** — devolve `{pipeline, stage}` como referências (uuid canônico, ou slug/alias legado que o resolvedor de funil entende).
- **`useExtractLeadToPipe` reescrito** — os 3 ramos por view `pipe_*` viraram um motor único sobre `pipeline_entries` (qualquer funil): resolve funil (id/slug/alias `pipe_*`) e etapa (uuid/stage_key ativa), atualiza a entry corrente (primeira aberta; senão a mais recente) ou insere com `assigned_to = responsible ?? sdr ?? closer` e metadata espelhando as views. Follow-up automation só dispara pro trio (ponte legada — `follow_up_automations` ainda é por `pipe_type`).
- **DisparoWizard (board) por pipeline_id** — contexto canônico novo `{kind:"pipeline", pipelineId}`; `{kind:"system"}`/`{kind:"custom"}` aceitos pra sempre (slug resolve via `usePipelines`). Público via `get_pipeline_lead_ids` (motor único), etapas via `useStagesDoFunil` (uuid). `SystemPipelineType` marcado deprecated (morre na F6).
- **Wizard standalone (/disparos)** — `AudienceSelection` colapsou pra `{funnelScope, pipelineId, stageId, stageScope, conditions}`; seletores (público, destino pós-envio, planilha) listam os funis REAIS da org num Select só. Payload `post_send_target` canônico `{pipelineId, stageId, label}`.
- **Edge fns** — `post-send-target.ts` normaliza 3 shapes (canônico + 2 legados) pra `{pipelineRef, stageRef}` e valida contra `pipelines`+`pipeline_stages`; `blast-plan-create` persiste o shape canônico e a coluna nova `blast_plans.pipeline_id` (proveniência org-validada); `disparo-planilha-create` perdeu o split system/custom (resolvePipeline + pipeline_stages + upsertPipeEntry).
- **`blast_plans.pipeline_id`** — coluna canônica backfillada (5/5 em prod); `source`/`post_send_target` legados ganham `pipelineId` aditivo com marcador `backfilled_pipeline_id` (rollback remove só o que o backfill pôs).

## Medições que sustentaram (prod 2026-09-02)

- Ledger no topo `20270916000010` — 8 migrations fantasma acima do repo → a migration é `20270917000000`.
- `campanhas`: 12 linhas (qualificacao 4, agendamentos 1, livre 7 — 3 com free_target). 8/8 destinos deriváveis resolvem em (org, slug) + stage ativa.
- `pipelines.config.objective_*` custom: 0 usos. `blast_plans`: 5 linhas, todas whatsapp; `post_send_target`: 2, ambas system/whatsapp. 0 custom.
- UI Kanban de campanhas está RETIRADA — `useExtractLeadToPipe`/`resolveExtractionTarget` não têm consumidor de UI (só testes + API pública do módulo).

## Testes

`use-campanhas.test` (113), `disparo-audience-resolve` (31), `disparo-wizard` (27), `blast-plan-post-send` (18) migrados; família blast/disparo completa 375+25 verdes. `check-metric-antipatterns` sem allow novo. Ratchet de types verde (2 erros restantes são de arquivos em voo do agente A).

## Pendências

- Aplicar `20270917000000` em prod (janela) + regen `types.ts` + deploy `blast-plan-create`, `blast-plan-release`, `process-blast-recipients`, `disparo-planilha-create`.
- Página unificada (agente A) pode migrar o mount pro contexto `{kind:"pipeline", pipelineId}` quando quiser — o legado segue aceito.
