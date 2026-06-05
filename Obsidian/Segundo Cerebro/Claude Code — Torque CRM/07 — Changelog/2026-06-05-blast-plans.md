# 2026-06-05 — Blast Plans: auto-batch over days (#707)

## Mudanças
- **Mass Send / Disparo**: implementado o **Blast Plan** (metade #707 do ADR-0003) — um Mass Send cuja audiência excede o orçamento diário restante é fatiado em **lotes diários** ao longo de dias consecutivos. Membership **congelada na criação** (snapshot — Leads que entram no Estágio depois NÃO entram). Lote 1 dispara hoje consumindo o orçamento diário restante; os demais saem por um cron diário que **re-aplica os refinements #704** sobre a membership congelada e consome no máximo o orçamento diário restante. Plano finito e auto-terminável. Backend only — UI ("agendar N lotes" no wizard, painel Disparos, pause/cancel) fica em slice posterior.

## Arquivos tocados
- `supabase/migrations/20261122000000_blast_plans.sql` — tabelas `blast_plans` (status active/paused/completed/cancelled, source jsonb, message congelada, refinements jsonb, image_url, delay min/max, total_recipients, lots_total, lots_released, release_time TIME default 09:00, next_release_date DATE, timestamps) e `blast_plan_recipients` (plan_id FK CASCADE, lead_id, phone, variable_snapshot jsonb, lot_index, status pending/sent/skipped, reason). RLS select tenant-isolada via **`get_my_organization_ids()`** (NÃO `auth.org_id()` — não existe no projeto); writes service_role-only. Índice parcial `idx_blast_plans_due (next_release_date) WHERE status='active'` + `(plan_id, lot_index, status)`. Trigger `set_updated_at`. Cron diário `blast-plan-release` (09:05 BRT = `5 12 * * *`) via `invoke_blast_plan_release()` + `cron_config` (url + secret).
- `supabase/functions/_shared/quick-blast/plan-slicing.ts` — núcleo puro: `planLotCount` (ceil, fail-closed 1/dia), `selectLotSlice` (budget-bound + defer), `addDaysIso` (aritmética de data BRT, noon-UTC anchor).
- `supabase/functions/_shared/quick-blast/blast-plan.ts` — orquestração: `createBlastPlan` (congela snapshot, fatia, dispara lote 1 hoje via ledger #706, persiste next_release_date=amanhã) + `releaseBlastPlanLot` (re-aplica refinements #704 sobre membership congelada, budget-bound, defer elástico, increment ledger compartilhado, completed quando exausto). Toda IO injetada (`BlastPlanStore`, `BlastUsageSource`, `BlastActivitySource`, dispatch, instanceResolver).
- `supabase/functions/_shared/quick-blast/blast-plan-store.ts` — impl real do `BlastPlanStore` sobre Supabase service_role (insert/update/getLot/mark/move/listDue, chunked 500).
- `supabase/functions/blast-plan-create/index.ts` — edge fn JWT (getUser, SEM role gate ADR-0002), congela audiência via fetch org-scoped de leads, retorna plan_id + breakdown dia-a-dia.
- `supabase/functions/blast-plan-release/index.ts` — edge fn cron-only (x-cron-secret + timingSafeCompare), pull `listActivePlansDue(today)`, libera lote de cada plano, instanceResolver + budget cacheados por run.
- `supabase/config.toml` — `[functions.blast-plan-create]` + `[functions.blast-plan-release]` `verify_jwt=false`.
- `tests/unit/blast-plan-slicing.test.ts` (12) + `tests/unit/blast-plan.test.ts` (15).

## Decisões
- **Frozen-not-requery** (ADR-0003 §4): o releaser SÓ lê os recipients congelados do próprio plano; nunca re-consulta o Estágio fonte. Mantém o Blast Plan um broadcast finito e auto-terminável, não uma regra de Estágio (isso é Workflow). Reforçado por teste ("frozen lot ignores new Stage entrants").
- **Lote 1 NÃO re-refina na criação**: o wizard resolveu a audiência ao vivo segundos antes; refinements re-rodam só nos lotes FUTUROS quando o dia chega. Lotes futuros sempre re-aplicam #704 (drop replied/recently-contacted desde o snapshot).
- **Ledger #706 compartilhado**: um lote consome o MESMO `blast_daily_usage` que um Quick Blast manual. Um dia manual pesado encolhe/adiada o lote (teste "heavy manual day shrinks lot 1"). Increment pelo count realmente despachado, pós-dispatch.
- **Duração elástica**: um lote que não cabe no orçamento do dia adia o remanescente para o lote seguinte (`moveRecipientsToLot`), empurrando `next_release_date`. Plano só completa quando o último lote drena com zero deferred.
- **Fail-closed no slicing**: budget não-positivo → 1 recipient/dia (nunca Infinity lots), remaining negativo → 0 enviados.
- **Day boundary America/Sao_Paulo** (igual #706), cron 09:05 BRT logo após o `release_time` default 09:00.
- Decisão canônica: `docs/adr/0003-mass-send-daily-budget-and-blast-plans.md`.

## Segurança
- RLS obrigatória nas 2 tabelas, scope via `get_my_organization_ids()` (SECURITY DEFINER, evita recursão team_members sob Realtime). Anon REVOKE. Writes service_role-only — cliente não cria/muta plano para furar o teto.
- `blast_plan_recipients` sem `organization_id` próprio: isolamento via EXISTS no plano pai (1 plano = 1 org).
- Tenant guard duplo na criação (instance.organization_id === orgId no handler E no core) e no release (instanceResolver valida org da instância contra org do plano).
- Cron auth x-cron-secret com `timingSafeCompare`; releaser nunca aceita JWT de usuário.

## Follow-ups
- Migration NÃO aplicada a nenhum ambiente — orquestrador aplica + verifica no dev (`bcfadphgsibjzivtbjvc`) após review, seeda `cron_config` (blast_plan_release_url + cron_secret), regenera types.
- Deploy das 2 edge fns + smoke do cron no dev pendente (orquestrador).
- **UI (slice posterior)**: "agendar N lotes" no review do wizard, painel Disparos (listar planos + breakdown), pause/cancel. Hooks consumirão `blast-plan-create` (plan_id + breakdown) e leitura de `blast_plans`/`blast_plan_recipients` (RLS select já permite).
- Purge de `blast_plan_recipients`/`blast_plans` antigos não criado — avaliar retenção quando volume crescer (mesma nota do #706).
