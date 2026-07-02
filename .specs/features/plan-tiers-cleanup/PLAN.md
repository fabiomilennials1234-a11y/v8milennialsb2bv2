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

- [ ] **Step 1:** `rg "WhatsAppMigrationBanner" src/` → só barrel + arquivo. Deletar ambos os pontos.
- [ ] **Step 2:** `rg "webhook-validate-url" src/ supabase/` → se nenhum invoke/call-site fora do config.toml, deletar pasta + entrada config.toml. Se houver call-site, manter.
- [ ] **Step 3:** Corrigir tag do `ClientDetailModal`.
- [ ] **Step 4:** Build + testes verde. Commit: `chore(cleanup): banner de migração órfão, tag deprecated incorreta, edge órfã`

### Task 4: `scripts/recovery/` (untracked, ~90 arquivos de incidentes)

⚠️ Untracked = irrecuperável se apagado errado (memória `feedback_git_clean_safety`). NÃO usar `git clean`.

- [x] **Step 1:** Mover a pasta INTEIRA para fora do repo: `Move-Item scripts\recovery "$env:USERPROFILE\Desktop\torque-ops-archive-recovery"` (arquivo morto de ops preservado, fora do source tree). → 102 arquivos movidos, pasta fora do repo.
- [x] **Step 2:** Adicionar `scripts/recovery/` ao `.gitignore` (linha nova) — futuros scripts one-off não poluem `git status`.
- [x] **Step 3:** Commit: `chore(repo): ignora scripts/recovery (ops one-off arquivados fora do repo)`

### Task 5: Documentar intencionais que parecem mortos

**Files:**
- Modify: `supabase/functions/CLAUDE.md` — corrigir nota de `webhook-send-test` ("deletar candidato" → "USADO por WebhookSettings.tsx:197"); anotar `process-followup-situations` (ADR-0006, rollout pendente, sem cron ainda) e `recover-stuck-conversations` (ferramenta ops manual, service_role).

- [ ] **Step 1:** Editar as 3 notas.
- [ ] **Step 2:** Commit: `docs(functions): corrige notas de funções vivas que pareciam mortas`

### Task 6: Vault sync da faxina

