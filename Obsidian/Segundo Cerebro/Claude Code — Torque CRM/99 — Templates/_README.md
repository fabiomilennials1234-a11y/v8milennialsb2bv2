---
type: identity
title: Templates do Vault
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [templates, convencoes]
owner: gabriel
---

# Templates — Vault Torque CRM

Templates oficiais. Usar como ponto de partida ao criar arquivo novo no vault.

## Quando usar cada template

| Template | Quando | Path final |
|---|---|---|
| [[adr]] | Decisão arquitetural que afeta >1 módulo | `04 — Decisões/ADR-YYYY-MM-DD-slug.md` |
| [[feature]] | Documentar feature do produto (regras de negócio) | `06 — Features/<dominio>/<slug>.md` |
| [[howto]] | Procedimento operacional (passo a passo) | `05 — How-to/<verbo-objeto>.md` |
| [[tutorial]] | Material de aprendizado (onboarding etc.) | `09 — Tutorials/NN-topico.md` |
| [[reference]] | Lookup table / referência estática | `03 — Reference/Topico Pascal.md` |
| [[changelog-entry]] | Registro de mudança shipped | `07 — Changelog/YYYY-MM-DD-slug.md` ou daily |
| [[backlog-item]] | Item pendente em backlog | `08 — Backlog/backlog/<slug>.md` |
| [[adr-superseded]] | ADR que substituiu outra (com link forward) | mesma pasta dos ADRs |

## Frontmatter universal

Toda nota do vault DEVE ter frontmatter com os campos abaixo:

```yaml
---
type: adr | feature | howto | tutorial | reference | changelog | backlog | identity | architecture
title: <título humano legível>
status: draft | active | accepted | superseded | archived | shipped | in-progress
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [dominio, subtopico, ...]
related: ["[[ref1]]", "[[ref2]]"]
owner: gabriel | marcelo | claude-agent | unowned
---
```

Campos opcionais por tipo:
- ADR: `supersedes: [...]`, `superseded_by: [...]`
- Backlog: `priority: P0 | P1 | P2 | P3`, `estimated_hours: <int>`
- Feature: `area: chat | vendas | ia | admin | etc.`
- Changelog: `branch: <branch-name>`, `pr: <pr-url>`

## Naming convention

| Tipo | Padrão | Exemplo |
|---|---|---|
| ADR | `ADR-YYYY-MM-DD-slug-kebab.md` | `ADR-2026-05-15-consolidacao-subagentes.md` |
| Feature | `<dominio>/<slug-kebab>.md` | `Chat/whatsapp-stability.md` |
| How-to | `<verbo>-<objeto>-kebab.md` | `deploy-edge-function.md` |
| Tutorial | `NN-topico-kebab.md` | `01-onboarding-dev.md` |
| Reference | `Topico Pascal.md` ou `Topico-Pascal.md` | `RLS Policies.md` |
| Changelog daily | `YYYY-MM-DD.md` | `2026-05-15.md` |
| Changelog per-feature | `YYYY-MM-DD-slug-kebab.md` | `2026-05-15-vault-protection.md` |
| Backlog item | `<slug-kebab>.md` | `microcopy-reschedule-modal.md` |
| MOC (Map of Content) | `_MOC.md` em qualquer pasta | `06 — Features/_MOC.md` |

## Regras práticas

1. **Sempre frontmatter.** Sem exceção. vault-lint vai bloquear no CI.
2. **`type` único e correto.** Determina linting + filtros do INDEX/MOC.
3. **`status` reflete realidade.** Atualizar quando muda (active → archived etc.).
4. **`updated` sempre na última edição.**
5. **Wikilinks > URLs externas** quando referenciando outro arquivo do vault.
6. **`related` cobre dependências semânticas**, não estruturais (estrutura vem da pasta).
7. **`tags` em kebab-case minúsculo**, sem espaços.
8. **Não criar arquivo na raiz** do vault — sempre em uma das pastas numeradas.

## Como criar nota nova

```bash
# 1. Identifique o tipo (consultar tabela acima)
# 2. Copie o template apropriado:
cp "99 — Templates/<tipo>.md" "<pasta>/<arquivo>.md"

# 3. Preencha frontmatter (placeholders <...>)
# 4. Escreva conteúdo
# 5. git add + commit com scope docs(vault):
```

Futuro: skill `vault-new <tipo>` automatiza este fluxo.
