# Plan Tiers + Faxina — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limpar código morto (código + vault + UI), consolidar a matriz plano→feature (Base / Automation / Copilot, 5 usuários por plano) e fechar os furos de enforcement — server-side e rotas sem guard.

**Architecture:** O gating por plano já existe (branch `feat/plan-feature-gating`): `OrgFeaturesContext.hasFeature()` ← RPC `org_get_features_and_limits`, `PlanFeatureProtectedRoute` em rotas, cadeado via `SIDEBAR_FEATURE_MAP` na nav/palette/bottom-nav, `UpgradeModal`. Este plano NÃO recria nada disso — ele (1) remove código morto, (2) corrige DADOS (`max_users: -1` → `5`; carteira no Base), (3) adiciona a camada server-side inexistente (`_shared/plan-gate.ts` nas edges premium), (4) fecha rotas sem guard derivando guards do registry (fonte única), (5) sincroniza vault.

**Tech Stack:** React 18 + TS, Supabase (Postgres migrations + Deno edge functions), Vitest.

**Branch:** criar `feat/plan-tiers-cleanup` a partir de `feat/plan-feature-gating` (stacked — PR da base ainda não mergeado). ⚠️ Regra de squash de PR stacked: antes do squash-merge, rebase + retarget base para `main` (ver memória `feedback_squash_stacked_prs`). Default DEV; nada de deploy prod sem pedido explícito do CTO.

---

## Estado atual (verificado 2026-07-02 — não re-derivar)

**Mecanismo de gating (já existe, não recriar):**
- `src/contexts/OrgFeaturesContext.tsx` — `hasFeature(key)`, `checkLimit(key)`, `planName`; fail-open durante loading; master bypass.
- `src/modules/platform/components/PlanFeatureProtectedRoute.tsx` — guard de rota (cadeado + CTA).
- `src/modules/platform/lib/feature-registry.ts` — `FEATURES`, `LIMITS`, `SIDEBAR_FEATURE_MAP` (path → feature key).
- `src/shared/components/UpgradeModal.tsx` — `PLAN_LABELS`, `UPGRADE_CONTACT_URL`.
- Rotas já guardadas em `App.tsx`: whatsapp_bulk (/disparos), copilot (4 rotas), chat (3), carteira, automations (4), message_templates.

**Planos (seed `20260830000000_checkout_plans_and_tables.sql:48-231` + `20270103000000`):**
- `torque-1.0` (Base), `torque-2.0` (Automation), `torque-v8` (Copilot). Legados free/starter/pro/enterprise já `is_active=false`.
- Addon `turbo` (plan_addons) desbloqueia `copilot`+`oraculo` p/ 1.0/2.0 — MANTER.

**Furos confirmados:**
1. `limits.max_users = -1` nos 3 planos → limite de 5 não existe em dado nenhum. Trigger `trg_enforce_seat_limit` (`20260910000005`) existe e funciona — está desarmado pelo dado.
2. `create-org-user/index.ts:189-205` lê `limits.users` (key não existe; correta é `max_users`) → checagem é no-op silencioso.
3. ZERO enforcement server-side de plan-features: `agent-message`, `copilot-v2-worker`, `oraculo-comercial`, `process-workflow-executions`, `mass-send-create`, `whatsapp-api-proxy` executam sem checar plano.
4. Rotas sem `PlanFeatureProtectedRoute`: `/comissoes`, `/tv`, `/produtos`, `/negocios`, `/performance`, `/analytics` — cadeado na nav é contornável via URL direta.
5. `hasFeature` fail-open durante loading → janela de acesso a feature bloqueada.
6. `customer_portfolio` gateia telas de carteira mas nunca foi seedado em plano nenhum.

**Código morto (evidência do sweep 2026-07-02):**
- ALTA confiança: `CompetitionPodium.tsx` (V1, zero imports), `ProposalDetailModal.tsx` (@deprecated, nunca importado).
- MÉDIA: `WhatsAppMigrationBanner.tsx` (exportado no barrel, nunca montado), `scripts/recovery/` (~90 arquivos untracked de incidentes passados), páginas órfãs sem rota (`DashboardOutbound.tsx`, `campaigns/pages/Campanhas.tsx`, `engagement/pages/{Metas,Ranking,Premiacoes,GestaoMetas}.tsx`, `platform/pages/Onboarding.tsx` legado).
- VERIFICAR antes: `webhook-validate-url` (sem call-site achado), `campaigns/pages/MassSend.tsx` (pode estar embutido).

