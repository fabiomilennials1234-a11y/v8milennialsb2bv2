---
status: planejado
owner: arquiteto
tipo: fase-execucao
fase: 9
criado: 2026-05-28
atualizado: 2026-05-29
estimate: 10-16h
decisao_alt: B
decidido_em: 2026-05-28
decidido_por: CTO (via inventario 9.1)
pre_requisitos:
  - "[[fase-8-pipelines-re-deepen]] mergeada"
  - "Pattern de deepening validado em pipelines"
  - "Develop estável ≥ 7 dias pós-Fase-8"
habilita:
  - "Onboarding mais limpo + auth desacoplada"
relacionados:
  - "[[inventario-identity]]"
  - "[[_INDEX]]"
---

# Fase 9 — `identity` split em sub-BCs

**Branch base:** `develop`
**Target PR:** `develop`
**Estimate:** 10-16h em 3-5 slices/PRs
**🟠 Área frágil — risco mais alto deste roadmap**

## Problema

`src/modules/identity/` métricas atuais:
- 66 arquivos / 44 exports = **1.50 files-per-export — shallow**
- 5 sub-domínios distintos misturados:
  - **Auth** (login, signup, reset, sessions) — Supabase Auth
  - **Role** (admin/master/membro) — discriminador
  - **Permissions** (3 camadas: master → admin → feature → role) — área frágil 🟠
  - **Master ops** (super-admin transversal a orgs)
  - **Org + Team** (org switching, team members, profiles)
- Hotfix #530 (stale `useMasterOperations` export) é sintoma — barrel grande perde sincronia
- Auth e Permissões são áreas frágeis 🟠 no CLAUDE.md raiz

## Tese de deepening

**Decisão Slice 9.1 (2026-05-28): Alternativa B** — re-deepen interno preservando 1 BC `identity`.

Ver [[inventario-identity]] — 44 export statements, 114 símbolos, 396 sites consumers, 25 símbolos com reach externo, 89 (78%) símbolos sem consumer cross-module. Alt B preserva 396 sites inalterados; Alt A teria que migrar todos. Pattern Fase 8 já validado. Promoção a Alt A (split em 4 BCs físicos) avaliada na Fase 10 se `master/` provar-se autônomo pós-9.4.

Alternativas originais documentadas abaixo para histórico.

### Alternativa A — Split em 4 BCs autônomos (mais radical)

```
src/modules/
├── auth/                     # signin/signup/reset/session
│   ├── hooks/                # useAuth, useSession
│   ├── components/           # ProtectedRoute, AuthContext
│   ├── lib/
│   ├── index.ts              # ~8 exports
│   └── CLAUDE.md
├── permissions/              # 3 camadas + role matrix
│   ├── hooks/                # useUserRole, useCanDo, useFeaturePermission
│   ├── lib/                  # permissions.ts (resolver)
│   ├── components/           # PermissionProtectedRoute, PermissionsTab
│   ├── index.ts              # ~10 exports
│   └── CLAUDE.md
├── org-team/                 # org switching, team members, profiles
│   ├── hooks/                # useOrganization, useTeamMembers, useProfile
│   ├── components/           # MemberPermissions, SeatUsageBar, TeamMemberCard
│   ├── pages/                # Equipe.tsx
│   ├── index.ts              # ~12 exports
│   └── CLAUDE.md
└── master/                   # super-admin transversal
    ├── hooks/                # useMasterAuth, useMasterOrgs, useMasterUsers, useMasterPlans
    ├── components/           # master/ subpasta atual
    ├── pages/                # master/* pages
    ├── index.ts              # ~12 exports
    └── CLAUDE.md
```

**Total: 14 → 17 BCs físicos.**

**Pros:** deletion test claro por sub-conceito. Onboarding mais explícito. Permissões isoladas (área 🟠 com fronteira firme).
**Cons:** mais módulos pra manter. Dependências entre eles (e.g. `master` precisa `auth`, `permissions` precisa `org-team`) — corre risco de criar novo ciclo.

