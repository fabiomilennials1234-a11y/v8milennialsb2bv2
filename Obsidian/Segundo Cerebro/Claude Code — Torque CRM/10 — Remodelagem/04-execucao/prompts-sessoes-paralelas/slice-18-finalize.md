# Slice 18 — Finalize modularização

**Branch:** `feat/modularizacao/18-finalize`
**Base:** `develop` (com slices 16, 17 e 19 já mergeadas)
**Target PR:** `develop` (NÃO `main`)
**Estimate:** 2h
**SEQUENCIAL:** depende de slices 17 + 19 mergeadas. Não atacar antes.

## Constraints invariantes (NÃO violar)

1. Zero push em `main`. Zero merge em `main`.
2. Zero mutação em prod DB.
3. Zero deploy edge function.
4. Branch sai de `develop`. PR target = `develop`.
5. **PR final develop → main fica pra coordenação humana** (não rodar nesta sessão). Esta slice só prepara o estado final em develop.
6. Antes de começar: confirmar `git log` em develop traz commits das slices 16, 17 e 19. Se faltar alguma, **PARAR** e perguntar ao CTO.

## Contexto

Esta é a slice de fechamento. Não introduz nada novo — apenas:

1. Deleta pastas legacy vazias remanescentes.
2. Cria ADR de conclusão da modularização.
3. Atualiza `slices.md` do vault marcando tudo ✅.
4. **Prepara** (não abre) o futuro PR `develop → main`.

## Tarefas

### 1. Sincronizar

```bash
git checkout develop
git pull origin develop
# Confirmar commits de 16, 17, 19 presentes
git log --oneline | grep -E "slice 1[6789]" | head -5
git checkout -b feat/modularizacao/18-finalize
```

### 2. Caçar e deletar pastas legacy vazias

```bash
# Pastas que deveriam estar vazias após cleanup
find src/components -maxdepth 1 -type d -empty
find src/hooks -maxdepth 1 -type d -empty
find src/pages -maxdepth 1 -type d -empty
```

Se algo aparecer, deletar com `rmdir`. Se sobrar arquivo solto que não foi tratado, **PARAR** e perguntar.

Confirmar estado final esperado:

```bash
ls src/components/   # esperado: ui/
ls src/hooks/        # esperado: use-toast.ts
ls src/pages/        # esperado: vazio
```

### 3. ADR de conclusão

Criar `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisões/ADR-2026-XX-XX-modularizacao-conclusao.md` (substituir data):

```markdown
# ADR — Modularização concluída (monolito modular)

**Status:** Implementado
**Data:** <hoje>
**Decisores:** CTO
**Slices:** 0-19 (16 cleanup longtail e 17 docs + flip incluídos; 15 real descartada)

## Decisão

Codebase reorganizado em 14 bounded contexts sob `src/modules/<bc>/`, com `src/shared/` para utils cross-cutting e `src/components/ui/` mantida para primitivos shadcn.

## Resultado

- 14 módulos populados, cada um com API pública via `index.ts` + sub-CLAUDE.md.
- `eslint-plugin-boundaries` em error mode + CI gate ativo.
- 0 arquivos soltos em root de `src/components/`, `src/hooks/`, `src/pages/`.
- Edge functions mantidas flat por restrição do Supabase CLI; organização por BC via doc + naming.
- Event-bus piloto operacional para `lead.stage_changed` — padrão validado.

## Consequências

- Onboarding novo dev: começar lendo `src/modules/<bc>/CLAUDE.md` do BC relevante.
- AI subagentes: roteamento por BC explícito.
- Cross-imports proibidos fora de `index.ts` por módulo (CI gate).
- Slice 15 real descartada — edge functions permanecem em flat layout.

## Métricas pre vs post

- `src/hooks/` root: 263 → 1 arquivo.
- `src/components/` root: 13 subpastas → 1 (`ui/`).
- `src/pages/` root: 47 → 0.
- 14 módulos em `src/modules/` com sub-CLAUDE.md.
```

### 4. Atualizar slices.md no vault

`Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/slices.md` — marcar todas as slices como ✅. Anotar slice 15 real descartada. Anotar slice 16 (cleanup longtail) adicionada ao roadmap original.

### 5. Atualizar SPEC

`.specs/features/modularizacao/SPEC.md` — adicionar nota de fechamento ao final referenciando o ADR de conclusão.

### 6. Smoke checklist pra coordenação manual

Criar arquivo `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/smoke-pre-develop-to-main.md` com:

- Checklist manual a rodar antes do CTO abrir o PR `develop → main`.
- Cobertura: login, kanban, chat, copilot, workflow, campaign, carteira, agenda.
- Pontos críticos: cron jobs ainda apontam pros paths atuais (edge functions flat).
- `domain_events` migration: aplicar em prod **antes** do deploy do front (senão call sites publicam pra tabela inexistente).
- Sequência sugerida: aplicar migration em prod → deploy edge `event-dispatcher` em prod → ativar cron em prod → deploy front.

### 7. Commit + push + PR contra develop

```bash
git add -A
git status --short | grep -i "feature-overview" && echo "PARAR — vault scratch file"
git commit -m "feat(modularizacao): slice 18 — finalize (cleanup + ADR + smoke checklist)

Encerra a modularização em develop. Deleta pastas legacy vazias remanescentes,
adiciona ADR de conclusão, atualiza slices.md no vault, e prepara smoke
checklist para coordenação manual do PR develop→main.

NÃO abre PR contra main — fica pra coordenação humana (sequência de deploy de
domain_events migration + event-dispatcher + cron + frontend documentada).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin feat/modularizacao/18-finalize
gh pr create --base develop --head feat/modularizacao/18-finalize --title "feat(modularizacao): slice 18 — finalize (ADR + smoke checklist)" --body "<resumo>"
```

## Critério de aceite

- [ ] Pastas legacy vazias deletadas. `src/components/` = `ui/`, `src/hooks/` = `use-toast.ts`, `src/pages/` vazia.
- [ ] ADR de conclusão criado no vault.
- [ ] `slices.md` marcado tudo ✅.
- [ ] SPEC com nota de fechamento.
- [ ] `smoke-pre-develop-to-main.md` criado.
- [ ] PR aberto contra `develop`.
- [ ] **PR develop → main NÃO aberto nesta sessão.**

## Out of scope (explicitamente)

- Abrir PR `develop → main` — fica pra coordenação humana (CTO decide quando deploy).
- Deploy de migration `domain_events` em prod.
- Deploy de `event-dispatcher` em prod.
- Ativação do cron em prod.

## Riscos

- **Erro em arquivo de ADR** — usar template do vault existente, não inventar formato.
- **Esquecer slice 17 ou 19 não mergeada** — sempre checar `git log` antes.
- **Commit acidental de scratch vault** — `git status` antes de `git add`.