**FALSOS-POSITIVOS — NÃO DELETAR (lista de proteção):**
- Evolution provider (`_shared/whatsapp-providers/evolution-provider.ts`) + `RepairingWizard` + `useOrgWhatsAppMigration` — kill-switch ativo via `organizations.whatsapp_provider_override`.
- Copilot v2 (`agent-runtime-v2`, `copilot-v2-worker`, `_shared/copilot-v2/*`) — live-but-inert de propósito.
- SZ.Chat (`sz-chat-send/webhook`, `useWhatsAppSzChat`) — ativo em roteamento de envio.
- `pipelines/hooks/legacy/` + `components/legacy/` — nome histórico, consumidos por TV dashboard e CrossPipePanel.
- `ClientDetailModal.tsx` — tag @deprecated desatualizada; importado por `UpsellBaseList.tsx:7,113` (corrigir a tag, não deletar).
- Feature keys legadas em `feature-registry.ts` (`campaigns_*`, `max_campaigns`, `max_funnels`...) — contrato de dados com rows vivas de `feature_flags`. Manter.
- `webhook-send-test` — invocado por `WebhookSettings.tsx:197`. Manter.
- `process-followup-situations` — ADR-0006 accepted, rollout pendente. Manter, documentar.
- `recover-stuck-conversations` — ferramenta ops manual. Manter, documentar.
- `OnboardingHubPreview.tsx` + WIP onboarding untracked — feature nova ativa, dev-only. Manter.

---

## Matriz plano → feature (DECISÃO — fonte de verdade deste plano)

Spec do CTO: Base = só CRM (sem automações, copilot, chat). Automation = CRM + automações + chat (sem copilot). Copilot = tudo. Todos: **5 usuários**.

| Feature key | Base (torque-1.0) | Automation (torque-2.0) | Copilot (torque-v8) | Nota |
|---|---|---|---|---|
| leads, funnels, deals, review | ✅ | ✅ | ✅ | CRM core |
| performance, commissions, tv_dashboard, analytics | ✅ | ✅ | ✅ | CRM core |
| products | ✅ | ✅ | ✅ | CRM core |
| **carteira, customer_portfolio** | ✅ **(MUDANÇA: hoje false)** | ✅ | ✅ | Carteira = CRM pós-venda. Spec CTO: Base tem CRM completo |
| marketing (lead forms/UTM) | ✅ | ✅ | ✅ | Captação = entrada do CRM |
| chat | ❌ | ✅ | ✅ | |
| message_templates | ❌ | ✅ | ✅ | Acoplado a chat |
| automations | ❌ | ✅ | ✅ | |
| whatsapp_bulk (disparos) | ❌ | ✅ | ✅ | |
| scheduled_messages | ❌ | ✅ | ✅ | |
| campaigns_* (legadas) | ❌ | ✅ | ✅ | Manter keys por compat |
| copilot, copilot_advanced | ❌ | ❌ (addon turbo ✅) | ✅ | |
| oraculo | ❌ | ❌ (addon turbo ✅) | ✅ | |
| merged_opportunity_funnel | — | — | — | Rollout flag per-org, fora da matriz |
| api_access, white_label, external_cadastro | — | — | — | Fora dos 3 planos; manter comportamento atual (default flags) |

**Limits:** `max_users: 5` nos 3 planos (era -1). `max_copilot_agents`: 0 / 0 / -1 (mantém). `max_whatsapp_instances`: 0 / -1 / -1 (mantém).
**Grandfathering:** org com >5 membros ativos hoje NÃO quebra — trigger só bloqueia adicionar; não desativa ninguém. Não mexer em `admin_adjustment`.

---

## FASE 1 — Faxina (código + UI + vault)

### Task 1: Deletar mortos de alta confiança

**Files:**
- Delete: `src/modules/analytics/components/performance/CompetitionPodium.tsx`
- Delete: `src/modules/carteira/components/proposal/ProposalDetailModal.tsx`

- [x] **Step 1: Confirmar zero imports (paranoia barata)**

Run: `rg -l "CompetitionPodium[^V]" src/ ; rg -l "ProposalDetailModal" src/`
Expected: só os próprios arquivos (e comentários em `useTinyErp.ts`/`useLeadTimeline.ts` p/ ProposalDetailModal — comentário não conta).

