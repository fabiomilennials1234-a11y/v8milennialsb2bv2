---
status: ativo
owner: arquiteto
tipo: prompts-execucao
fase: 7-8-9
criado: 2026-05-28
contexto: prompts /tdd autocontidos pra rodar cada slice em sessao Claude paralela ou sequencial
relacionados:
  - "[[_INDEX]]"
  - "[[fase-7-quebrar-ciclo-leads-pipelines]]"
  - "[[fase-8-pipelines-re-deepen]]"
  - "[[fase-9-identity-split]]"
  - "[[inventario-leads-pipelines]]"
---

# Prompts /tdd por Wave — roadmap arch deepening

Cada prompt **autocontido**. Cole no terminal Claude correspondente (track A ou track B). Setup recomendado: 2 worktrees + 2 terminais.

> [!info] Setup worktree
> ```bash
> # Track A
> git worktree add ../torque-trackA develop
>
> # Track B
> git worktree add ../torque-trackB develop
> ```
> Cada terminal: `cd ../torque-trackA` (ou B) → executar Claude → colar prompt.

---

## Sumário das Waves

| Wave | Track A (pipelines) | Track B (identity) |
|:---:|---|---|
| W0 | 7.1 ✅ done (#533) | — |
| **W1** | 7.2 em curso | 9.1 em curso |
| W2 | 8.1 doc | 9.2 refactor `auth/` |
| W3 | 8.2 refactor `views/` | 9.3 refactor `permissions/` 🟠 |
| W4 | 8.3 refactor `canonical/` + `custom/` | 9.4 refactor `org-team/` + `master/` |
| W5 | 8.4 refactor barrel pipelines | 9.5 refactor barrel identity |
| W6 | Gate — habilita Fase 5 | — |

---

## Wave 1 (em curso) — registros

### W1 Track A — Slice 7.2

```
/tdd Slice 7.2 do roadmap arch deepening pos-modularizacao — quebrar ciclo leads<->pipelines. Refactor. Branch base develop sincronizada, branch alvo feat/arch-deepening/07-2-promote-and-rewire, PR target develop.

Contexto: 47 deep imports cruzados entre src/modules/leads/ e src/modules/pipelines/ (38 leads->pipelines + 9 pipelines->leads). Inventario completo em Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/roadmap-arch-deepening/inventario-leads-pipelines.md. Achado pragmatico: nenhum simbolo precisa extracao pra src/shared/ — todos podem ficar no modulo de origem desde que promovidos ao barrel.

Objetivo: promover 29 simbolos ao barrel pipelines/index.ts + 3 simbolos ao barrel leads/index.ts + atualizar 15 arquivos consumers (12 em leads/ + 3 em pipelines/) substituindo deep imports por imports via barrel. Resultado esperado: 0 deep imports cross-module entre os dois modulos.

PASSO 0 — sync + branch:
git checkout develop
git pull --ff-only origin develop
git checkout -b feat/arch-deepening/07-2-promote-and-rewire

PASSO 1 — ler inventario (fonte de verdade dos simbolos a promover):
cat "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/roadmap-arch-deepening/inventario-leads-pipelines.md"

PASSO 2 — descobrir paths de origem reais de cada simbolo via grep -rE "^export.*X" src/modules/pipelines/ (idem leads).

PASSO 3 — adicionar exports nos barrels (agrupar em secao com comentario "Slice 7.2 — promovidos para quebrar ciclo").

PASSO 4 — rewire consumers: trocar deep paths por barrel @/modules/pipelines ou @/modules/leads. Consolidar multiplos imports do mesmo modulo em 1 linha.

PASSO 5 — atualizar inventario com snapshot pos-merge.

VERIFICACAO TDD:
1. npm run lint (0 errors)
2. npm run lint:deps:check (ratchet verde)
3. npm run lint:deps:baseline → total <= 80 (era 86)
4. grep -rE 'from "@/modules/pipelines/(hooks|components|lib)/' src/modules/leads/ | wc -l → 0
5. grep -rE 'from "@/modules/leads/(hooks|components|lib)/' src/modules/pipelines/ | wc -l → 0
6. npm run build (verde, chunks similar)
7. npx vitest run tests/unit/ (nao regride vs develop)
8. Smoke Blocos 2+3+4 de smoke-roteiro-sem-whatsapp.md

CONSTRAINTS: zero push main, zero mutacao DB, zero deploy, sem --no-verify, .claude/scheduled_tasks.lock NAO commit, feature-overview.md NAO commit.

Commit "feat(arch-deepening): slice 7.2 — quebrar ciclo leads<->pipelines" + push + PR contra develop com tabela diff (exports antes/depois, baseline antes/depois, deep cross antes/depois).
```

### W1 Track B — Slice 9.1

```
/tdd Slice 9.1 do roadmap arch deepening pos-modularizacao. Doc-only. Branch base develop sincronizada, branch alvo feat/arch-deepening/09-1-decisao-identity, PR target develop.

Contexto: src/modules/identity/ tem 44 exports / 66 arquivos (ratio 1.50 — shallow). Mistura 5 sub-conceitos: auth + role + permissions + master ops + org-team. Hotfix #530 (stale useMasterOperations export) sintoma do barrel desalinhado. Fase 9 do roadmap em Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/roadmap-arch-deepening/fase-9-identity-split.md propoe duas alternativas:
- Alt A: split em 4 BCs fisicos autonomos (auth + permissions + org-team + master)
- Alt B: re-deepen interno preservando 1 BC identity (sub-pastas privadas, barrel reduzido)

Objetivo: inventariar 44 exports, classificar por sub-conceito, escolher A ou B, registrar decisao e adaptar slices 9.2-9.5.

Tarefas:
1. Listar exports: grep "^export" src/modules/identity/index.ts
2. Pra cada export, classificar (auth / permissions / org-team / master / shared) + contar consumers externos
3. Criar Obsidian/.../inventario-identity.md com tabela completa + breakdown por sub-conceito + pros/cons Alt A vs B + recomendacao
4. Atualizar fase-9-identity-split.md refletindo decisao
5. Frontmatter obsidiano valido + wikilinks

VERIFICACAO: doc renderiza, 100% exports cobertos, decisao clara com pros/cons mensurados.

CONSTRAINTS: zero codigo modificado. Doc-only. PR target develop. Sem --no-verify.

Commit "docs(arch-deepening): slice 9.1 — inventario identity + decisao alt A/B" + push + PR.
```

---

## Wave 2 — após W1 mergeado

### W2 Track A — Slice 8.1 (doc-only, inventário pipelines)

```
/tdd Slice 8.1 do roadmap arch deepening pos-modularizacao. Doc-only. Branch base develop sincronizada com slice 7.2 mergeado, branch alvo feat/arch-deepening/08-1-inventario-pipelines, PR target develop.

Contexto: pos-Slice-7.2, src/modules/pipelines/index.ts tem ~97 exports (era 68 + 29 promovidos no 7.2). Ratio files-per-export ~0.6 (ainda pior que 0.85 inicial). Fase 8 do roadmap em Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/roadmap-arch-deepening/fase-8-pipelines-re-deepen.md propoe reorganizar em sub-pastas internas (views/ canonical/ custom/ shared/) e reduzir barrel publico para <= 20 exports.

Objetivo: inventariar todos exports do barrel + decidir quais ficam PUBLICO (cross-module necessario) vs PRIVADO (intra-pipelines so), classificar cada um em sub-conceito.

Tarefas:
1. Listar exports atuais: grep "^export" src/modules/pipelines/index.ts > /tmp/pipelines-exports.txt
2. Pra cada export, contar consumers cross-module:
   for sym in $(...); do count=$(grep -rE 'from "@/modules/pipelines"' src --include="*.ts" --include="*.tsx" | grep -c "$sym"); echo "$sym: $count"; done | sort -t: -k2 -rn
3. Classificar cada export:
   - Sub-conceito: views legacy / canonical / custom / shared
   - Marcador: PUBLICO (>= 1 consumer externo) ou PRIVADO (zero consumers externos OU consumers podem usar API alternativa)
4. Criar Obsidian/.../inventario-pipelines.md com:
   - Tabela 97 linhas (simbolo, tipo, sub-conceito, consumers count, PUB/PRIV)
   - Breakdown por sub-conceito (views=N, canonical=M, custom=K, shared=L)
   - Lista exports PRIVADOS (alvo de remocao)
   - Lista exports PUBLICOS finais (alvo <= 20)
   - Mapa de migracao consumer-by-consumer se algum PRIVADO tem consumer externo (Opcao 1: migrar pra API alternativa | Opcao 2: manter PUBLICO temp com nota TODO)
5. Atualizar fase-8-pipelines-re-deepen.md refletindo decisoes

VERIFICACAO: doc renderiza, 100% exports cobertos, ratio alvo definido (>= 3.0), slices 8.2-8.4 alinhados com decisao.

CONSTRAINTS: zero codigo modificado. Doc-only. PR target develop. Sem --no-verify. Lock file + feature-overview.md NAO commit.

Commit "docs(arch-deepening): slice 8.1 — inventario pipelines + decisao sub-conceitos" + push + PR.
```

### W2 Track B — Slice 9.2 (refactor `auth/` interno)

```
/tdd Slice 9.2 do roadmap arch deepening pos-modularizacao. Refactor interno do sub-conceito auth. Branch base develop sincronizada com slice 9.1 mergeado, branch alvo feat/arch-deepening/09-2-identity-auth, PR target develop.

Contexto: Slice 9.1 decidiu Alt B (re-deepen interno) — confirmar lendo inventario-identity.md no vault. Sub-conceito auth (signin/signup/reset/session) tem N exports identificados no inventario. Pattern: criar sub-pasta privada src/modules/identity/auth/ com barrel privado, mover hooks/components, re-exportar via barrel publico identity/index.ts sem alterar API publica.

Objetivo: reorganizar physical layout do sub-conceito auth — sem alterar barrel publico nem comportamento.

Tarefas:
1. Ler Obsidian/.../inventario-identity.md confirmar decisao Alt B + lista de simbolos do sub-conceito auth
2. mkdir src/modules/identity/auth/{hooks,components,lib,contexts}
3. git mv contexts/AuthContext.tsx → auth/contexts/AuthContext.tsx
4. git mv hooks de session/signin/signup/reset → auth/hooks/
5. git mv components ProtectedRoute (se for auth-specific apenas — verificar dependencias de permissions ANTES) → auth/components/
6. Criar src/modules/identity/auth/index.ts (barrel privado interno re-exportando tudo de auth/)
7. Atualizar imports internos no modulo identity/ via caminho relativo curto (./auth/...)
8. Atualizar src/modules/identity/index.ts: trocar caminhos internos de ./contexts/AuthContext para ./auth/contexts/AuthContext (manter API publica inalterada — mesmos nomes exportados)
9. CRITICO — preservar shim em src/contexts/AuthContext.tsx (re-exportar do novo path) — memoria CTO documenta que @/contexts/AuthContext e cross-cutting consumido por varios lugares. NAO QUEBRAR.

VERIFICACAO TDD:
1. npm run lint && npm run lint:deps:check && npm run build (tudo verde)
2. npx vitest run tests/unit/ (nao regride)
3. Smoke Bloco 1.1, 1.2 (login flow) de smoke-roteiro-sem-whatsapp.md
4. tests/integration/permission-engine.test.ts continua verde
5. grep -c "^export" src/modules/identity/index.ts IGUAL pre-slice (barrel publico inalterado)
6. Tentar login admin + login membro + login master — todos OK

CONSTRAINTS: zero mudanca barrel publico. Reorg interno. Zero push main. Zero mutacao DB. Sem --no-verify. Lock file + feature-overview.md NAO commit. AuthContext shim cross-cutting preservado.

Commit "refactor(arch-deepening): slice 9.2 — identity auth reorganizado em sub-pasta interna" + push + PR contra develop com tabela: arquivos movidos, barrel publico antes/depois (igual), smoke marcado verde.
```

---

## Wave 3 — após W2 mergeado

### W3 Track A — Slice 8.2 (refactor `views/` legacy)

```
/tdd Slice 8.2 do roadmap arch deepening pos-modularizacao. Refactor interno sub-conceito views legacy. Branch base develop sincronizada com slice 8.1 mergeado, branch alvo feat/arch-deepening/08-2-pipelines-views, PR target develop.

Contexto: Slice 8.1 mapeou exports por sub-conceito. Sub-conceito views (hooks usePipe* das views pipe_whatsapp/confirmacao/propostas legacy) deve mover pra sub-pasta privada src/modules/pipelines/views/. Pattern Fase 8.

Objetivo: reorganizar views legacy interno sem alterar barrel publico.

Tarefas:
1. Ler Obsidian/.../inventario-pipelines.md confirmar lista de simbolos do sub-conceito views
2. mkdir src/modules/pipelines/views/{hooks,components,lib}
3. git mv usePipeWhatsapp.ts, usePipeConfirmacao.ts, usePipePropostas.ts, usePipePropostaItems.ts, usePipelineStages.ts (e outros listados no inventario) → views/hooks/
4. git mv components específicos (CompareceuModal, RescheduleModal, etc se aplicavel) → views/components/
5. Criar views/index.ts privado re-exportando tudo de views/
6. Atualizar imports internos relativos (./views/...)
7. Atualizar pipelines/index.ts: trocar caminhos internos de ./hooks/usePipeXxx para ./views/hooks/usePipeXxx (API publica inalterada)

VERIFICACAO TDD:
1. npm run lint && npm run lint:deps:check && npm run build
2. npx vitest run tests/unit/
3. Smoke Bloco 3.1-3.5 (kanban legacy whatsapp/confirmacao/propostas) — drag entre stages, realtime multi-tab
4. grep -c "^export" src/modules/pipelines/index.ts IGUAL pre-slice
5. Verificar pages/PipeWhatsapp.tsx etc continuam carregando

CONSTRAINTS: zero mudanca barrel publico. Reorg interno. NAO unificar dual model. Sem --no-verify. Lock + feature-overview NAO commit.

Commit "refactor(arch-deepening): slice 8.2 — pipelines views reorganizado em sub-pasta interna" + push + PR contra develop com tabela arquivos movidos + smoke checklist.
```

### W3 Track B — Slice 9.3 🟠 (refactor `permissions/` interno)

```
/tdd Slice 9.3 do roadmap arch deepening pos-modularizacao. AREA FRAGIL 🟠 — permissoes 3 camadas com fallback fail-closed. Branch base develop sincronizada com slice 9.2 mergeado, branch alvo feat/arch-deepening/09-3-identity-permissions, PR target develop.

Contexto: Sub-conceito permissions e area fragil declarada em CLAUDE.md raiz. Inclui:
- lib/permissions.ts (resolver 3 camadas: master->admin->feature->role)
- 12 hooks (useUserRole, useCanDo, useFeaturePermission, useHasPermission, useMyPermissions, useOrganizationRolePermissions, useTeamMemberOrgPermissions, useSaveTeamMemberOrgPermissions, useOrgRolePermissions, useUpdateRolePermission, useResetOrgRolePermissions e outros)
- 2 components: PermissionProtectedRoute, PermissionsTab
- Backlog: permissions-fallback-fail-closed.md (MEDIUM)
- Test integration: tests/integration/permission-engine.test.ts

CUIDADOS ESPECIFICOS:
- NAO mudar lib/permissions.ts (resolver) — apenas mover de local
- NAO mudar comportamento fail-closed em loading state
- NAO mexer permission_engine.ts (backend supabase/functions/_shared/, fora do escopo)
- Memoria CTO: fail-open em loading state e bug medio (permissoes-fallback-fail-closed) — NAO introduzir regressao

Objetivo: reorganizar permissions interno em src/modules/identity/permissions/ sem alterar barrel publico nem comportamento.

Tarefas:
1. mkdir src/modules/identity/permissions/{hooks,components,lib}
2. git mv lib/permissions.ts → permissions/lib/permissions.ts
3. git mv hooks listados acima → permissions/hooks/
4. git mv PermissionProtectedRoute + PermissionsTab → permissions/components/
5. Criar permissions/index.ts privado
6. Atualizar imports relativos internos
7. identity/index.ts: trocar caminhos internos (API publica inalterada)

VERIFICACAO TDD (CRITICA):
1. npm run lint && npm run lint:deps:check && npm run build
2. tests/integration/permission-engine.test.ts → rodar 3 vezes consecutivas, 100% pass cada
3. Smoke OBRIGATORIO POR ROLE SEPARADO:
   - Login admin: Bloco 1.4 (lista team), 1.5 (editar permissoes) — verde
   - Login membro: Bloco 1.6 (tentar /master, esperado 403), 1.7 (botoes edit hidden)
   - Login master: Bloco 11 completo — todas as rotas master/*
4. Throttling network DevTools (Slow 3G) — verificar permissao em loading state NAO fail-open
5. Hotfix #530 nao regride: /master/operations carrega
6. grep -c "^export" src/modules/identity/index.ts IGUAL pre-slice

CONSTRAINTS: zero mudanca barrel publico. Zero mudanca comportamental. Permissions fail-closed preservadas. Sem --no-verify. Lock + feature-overview NAO commit.

Risco critico: se qualquer falha de permissao por role aparecer no smoke, ABORTAR slice + git reset --hard + reportar.

Commit "refactor(arch-deepening): slice 9.3 — identity permissions reorganizado (area fragil)" + push + PR contra develop com smoke checklist por role + resultado dos 3 runs do test integration.
```

---

## Wave 4 — após W3 mergeado

### W4 Track A — Slice 8.3 (refactor `canonical/` + `custom/`)

```
/tdd Slice 8.3 do roadmap arch deepening pos-modularizacao. Refactor interno. Branch base develop sincronizada com slice 8.2 mergeado, branch alvo feat/arch-deepening/08-3-pipelines-canonical-custom, PR target develop.

Contexto: Sub-conceitos canonical (pipeline_entries modelo novo) e custom (custom_pipelines + custom_pipe_entries) precisam mesma reorganizacao da slice 8.2. Pattern Fase 8.

Objetivo: reorganizar canonical + custom em sub-pastas internas sem alterar barrel publico.

Tarefas:
1. Ler inventario-pipelines.md confirmar simbolos
2. canonical/:
   - mkdir src/modules/pipelines/canonical/{hooks,components}
   - git mv usePipelineEntries.ts e relacionados → canonical/hooks/
   - Criar canonical/index.ts privado
3. custom/:
   - mkdir src/modules/pipelines/custom/{hooks,components}
   - git mv useCustomPipelines.ts, useCustomPipelineStages.ts, useAddLeadToCustomPipe → custom/hooks/
   - Criar custom/index.ts privado
4. Atualizar imports internos relativos
5. Atualizar pipelines/index.ts: trocar caminhos internos (API publica inalterada)

VERIFICACAO TDD:
1. npm run lint && npm run lint:deps:check && npm run build
2. npx vitest run tests/unit/
3. Smoke Bloco 3.6-3.7 (custom pipes — funis novos)
4. grep -c "^export" src/modules/pipelines/index.ts IGUAL pre-slice
5. pages/Funis.tsx + custom pipe detail funcionam

CONSTRAINTS: zero mudanca barrel publico. NAO unificar com views legacy. Sem --no-verify. Lock + feature-overview NAO commit.

Commit "refactor(arch-deepening): slice 8.3 — pipelines canonical+custom reorganizados" + push + PR.
```

### W4 Track B — Slice 9.4 (refactor `org-team/` + `master/`)

```
/tdd Slice 9.4 do roadmap arch deepening pos-modularizacao. Refactor interno. Branch base develop sincronizada com slice 9.3 mergeado, branch alvo feat/arch-deepening/09-4-identity-org-team-master, PR target develop.

Contexto: Sub-conceitos org-team (organization + team members + profiles + avatar) e master (super-admin transversal) precisam reorganizacao. Pattern Fase 9 Alt B.

Objetivo: reorganizar org-team + master em sub-pastas internas sem alterar barrel publico.

Tarefas:
1. Ler inventario-identity.md confirmar simbolos
2. org-team/:
   - mkdir src/modules/identity/org-team/{hooks,components,pages}
   - git mv useOrganization, useOrganizationSettings, useOrgQuotas, useOrgSwitcher, useSeatUsage, useTeamMembers, useProfiles, useAvatarMap, useAutoAdminAssignment → org-team/hooks/
   - git mv components/team/* (MemberPermissions, SeatUsageBar, TeamMemberCard, TeamStats) → org-team/components/
   - git mv pages/Equipe.tsx → org-team/pages/ se aplicavel
   - Criar org-team/index.ts privado
3. master/:
   - mkdir src/modules/identity/master/{hooks,components,pages}
   - git mv useMasterAuth, useMasterOperations granular (useOperationsOverview, useUsageByOrg, useRuntimeLogs, useJobsOverview, useAutomationJobs, useRetryDeadLetter), useMasterOrganizations, useMasterPlans, useMasterUsers, useMasterAuditLogs → master/hooks/
   - git mv components/master/* → master/components/
   - git mv pages/master/* → master/pages/
   - Criar master/index.ts privado
4. Atualizar imports relativos internos
5. identity/index.ts: trocar caminhos internos (API publica inalterada)

VERIFICACAO TDD:
1. npm run lint && npm run lint:deps:check && npm run build
2. npx vitest run tests/unit/
3. Smoke Bloco 1.3-1.5 (org switcher + equipe)
4. Smoke Bloco 11 completo (master ops) — REGRESSION TEST hotfix #530: /master/operations carrega
5. grep -c "^export" src/modules/identity/index.ts IGUAL pre-slice
6. Logout/login com 3 roles diferentes — todos funcionam

CONSTRAINTS: zero mudanca barrel publico. Permissoes preservadas. Sem --no-verify. Lock + feature-overview NAO commit.

Commit "refactor(arch-deepening): slice 9.4 — identity org-team+master reorganizados" + push + PR contra develop com smoke checklist por role.
```

---

## Wave 5 — após W4 mergeado

### W5 Track A — Slice 8.4 (reduzir barrel pipelines)

```
/tdd Slice 8.4 do roadmap arch deepening pos-modularizacao. Slice MAIS DELICADO da fase 8. Branch base develop sincronizada com slice 8.3 mergeado, branch alvo feat/arch-deepening/08-4-reduzir-barrel-pipelines, PR target develop.

Contexto: pos-slices 8.1-8.3, src/modules/pipelines/index.ts tem ~97 exports organizados internamente em views/ canonical/ custom/. Inventario 8.1 marcou exports PRIVADOS (intra-pipelines so) e PUBLICOS (cross-module necessario). Alvo: barrel publico <= 20 exports. Resultado: ratio files-per-export >= 3.0.

Objetivo: reduzir barrel publico de ~97 para <= 20 exports removendo os marcados PRIVADO.

Tarefas:
1. Ler Obsidian/.../inventario-pipelines.md — lista exports PRIVADOS vs PUBLICOS
2. Pra cada export PRIVADO:
   a. Identificar consumers externos: grep -rE 'from "@/modules/pipelines"' src --include="*.ts" --include="*.tsx" | grep "$sym"
   b. Se zero consumers externos → remover do barrel imediatamente
   c. Se consumers existem → triage CTO inline:
      - Opcao 1 (preferida): migrar consumer pra API publica alternativa (ex: hook wrapper menor que use o interno)
      - Opcao 2: manter PUBLICO temporariamente com comentario TODO no CLAUDE.md (candidato a remocao em sprint futura)
3. Atualizar src/modules/pipelines/index.ts: barrel reduzido com no maximo 20 exports
4. Atualizar src/modules/pipelines/CLAUDE.md:
   - Nova estrutura (views/ canonical/ custom/ + barrel <=20)
   - Ratio alvo files-per-export >= 3.0 documentado
   - Lista exports publicos comentada
5. Atualizar Obsidian/.../mapa-as-is-to-be-real.md com novos counts pipelines

VERIFICACAO TDD:
1. grep -c "^export" src/modules/pipelines/index.ts → <= 20
2. node -e 'const f=require("fs"); const files=f.readdirSync(...)... ; console.log(files/exports)' → ratio >= 2.5 (alvo 3.0)
3. npm run lint && npm run lint:deps:check && npm run build (tudo verde)
4. npx vitest run tests/unit/ (nao regride)
5. npm run lint:deps:baseline → baseline diminui em >= 5 violations
6. Smoke completo Blocos 2 + 3 + 4 de smoke-roteiro-sem-whatsapp.md
7. Bundle delta: comparar dist size pre vs pos (alvo ±5%)

CONSTRAINTS: zero mudanca de comportamento. Dual model views vs canonical preservado. Sem --no-verify. Lock + feature-overview NAO commit.

Risco alto: se Opcao 1 estourar muito (consumer migration demorada), quebrar em 8.4a (low-hanging fruit — exports privados sem consumer) + 8.4b (consumer migration). Reportar ao CTO antes de prosseguir com 8.4b.

Commit "refactor(arch-deepening): slice 8.4 — reduzir barrel pipelines de N para M exports" + push + PR contra develop com tabela:
- Barrel antes (~97) -> depois (<=20)
- Ratio files-per-export antes -> depois
- Baseline ratchet antes -> depois
- Bundle size antes -> depois
- Smoke checklist completo
```

### W5 Track B — Slice 9.5 (reduzir barrel identity)

```
/tdd Slice 9.5 do roadmap arch deepening pos-modularizacao. Slice MAIS DELICADO da fase 9 — area fragil 🟠 permissoes. Branch base develop sincronizada com slice 9.4 mergeado, branch alvo feat/arch-deepening/09-5-reduzir-barrel-identity, PR target develop.

Contexto: pos-slices 9.1-9.4, src/modules/identity/index.ts tem 44 exports organizados internamente em auth/ permissions/ org-team/ master/. Inventario 9.1 marcou PRIVADOS vs PUBLICOS. Alvo: barrel publico <= 20 exports. Ratio files-per-export >= 3.0.

Objetivo: reduzir barrel publico de 44 para <= 20 exports removendo os marcados PRIVADO.

CUIDADO CRITICO: identity contem auth + permissions = area fragil. Qualquer regressao em loading state fail-closed = block.

Tarefas:
1. Ler inventario-identity.md — lista exports PRIVADOS vs PUBLICOS
2. Pra cada export PRIVADO:
   a. Identificar consumers externos via grep
   b. Migrar consumer pra API alternativa OU manter PUBLICO temp com TODO
3. Atualizar identity/index.ts (<= 20 exports)
4. Atualizar src/modules/identity/CLAUDE.md com nova estrutura + ratio alvo
5. Atualizar mapa-as-is-to-be-real.md com novos counts identity
6. Validar permissoes 3 camadas continuam fail-closed

VERIFICACAO TDD (CRITICA):
1. grep -c "^export" src/modules/identity/index.ts → <= 20
2. ratio files-per-export >= 3.0
3. npm run lint && npm run lint:deps:check && npm run build
4. tests/integration/permission-engine.test.ts → rodar 3x consecutivas, 100% pass
5. Smoke OBRIGATORIO por role:
   - admin: Bloco 1 + Bloco 11 completos
   - membro: Bloco 1.6, 1.7 (gates corretos)
   - master: Bloco 11 (todas as rotas master/*)
6. Throttling network — fail-closed preservado
7. Hotfix #530 nao regride
8. Baseline ratchet diminui em >= 3 violations
9. AuthContext shim em src/contexts/AuthContext.tsx ainda funciona (re-export OK)

CONSTRAINTS: zero comportamento mudado. Permissoes fail-closed preservadas. Sem --no-verify. Lock + feature-overview NAO commit.

Risco maximo: qualquer falha em smoke por role = abortar + reset hard.

Commit "refactor(arch-deepening): slice 9.5 — reduzir barrel identity de 44 para M exports" + push + PR contra develop com:
- Barrel antes (44) -> depois (<=20)
- Ratio antes (1.50) -> depois (>=3.0)
- Test integration permission-engine: 3 runs verde
- Smoke por role completo
- Baseline ratchet antes -> depois
- Hotfix #530 regression test verde

Apos merge: roadmap arch-deepening COMPLETO. Habilita Fase 5 (deploy prod) com baseline reduzido.
```

---

## Notas operacionais

### Verificacao geral apos cada wave

- Ratchet baseline sempre verde (`npm run lint:deps:check`)
- Test suites nao regridem vs develop atual (27 files/42 tests pre-existentes tolerados)
- Smoke do bloco correspondente do roteiro `smoke-roteiro-sem-whatsapp.md`
- Build verde + dist size delta ±5%

### Quando abortar um slice

- Comportamento muda (regressao)
- Permission fail-open detectado
- White screen em qualquer rota
- Baseline ratchet sobe
- Test integration permission-engine falha

Comando de aborto: `git reset --hard origin/develop && git checkout develop && git branch -D <slice-branch>`

### Hotfix durante o roadmap

Memoria CTO: hotfix sai de main, PR pra main, sync main->develop, rebase slices em curso.

### Apos W5 (ambos tracks)

Roadmap arch-deepening completo. Estado esperado:
- pipelines: ratio >= 3.0 (vs 0.85)
- identity: ratio >= 3.0 (vs 1.50)
- ciclo leads<->pipelines: 0 (vs 47)
- baseline ratchet: <= 70 (vs 86)

Habilita Fase 5 do roadmap pos-modularizacao (deploy prod) com baseline arquitetural mais limpo.

---

## Refs

- [[_INDEX]] — roadmap arch deepening completo
- [[fase-7-quebrar-ciclo-leads-pipelines]]
- [[fase-8-pipelines-re-deepen]]
- [[fase-9-identity-split]]
- [[inventario-leads-pipelines]] — fonte de verdade slice 7.1
- [[../smoke-roteiro-sem-whatsapp]] — smoke obrigatorio por bloco
- [[../mapa-as-is-to-be-real]] — contexto state atual
- [[../roadmap-pos-modularizacao/fase-5-deploy-prod]] — gate pos-W5
