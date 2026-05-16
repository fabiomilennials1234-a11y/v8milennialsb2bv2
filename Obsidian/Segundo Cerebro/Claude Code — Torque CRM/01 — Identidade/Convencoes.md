---
type: identity
title: Convenções do Vault
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [convencoes, vault, identidade]
related: ["[[Subagentes]]", "[[99 — Templates/_README]]"]
owner: gabriel
---

# Convenções do Vault — Torque CRM

Regras operacionais para manter o vault navegável, parseável por agente e
resistente a perda. Inspiração: Diátaxis (4 modos), ADR Nygard, llms.txt
(Howard), Anthropic context engineering, Karpathy "build for agents".

## Diátaxis aplicado ao vault

Quatro modos ortogonais — confundir é o pecado original.

| Modo | Pasta | Quando | Exemplo |
|---|---|---|---|
| **Tutorial** | `09 — Tutorials/` | Ensinar dev novo a fazer X pela primeira vez | "Onboarding dev novo" |
| **How-to** | `05 — How-to/` | Tarefa específica, dev já sabe contexto | "Deploy edge function" |
| **Reference** | `03 — Reference/` | Lookup table, valores, comandos, schemas | "RLS Policies" |
| **Explanation** | `02 — Arquitetura/` | Por quê, trade-offs, modelo mental | "Multi-tenancy" |

Adicionais (não Diátaxis puro mas necessários):
- `01 — Identidade/` — quem somos, padrões, subagentes
- `04 — Decisões/` — ADRs imutáveis
- `06 — Features/` — domínio (regras de negócio)
- `07 — Changelog/` — append-only, histórico
- `08 — Backlog/` — work in progress
- `99 — Templates/` — esqueletos

## Frontmatter universal

**Toda nota DEVE ter frontmatter.** Sem exceção. `vault-lint` bloqueia no CI.

```yaml
---
type: adr | feature | howto | tutorial | reference | changelog | backlog | identity | architecture
title: <título humano legível>
status: draft | active | accepted | superseded | archived | shipped | in-progress
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [dominio, subtopico]
related: ["[[ref1]]", "[[ref2]]"]
owner: gabriel | marcelo | claude-agent | unowned
---
```

Campos opcionais por tipo: ver [[99 — Templates/_README|Templates README]].

## Naming convention

Detalhes em [[99 — Templates/_README|Templates README]]. Resumo:

| Tipo | Padrão | Exemplo |
|---|---|---|
| ADR | `ADR-YYYY-MM-DD-slug.md` | `ADR-2026-05-15-consolidacao-subagentes.md` |
| Feature | `<dominio>/<slug>.md` | `Chat/whatsapp-stability.md` |
| How-to | `<verbo>-<objeto>.md` | `deploy-edge-function.md` |
| Tutorial | `NN-topico.md` | `01-onboarding-dev.md` |
| Reference | `Topico Pascal.md` | `RLS Policies.md` |
| Changelog daily | `YYYY-MM-DD.md` | `2026-05-15.md` |
| Changelog per-feature | `YYYY-MM-DD-slug.md` | `2026-05-15-vault-protection.md` |
| Backlog item | `<slug>.md` | `microcopy-reschedule-modal.md` |
| MOC | `_MOC.md` na pasta | `06 — Features/_MOC.md` |

## Changelog — padrão híbrido

Decisão arquitetural: **daily como MOC + per-feature como detalhe**.

- `07 — Changelog/YYYY-MM-DD.md` — daily, agrega o que foi shipped no dia
  (1-2 linhas por entrega + link pro per-feature)
- `07 — Changelog/YYYY-MM-DD-slug.md` — per-feature, detalhe técnico
  (template [[99 — Templates/changelog-entry]])

Auto-gerado pelo hook `scripts/obsidian-post-commit.sh` ao fazer commit.

## Wikilinks

- Sempre `[[arquivo]]` ou `[[arquivo|texto custom]]` para referenciar nota do vault.
- Obsidian resolve por filename — não precisa path completo (mas pode usar `[[Pasta/arquivo]]`).
- Linkar lateralmente (related notes) e hierarquicamente (de MOC pra folha).
- Após rename, Obsidian atualiza wikilinks automaticamente — preferir `git mv`.

## Status — ciclo de vida

