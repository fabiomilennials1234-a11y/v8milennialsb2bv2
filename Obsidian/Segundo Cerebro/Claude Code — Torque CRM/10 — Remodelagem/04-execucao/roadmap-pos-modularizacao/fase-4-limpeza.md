# Fase 4 — Limpeza pós-validação

**Branch:** `chore/cleanup-pos-modularizacao`
**Base:** `develop` (com Fases 1, 2 e 3 já mergeadas/validadas)
**Target PR:** `develop`
**Estimate:** 1h
**Pré-requisitos:**
- Fase 2 mergeada (boundaries enforcement real).
- Fase 3 com 24h de monitoria verde em dev (`failed=0` em `domain_events`).

## Constraints invariantes (NÃO violar)

1. Zero push em `main`. Zero merge em `main`.
2. Zero mutação em prod DB ou dev DB.
3. Zero deploy edge function.
4. Branch sai de `develop` sincronizada. PR target = `develop`.
5. Sem `--no-verify`.
6. Antes de começar: confirmar Fase 3 verde 24h em dev consultando `Obsidian/.../event-bus-dev-validation.md`.

## Contexto

A análise identificou 4 itens de limpeza:

1. **`triggerStageChangedWorkflows` dead code**. Função em `src/lib/workflowTrigger.ts:45` exportada sem caller após slice 19 (único caller `useCampanhas.ts` foi migrado pra `publishEvent`). Comentários TODO no `useCampanhas.ts` referenciam a chamada antiga que pode ser removida.
2. **Decisão `integrations` (3 arquivos)**: absorver em `platform` OU manter pra expansão futura (TinyERP, Asaas, Meta hoje em edge functions + UI espalhada).
3. **Decisão `billing` (5 arquivos)**: manter como está se subscription estável; absorver em `platform` se a feature estiver dormente.
4. **Atualizar baseline de deep-imports** (`.dependency-cruiser-baseline.json`) com quaisquer reduções resultantes desta fase.

Esta fase só **executa** ações de baixo risco. Decisões #2 e #3 sobre módulos quase-vazios **exigem CTO** — se não houver decisão na sessão, **deixar como está** e documentar.

## Tarefas

### 1. Sincronizar + branch

```bash
git checkout develop
git pull --ff-only origin develop
# Confirmar Fase 2 + Fase 3 mergeadas
git log origin/develop --oneline -20 | grep -E "boundaries-enforcement-real|event-bus-dev-validation"

git checkout -b chore/cleanup-pos-modularizacao
```

### 2. Deletar `triggerStageChangedWorkflows` dead code

Verificar uma última vez que ninguém chama:

```bash
grep -rn "triggerStageChangedWorkflows" src/ --include="*.ts" --include="*.tsx" | grep -v ".md\|^//\|/\* " | grep -v "events.ts\|workflowTrigger.ts"
# Esperado: zero linhas. Se houver, PARAR e investigar.
```

Deletar:

```bash
# Verificar conteudo antes
cat src/lib/workflowTrigger.ts

# Verificar imports do arquivo (outros symbols exportados?)
grep -n "^export" src/lib/workflowTrigger.ts

# Se triggerStageChangedWorkflows for o unico export:
git rm src/lib/workflowTrigger.ts

# Se outros exports existirem, abrir o arquivo e remover SO a funcao + types relacionados.
```

Limpar comentários TODO em `src/modules/campaigns/hooks/useCampanhas.ts` referenciando a chamada antiga (linhas ~815-840). Remover bloco comentado, manter apenas o `publishEvent` ativo. Conservar 1 linha de histórico:

```ts
// Migrado em slice 19 (2026-05-27): publishEvent('lead.stage_changed') substitui
// triggerStageChangedWorkflows direto. Função legacy deletada em fase 4.
```

### 3. Decisão sobre `integrations` e `billing`

**Default sem orientação CTO:** manter os módulos como estão. Apenas verificar que `index.ts` e `CLAUDE.md` deles documentam claramente "alvo de expansão futura — TinyERP, Asaas, Meta, etc." em `integrations`, e "subscription stable, expandir se Asaas/Stripe ganhar nova superfície" em `billing`.

Se essas notas faltarem nos CLAUDE.md, adicionar:

```bash
# Inspecionar
cat src/modules/integrations/CLAUDE.md
cat src/modules/billing/CLAUDE.md
```

Atualizar onde fizer sentido.