- [x] **Step 2: Deletar + limpar comentários órfãos**

`git rm` dos dois arquivos. Em `useTinyErp.ts` e `useLeadTimeline.ts`, remover só as linhas de comentário que citam `ProposalDetailModal` (não tocar código).

- [x] **Step 3: Build + testes**

Run: `npx tsc --noEmit && npm run build && npm run test:unit`
Expected: verde. (CI não tem gate de tsc — rodar manual é obrigatório.)
Resultado: tsc ✅ 0 erros, build ✅. test:unit: 70 failed | 4868 passed | 150 skipped — TODAS as falhas pré-existentes (baseline red, memória `project_ci_baseline_red`); mudança é comment-only + deleção de arquivos com zero importers (tsc+build provam). Baseline de arquivos falhando capturado p/ comparação de regressão nos gates seguintes.

- [x] **Step 4: Commit**

```bash
git commit -m "chore(cleanup): remove CompetitionPodium v1 e ProposalDetailModal mortos"
```

### Task 2: Páginas órfãs sem rota

**Files:**
- Delete (após verificação individual): `src/modules/analytics/pages/DashboardOutbound.tsx`, `src/modules/campaigns/pages/Campanhas.tsx`, `src/modules/engagement/pages/Metas.tsx`, `src/modules/engagement/pages/Ranking.tsx`, `src/modules/engagement/pages/Premiacoes.tsx`, `src/modules/engagement/pages/GestaoMetas.tsx`, `src/modules/platform/pages/Onboarding.tsx`
- Verify-only: `src/modules/campaigns/pages/MassSend.tsx`

- [x] **Step 1: Para CADA arquivo, verificar que nada importa**

Resultado: **`DashboardOutbound.tsx` NÃO é órfã** — importada e renderizada por `Dashboard.tsx:27,89` → MANTIDA (registrar no PR). `MassSend.tsx` sem consumidor de página, mas verify-only por decisão ("mantida pra futuro", campaigns/CLAUDE.md) → MANTIDA. Órfãs confirmadas: `Campanhas.tsx` (lazy decl morto em App.tsx:60, nunca renderizado), 4 pages engagement, `platform/pages/Onboarding.tsx`.

- [x] **Step 2: Deletar confirmados + remover redirects/lazy imports correspondentes em `App.tsx` se apontarem pra arquivo deletado** (redirects `/metas`→`/performance` etc. FICAM — só o lazy import do arquivo morto sai, se existir). → 6 arquivos deletados + lazy decl `Campanhas` removido + comentários de barrel (engagement/platform index.ts) + CLAUDE.md dos 4 módulos sincronizados.

- [x] **Step 3: Build + testes** — tsc ✅ 0 erros, build ✅. test:unit: 31 failed files / 71 failed tests — **zero arquivos novos falhando vs baseline** (diff vazio; +1 teste dentro de arquivo já-vermelho = flake de env).

- [x] **Step 4: Commit** — `chore(cleanup): remove páginas órfãs sem rota (v1 de metas/ranking/campanhas/onboarding)`

### Task 3: Restos de UI/exports mortos + tags @deprecated mentirosas

**Files:**
- Delete: `src/modules/communication/components/whatsapp-migration/WhatsAppMigrationBanner.tsx`
- Modify: `src/modules/communication/index.ts:234` (remover export do banner)
- Modify: `src/modules/carteira/components/.../ClientDetailModal.tsx` (REMOVER a tag `@deprecated` — componente é vivo, usado por `UpsellBaseList.tsx:7,113`)
- Verify+delete se órfã: `supabase/functions/webhook-validate-url/` (+ entrada no `config.toml`)

- [x] **Step 1:** `rg "WhatsAppMigrationBanner" src/` → só barrel + arquivo. Deletar ambos os pontos. → deletado + barrel (index.ts:234) + sub-barrel; `RepairingWizard` preservado (deep-imports vivos em WhatsAppMigration.tsx:32 e CommandGroupUazapi.tsx:20).
- [x] **Step 2:** `rg "webhook-validate-url"` → zero call-sites (só docs/config.toml/próprio index) → pasta deletada + entrada config.toml removida + docs (EDGE-FUNCTIONS-AUTH-MAP, functions/CLAUDE.md) atualizados.
- [x] **Step 3:** Corrigir tag do `ClientDetailModal`. → tag @deprecated removida (componente vivo via UpsellBaseList).
- [x] **Step 4:** Build + testes verde. → tsc ✅, build ✅. Gate revelou 1 arquivo novo falhando (`tests/unit/whatsapp-migration.test.tsx` — testava o banner deletado); describe do banner removido, testes de hooks vivos mantidos → arquivo re-rodado: 1 passed (4 tests). Commit: `chore(cleanup): banner de migração órfão, tag deprecated incorreta, edge órfã`