```
draft → active → archived
        └─ accepted (ADR) → superseded
        └─ in-progress (backlog) → shipped → archived
```

- **draft** — rascunho, não confiar como verdade
- **active** — em uso, fonte de verdade
- **accepted** — ADR aceita e em vigor
- **in-progress** — backlog item sendo trabalhado
- **shipped** — changelog de mudança em prod
- **superseded** — ADR substituída (linkar forward em `superseded_by`)
- **archived** — não usar mais, mantido pra histórico

## Owner

Quem é responsável por manter a nota atualizada:
- `gabriel` — CTO
- `marcelo` — dev junior
- `claude-agent` — gerado/mantido automaticamente
- `unowned` — sem dono explícito (deveria ter — flag pra revisitar)

## Tags

- Kebab-case minúsculo: `whatsapp`, `multi-tenant`, `rls`
- Sem espaços: usar hífen
- Primeira tag = domínio (`chat`, `vendas`, `ia`, `admin`, `automacao`, `infra`)
- Tags adicionais = subtopicos

## Tópicos transversais (cross-cutting)

Quando uma nota toca múltiplos domínios:
- Pasta = domínio principal
- Tags = todos os domínios
- `related` cobre as outras notas relevantes

## Templates obrigatórios

Sempre começar de [[99 — Templates/_README|template existente]]. Não criar do zero.

## Wikilinks órfãos

`vault-lint` checa wikilinks apontando para arquivos inexistentes. Bloqueia CI.
Corrigir antes de mergear:
- Criar o arquivo apontado, OU
- Remover wikilink, OU
- Apontar para arquivo existente

## Pastas vazias

Não comitar pastas vazias (git não rastreia mesmo). Se precisar reservar
estrutura, criar `_README.md` explicando o que vai morar ali.

## Arquivos efêmeros

Notas que perdem valor após uso (handoff prompts, planos de sessão única):
- Não commitar se possível.
- Se commitar (pra alguém retomar), **incluir data de expiração** no
  frontmatter (`expires: YYYY-MM-DD`) e deletar com flag `[vault-delete-ok]`
  após consumo.

## Quem mexe no vault

- **CTO**: cria/edita/aprova qualquer coisa
- **Dev junior**: cria/edita; CTO aprova merge via CODEOWNERS
- **Claude agent**: cria/edita conforme task; CTO aprova merge
- Mudanças em `01 — Identidade/`, `04 — Decisões/`, e este arquivo
  exigem ADR formal se mudam estrutura/processo

## Como adicionar nota nova

1. Identificar tipo (tabela Diátaxis acima)
2. Copiar template apropriado de `99 — Templates/`
3. Preencher frontmatter
4. Escrever conteúdo
5. Comitar com scope `docs(vault):`
6. Push em branch nova (regra global)

Futuro: skill `vault-new <tipo>` automatiza.

## Como deletar nota

1. Justificar em commit message + adicionar flag `[vault-delete-ok]` em algum
   commit do PR — caso contrário, `vault-sentinel` bloqueia.
2. Atualizar `related` em notas que apontavam pra nota deletada.
3. Atualizar [[00 — INDEX]] se necessário.

Preferir **mover/arquivar** a deletar quando possível:
- `08 — Backlog/concluido/` — backlog items shipped
- `99 — Templates/_archived/` — templates obsoletos

## Como mover/renomear nota

```bash
git mv "old-path.md" "new-path.md"
```

Obsidian detecta e atualiza wikilinks automaticamente (se vault aberto).
Se vault fechado: rodar `vault-lint` para detectar links quebrados.

## Padrão de qualidade

Inspiração: Karpathy, Anthropic context engineering, comunidade.

- **Markdown puro.** Sem HTML salvo callouts Obsidian.
- **Concisão.** Cada parágrafo carrega peso. Lixo degrada inferência.
- **Hierarquia clara.** H1 título, H2 seções, H3 subseções. Sem H4+ salvo necessidade.
- **Code blocks com linguagem.** ` ```bash`, ` ```typescript`, ` ```sql`.
- **Tabelas para lookup**, listas para enumeração.
- **Wikilinks > paths absolutos.**
- **`> [!info]` / `> [!warning]` / `> [!danger]`** para destaque (callouts Obsidian).