### Alternativa B — Re-deepen interno preservando 1 BC `identity` (menos radical)

Aplicar pattern da Fase 8 (sub-pastas internas com barrels privados):

```
src/modules/identity/
├── auth/                     # sub-pasta privada
├── permissions/              # sub-pasta privada
├── org-team/                 # sub-pasta privada
├── master/                   # sub-pasta privada
├── shared/                   # types comuns
├── index.ts                  # ≤ 20 exports (vs 44 hoje)
└── CLAUDE.md
```

**Pros:** sem novo BC criado. Menor blast radius. Pattern já validado em Fase 8.
**Cons:** não testa deletion-independence dos sub-conceitos. Barrel ainda > 1 sub-conceito.

### Recomendação (executada — Slice 9.1)

**Iniciar com Alternativa B** (re-deepen interno). Se ratio cair ≥ 3.0 e área 🟠 ficar mais navegável, parar. Se sub-conceitos provarem-se independentes na prática, promover Alternativa A em fase futura (10).

**Status:** ✅ aprovada pelo CTO em 2026-05-28 com base em [[inventario-identity]].

## Constraints

Ver `_INDEX.md`. Adicional:
- **NÃO** mudar `permission_engine.ts` no backend (`supabase/functions/_shared/`)
- **NÃO** mudar comportamento de fail-closed em loading state (backlog `permissions-fallback-fail-closed.md`)
- **NÃO** mover types de `AuthContext` sem validar consumers de `@/contexts/AuthContext` (cross-cutting global)
- Smoke Bloco 1 (Auth + Permissões) + Bloco 11 (Master Ops) verde a cada slice — área frágil exige overcautel
- Test integration `permission-engine.test.ts` SEMPRE verde

## Slices (Alternativa B)

### Slice 9.1 — Decisão A vs B + inventário (2-3h) — ✅ CONCLUÍDO

Doc-only.

**Tarefas:**
1. Listar 44 exports do `identity/index.ts` atual com:
   - Símbolo
   - Sub-conceito candidato (auth / permissions / org-team / master / shared)
   - Consumers cross-module (grep)
   - Frequência de uso
2. Discussão CTO: alternativa A ou B?
3. Decisão registrada no doc.

**Entregáveis 9.1:**
- ✅ Doc [[inventario-identity]] no vault — 44 statements / 114 símbolos / 25 com reach externo.
- ✅ Decisão **Alt B** registrada (CTO, 2026-05-28).
- ✅ Slices 9.2-9.5 abaixo ajustados com alvo barrel pós-slice (44 → 18) e classificação PUB/PRIV por statement.
- PR doc-only — `feat/arch-deepening/09-1-decisao-identity` → `develop`.

**Achados que afetam 9.2-9.5:**
- 78% dos símbolos do barrel não têm consumer externo (purgáveis em 9.5)
- 95% do reach concentra em 12 símbolos (PUB mantido)
- `master` = 39% dos símbolos / 0,3% do reach — purga maciça em 9.4 (só `useMasterAuth` mantém-se PUB)
- `permissions` (área 🟠) — 33 símbolos, só 9 com consumer externo (4 com reach ≥ 5)

### Slice 9.1b — Inverter dependência `realtime → identity` (precursora / enabler) — ✅ CONCLUÍDO 2026-05-29

**Inserida fora da sequência original.** Não estava no plano 9.1→9.5; surgiu como **bloqueador** das movimentações de arquivo (9.2–9.5).

