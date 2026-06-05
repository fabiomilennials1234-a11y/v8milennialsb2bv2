# 2026-06-05 — Daily Blast Budget (#706)

## Mudanças
- **Mass Send / Disparo**: substituído o *framing* de teto por-disparo (ADR-0002) por um **teto diário Org-wide** (ADR-0003). Limite de Leads mensageáveis via Mass Send por dia-calendário (America/Sao_Paulo), somado entre todos os disparos (Quick Blasts manuais hoje; lotes de Blast Plan em #707). Server-side, fail-closed. `quick_blast_max_leads` mantido como clamp por-disparo DENTRO do orçamento diário.

## Arquivos tocados
- `supabase/migrations/20261121000000_daily_blast_budget.sql` — `organizations.daily_blast_budget INT NOT NULL DEFAULT 200`; tabela `blast_daily_usage (organization_id, usage_date, leads_sent, PK(org, date))` com RLS (select tenant-isolado, sem grant de write a cliente); RPC atômica `increment_blast_daily_usage` (SECURITY DEFINER, search_path='', service_role-only, UPSERT `leads_sent += excluded`).
- `supabase/functions/_shared/quick-blast/daily-budget.ts` — núcleo puro (`resolveDailyBudget` fail-closed, `computeDailyClamp`, `saoPauloUsageDate`) + seam IO `BlastUsageSource` (`getUsedToday` fail-closed, `increment`) + impl real `blastDailyUsageSource` + `getDailyBlastBudget`.
- `supabase/functions/quick-blast-create/run.ts` — clamp diário antes de montar recipients; rejeição `daily_budget_exhausted` em remaining 0; increment atômico do ledger pelo count realmente despachado APÓS dispatch real (nunca em dry-run); `QuickBlastResult.skipped.overDailyBudget` + `remaining`.
- `supabase/functions/quick-blast-create/index.ts` — surface `remaining` nas respostas (sucesso, dry-run, erro).
- `src/modules/leads/hooks/useQuickBlast.ts` — `QuickBlastResult`/`QuickBlastPreview` ganham `skipped.overDailyBudget` + `remaining`.
- `src/modules/pipelines/components/disparo/BlastBreakdown.tsx` — linha "acima do teto diário" no recibo de skips do wizard.
- `tests/unit/quick-blast-daily-budget.test.ts` (16) + `tests/unit/quick-blast-run-daily-budget.test.ts` (9); `tests/unit/quick-blast-run.test.ts` stub estendido (ledger + rpc).

## Decisões
- **Day boundary = America/Sao_Paulo** (tz de negócio, igual `getTimeBasedVariables`/followupSchedule/workflow windows). `usage_date` calculado server-side, determinístico independente do clock do servidor.
- **Fail-closed em DOIS pontos**: (1) `daily_blast_budget` ausente/inválido → default 200, nunca ilimitado; (2) erro de leitura do ledger → resolve a "orçamento todo consumido" (remaining 0, bloqueia o dia) — um blip de DB custa um disparo adiado, nunca um número banido. Contrasta de propósito com o refinement #704, que fail-OPEN (orçamento diário é o guardrail duro; refinement é narrowing best-effort).
- **Increment pós-dispatch, pelo count real** (não o requisitado): leads sem telefone/dups não consomem orçamento. Atômico via `ON CONFLICT DO UPDATE` → disparos concorrentes no mesmo dia nunca perdem contagem.
- **Dry-run nunca consome**: preview short-circuita antes do dispatch e do increment; reporta o mesmo clamp + `remaining`.
- Decisão canônica: `docs/adr/0003-mass-send-daily-budget-and-blast-plans.md`.

## Follow-ups
- Migration NÃO aplicada a nenhum ambiente — orquestrador aplica + verifica no dev (`bcfadphgsibjzivtbjvc`) após review e regenera types.
- `auth.org_id()` é o helper de tenancy usado (igual `send_dedup_log`) — confirmar presença no dev antes do apply.
- #707 (Blast Plan: snapshot congelado + cron releaser) consome o mesmo ledger diário compartilhado.
- Cron de limpeza de `blast_daily_usage` (rows antigos) não criado — tabela é low-churn (1 row/org/dia); avaliar retenção/purge se crescer.
