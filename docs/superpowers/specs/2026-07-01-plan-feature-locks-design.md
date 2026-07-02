# Cadeados de feature por plano — Design

**Data:** 2026-07-01
**Branch:** `feat/plan-feature-locks`
**Autor:** CTO (Gabriel) + Claude

## Problema

O gating de features por plano existe parcialmente e de forma inconsistente:

- **Sidebar** já tranca módulos (`TopNavigation.isLocked` + `<Lock>` âmbar + `UpgradeModal`), mas é a única superfície coberta.
- **Bypass por URL** — navegar direto para `/copilot` carrega a página sem cadeado. Não existe route guard por feature.
- **In-page inconsistente** — 16 arquivos chamam `useOrgFeatures().hasFeature()` inline, cada um com tratamento próprio (botão de disparo em massa, cadastro externo, etc.).
- **`UpgradeModal` stale** — `PLAN_LABELS` só conhece planos legados (`free/starter/pro/enterprise`), não os planos ativos (Torque Base/Automation/Copilot). Não diz qual plano desbloqueia. CTA com número WhatsApp fake `5511999999999`.
- **Zero enforcement server-side** — features são advisory no frontend; requests diretos à RPC/edge function passam.

## Objetivo

Um padrão único de cadeado, com `hasFeature` como fonte de verdade, aplicado em **3 superfícies** (nav, rota, in-page) + **backstop server-side** nos writes que geram custo. Org sem a feature: label visível com cadeado após o texto, click bloqueado → upsell, e a página nem carrega via URL direta.

## Não-objetivo (fora deste ciclo)

- Página de planos completa org-facing (aba "Plano" rica em Configurações) — fica para slice seguinte. Neste ciclo o `UpgradeModal` v2 é o "mini plans view".
- Checkout self-serve / wiring de `org_subscriptions` (tabela hoje vazia).
- Enforcement server-side exaustivo nas 78 edge functions — só os pontos que queimam dinheiro.

## Arquitetura

### 1. Fonte de verdade — mapa `feature → plano mínimo`

Derivado de `subscription_plans.features` (jsonb), **sem hardcode**. Para cada `FeatureKey`, o plano ativo mais barato (menor `position`, `is_active = true`) cujo `features[key] === true` é o plano que desbloqueia aquela feature.

`OrgFeaturesContext` passa a buscar também a lista de planos ativos (uma query extra, cacheada 5 min junto do resto) e expõe:

```ts
featureUnlockPlan: Record<FeatureKey, { name: string; display_name: string } | null>
```

`null` = nenhum plano ativo oferece a feature (não deveria acontecer; trata como "fale com comercial").

Plano novo ou feature nova refletem automaticamente — a matriz vem do DB.

### 2. `<FeatureLock>` — componente reusável (novo, em `platform`)

Localização: `src/modules/platform/components/feature-lock/FeatureLock.tsx` (re-exportado no barrel do módulo).

```tsx
<FeatureLock feature="copilot" variant="inline">Copilot</FeatureLock>
<FeatureLock feature="whatsapp_bulk" variant="wrapper"><Button>Disparar</Button></FeatureLock>
```

Comportamento:
- `hasFeature(feature) === true` → renderiza `children` sem alteração (custo zero).
- Locked:
  - `inline` — renderiza `children` (o label) + `<Lock className="text-amber-500">` após o texto.
  - `wrapper` — envolve o elemento; aplica `aria-disabled`, `cursor-not-allowed`, `pointer-events-none` no filho, adiciona badge de cadeado.
  - `iconOnly` — só o cadeado.
  - `onClickCapture` intercepta **antes** do handler interno → abre `UpgradeModal` com o `feature` + `featureUnlockPlan[feature]`.
- Enquanto `!isReady` (features carregando) → renderiza `children` sem lock (evita flash de cadeado). Mesmo guard que o `hasFeature` já usa.

Substitui:
- A lógica ad-hoc dos 16 arquivos que chamam `hasFeature` inline (migração incremental — os críticos neste ciclo, resto marcado como follow-up).
- `TopNavigation.isLocked` + render manual de `<Lock>` → passa a consumir `<FeatureLock variant="inline">`.

### 3. Route guard — `<FeatureRoute>` (novo)

Localização: `src/modules/platform/components/feature-lock/FeatureRoute.tsx`.

Envolve as rotas lazy em `App.tsx`:

```tsx
<Route path="/copilot" element={<FeatureRoute feature="copilot"><Copilot /></FeatureRoute>} />
```

- Resolve a feature via prop explícita (preferido) ou fallback `SIDEBAR_FEATURE_MAP[path]`.
- `hasFeature` true → renderiza o módulo.
- Locked → renderiza `<FeatureLockedScreen feature=... />` (tela cheia de upgrade: nome da feature, plano-alvo, o que inclui, CTA). **Fecha o bypass de URL.**
- `!isReady` → loader (mesmo componente de loading das rotas lazy). Não bloqueia até saber.

Rotas a proteger (via `SIDEBAR_FEATURE_MAP` já existente): `/copilot`, `/chat-whatsapp`, `/upsell`, `/analytics`, `/templates`, `/marketing`, `/negocios`, `/tv`, pipes de funil, etc.

### 4. `UpgradeModal` v2 (reescreve o atual)

- `PLAN_LABELS` removido; nome do plano-alvo vem de `featureUnlockPlan[feature].display_name` (deriva do DB).
- Copy: "**{featureLabel}** está disponível no plano **{plano-alvo}**." + lista do que mais o plano-alvo inclui (features do plano-alvo, via `FEATURES` + `plans.features`).
- Mostra o plano atual da org (`planName` → display_name).
- CTA único → contato comercial configurável (`VITE_UPGRADE_CONTACT_URL`, fallback para a página de planos quando existir). Sem número hardcoded.

### 5. Server backstop — `org_has_feature(p_org_id uuid, p_feature_key text) → boolean`

Migration nova. Função `SECURITY DEFINER` com `search_path` pinado (`public, extensions` — classe dos 58 definers, ver memory `project_definer_search_path_hardening`). Lê o plano da org e o `features` jsonb; retorna `features[p_feature_key] === true`.

Guard no topo dos writes que queimam dinheiro (retorna 403 `feature_locked`):
- criar agente copilot (`copilot`)
- disparo em massa (`whatsapp_bulk`)
- cadastro externo (`external_cadastro`)
- criar funil custom/temporário (`funnels_custom` / templates)
- message templates (`message_templates`)

`org_id` **sempre** do contexto autenticado, nunca do payload do client.

### 6. Testes

- `feature-unlock-map` — deriva plano mínimo correto de uma matriz de planos (Base/Automation/Copilot).
- `FeatureLock` — renderiza locked vs unlocked; intercepta click quando locked; não trava durante `!isReady`.
- `FeatureRoute` — renderiza módulo quando unlocked, `FeatureLockedScreen` quando locked, loader quando `!isReady`.
- `org_has_feature` — matriz plano × feature (integration/RLS): org em Base não tem `copilot`; org em Copilot tem tudo; org sem plano → false.

## Superfícies afetadas

| Arquivo | Mudança |
|---|---|
| `src/contexts/OrgFeaturesContext.tsx` | + fetch planos ativos, + `featureUnlockPlan` |
| `src/modules/platform/components/feature-lock/*` | **novo** — `FeatureLock`, `FeatureRoute`, `FeatureLockedScreen` |
| `src/modules/platform/lib/feature-registry.ts` | helper de derivação do plano mínimo |
| `src/modules/platform/index.ts` | export dos novos componentes |
| `src/shared/components/UpgradeModal.tsx` | reescrita v2 |
| `src/modules/platform/components/layout/TopNavigation.tsx` | consome `<FeatureLock>` no lugar da lógica manual |
| `src/App.tsx` | envolve rotas gated em `<FeatureRoute>` |
| Edge functions/RPCs dos ~6 writes caros | guard `org_has_feature` |
| `supabase/migrations/…_org_has_feature.sql` | **nova** função definer |

## Segurança

- Multi-tenant: `org_id` do auth, nunca do client, em toda camada.
- `org_has_feature` definer com `search_path` pinado.
- Frontend é UX/upsell; o backstop server-side é o que impede abuso real nos vetores de custo.

## Riscos / gotchas

- **Flash de cadeado** — sem o guard `!isReady`, o usuário veria tudo travado no primeiro paint. Guard obrigatório em `FeatureLock` e `FeatureRoute`.
- **Migração incremental dos 16 call-sites** — só os críticos neste ciclo; resto documentado como follow-up para não inflar o PR.
- **`useFeatureFlag` ≠ `hasFeature`** — feature flags de rollout são um sistema separado; não confundir. Este trabalho é só plan-gating.