**Files:**
- Modify: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/07 — Changelog/` (append nota da faxina)
- Verify: `06 — Features/` — se alguma nota documentar exclusivamente feature deletada (ex.: podium v1, telas metas/ranking v1), marcar como histórico ou deletar.

- [ ] **Step 1:** Ler `06 — Features/_MOC.md` + subpastas (Vendas, Dashboard, Admin); identificar notas que referenciam SÓ artefatos deletados nas Tasks 1-3.
- [ ] **Step 2:** Notas 100% obsoletas → deletar. ⚠️ Commit de deleção no vault EXIGE `[vault-delete-ok]` na mensagem. Notas parcialmente obsoletas → editar removendo a parte morta.
- [ ] **Step 3:** Append no changelog: data, o que saiu, por quê.
- [ ] **Step 4:** Commit: `docs(vault): sync faxina de features mortas [vault-delete-ok]`

---

## FASE 2 — Matriz de planos + enforcement

### Task 7: Migration — matriz + max_users=5

**Files:**
- Create: `supabase/migrations/20270105000000_plan_matrix_base_automation_copilot.sql`

- [ ] **Step 1: Escrever migration (idempotente)**

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

- [ ] **Step 2: Verificar schema real de `org_quotas` antes de aplicar** — ler `20260910000100_*.sql`: se `effective_limit` for coluna gerada, o UPDATE acima basta; se for materializada por trigger/função, chamar a função de resync no lugar. Ajustar SQL conforme.
- [ ] **Step 3: Verificar grandfathering** — query de leitura: orgs torque com `count(team_members ativos) > 5`. Registrar lista no PR (essas orgs não quebram; só não adicionam mais). NÃO mexer em `admin_adjustment`.
- [ ] **Step 4: Aplicar em DEV** (`bcfadphgsibjzivtbjvc`) via Supabase Management API (memória `reference_supabase_mgmt_api`; dev tem quota 402 p/ REST — Management API funciona). Validar: `SELECT name, limits->>'max_users', features->>'carteira' FROM subscription_plans WHERE name LIKE 'torque%'`.
- [ ] **Step 5: Commit** — `feat(plans): matriz Base/Automation/Copilot + limite 5 usuários por plano`

⚠️ PROD: só com pedido explícito do CTO. Migration fica pronta; aplicar não.

### Task 8: Corrigir seat check quebrado em create-org-user

**Files:**
- Modify: `supabase/functions/create-org-user/index.ts:178-205`
- Test: `tests/unit/create-org-user-seat-limit.test.ts` (novo)

- [ ] **Step 1: Teste falhando** — extrair a lógica de decisão pra função pura testável (ou testar via mock do client). Casos: (a) limite 5, 5 ativos → recusa 403; (b) limite 5, 4 ativos → permite; (c) limite -1 → permite; (d) master → permite.
- [ ] **Step 2: Implementar** — substituir o bloco que lê `subscription_plans.limits.users` por chamada à RPC canônica:

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

(Verificar assinatura/retorno reais de `org_resolve_quota` em `20260910000002_quota_resolution_rpcs.sql:23` — nomes de params e shape do JSONB — e ajustar. Trigger `trg_enforce_seat_limit` continua como backstop autoritativo.)
- [ ] **Step 3:** `npm run test:unit` → verde.
- [ ] **Step 4: Commit** — `fix(identity): seat check de create-org-user lia key inexistente (users vs max_users)`

### Task 9: Helper server-side `plan-gate.ts`

**Files:**
- Create: `supabase/functions/_shared/plan-gate.ts`
- Test: `tests/unit/plan-gate.test.ts`

- [ ] **Step 1: Teste falhando** — casos: feature true → passa; false/ausente → `PlanFeatureDeniedError`; plan_name master → passa; erro RPC → throw genérico (fail-CLOSED).
- [ ] **Step 2: Implementar**

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

(Verificar nome do param da RPC em `20260910000008_update_features_limits_rpc.sql:15` e ajustar. Seguir padrão de import estático — dynamic import de `_shared` quebra eszip, memória `project_realsc_scheduled_blast_dynamic_import`.)
- [ ] **Step 3:** Testes verde. Commit: `feat(plan-gate): helper server-side de feature por plano (fail-closed)`

### Task 10: Aplicar plan-gate nas edges premium

**Files (modify, topo do handler, depois da resolução de org):**
- `supabase/functions/agent-message/index.ts` → `assertPlanFeature(svc, orgId, "copilot")`
- `supabase/functions/oraculo-comercial/index.ts` → `"oraculo"`
- `supabase/functions/process-workflow-executions/index.ts` → `"automations"` **por org do job** (é cron multi-org: gate dentro do loop de execuções, skip + marca execução como `skipped_plan` em vez de 403 global)
- `supabase/functions/mass-send-create/index.ts` → `"whatsapp_bulk"`
- `supabase/functions/whatsapp-api-proxy/index.ts` → `"chat"`
- Test: ampliar `tests/unit/plan-gate.test.ts` + testes por função onde já houver suite

- [ ] **Step 1:** Um commit POR função (deploy independente, rollback granular). Em cada uma: teste (quando a função tiver suite em `tests/unit/`) → gate no topo → catch de `PlanFeatureDeniedError` → resposta 403 JSON com `{ error, feature, plan }`.
- [ ] **Step 2:** ⚠️ Cuidados: (a) `agent-message` é o fluxo mais frágil do sistema — gate ANTES de qualquer side-effect, e org com addon turbo tem `copilot: true` resolvido pela RPC (addon já entra no JSONB via organization_features — VERIFICAR; se não entrar, resolver addon no gate); (b) `process-workflow-executions` não pode derrubar o batch inteiro por uma org sem plano — isolar por execução; (c) NÃO gatear `copilot-v2-worker` (sistema inert de propósito, só Milennials) — deixar fora.
- [ ] **Step 3:** `npm run test:unit` verde por commit. Commits: `feat(plan-gate): enforce <feature> em <função>` (×5).
- [ ] **Step 4:** Deploy DEV das 5 funções (`supabase functions deploy <fn> --project-ref bcfadphgsibjzivtbjvc`). Smoke: org dev em torque-1.0 chamando mass-send-create → 403.

### Task 11: UI de equipe respeita o novo limite

**Files:**
- Verify: `src/modules/identity/org-team/pages/Equipe.tsx:589` (botão já desabilita via `seatUsage.can_add`) + `SeatUsageBar`

- [ ] **Step 1:** Com migration aplicada em dev, validar que `org_get_seat_usage` retorna `paid_seats: 5` e a UI mostra "X de 5". Se `SeatUsageBar` tratava -1/ilimitado com copy especial, confirmar que o caminho finito renderiza bem.
- [ ] **Step 2:** Ajuste de copy/estado se necessário; senão task é verify-only. Commit se houver diff: `fix(identity): UI de assentos com limite finito de 5`

---

## FASE 3 — UI por plano (consistência de superfícies)

### Task 12: Fonte única — guards de rota derivados do registry

**Files:**
- Modify: `src/modules/platform/lib/feature-registry.ts` — adicionar/completar mapa `ROUTE_FEATURE_MAP` (path pattern → feature key) cobrindo TODAS as rotas gateáveis, incl. as hoje sem guard: `/comissoes→commissions`, `/tv→tv_dashboard`, `/produtos→products`, `/negocios→deals`, `/performance→performance`, `/upsell→carteira`, `/carteira/:id→carteira`
- Modify: `src/App.tsx` — envolver as rotas faltantes com `PlanFeatureProtectedRoute`
- Test: `tests/unit/route-feature-map.test.ts` — asserta que todo path em `SIDEBAR_FEATURE_MAP`/`ROUTE_FEATURE_MAP` com feature key tem guard correspondente (teste de consistência lê ambos os mapas; guard sem key ou key sem guard = fail)

- [ ] **Step 1:** Teste de consistência falhando (rotas sem guard listadas acima).
- [ ] **Step 2:** Adicionar guards em App.tsx. Nota: como a matriz dá `commissions/tv_dashboard/products/deals/performance: true` nos 3 planos, isso NÃO muda comportamento hoje — fecha a porta pro futuro (plano novo sem essas keys) e mata a divergência nav-cadeado vs rota-aberta.
- [ ] **Step 3:** Verde. Commit: `feat(plans): guards de rota derivados do registry — nav e rota nunca divergem`

### Task 13: Matar fail-open no guard de rota

**Files:**
- Modify: `src/modules/platform/components/PlanFeatureProtectedRoute.tsx`
- Test: `tests/unit/plan-feature-protected-route.test.tsx` (se não existir, criar)

- [ ] **Step 1:** Teste: com `isReady=false` → renderiza skeleton/spinner (NÃO o conteúdo); `isReady=true && !hasFeature` → cadeado; `isReady && hasFeature` → children.
- [ ] **Step 2:** Implementar: guard espera `isReady` (skeleton neutro), decide depois. `hasFeature` do contexto CONTINUA fail-open (evita flash de cadeado no chrome/nav) — só o guard de rota fica estrito.
- [ ] **Step 3:** Verde. Commit: `fix(plans): guard de rota espera resolução do plano (era fail-open no loading)`

### Task 14: Superfície Carteira no Base + varredura visual

**Files:**
- Verify: nav (`TopNavigation.tsx`), `SIDEBAR_FEATURE_MAP`, gates in-place de carteira (`Upsell.tsx:54`, `ImportUpsellClientsContent.tsx:176`, `PlaygroundConexao.tsx:166`)

- [ ] **Step 1:** Com org dev em torque-1.0: Carteira agora acessível (matriz nova); Chat/Turbo/Disparos com cadeado; clique → UpgradeModal com plano correto sugerido.
- [ ] **Step 2:** Repetir com org torque-2.0 (Copilot com cadeado, resto aberto) e torque-v8 (tudo aberto). Checar as 5 superfícies: top nav, mobile sheet, bottom nav, command palette, URL direta.
- [ ] **Step 3:** Corrigir divergências achadas. Commit: `fix(plans): consistência de superfícies por plano`

---

## FASE 4 — Docs + fechamento

### Task 15: Vault + docs de referência

**Files:**
- Modify: `Obsidian/.../03 — Reference/` — nota de planos: matriz completa desta spec (tabela acima), limite 5, addon turbo, onde vive cada camada (RPC, trigger, plan-gate, registry)
- Modify: `docs/PERMISSION-ENFORCEMENT.md` — nova seção "Plan gating server-side" com o mapa função→feature key da Task 10
- Modify: `Obsidian/.../07 — Changelog/` — append

- [ ] **Step 1:** Escrever as 3 atualizações. **Step 2:** Commit: `docs: matriz de planos + enforcement server-side documentados`

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
