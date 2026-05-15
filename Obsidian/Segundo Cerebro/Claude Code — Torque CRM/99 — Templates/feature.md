---
type: feature
title: "<Nome da feature>"
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [<dominio>, <subtopico>]
area: chat | vendas | ia | admin | automacao | analytics | equipe | integracoes | infra
related: []
owner: unowned
---

# <Nome da feature>

> [!info] Ao mexer aqui
> Testar: <fluxo crítico>. Edge cases: <list>.

## O que é

<1-2 parágrafos descrevendo o que a feature faz, do ponto de vista do usuário
final. Não código — domínio.>

## Regras de negócio

- <regra 1>
- <regra 2>
- <regra 3>

## Fluxo principal

1. <passo>
2. <passo>
3. <passo>

## Edge cases conhecidos

- <case 1>
- <case 2>

## Onde vive no código

### UI / Frontend
- `src/pages/<...>.tsx` — <descrição>
- `src/components/<...>` — <descrição>

### Backend / Edge Functions
- `supabase/functions/<...>` — <descrição>

### Hooks / Lógica
- `src/hooks/<...>.ts` — <descrição>

### Schema / DB
- Tabelas: `<tabela>`, `<tabela>`
- RPCs: `<rpc>`
- Migrations chave: `<migration>`

## Permissões

| Action | Quem pode |
|---|---|
| <action> | master / admin / membro |

## Integrações

- <serviço externo / outra feature do produto>

## Testes

- Unit: `tests/unit/<...>.test.ts`
- Integration: `tests/integration/<...>.test.ts`
- E2E: `tests/e2e/<...>.spec.ts`

## ADRs relacionadas

- [[ADR-YYYY-MM-DD-slug]] — <decisão>

## Changelog

- YYYY-MM-DD — <mudança> ([[YYYY-MM-DD-slug]])
