---
type: reference
title: To-Be — Princípios do Módulo
status: concluido
created: 2026-05-26
updated: 2026-05-28
tags: [remodelagem, to-be, principios]
related: ["[[monolito-modular]]", "[[boundary-enforcement]]", "[[ADR-2026-05-28-modularizacao-conclusao]]"]
---

# To-Be — Princípios do Módulo

> [!success] EM VIGOR — 2026-05-28
> Princípios aplicados e enforced (ESLint `boundaries` error mode + CI gate) após a conclusão das slices. Ver [[ADR-2026-05-28-modularizacao-conclusao]].

Regras invariantes que todo módulo respeita.

## 1. API pública via `index.ts`

Cada módulo expõe um único ponto de entrada: `src/modules/<bc>/index.ts`.

Tudo que outros módulos consomem deve estar exportado lá. Internals (sub-pastas) são privados — proibidos de import cross-module.

```typescript
// src/modules/leads/index.ts
export { useLead, useLeads, useLeadTimeline } from "./hooks";
export { LeadCard, LeadModal } from "./components";
export type { Lead, LeadStatus } from "./types";
// Tudo mais (LeadInternalForm, useLeadInternalState) NÃO exportado.
```

Consumo:
```typescript
// ✅ Permitido
import { useLeads, LeadCard } from "@/modules/leads";

// ❌ Bloqueado por ESLint
import { LeadInternalForm } from "@/modules/leads/components/internal/LeadInternalForm";
```

## 2. Sub-CLAUDE.md obrigatório

Cada módulo tem `src/modules/<bc>/CLAUDE.md` ou `supabase/functions/<bc>/CLAUDE.md`. Conteúdo mínimo:
- **Escopo**: o que este módulo faz
- **Não-escopo**: o que NÃO faz (delegado a quem)
- **Entidade primária**: tabelas e lifecycle
- **API pública**: o que está em `index.ts` e por quê
- **Áreas frágeis**: edge cases, bugs históricos, gotchas
- **Owner**: humano + AI agent
- **Refs**: vault, ADRs, backlog

## 3. Cross-imports inter-módulo proibidos fora da API pública

Enforced por `eslint-plugin-boundaries` + `dependency-cruiser` + CI gate. Detalhe em [[boundary-enforcement]].

Exceção: cross-cutting (`ui/`, `shared/`, `core/`) — importáveis de qualquer lugar.

## 4. 1 módulo = 1 bounded context

Não 2. Não 0.5. Se está pensando em criar `modules/lead-tagging/` separado de `modules/leads/` — provavelmente lead-tagging é submódulo de leads (sub-pasta interna), não BC autônomo.

Critério de classificação em [[bounded-contexts]].

## 5. Comunicação cross-module via evento (post slice 19)

Acoplamento direto (chamar função de outro módulo) é exceção, não regra. Default: **publicar evento**, outro módulo registra handler.

Detalhe em [[event-bus]].

Casos onde acoplamento direto é OK:
- Read-only de tipos (`import type { Lead }`)
- Query utilities sem side-effect (`getLeadById`)
- Componentes UI (`<LeadCard lead={...} />`)

Side-effects (mutations, workflows, fanout) → evento.

## 6. Self-contained

Módulo pode ser entregue/removido sem quebrar outros. Se deletar `modules/copilot/` quebra `modules/leads/` — fronteira errada.

Teste: comentar `export * from "./modules/copilot"` no `app/index.ts` raiz. Outros módulos compilam? Se não, há leak.

## 7. Owner mental claro

Quem é dono do módulo? Vendas, comunicação, ops, finance, plataforma. Documentado em sub-CLAUDE.md.

Sem owner = sem responsabilidade = código apodrece.

## 8. Sem `actions/` ambíguo

Nomenclatura interna do módulo é livre, mas convenção sugerida:
- `components/` — React components
- `hooks/` — React hooks (`useXxx`)
- `pages/` — route components
- `lib/` — utils internos do módulo
- `types.ts` — types públicos
- `events.ts` — handlers de evento publicados pelo módulo
- `index.ts` — API pública

Evitar `actions/`, `helpers/`, `utils/` no root do módulo — ambíguos.

## 9. Tests co-located

`Foo.tsx` + `Foo.test.tsx` no mesmo diretório. Tests de módulo ficam dentro do módulo.

Tests cross-module (integration) → `tests/integration/<feature>.test.ts`.

## 10. Migrations e edge functions seguem mesma estrutura

Backend espelha frontend:
- `supabase/functions/<bc>/<fn>/index.ts` — função do módulo
- `supabase/functions/_shared/<bc>/` — utils do módulo compartilhados entre suas funções
- `supabase/functions/_shared/core/` — utils cross-cutting

Migration permanece global (`supabase/migrations/`) — schema é compartilhado, não há "schema do módulo". Convenção: nome de migration referencia BC (`20260526120000_leads_add_qualification_score.sql`).

## Refs

- [[monolito-modular]] — decisão raiz
- [[boundary-enforcement]] — como é forçado
- [[event-bus]] — comunicação cross-module
- [[bounded-contexts]] — 14 BCs
