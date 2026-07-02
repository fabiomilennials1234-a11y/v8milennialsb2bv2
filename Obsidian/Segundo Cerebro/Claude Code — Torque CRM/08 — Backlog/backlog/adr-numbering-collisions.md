---
type: backlog
title: "Resolver colisões de numeração nos ADRs do repo (docs/adr)"
status: backlog
priority: medium
created: 2026-06-30
updated: 2026-06-30
tags: [adr, docs, hygiene, blocker-cto]
related:
  - "[[00 — INDEX]]"
owner: gabriel
---

# Colisões de numeração — `docs/adr/`

Achado na limpeza do vault (2026-06-30). O diretório `docs/adr/` tem **dois pares
de arquivos com o mesmo número**, o que torna citações tipo "ADR-0002" / "ADR-0012"
ambíguas:

| Número | Arquivos em colisão |
|---|---|
| `0002` | `0002-copilot-v2-architecture.md` · `0002-quick-blast-bypasses-mass-send-role-gate.md` |
| `0012` | `0012-crm-mcp-customer-facing-pat.md` · `0012-unified-whatsapp-message-node.md` |

## Por que NÃO foi renumerado automaticamente

A faixa de números está **disputada por branches não-mergeadas**:

- `0014`/`0015` já estão **reservados** pela branch de Disparos (commits citam `ADR-0014`
  spreadsheet upsert e `ADR-0015` multi-número), mas ainda **não estão em `main`**.
- Os dois `0012` são **citados por docs recém-escritos** no vault (changelog crm-mcp C2
  aponta `0012-crm-mcp-customer-facing-pat.md`; ADR `send_to_number` aponta o
  `0012-unified-whatsapp-message-node`).

Renumerar agora na branch de limpeza **arriscaria criar colisões novas** quando essas
branches mergearem. É uma decisão de numeração que precisa do CTO com visão de todas as
branches em voo.

## Opções

1. **Mínima** — mover só os duplicados pra próximos números livres *não-reservados* (ex.:
   `0016`, `0017`), mantendo o resto. Quebra zero citação externa de `0003..0013`. Perde
   ordem cronológica dos movidos.
2. **Shift completo** — renumerar quick-blast→0003 e empurrar 0003→0004 … 0013→0014.
   Reescreve TODAS as citações `0003..0013` (PRs, commits, memória, vault) — alto custo,
   alto risco.
3. **Reservar faixa por branch** — adotar convenção (ex.: branch X usa 00NN..00NN+k) pra
   não colidir no futuro. Resolve a causa-raiz.

## Recomendação

Opção 1 + adotar a convenção da Opção 3. Decisão e execução = CTO (depende das branches em voo).
