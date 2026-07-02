---
type: changelog
title: 2026-06-26 — Build fix — decouple OnboardingHub não-shipado de App.tsx (desbloqueia deploy) + commit dos arquivos faltantes
status: shipped
created: 2026-06-26
updated: 2026-06-26
tags: [build, ci, deploy, onboarding, insights, ghcr]
related: ["[[2026-06-25]]"]
owner: CTO (Gabriel)
---

# 2026-06-26 — Build fix — decouple OnboardingHub não-shipado de App.tsx

## Contexto

A feature master de unit economics (`/insights`) foi mergeada em `main` no PR
**#916** (`f5c42f2f`). No mesmo squash, o roteamento do **Onboarding Hub** foi
varrido pra dentro de `src/App.tsx` (imports `lazy` + rotas `/onboarding` e
`/onboarding-preview`) — **mas os arquivos de página/componente/lib referenciados
nunca foram commitados** (ficaram untracked no disco do CTO).

Resultado: `main` buildava localmente (arquivo no disco) mas o **`npm run build`
do CI quebrava** com `ENOENT` em `@/modules/platform/pages/OnboardingHub` →
job **Build Image** (push `main` → imagem `ghcr` `:latest`) falhava → `:latest`
**congelado** → **a tela Insights (e todo commit desde #916) nunca chegou em
produção**.

## Mudanças

- **Decouple-first (#918, `8cae494c`)**: remove de `src/App.tsx` os dois imports
  `lazy` pendentes (`OnboardingHubPage`, `OnboardingHubPreview`) + a rota
  protegida `/onboarding` + a rota DEV-only `/onboarding-preview`. Nada navegava
  pra essas rotas ainda. `main` volta a buildar verde → **Build Image GREEN** →
  `:latest` reconstruído **com Insights** e pushado. Diff: `−16` linhas, só
  `App.tsx`.
- **Commit dos arquivos faltantes (#917, `35761aa4`)**: traz pro repo os 4
  arquivos que o #916 referenciava mas deixou untracked (`+521` linhas). Resolve
  os imports pendentes pra quando o Onboarding Hub for plugado de volta. **Não
  restaura** o roteamento em `App.tsx` (segue pendente o join futuro).

## Arquivos tocados

**#918 (`8cae494c`) — decouple:**
- `src/App.tsx` — remove imports `lazy` `OnboardingHubPage`/`OnboardingHubPreview`
  + rotas `/onboarding` (ProtectedRoute + LayoutWrapper) e `/onboarding-preview`
  (gated em `import.meta.env.DEV`).

**#917 (`35761aa4`) — commit dos 4 arquivos:**
- `src/modules/platform/components/onboarding/OnboardingHub.tsx` — **novo** (313 linhas).
- `src/modules/platform/lib/onboarding-steps.ts` — **novo** (118 linhas).
- `src/modules/platform/pages/OnboardingHub.tsx` — **novo** (29 linhas).
- `src/modules/platform/pages/OnboardingHubPreview.tsx` — **novo** (61 linhas).

## Ordem dos eventos (mesmo dia)

1. `8cae494c` (#918, 09:06) — merge do decouple em `main` → Build Image verde →
   `:latest` reconstruído com Insights.
2. `35761aa4` (#917, 11:12) — merge dos 4 arquivos faltantes em `main`.

(Commits de branch pré-merge: `a1a127c8` do #918, `eca4ea65` do #917.)

## Decisões

- **Decouple antes de juntar o Onboarding** (decisão CTO): em vez de esperar o
  Onboarding Hub estar pronto, remover já os refs pendentes do `App.tsx`
  desbloqueia o deploy do Insights na hora. O Hub entra depois com o roteamento
  do `App.tsx` restaurado.
- **#917 separado**: os 4 arquivos ficam versionados no repo (deixam de ser
  untracked), mas o roteamento só volta quando o Onboarding Hub for plugado de
  fato — evita reintroduzir rota morta em `main`.

## Impacto

- **`:latest` descongelado** → tela master **`/insights` (unit economics) e todo
  commit desde #916** voltam a ser deployáveis em prod (pull `:latest` no
  EasyPanel, manual).
- Build do CI (`npm run build`) volta a refletir a verdade do repo — some o gap
  "passa local, quebra no CI" que vinha de arquivo untracked.

## Follow-ups

- **Join do Onboarding Hub**: restaurar imports `lazy` + rotas `/onboarding` e
  `/onboarding-preview` em `App.tsx` quando o Hub for ativado (os 4 arquivos já
  estão no repo via #917).
- Lembrete operacional: deploy do frontend é **manual** (CTO puxa `:latest` no
  EasyPanel) — merge em `main` só reconstrói a imagem `ghcr`.
