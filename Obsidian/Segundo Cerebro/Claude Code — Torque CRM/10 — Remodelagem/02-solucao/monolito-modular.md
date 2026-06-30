---
type: reference
title: Solução — Monolito Modular
status: archived
created: 2026-05-26
updated: 2026-05-28
tags: [remodelagem, solucao, arquitetura]
related:
  - "[[ADR-2026-05-26-modularizacao-monolito-modular]]"
  - "[[ADR-2026-05-28-modularizacao-conclusao]]"
  - "[[event-bus]]"
  - "[[boundary-enforcement]]"
---

# Solução — Monolito Modular

> [!success] IMPLEMENTADO — 2026-05-28
> Decisão executada (slices 0–19 merged em `develop`). Encerramento em [[ADR-2026-05-28-modularizacao-conclusao]].

Decisão arquitetural raiz. Detalhe formal em [[ADR-2026-05-26-modularizacao-monolito-modular]].

## A decisão

Adotar **monolito modular** como padrão de organização física. Reorganizar `src/` em `src/modules/<bc>/` e `supabase/functions/` em `supabase/functions/<bc>/<fn>/`, derivando módulos do CONTEXT.md.

Continua sendo **1 frontend + 1 Supabase**. Sem microsserviços. Sem comunicação via rede entre módulos do mesmo runtime.

## Por que não as alternativas

| Opção | Por que NÃO |
|-------|-------------|
| **Status quo + doc melhor** | Não resolve blast radius nem onboarding. Documentação fica desatualizada sem âncora física. |
| **Microsserviços** | Overhead devops gigante (orquestração, observabilidade distribuída, latência de rede, bancos separados). Justifica-se acima de 100+ devs. Torque tem 2 humanos + 3 AI agents. |
| **Microfrontends** | Mesmo problema. Monolito React funciona. Custo > benefício. |
| **Reorganizar só `src/`** | Deixa 97 edge functions + 63 `_shared/` no caos. Metade do código de negócio fica intocado. |
| **DDD em arquivo (sem mover)** | Zero ganho de blast radius. AI agents continuam perdidos sem âncora física. |

## Fundamentação conceitual

Clipping [Augusto Galego — "Acabou o hype de microsserviços. Voltamos pra 2010"](../../../Clippings/(1197)%20Acabou%20o%20hype%20de%20microsserviços.%20Voltamos%20pra%202010.md).

Três cenários de organização:

1. **MVP single-dev** (Pieter Levels): monolito puro. Bota em 3-4 máquinas, acabou.
2. **Empresa média 10-50 devs**: monolito espaguete vira problema; microsserviços é overkill. **Monolito modular**.
3. **Big tech 100+ devs**: microsserviços de verdade.

Torque saiu do cenário 1 e está entrando no cenário 2. **Janela exata**.

Citação central:
> "Monolito modular: 1 aplicação, 1 banco, 1 deploy. Dentro, módulos por domínio com **contratos/interfaces** definindo o que entra e sai. Módulos não chamam funções uns dos outros — comunicam via API pública do módulo (ports and adapters, hexagonal)."

## Regras do módulo

Cada módulo:
- **API pública via `index.ts`** (ou pasta `public/`)
- **Sub-CLAUDE.md** descrevendo escopo, áreas frágeis, owner
- **Cross-imports inter-módulo proibidos** fora da API pública
- **1 entidade primária** com lifecycle
- **Owner mental claro** (vendas, comunicação, ops, finance)
- **Pode ser entregue/removido sem quebrar outros**

## Bounded contexts (14)

Derivados de CONTEXT.md. Detalhe em [[bounded-contexts]].

`identity` · `leads` · `pipelines` · `communication` · `copilot` · `workflows` · `campaigns` · `carteira` · `engagement` · `analytics` · `billing` · `marketing` · `integrations` · `platform`

## Cross-cutting (não-módulo)

- `ui/` — primitivos shadcn (mantém intacto)
- `shared/` — utils puros sem dependência de domínio (`cn`, `format`, `normalizePhone`, `optimistic-lock`)
- `core/` — supabase client, types globais, env, sentry init

## Caminho aberto pra extrair em serviço (consequência diretamente apontada no vídeo)

> "Se eu quiser pegar um módulo desse — módulo de IA, por exemplo —, pô, a gente quer botar IA pra rodar nas nossas próprias GPUs, então vai se comunicar via network, vai ter que sair daqui do nosso monolito. As interfaces já estavam expostas. Só o que eu preciso trocar é como se comunica. Antes era uma chamada de função ali nas interfaces, agora é uma chamada via GRPC. Pronto."

Mesmo princípio aplicado ao Torque: se um dia Copilot precisar de GPU dedicada → extrai pra serviço com mínimo refactor.

## Não-objetivos

- Reescrita de regras de negócio (comportamento idêntico antes/depois)
- Mudança de schema DB
- Migração de provider (Evolution→Uazapi já feita)
- Mudança de stack de hooks (manter `useQuery`/`useMutation`)
- Mudança visual (zero pixel)
- Refactor de Copilot internals (sub-projeto separado)

## Refs

- [[ADR-2026-05-26-modularizacao-monolito-modular]]
- [Clipping fundamentação](../../../Clippings/(1197)%20Acabou%20o%20hype%20de%20microsserviços.%20Voltamos%20pra%202010.md)
- [[event-bus]] — como módulos conversam
- [[boundary-enforcement]] — como fronteiras são forçadas
- [[bounded-contexts]] — 14 BCs detalhados
- [[estrutura-final]] — layout target