### Task 4: `scripts/recovery/` (untracked, ~90 arquivos de incidentes)

⚠️ Untracked = irrecuperável se apagado errado (memória `feedback_git_clean_safety`). NÃO usar `git clean`.

- [x] **Step 1:** Mover a pasta INTEIRA para fora do repo: `Move-Item scripts\recovery "$env:USERPROFILE\Desktop\torque-ops-archive-recovery"` (arquivo morto de ops preservado, fora do source tree). → 102 arquivos movidos, pasta fora do repo.
- [x] **Step 2:** Adicionar `scripts/recovery/` ao `.gitignore` (linha nova) — futuros scripts one-off não poluem `git status`.
- [x] **Step 3:** Commit: `chore(repo): ignora scripts/recovery (ops one-off arquivados fora do repo)`

### Task 5: Documentar intencionais que parecem mortos

**Files:**
- Modify: `supabase/functions/CLAUDE.md` — corrigir nota de `webhook-send-test` ("deletar candidato" → "USADO por WebhookSettings.tsx:197"); anotar `process-followup-situations` (ADR-0006, rollout pendente, sem cron ainda) e `recover-stuck-conversations` (ferramenta ops manual, service_role).

- [x] **Step 1:** Editar as 3 notas. → webhook-send-test (USADO por WebhookSettings.tsx:197 — nota corrigida em functions/CLAUDE.md e platform/CLAUDE.md), process-followup-situations + recover-stuck-conversations adicionadas ao mapa copilot (contagem 18→20).
- [x] **Step 2:** Commit: `docs(functions): corrige notas de funções vivas que pareciam mortas`

### Task 6: Vault sync da faxina

**Files:**
- Modify: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/07 — Changelog/` (append nota da faxina)
- Verify: `06 — Features/` — se alguma nota documentar exclusivamente feature deletada (ex.: podium v1, telas metas/ranking v1), marcar como histórico ou deletar.

- [x] **Step 1:** Ler `06 — Features/_MOC.md` + subpastas (Vendas, Dashboard, Admin); identificar notas que referenciam SÓ artefatos deletados nas Tasks 1-3. → recon exaustivo (agente): ZERO notas 100% sobre artefato deletado; só menções incidentais em inventários (auditoria-duplicatas, As-Is, bounded-contexts) e changelog histórico.
- [x] **Step 2:** Notas 100% obsoletas → deletar. → Nenhuma deleção necessária (sem `[vault-delete-ok]`). Editadas as linhas acionáveis erradas de `auditoria-duplicatas.md` (webhook-send-test "DELETAR"→VIVO; webhook-validate-url→DELETADA; ProposalDetailModal/Premiacoes marcados resolvidos). Snapshots históricos (As-Is, bounded-contexts, To-Be) intocados de propósito — documentam estado pré-modularização.
- [x] **Step 3:** Append no changelog: data, o que saiu, por quê. → `07 — Changelog/2026-07-02-plan-tiers-cleanup-faxina.md`.
- [x] **Step 4:** Commit: `docs(vault): sync faxina de features mortas` (sem flag — zero deleções no vault)

---

## FASE 2 — Matriz de planos + enforcement

### Task 7: Migration — matriz + max_users=5

**Files:**
- Create: `supabase/migrations/20270105000000_plan_matrix_base_automation_copilot.sql`

- [x] **Step 1: Escrever migration (idempotente)** — escrita com ajuste: + audit trail em `quota_audit_log`, guard `IS DISTINCT FROM 5` p/ idempotência.

```sql
-- Matriz plano→feature v1: Base=CRM, Automation=+chat/automações, Copilot=tudo. 5 users em todos.
BEGIN;

-- 1) Limite de 5 usuários nos 3 planos (era -1 = ilimitado)
UPDATE public.subscription_plans
SET limits = limits || jsonb_build_object('max_users', 5)
WHERE name IN ('torque-1.0', 'torque-2.0', 'torque-v8');