**Por quê.** `src/shared/realtime/useRealtimeSubscription.ts` importava `useOrganization` de `@/modules/identity` (barrel raiz) — um edge `shared → module` que fechava um ciclo: o barrel re-exporta hooks (`useTeamMembers`, `useOrgRolePermissions`) que chegam a `useRealtimeSubscription`, que reimportava o barrel. Esse único edge gerava **27 violações `no-circular`** no dep-cruise (todos os ciclos que atravessavam `useRealtimeSubscription`, ancorados em `identity/index.ts`). Mover arquivos de `identity` em 9.2–9.5 re-chavearia esses edges cíclicos cross-boundary a cada slice, mascarando regressões no ratchet.

**O que foi feito.** Inversão via contexto React (mesmo espírito do `PipeOpsPort` da Fase 7):
- Novo `src/shared/realtime/realtime-org-context.tsx` — `RealtimeOrgProvider` + `useRealtimeOrgId()`. **Owned** por `shared/realtime`, só importa `react`.
- `useRealtimeSubscription.ts` passa a LER o org-id via `useRealtimeOrgId()` — não importa mais `@/modules/identity`.
- `App.tsx`: `RealtimeOrgBridge` (deep-import `useOrganization`, preserva code-splitting) ALIMENTA o contexto, montado entre `<AuthProvider>` e `<PipeOpsProvider>`. Reatividade a org switch preservada.

**Resultado (dep-cruise).** Baseline **83 → 56** (`no-circular` 60 → 33; `no-orphans` 23 inalterado). 27 `no-circular` removidos, 0 adicionados. `useIdentity`/`ProtectedRoute`/`useUserRole`/`useOrgRolePermissions`/`useRealtimeSubscription` agora em **zero** ciclos. Nenhum ciclo atravessa mais `shared/realtime`.

**Impacto no plano.**
- **Destrava 9.2–9.5**: mover arquivos `identity` não toca mais edges cíclicos cross-boundary.
- **Recalibra alvos de baseline downstream**: critérios da Fase 9 (e do `_INDEX`) eram premissados em baseline 83. Nova base = **56**. Os alvos globais (`baseline ≤ 70`, `no-circular ≤ 50`) já foram **atingidos** por esta slice precursora; 9.2–9.5 continuam reduzindo a partir de 56.
- **Residual conhecido (escopo 9.2+)**: sobrou 1 ciclo *intra-identity* `useTeamMembers ↔ useOrganization` (ambos importam um ao outro, sem cross-boundary). Não envolve `shared/realtime` e não bloqueia nada — será endereçado ao reorganizar `org-team/` interno (9.4).

**Auto-QA (literal).** tsc app + root = 0 erros; `npm run lint` = 0 errors / 2451 warnings (pré-existentes); `npm run test:unit` = 26 files / 40 tests failed (vs baseline `d902ddc4` = 27 files / 43 failed → **zero regressão nova**; `auth-context.test.ts` flaky-async passou neste run); `useRealtimeSubscription-refactored.test.ts` + `hooks-realtime-sub.test.ts` = 23/23 verde; ratchet OK em 56.

**Changelog:** [[07 — Changelog/2026-05-29-arch-deepening-9-1b-realtime-decouple]].

### Slice 9.2 — Reorganizar `auth/` interno (2-3h)
### Slice 9.2 — Reorganizar `auth/` interno (2-3h) — ✅ CONCLUÍDO (2026-05-29)

Pattern Fase 8. Escopo definido por [[inventario-identity]] — statements 1, 4, 5, 42.

**Tarefas:**
1. Criar `src/modules/identity/auth/` com `hooks/`, `components/`, `contexts/`, `index.ts` privado.
2. Mover: `AuthContext` (+ `AuthProvider`, `useAuth`), `useIdentity` + type `Identity`, `ProtectedRoute`. Pages auth (`Auth.tsx`, `Signup.tsx`, `ResetPassword.tsx`) ficam em `identity/pages/` (deep-import permitido).
3. Imports internos no módulo via caminho relativo (`./auth/...`).
4. Barrel raiz `identity/index.ts` re-exporta os 4 statements de `auth` (consumers externos inalterados — `useAuth`=57, `useIdentity`=26 mantêm path `@/modules/identity`).
5. Validar.

