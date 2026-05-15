---
type: tutorial
title: Tour do Vault Obsidian
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [tutorial, vault, obsidian, onboarding]
related: ["[[Convencoes]]", "[[99 — Templates/_README]]"]
owner: gabriel
audience: dev-novo
estimated_time_min: 30
---

# Tour do Vault — Como navegar e escrever

> Vault = segundo cérebro do projeto. Concentra ADRs, features, changelog,
> decisões. Não é README inflado — é estrutura Diátaxis + ADR + MOC.

## O que você vai aprender

- Estrutura de pastas e por quê
- Diátaxis (4 modos)
- Frontmatter universal
- Wikilinks
- Como criar nota nova
- Como deletar com segurança

## Por que vault separado do README

- README pra humanos navegando no GitHub
- Vault pra dev + agente IA — markdown puro, parseável, hub→leaf
- Inspiração: Karpathy ("BUILD FOR AGENTS"), Anthropic context engineering,
  Diátaxis (Procida), llms.txt (Howard)

## Estrutura

```
00 — INDEX.md         ← MOC raiz, mapa do vault
01 — Identidade/      ← quem somos, padrões, subagentes
02 — Arquitetura/     ← Diátaxis Explanation (por quê)
03 — Reference/       ← Diátaxis Reference (lookup)
04 — Decisões/        ← ADRs imutáveis
05 — How-to/          ← Diátaxis How-to (executar)
06 — Features/        ← Domínio (regras de negócio)
07 — Changelog/       ← Append-only (histórico)
08 — Backlog/         ← Work in progress
09 — Tutorials/       ← Diátaxis Tutorial (aprender) — você está aqui
99 — Templates/       ← Esqueletos
```

## Diátaxis em 30 segundos

| Modo | Pergunta que responde | Exemplo |
|---|---|---|
| **Tutorial** (09) | "Como aprendo X?" | "Onboarding dev" |
| **How-to** (05) | "Como faço Y específico?" | "Deploy edge function" |
| **Reference** (03) | "Qual é o valor de Z?" | "RLS Policies" |
| **Explanation** (02) | "Por que é assim?" | "Multi-tenancy" |

Misturar modos = confusão. Cada nota tem 1 propósito.

## Frontmatter — sempre

Toda nota começa com:

```yaml
---
type: adr | feature | howto | tutorial | reference | changelog | backlog | identity | architecture
title: <título humano>
status: draft | active | accepted | superseded | archived | shipped | in-progress
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [dominio, subtopico]
related: ["[[ref1]]", "[[ref2]]"]
owner: gabriel | marcelo | claude-agent | unowned
---
```

`vault-lint` bloqueia se faltar.

## Wikilinks

```markdown
Ver [[Multi-tenancy]] para detalhes.
Ou [[Multi-tenancy|isolamento por tenant]] com texto custom.
```

Obsidian resolve por filename globalmente. Não precisa path completo.
Após rename: Obsidian atualiza wikilinks (se vault aberto).

## Como criar nota nova

```bash
# 1. Identifique o tipo (consultar tabela Diátaxis acima)
# 2. Copie o template:
cp "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/99 — Templates/howto.md" \
   "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/05 — How-to/<slug>.md"

# 3. Preencha frontmatter + conteúdo
# 4. Atualize INDEX se for nota importante
# 5. Commit:
git add "Obsidian/.../<arquivo>.md"
git commit -m "docs(vault): add <nome>"
```

## Como deletar nota

> Defesa em camadas ativa. Vault-sentinel bloqueia perda silenciosa.

```bash
git rm "Obsidian/.../<arquivo>.md"
git commit -m "chore(vault): remove obsoleto <X>"

# Pre-commit hook PEDE confirmação:
# > Pre-commit: Mudança destrutiva no vault detectada
# > Arquivos sendo DELETADOS: ...
# > Confirma operação? Digite YES:
# YES

# Adicionar flag pra GitHub Action passar:
git commit --allow-empty -m "chore(vault): autoriza remoção [vault-delete-ok]

Razão: <X foi superado pela ADR-YYYY-MM-DD-Z>"
git push
```

Sem `[vault-delete-ok]`, `vault-sentinel` bloqueia PR.

## Preferir mover/renomear a deletar

```bash
# Obsidian atualiza wikilinks automaticamente em rename
git mv "Obsidian/.../old.md" "Obsidian/.../new.md"
```

## Como recuperar arquivo deletado

```bash
# Listar commits que tocaram
git log --all --diff-filter=D --name-only -- "Obsidian/.../<arquivo>"

# Restaurar
git checkout <hash>^ -- "Obsidian/.../<arquivo>"
git commit -m "fix(vault): restaura <arquivo> deletado por engano"
```

Ou via branch backup automática:
```bash
git fetch origin vault-only
git checkout origin/vault-only -- Obsidian/...
```

## Onde guardar o quê — fluxograma

```
Tem decisão arquitetural?           → 04 — Decisões/ADR-...
Tem nova regra de negócio/feature?  → 06 — Features/<dominio>/...
Tem mudança shipped?                → 07 — Changelog/...
Tem ideia/bug pendente?             → 08 — Backlog/...
Quer ensinar algo?                  → 09 — Tutorials/...
Quer documentar procedimento?       → 05 — How-to/...
Quer documentar lookup?             → 03 — Reference/...
Quer explicar arquitetura?          → 02 — Arquitetura/...
Padrão/quem somos?                  → 01 — Identidade/...
```

## Recapitulação

Você sabe:
- 9 pastas + significado de cada
- 4 modos Diátaxis + quando usar cada
- Frontmatter universal
- Wikilinks
- Como criar nota
- Como deletar com segurança

## Próximo passo

[[04-trabalhando-com-claude]] — usar subagentes pra acelerar trabalho.