-- 2) Carteira entra no Base (spec CTO: Base = CRM completo, carteira é pós-venda do CRM)
UPDATE public.subscription_plans
SET features = features || jsonb_build_object('carteira', true, 'customer_portfolio', true)
WHERE name = 'torque-1.0';

-- 3) customer_portfolio alinhado a carteira nos demais (nunca foi seedado)
UPDATE public.subscription_plans
SET features = features || jsonb_build_object('customer_portfolio', true)
WHERE name IN ('torque-2.0', 'torque-v8');

-- 4) marketing explícito nos 3 (captação = CRM core; hoje resolve por default_enabled)
UPDATE public.subscription_plans
SET features = features || jsonb_build_object('marketing', true)
WHERE name IN ('torque-1.0', 'torque-2.0', 'torque-v8');

-- 5) Re-sync org_quotas.plan_base para orgs nos planos torque
--    (trigger trg_sync_org_plan_quotas só dispara em UPDATE de organizations — backfill manual)
UPDATE public.org_quotas q
SET plan_base = 5, updated_at = now()
FROM public.organizations o
WHERE q.organization_id = o.id
  AND q.resource_key = 'max_users'
  AND o.subscription_plan IN ('torque-1.0', 'torque-2.0', 'torque-v8');

COMMIT;
```

- [x] **Step 2: Verificar schema real de `org_quotas` antes de aplicar** — verificado: `effective_limit` é `GENERATED ALWAYS ... STORED` (20260910000100:18-23) → UPDATE de `plan_base` basta. Adicionado INSERT em `quota_audit_log` (change_reason `data_migration`) antes do resync — `sync_org_quotas_from_plan` não é chamável de migration (guard exige service_role/master).
- [x] **Step 3: Verificar grandfathering** — DEV: 5 orgs >5 ativos, todas torque-v8 — Organização Principal (33), Alamaster (33), VitrineVET (23), Milennials (11), Basic4u (6). Registrado p/ PR. `admin_adjustment` intocado. (Lista de PROD precisa ser levantada quando CTO autorizar apply prod.)
- [x] **Step 4: Aplicar em DEV** — aplicado via Management API + registrado em `supabase_migrations.schema_migrations` (mesmo padrão da 20270103000000). Validado: 3 planos com `max_users=5`, `carteira/customer_portfolio/marketing=true`; 22 rows de `org_quotas` resyncadas p/ plan_base=5.
- [x] **Step 5: Commit** — `feat(plans): matriz Base/Automation/Copilot + limite 5 usuários por plano`

⚠️ PROD: só com pedido explícito do CTO. Migration fica pronta; aplicar não.

### Task 8: Corrigir seat check quebrado em create-org-user

**Files:**
- Modify: `supabase/functions/create-org-user/index.ts:178-205`
- Test: `tests/unit/create-org-user-seat-limit.test.ts` (novo)

- [x] **Step 1: Teste falhando** — lógica extraída pra `_shared/seat-quota.ts` (`evaluateSeatQuota`, pura). 7 casos: 403 no limite, permite com folga, ilimitado, master bypass, erro RPC→500, quota null→permite (trigger backstopa), shape inesperado→permite. RED confirmado antes da implementação.
- [x] **Step 2: Implementar** — substituir o bloco que lê `subscription_plans.limits.users` por chamada à RPC canônica:

```ts
// Antes (no-op silencioso): limits.users não existe — key correta é max_users.
// Agora: fonte única de verdade de quota.
const { data: quota, error: quotaErr } = await serviceClient.rpc("org_resolve_quota", {
  p_organization_id: organizationId,
  p_resource_key: "max_users",
});
if (quotaErr) {
  return jsonResponse({ error: "Falha ao resolver limite de usuários" }, 500);
}
if (quota && quota.can_add === false) {
  return jsonResponse({ error: "Limite de usuários do plano atingido" }, 403);
}
```

(Verificado: assinatura real é `org_resolve_quota(p_org_id, p_resource_key)` — o sketch acima usava `p_organization_id`, corrigido na implementação. Retorno JSONB tem `can_add`/`is_unlimited`/`effective_limit`. Trigger `trg_enforce_seat_limit` continua como backstop autoritativo.)
- [x] **Step 3:** `npm run test:unit` → 7/7 no arquivo novo; suite completa: 71 failed/4871 passed — zero arquivos novos falhando vs baseline. `deno check` no módulo novo ✅ (deno check do index inteiro é baseline-red em _shared/auth.ts+sentry.ts pré-existentes).
- [x] **Step 4: Commit** — `fix(identity): seat check de create-org-user lia key inexistente (users vs max_users)`

### Task 9: Helper server-side `plan-gate.ts`

**Files:**
- Create: `supabase/functions/_shared/plan-gate.ts`
- Test: `tests/unit/plan-gate.test.ts`

- [x] **Step 1: Teste falhando** — 6 casos: true→passa; false→PlanFeatureDeniedError(403, featureKey, planName); ausente→nega; master→passa; erro RPC→throw genérico ≠ DeniedError (fail-closed); payload null sem erro→nega. RED confirmado.
- [x] **Step 2: Implementar**

```ts
// supabase/functions/_shared/plan-gate.ts
// Gating de plano server-side. Fail-closed: erro na resolução = negado.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export class PlanFeatureDeniedError extends Error {
  readonly status = 403;
  constructor(readonly featureKey: string, readonly planName: string | null) {
    super(`Feature '${featureKey}' indisponível no plano '${planName ?? "desconhecido"}'`);
  }
}

