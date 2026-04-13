---
name: second-brain
description: Update the Obsidian Second Brain vault with recent changes, feature docs, and backlog items
user_invocable: true
---

# /second-brain — Atualizar Segundo Cerebro

Atualiza o vault Obsidian com mudancas recentes, documentacao de features, e items de backlog.

## Vault

**Root:** `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/`

## Parametros

- `/second-brain` — Scan completo desde ultima execucao
- `/second-brain resumo` — Gera resumo do dia na daily note
- `/second-brain feature <nome>` — Atualiza nota de feature especifica
- `/second-brain backlog <titulo>` — Cria item no backlog

## Processo — Scan completo

1. **Le timestamp da ultima execucao** em `.claude/last-second-brain-run`
2. **Busca commits desde entao** via `git log --since=<timestamp>`
3. **Para cada commit significativo** (feat/fix/refactor/spec):
   a. Cria nota individual em `07 — Changelog/individuais/YYYY-MM-DD—tipo-descricao.md`
   b. Detecta features afetadas via `scripts/obsidian-feature-map.json`
   c. Atualiza nota da feature em `06 — Features/<dominio>/` (secao "Historico de mudancas" + ajusta "Como funciona" se necessario lendo o codigo atual)
   d. Checa `08 — Backlog/` — se existe item relacionado, atualiza status
4. **Appenda no daily note** `07 — Changelog/YYYY-MM-DD.md` se nao foi feito pelo hook
5. **Atualiza timestamp** em `.claude/last-second-brain-run`

## Processo — Resumo do dia

1. Le o daily note `07 — Changelog/YYYY-MM-DD.md`
2. Analisa todos os commits do dia
3. Gera "Resumo do dia" (2-3 frases) e atualiza a secao no daily note

## Processo — Feature especifica

1. Le a nota da feature em `06 — Features/<dominio>/<nome>.md`
2. Le o codigo atual dos componentes, hooks, edge functions, e tabelas listados na nota
3. Atualiza as secoes tecnicas se algo mudou
4. Adiciona entradas no "Historico de mudancas" se houve commits recentes

## Processo — Backlog

1. Cria nota em `08 — Backlog/backlog/<titulo-slug>.md` com template padrao
2. Preenche: descricao, criterios de conclusao, features afetadas
3. Status: backlog

## Templates

### Nota individual changelog

```markdown
---
tags:
  - claude-code
  - changelog
  - <tipo>
created: YYYY-MM-DD
status: concluido
tipo: feat | fix | refactor | spec
features:
  - Feature Afetada
---

# <tipo>: <descricao>

## O que mudou
## Arquivos alterados
## Contexto
## Impacto
## Features afetadas
```

### Backlog item

```markdown
---
tags:
  - claude-code
  - backlog
  - <tipo>
  - torque-crm
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: backlog
tipo: feature | fix | spec | melhoria | pedido
prioridade: alta | media | baixa
features:
  - Feature Afetada
---

# <Titulo>

## Descricao
## Criterios de conclusao
## Notas
## Historico
```

## Regras

- Sempre usar wikilinks `[[Nome]]` para cross-references
- Datas absolutas (nunca "ontem", "semana passada")
- Copiar paths exatos dos arquivos alterados
- Atualizar `last_updated` no frontmatter de notas modificadas
- Mover items do backlog entre pastas quando status muda