**Critério aceite 9.2 (verificado com counts literais):**
- [x] `auth/` populada — 3 arquivos movidos (`AuthContext.tsx`, `useIdentity.ts`, `ProtectedRoute.tsx` via `git mv`, history preservada) + `auth/index.ts` privado re-exportando os 4 statements / 5 símbolos (`AuthProvider`, `useAuth`, `useIdentity`, `Identity`, `ProtectedRoute`)
- [x] Barrel raiz statements: **44** (`grep -c '^export'` = 44, inalterado)
- [x] identity files: **66 → 67** (criação de `auth/index.ts`)
- [x] `npx tsc --noEmit` (root solution-style) = **0 erros** (literal)
- [x] `npx tsc --noEmit -p tsconfig.app.json` = 1764 erros (= baseline, delta 0; arquivos `auth/*` movidos = 0 erros antes/depois; App.tsx = 4 erros TS6133 pré-existentes, inalterado)
- [x] `npm run lint` nos arquivos tocados = 0 errors, 6 warnings (todos pré-existentes; `boundaries/element-types` e `boundaries/no-private` NÃO acusam os movidos/App.tsx)
- [x] `npm run test:unit` = sem regressão vs baseline (26 red files / 39 red tests pré-existentes; auth-context + use-identity + permission-protected-route **verdes**; os 7 reds em `protected-route.test.tsx` são `TestingLibraryElementError` de lógica `/checkout` ausente — pré-existentes, NÃO de import quebrado)
- [x] Consumers externos inalterados (App.tsx repontado p/ `@/modules/identity/auth` sub-barrel; demais 25 símbolos com reach externo seguem via `@/modules/identity`)
- [x] Leak grep = **ZERO** referências remanescentes aos paths antigos
- [x] ✅ `dep-cruise-ratchet`: **OK — baseline 56, 0 new** (resume 2026-06-01). O net +1 da sessão anterior dissolveu: o precursor **9.1b (#592)** quebrou o edge raiz `useRealtimeSubscription → @/modules/identity`, removendo a cadeia inteira. `AuthContext`/`useIdentity`/`ProtectedRoute` confirmados em **zero** ciclos empiricamente. Sem regenerar baseline. (Ver "Achado dep-cruise" abaixo como registro histórico do bloqueio original.)

**Achado dep-cruise (Slice 9.2):** mover `useIdentity.ts`/`ProtectedRoute.tsx` (nós participantes de 7 ciclos `no-circular` baseline) re-chaveia esses ciclos pelo path novo. Após normalizar `auth/*`→path antigo, o delta lógico é **+1** ciclo: `index.ts → auth/components/ProtectedRoute` — é a MESMA cadeia `ProtectedRoute → useIdentity → useUserRole → useTeamMembers → useRealtimeSubscription → identity/index.ts` que o baseline já contava (entry-edge `components/ProtectedRoute → useIdentity`), apenas re-reportada por outro edge porque o dep-cruiser escolhe entry diferente quando `useIdentity` muda de pasta. **Causa-raiz**: edge pré-existente `shared/realtime/useRealtimeSubscription.ts → @/modules/identity` (importa `useOrganization`) — fora de escopo deste slice mecânico. Recomendação: quebrar esse edge num slice dedicado (eliminaria os ~7 ciclos de uma vez, ratchet ficaria negativo).

### Slice 9.3 — Reorganizar `permissions/` interno (3-4h)

🟠 área mais frágil. Escopo definido por [[inventario-identity]] — statements 2, 3, 6, 7, 8, 21, 22, 23, 24, 25, 26, 27, 43 (13 statements / 33 símbolos).

**Tarefas:**
1. Criar `src/modules/identity/permissions/` com `hooks/`, `lib/`, `components/`, `index.ts` privado.
2. Mover:
   - `lib/permissions.ts` (resolver: `resolveAction`, `usePermission`, `assertPermissionClient`, `assertPermission` + types `AppAction`, `ResolveActionContext`, `ResolveActionResult`)
   - `hooks/useUserRole.ts` (9 hooks + types `AppRole`, `UserRole`)
   - `hooks/useCanDo.ts`
   - `hooks/usePermissions.ts` (6 símbolos + 2 types)
   - `hooks/useOrgRolePermissions.ts` + `useUpdateRolePermission.ts` + `useResetOrgRolePermissions.ts` (+ types)
   - `components/PermissionProtectedRoute.tsx`
   - `components/PermissionsTab.tsx`
3. **CUIDADO**: fail-closed em loading state — backlog `permissions-fallback-fail-closed.md`.
4. Validar SEPARADAMENTE: admin / membro / master (Bloco 1.6, 1.7).
5. Test integration `permission-engine.test.ts` rodar 3× consecutivas pra detectar flakiness.

**Critério aceite 9.3 (verificado 2026-06-01 — PR #606):**
- [x] `permissions/` populada — 9 arquivos `git mv` (lib/permissions + 6 hooks role/perm + PermissionProtectedRoute + PermissionsTab) + `permissions/index.ts` sub-barrel privado
- [x] Barrel raiz statements: **44** (`grep -c '^export'` = 44; 13 statements re-apontados `from "./permissions"`)
- [x] `npx tsc --noEmit` (root) = **0** · leak grep = **0** · lint **0 errors** · ratchet **OK 56 0-new** (9 arquivos em zero ciclos → move neutro)
- [x] test:unit zero regressão; subset permissão/identity = **8 files / 89 tests 100% pass** (use-user-role, use-can-do, use-permissions-hooks, permission-protected-route, permissions-fail-closed, permissions, use-feature-permissions-orgid, use-identity)
- [ ] Smoke admin OK — **gate CTO**
- [ ] Smoke membro OK (sem fail-open) — **gate CTO**
- [ ] Smoke master OK — **gate CTO**
- [ ] `/master/operations` carrega (hotfix #530 não regride) — **gate CTO**
- ⚠️ `permission-engine.test.ts` (integration) = **env-blocked** (Supabase local sem seed de auth); backend não tocado pela slice — não-regressão. Rodar 3× quando ambiente disponível.

### Slice 9.4a — Precursora: quebrar ciclo `useOrganization↔useTeamMembers` (PR #610) ✅

Bloqueava o move 9.4 (mover ambos os arquivos cíclicos re-chaveava o ratchet edge-keyed). Decisão CTO (AskUserQuestion): precursora dedicada antes do move — espelha 9.1b. Ver changelog [[2026-06-01-arch-deepening-9-4a-break-org-team-cycle]].

- **Causa**: `useTeamMembers.ts` agregava `useCurrentTeamMember` (org-independente) com hooks org-scoped; `useOrganization` importava `useCurrentTeamMember` de lá ⇒ ciclo.
- **Fix mecânico**: extraído `hooks/useCurrentTeamMember.ts` (bodies verbatim via slice por linha). `useTeamMembers.ts` re-exporta (superfície pública inalterada). `useOrganization`/`useOrgSwitcher` repontados pra fonte nova. Único teste tocado: `use-organization.test.ts` (mock repontado).
- **Resultado**: baseline **56 → 55** (`no-circular` 33 → 32; removido só `useOrganization → useTeamMembers`, 0 add — provado por diff de chaves; baseline regenerado por ser redução). root tsc 0 · lint 0 err · test:unit zero regressão. **9.4 (move) agora ratchet-neutro.**
- [x] Aceite 9.4a: ciclo morto, baseline 55, superfície pública 44 intacta, smoke org-context = gate CTO.

### Slice 9.4 — Reorganizar `org-team/` + `master/` internos (3-4h)

> **FATIADA (CTO, AskUserQuestion 2026-06-01):** bundle grande demais p/ 1 PR em área frágil. **9.4 = master + demote** (PR #620, ✅ — alto valor, isolado, ~0 test-churn); **9.4b = org-team** (próxima — ~70 test-files de useOrganization/useTeamMembers, relocação pura). Ver changelog [[2026-06-01-arch-deepening-9-4-master-internal-demote]].

Escopo definido por [[inventario-identity]] — `org-team`: statements 28-41 (14 / 30 símbolos). `master`: statements 9-20 (12 / 45 símbolos).

**Tarefas:**
1. Criar `src/modules/identity/org-team/` + `src/modules/identity/master/` com mesma convenção (`hooks/`, `components/`, `pages/`, `index.ts` privado).
2. Mover:
   - **org-team**: `useOrganization*`, `useOrgQuotas`, `useOrgSwitcher`, `useSeatUsage`, `useTeamMembers*`, `useProfile*`, `getSelectedOrgId/setSelectedOrgId/isVirtualTeamMember`, components `team/*`, `ProfileSettings.tsx`, `pages/Equipe.tsx`.
   - **master**: todos os `useMaster*` hooks (8 statements / 38 hooks+types), components `master/*` (`MasterLayout`, `MasterRoute`, `MasterSidebar`, `PlanEditor`, etc.), pages `pages/master/*`.
3. **Demoção de barrel ALT** — `master`: dos 12 statements, **apenas `useMasterAuth, useCanAccessMaster` (statement 9) permanece re-exportado no barrel raiz**. Os outros 11 statements (44 símbolos master) ficam só em `identity/master/index.ts` (deep-import permitido p/ `pages/master/*` internas).
4. Validar.

**Critério aceite 9.4 (master, PR #620):**
- [x] `master/` populada — 34 `git mv` (6 hooks + 15 components incl `onboarding/` + 13 pages) + `master/index.ts` sub-barrel
- [x] Barrel raiz: 44 → **33** (`grep -c '^export'` = 33; só `useMasterAuth, useCanAccessMaster` via `./master`; 11 statements demovidos)
- [x] root tsc 0 · leak grep 0 · mojibake 0 · lint 0 err · ratchet **OK 55 0-new** · `npm run build` exit 0 (rotas master lazy resolvem)
- [x] test:unit zero regressão; subset repointado (use-identity/use-user-role/use-master-auth/use-can-do/use-permissions-hooks) = **5 files / 52 tests pass**
- [ ] Smoke Bloco 11 (master ops) — **gate CTO** (`/master`, `/master/operations` hotfix #530, `/master/organizations`, `/master/users`)
- [x] ESLint boundaries não acusa (deep-import em pages/App é permitido)
- ⏭️ `org-team/` (Bloco 1.3-1.5 org switcher + equipe) = **slice 9.4b**

**Critério aceite 9.4b (org-team, PR #621):**
- [x] `org-team/` populada — 14 `git mv` (8 hooks + 4 team components + ProfileSettings + Equipe) + `org-team/index.ts` sub-barrel; useAutoAdminAssignment/useAvatarMap ficam em `hooks/`
- [x] Barrel raiz **33** (re-aponta 14 statements org-team `from "./org-team"`, SEM demote — org-team é PUB)
- [x] root tsc 0 · leak grep 0 (alias+relativo) · mojibake 0 · lint 0 err · ratchet **OK 55 0-new** · build exit 0 · 14 renames
- [x] test:unit zero regressão (red set pré-existente; subset org/team/identity = **7 files / 78 tests pass**)
- [ ] Smoke Bloco 1.3-1.5 (org switcher + equipe + carga de org context) — **gate CTO**
- Débito pré-existente flagado: deep-imports cross-module (useBuilderSession/useQuickBlast) pro org-team barrel; orphans ProfileSettings/TeamMemberCard/TeamStats.

### Slice 9.5 — Reduzir barrel `identity/index.ts` (3-4h)

**Tarefas:**
1. Aplicar coluna **PUB/PRIV** da tabela em [[inventario-identity#tabela-completa-44-export-statements]]:
   - **Demover PRIV** (estimado ~15 statements): types órfãos (`OrgType`, `OrganizationContext`, `OrganizationSettings`, `QuotaInfo`, `SwitcherOrg`, `SeatUsage`, `Profile`, `AppRole`, `UserRole`, `Identity`, `AppAction`, `ResolveActionContext`, `ResolveActionResult`); hooks `permissions` granulares sem consumer externo (`useOrgRolePermissions`, `useUpdateRolePermission`, `useResetOrgRolePermissions`, `useMyPermissions`, `useOrganizationRolePermissions`, `useTeamMemberOrgPermissions`, `useSaveTeamMemberOrgPermissions`); `useSeatUsage`, `useProfile`/`useProfiles`, hooks team-member CRUD pouco usados.
   - **Manter PUB**: 12 hooks com reach ≥ 5 + 4 components Route + `useMasterAuth`.
2. Validar cada demoção rodando lint (boundaries) — re-promover qualquer símbolo que quebre build.
3. Alvo: **≈ 18 export statements** (66/18 ≈ 3.7 — supera alvo ≥ 3.0).
4. Atualizar `identity/CLAUDE.md` refletindo nova estrutura interna (`auth/`, `permissions/`, `org-team/`, `master/`).

**Critério aceite 9.5:**
- [ ] `identity/index.ts` ≤ 20 export statements (alvo concreto: ~18)
- [ ] files-per-export ≥ 3.0 (alvo concreto: 3.7)
- [ ] Build + lint + lint:deps:check verde
- [ ] Suite tests pass (não regride vs baseline)
- [ ] Baseline ratchet reduzido em ≥ 3 violations
- [ ] Sub-CLAUDE.md `identity` atualizado com 4 sub-pastas
- [ ] 25 símbolos com reach externo (inventário 9.1) continuam acessíveis via `@/modules/identity` (zero regressão consumer)

## Riscos + mitigação

| Risco | Mitigação |
|---|---|
| **Permission regression — membro vê coisa de admin** | Smoke obrigatório por role separado a cada slice. Test integration permission-engine SEMPRE verde |
| `AuthContext` import quebra cross-cutting (`@/contexts/AuthContext`) | Manter shim em `src/contexts/AuthContext.tsx` re-exportando do novo path durante transição |
| Hotfix #530 regride (barrel desalinhado novamente) | Cada slice valida `useMasterOperations*` em build |
| Permission loading state fail-open vaza | Testar com network throttling em DevTools |
| Slice 9.3 quebra alguma policy RLS indiretamente | RLS é backend, refactor é frontend — não deveria mas validar Bloco 4 (event-bus) ainda funciona |
| `org-team` quebra `useOrganization` (todo o app filtra por org) | Smoke em **toda** rota principal a cada slice |

## Métricas de progresso

```bash
echo "identity files: $(find src/modules/identity -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l)"
echo "identity exports: $(grep -c '^export' src/modules/identity/index.ts)"
echo "ratio: $(node -e 'console.log((66/44).toFixed(2))')"  # alvo ≥ 3.0
```

## Out of scope

- Backend `_shared/permission_engine.ts` refactor
- Server-side enforcement gap (backlog `move-pipe-record-server-side.md`)
- Renomeação de roles (sempre admin/master/membro)
- Mudança nas 3 camadas de permissão

## Pós-Fase-9

- Avaliar promoção pra Alternativa A (split em 4 BCs físicos) se sub-conceitos provarem-se independentes
- Decidir destino do `org-team` — pode virar BC autônomo (deeper review)
- Avaliar consolidação `auth + permissions` em "session-control" se acoplamento for inevitável
