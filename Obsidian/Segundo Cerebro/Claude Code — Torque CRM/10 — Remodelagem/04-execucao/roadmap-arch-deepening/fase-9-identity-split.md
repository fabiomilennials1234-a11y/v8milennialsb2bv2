---
status: planejado
owner: arquiteto
tipo: fase-execucao
fase: 9
criado: 2026-05-28
estimate: 10-16h
pre_requisitos:
  - "[[fase-8-pipelines-re-deepen]] mergeada"
  - "Pattern de deepening validado em pipelines"
  - "Develop estável ≥ 7 dias pós-Fase-8"
habilita:
  - "Onboarding mais limpo + auth desacoplada"
relacionados:
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

**Duas alternativas — decisão CTO no Slice 9.1.**

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

### Recomendação

**Iniciar com Alternativa B** (re-deepen interno). Se ratio cair ≥ 3.0 e área 🟠 ficar mais navegável, parar. Se sub-conceitos provarem-se independentes na prática, promover Alternativa A em fase futura (10).

## Constraints

Ver `_INDEX.md`. Adicional:
- **NÃO** mudar `permission_engine.ts` no backend (`supabase/functions/_shared/`)
- **NÃO** mudar comportamento de fail-closed em loading state (backlog `permissions-fallback-fail-closed.md`)
- **NÃO** mover types de `AuthContext` sem validar consumers de `@/contexts/AuthContext` (cross-cutting global)
- Smoke Bloco 1 (Auth + Permissões) + Bloco 11 (Master Ops) verde a cada slice — área frágil exige overcautel
- Test integration `permission-engine.test.ts` SEMPRE verde

## Slices (Alternativa B)

### Slice 9.1 — Decisão A vs B + inventário (2-3h)

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
- Doc `inventario-identity.md` no vault.
- Decisão A vs B assinada CTO.
- Próximos slices ajustados conforme decisão.
- PR doc-only.

### Slice 9.2 — Reorganizar `auth/` interno (2-3h)

Pattern Fase 8.

**Tarefas:**
1. Criar `src/modules/identity/auth/` com hooks/components/lib/index.ts.
2. Mover: `useAuth`, `AuthContext`, `ProtectedRoute`, hooks de session, signup, signin, reset.
3. Imports internos no módulo via caminho relativo (`./auth/...`).
4. Barrel raiz `identity/index.ts` re-exporta tudo de `auth` (consumers externos inalterados).
5. Validar.

**Critério aceite 9.2:**
- [ ] `auth/` populada
- [ ] Smoke Bloco 1.1, 1.2 (login flow) verde
- [ ] Build + lint + test integration permission-engine verde
- [ ] Consumers externos inalterados

### Slice 9.3 — Reorganizar `permissions/` interno (3-4h)

🟠 área mais frágil.

**Tarefas:**
1. Criar `src/modules/identity/permissions/`.
2. Mover: `permissions.ts` (resolver), `useUserRole`, `useCanDo`, `useFeaturePermission`, `PermissionProtectedRoute`, `PermissionsTab`, role matrix logic.
3. **CUIDADO**: fail-closed em loading state.
4. Validar SEPARADAMENTE: admin / membro / master (Bloco 1.6, 1.7).
5. Test integration `permission-engine.test.ts` rodar 3x consecutivas pra detectar flakiness.

**Critério aceite 9.3:**
- [ ] `permissions/` populada
- [ ] Smoke admin OK
- [ ] Smoke membro OK (sem fail-open)
- [ ] Smoke master OK
- [ ] `permission-engine.test.ts` 100% pass
- [ ] Hotfix #530 não regride (testar `/master/operations` carrega)

### Slice 9.4 — Reorganizar `org-team/` + `master/` internos (2-3h)

**Tarefas:**
1. Criar sub-pastas `org-team/` e `master/`.
2. Mover hooks e components correspondentes.
3. Validar.

**Critério aceite 9.4:**
- [ ] `org-team/` + `master/` populadas
- [ ] Smoke Bloco 1.3-1.5 (org switcher + equipe) verde
- [ ] Smoke Bloco 11 (master ops) verde

### Slice 9.5 — Reduzir barrel `identity/index.ts` (3-4h)

**Tarefas:**
1. Para cada export do barrel marcado "privado" no inventário 9.1:
   - Identificar consumers externos
   - Migrar ou manter conforme decisão
2. Alvo: ≤ 20 exports (vs 44)
3. Atualizar `identity/CLAUDE.md` com nova estrutura.

**Critério aceite 9.5:**
- [ ] `identity/index.ts` ≤ 20 exports
- [ ] files-per-export ≥ 3.0
- [ ] Build + lint + lint:deps:check verde
- [ ] Suite tests pass (não regride)
- [ ] Baseline ratchet reduzido em ≥ 3 violations
- [ ] Sub-CLAUDE.md `identity` atualizado

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