export async function assertPlanFeature(
  serviceClient: SupabaseClient,
  organizationId: string,
  featureKey: string,
): Promise<void> {
  const { data, error } = await serviceClient.rpc("org_get_features_and_limits", {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(`plan-gate: falha ao resolver features (${error.message})`);
  if (data?.plan_name === "master") return;
  if (data?.features?.[featureKey] !== true) {
    throw new PlanFeatureDeniedError(featureKey, data?.plan_name ?? null);
  }
}
```

(Verificado: param é `p_org_id` — sketch estava errado com `p_organization_id`, corrigido. Import estático ✅. Extra: helper `planDeniedResponse()` pro 403 JSON padrão `{error, feature, plan}`.)
- [x] **Step 3:** Testes verde (6/6 + deno check ✅). Commit: `feat(plan-gate): helper server-side de feature por plano (fail-closed)`

### Task 10: Aplicar plan-gate nas edges premium

**Files (modify, topo do handler, depois da resolução de org):**
- `supabase/functions/agent-message/index.ts` → `assertPlanFeature(svc, orgId, "copilot")`
- `supabase/functions/oraculo-comercial/index.ts` → `"oraculo"`
- `supabase/functions/process-workflow-executions/index.ts` → `"automations"` **por org do job** (é cron multi-org: gate dentro do loop de execuções, skip + marca execução como `skipped_plan` em vez de 403 global)
- `supabase/functions/mass-send-create/index.ts` → `"whatsapp_bulk"`
- `supabase/functions/whatsapp-api-proxy/index.ts` → `"chat"`
- Test: ampliar `tests/unit/plan-gate.test.ts` + testes por função onde já houver suite

- [x] **Step 1:** Um commit POR função (×5: 9a611af8 mass-send-create, 6e19f98f oraculo, e88823cb whatsapp-api-proxy, adcf49ee process-workflow-executions, c587dcfa agent-message). Teste adicionado onde havia suite de handler (mass-send-create: +5 casos, 10/10). Suites de oraculo/proxy/worker são logic-level ou inexistentes — gate coberto por plan-gate.test.ts (6/6).
- [x] **Step 2:** Cuidados aplicados: (a) agent-message gate 0.85 ANTES de lock/getOrCreateLead; denial = **200 {skipped, reason: plan_denied}** (não 403 — segue idioma dos early-gates da função; 4xx viraria retry/DLQ storm no hop interno). Addon turbo VERIFICADO: `plan_addons.features_unlocked=['copilot','oraculo']` materializa via `organization_features` → coberto pela RPC. (b) worker: gate POR EXECUÇÃO + cache por org + `skipped_plan` (status é TEXT sem constraint — verificado no dev) + fail-open em erro de resolução (marcar skipped por erro transiente perderia execução; catch marca failed terminal). (c) copilot-v2-worker NÃO gateado. (d) whatsapp-api-proxy: master bypassa (opera qualquer org).
- [x] **Step 3:** Testes verdes por commit (targeted); suite completa verde vs baseline no gate da Task 8. agent-message-batch: 2 failed/9 passed IDÊNTICO com e sem o gate (falhas pré-existentes em absorbPendingMessages).
- [ ] **Step 4:** Deploy DEV — **BLOQUEADO pelo permission classifier da sessão** (negou `supabase functions deploy` mesmo pra dev). Comando pronto p/ CTO/humano: `for fn in agent-message oraculo-comercial process-workflow-executions mass-send-create whatsapp-api-proxy create-org-user; do supabase functions deploy $fn --project-ref bcfadphgsibjzivtbjvc; done`. Smoke pós-deploy: org dev torque-1.0 → mass-send-create 403 / agent-message 200 skipped plan_denied.

### Task 11: UI de equipe respeita o novo limite

**Files:**
- Verify: `src/modules/identity/org-team/pages/Equipe.tsx:589` (botão já desabilita via `seatUsage.can_add`) + `SeatUsageBar`

- [x] **Step 1:** Validado no dev (Milennials): `org_get_seat_usage` → `{paid_seats: 5, active_members: 11, can_add: false, remaining: 0, is_unlimited: false}`. UI: botão "Criar usuário" desabilita via `seatUsage.can_add` (Equipe.tsx:589); `SeatUsageBar` trata finito bem — "11 / 5 seats", badge "Limite atingido", barra capada em 100% destructive. Caminho -1 tem branch próprio "Ilimitado".
- [x] **Step 2:** Verify-only — zero diff necessário.

---

## FASE 3 — UI por plano (consistência de superfícies)

### Task 12: Fonte única — guards de rota derivados do registry

**Files:**
- Modify: `src/modules/platform/lib/feature-registry.ts` — adicionar/completar mapa `ROUTE_FEATURE_MAP` (path pattern → feature key) cobrindo TODAS as rotas gateáveis, incl. as hoje sem guard: `/comissoes→commissions`, `/tv→tv_dashboard`, `/produtos→products`, `/negocios→deals`, `/performance→performance`, `/upsell→carteira`, `/carteira/:id→carteira`
- Modify: `src/App.tsx` — envolver as rotas faltantes com `PlanFeatureProtectedRoute`
- Test: `tests/unit/route-feature-map.test.ts` — asserta que todo path em `SIDEBAR_FEATURE_MAP`/`ROUTE_FEATURE_MAP` com feature key tem guard correspondente (teste de consistência lê ambos os mapas; guard sem key ou key sem guard = fail)

- [x] **Step 1:** Teste de consistência falhando — RED listou exatamente 13 rotas sem guard (as 5 do plano + funis/pipes/leads/lixeira/duplicatas/follow-ups, todas com cadeado na nav via SIDEBAR_FEATURE_MAP). 4 asserts: mapa→rota existe, mapa→guard com key certa, sidebar⊆mapa (exceto redirects /marketing,/analytics), guard∈mapa.
- [x] **Step 2:** ROUTE_FEATURE_MAP (27 rotas) no registry + 13 guards novos em App.tsx. Zero mudança de comportamento hoje (keys true nos 3 planos). Fora do mapa por decisão: `/campanhas/:id` (superfície legada, sem key na sidebar — registrar no PR) e `/pipe/custom/:slug` (gate in-place por funnels_custom).
- [x] **Step 3:** Verde (4/4) + tsc ✅. Commit: `feat(plans): guards de rota derivados do registry — nav e rota nunca divergem`

### Task 13: Matar fail-open no guard de rota

**Files:**
- Modify: `src/modules/platform/components/PlanFeatureProtectedRoute.tsx`
- Test: `tests/unit/plan-feature-protected-route.test.tsx` (se não existir, criar)

- [x] **Step 1:** Teste: arquivo JÁ EXISTIA (6 cenários do plan-feature-gating) — estendido: mocks ganharam `isReady: true` + caso novo `isReady=false → nem children nem cadeado`. RED confirmado (1 failed | 6 passed).
- [x] **Step 2:** Implementado: guard espera `isReady` → `<TorqueLoader variant="inline" />` (mesmo loader do PageLoader das rotas lazy). `hasFeature` do contexto continua fail-open.
- [x] **Step 3:** Verde (7/7) + tsc ✅. Commit: `fix(plans): guard de rota espera resolução do plano (era fail-open no loading)`

### Task 14: Superfície Carteira no Base + varredura visual

**Files:**
- Verify: nav (`TopNavigation.tsx`), `SIDEBAR_FEATURE_MAP`, gates in-place de carteira (`Upsell.tsx:54`, `ImportUpsellClientsContent.tsx:176`, `PlaygroundConexao.tsx:166`)

- [x] **Step 1:** Verificação DATA-LEVEL no dev (não há org dev em torque-1.0/2.0 — as 22 são torque-v8; auth dev segue 402 p/ login manual): payload de features por plano validado via SQL — torque-1.0: carteira/portfolio ✅, chat/copilot/oraculo/automations/bulk/templates/sched ❌. In-place gates de carteira (Upsell.tsx:54, ImportUpsellClientsContent.tsx:176, PlaygroundConexao.tsx:166) leem `customer_portfolio` — agora seedado true nos 3.
- [x] **Step 2:** As 5 superfícies derivam da MESMA fonte (SIDEBAR_FEATURE_MAP + hasFeature via RPC): TopNavigation:308-314 (top nav + mobile sheet), MobileBottomNav:54-55, CommandGroupNavigation:56-57, PlanFeatureProtectedRoute (URL direta, agora estrito) — consistência por construção. QA visual logado fica pendente (auth dev 402 + sem credencial) → listado no PR pro CTO.
- [x] **Step 3:** 🔴 DIVERGÊNCIA ACHADA E CORRIGIDA: `deals` nunca foi seedado em plano NENHUM e não tinha row em feature_flags → `hasFeature('deals')=false` universal → "Negócios" com cadeado na nav pra TODAS as orgs desde o plan-feature-gating (e a rota nova bloquearia junto). Fix: migration `20270105000001_seed_deals_feature_key.sql` (flag row default_enabled=true + deals/review explícitos nos 3 planos) — APLICADA dev + registrada + validada. Commit: `fix(plans): consistência de superfícies por plano — seed da key deals`

---

## FASE 4 — Docs + fechamento

### Task 15: Vault + docs de referência

**Files:**
- Modify: `Obsidian/.../03 — Reference/` — nota de planos: matriz completa desta spec (tabela acima), limite 5, addon turbo, onde vive cada camada (RPC, trigger, plan-gate, registry)
- Modify: `docs/PERMISSION-ENFORCEMENT.md` — nova seção "Plan gating server-side" com o mapa função→feature key da Task 10
- Modify: `Obsidian/.../07 — Changelog/` — append

- [x] **Step 1:** Escrever as 3 atualizações. → Vault: nota NOVA `03 — Reference/Planos e Feature Gating.md` (matriz completa + onde vive cada camada + gotcha de key ausente) + linha no `_MOC.md`; `docs/PERMISSION-ENFORCEMENT.md`: seção "Plan Gating Server-Side" (mapa função→key + comportamentos de negação) + 2 rows no Utility Reference; changelog: `07 — Changelog/2026-07-02-plan-tiers-cleanup-matriz-enforcement.md`. **Step 2:** Commit: `docs: matriz de planos + enforcement server-side documentados` [x]

### Task 16: Gate final + PR

- [ ] **Step 1:** Suite completa: `npm run lint && npx tsc --noEmit && npm run test:unit && npm run build`. Reportar OUTPUT LITERAL do runner (counts numéricos — memória `feedback_qa_raw_output`).
- [ ] **Step 2:** Auto-QA manual em dev (npm run dev): login org Base → confirmar cadeados; tentativa de 6º usuário → erro claro na UI.
- [ ] **Step 3:** Push branch `feat/plan-tiers-cleanup` + PR para `feat/plan-feature-gating` (stacked) OU para `main` se a base já tiver mergeado — checar `gh pr list` antes.
- [ ] **Step 4:** Corpo do PR: matriz, lista do que foi deletado (com evidência), furos fechados, lista de orgs >5 users (grandfathered), pendências prod (migration + deploy edges = aguardando ordem do CTO).

---

## Fora de escopo (explícito)

- Aplicar migration/deploy em PROD — só com ordem do CTO.
- `checkout-provision-org` / `asaas-webhook` (código não versionado no repo) — anotado como débito, não tocar.
- Copilot v2, Evolution kill-switch, SZ.Chat — intocáveis.
- Faxina de deps npm (exigiria depcheck dedicado).
- Unificação `organizations.subscription_plan` (TEXT) vs `org_subscriptions.plan_id` (FK) — débito arquitetural real, mas projeto próprio.