**Se CTO orientou consolidar:** seguir orientação (esta fase NÃO faz a consolidação sem orientação — risco de mover sem destino claro).

### 4. Atualizar baseline de deep-imports

Após deletar `workflowTrigger.ts` e limpar comentários, regenerar baseline para refletir o estado real:

```bash
npm run lint:deps:baseline
git diff .dependency-cruiser-baseline.json | head -30
# Esperado: redução de violations (a função deletada gerava acoplamento).
```

Anotar o delta no commit message.

### 5. Atualizar SPEC

`.specs/features/modularizacao/SPEC.md` — adicionar adendo final referenciando fases pós-modularização:

```markdown
## Adendo 2026-XX-XX — Roadmap pós-modularização

Após slices 0-19 fecharem em develop, análise (`Obsidian/.../analise-pos-modularizacao.md`)
identificou que enforcement era teatro e CI não validava. Roadmap pós-modularização
estruturado em 6 fases:

- Fase 1: CI unblock — `chore/ci-unblock-security-audit`
- Fase 2: Enforcement real via dep-cruise ratchet — `chore/boundaries-enforcement-real`
- Fase 3: Event-bus validado em dev — `chore/event-bus-dev-validation`
- Fase 4 (esta): limpeza pós-validação
- Fase 5: deploy prod (CTO + janela noturna)
- Fase 6: PR develop → main (release modularização completa)

Vault: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/roadmap-pos-modularizacao/_INDEX.md`
```

### 6. Validar tudo localmente

```bash
npm run lint
npm run lint:deps:check
npm run build
npm run test:unit -- workflowTrigger 2>&1 | tail -20
# Esperado: tests passam (ou test correspondente foi removido junto com a funcao)
```

Se algum test depender do `workflowTrigger.ts`, deletá-lo também (junto da função).

### 7. Commit + push + PR

```bash
git status --short
git status --short | grep -i "feature-overview" && echo "PARAR — vault scratch"

git add -A
git commit -m "chore(cleanup): pos-modularizacao — dead code + docs

- Deletar src/lib/workflowTrigger.ts (triggerStageChangedWorkflows) e tests
  correspondentes — dead code apos migracao para event-bus (slice 19, fase 3
  validada em dev por 24h).
- Limpar comentarios TODO em useCampanhas.ts.
- Atualizar dep-cruise baseline com reducao de violations apos delete.
- Atualizar SPEC com adendo do roadmap pos-modularizacao.
- (Opcional, se CTO orientou) Decisao sobre integrations/billing — ver
  commit message complementar.

Modulos integrations (3 arq) e billing (5 arq) mantidos como estao na
ausencia de orientacao explicita do CTO — documentados como 'alvo de
expansao futura' no CLAUDE.md de cada um.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin chore/cleanup-pos-modularizacao
gh pr create --base develop --head chore/cleanup-pos-modularizacao \
  --title "chore(cleanup): pos-modularizacao — dead code + docs" \
  --body "<resumo>"
```

## Critério de aceite

- [ ] `triggerStageChangedWorkflows` deletada (e arquivo `workflowTrigger.ts` se for o único export).
- [ ] Comentários TODO em `useCampanhas.ts` limpos, deixando 1 linha de histórico.
- [ ] CLAUDE.md de `integrations` e `billing` com nota sobre estado e expansão futura.
- [ ] `.dependency-cruiser-baseline.json` regenerado com delta documentado no PR body.
- [ ] `.specs/features/modularizacao/SPEC.md` com adendo do roadmap pós-modularização.
- [ ] `npm run lint`, `npm run lint:deps:check`, `npm run build`, `npm run test:unit` — tudo verde.
- [ ] PR aberto contra `develop`. CI verde após merge.

## Riscos + mitigação

- **Deletar `workflowTrigger.ts` e descobrir que outro caller existia escondido** (uso dinâmico, eval, etc). Mitigação: grep antes do delete + tests rodando.
- **Mover decisão sobre `integrations`/`billing` sem CTO.** Mitigação: default = não mover, só documentar.
- **Vault scratch commitado.** `git status` antes do `git add`.

## Out of scope

- Refactor dos 973 deep-imports (sprints separadas).
- Consolidação de `integrations` com edge functions (projeto separado).
- Migração de mais call sites pro event-bus (projeto separado).

## Próximo passo

Fase 5 — deploy prod (requer CTO + janela noturna combinada).
