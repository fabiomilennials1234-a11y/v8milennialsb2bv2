# ADR — Modularização do Torque CRM via monolito modular — 2026-05-26

## Status
Proposta. Aguardando aprovação CTO.

## Contexto

Codebase do Torque CRM (~2 anos) cresceu organizado por **camada técnica** (hooks/components/pages/functions), não por **domínio**:

- 263 arquivos em `src/hooks/` — 250+ soltos no root, sem agrupamento.
- 97 edge functions em `supabase/functions/<nome>/` — sem subpastas por domínio.
- 35+ módulos no root de `supabase/functions/_shared/` misturando domínios (workflow, message gateway, copilot batch, retention gate, permission engine).
- Pastas frontend duplicadas por domínio: `lead/`, `lead-detail/`, `leads/`; `chat/`, `chat-meta/`; `pipelines/`, `pipe-propostas/`; `campanhas/`, `campaigns/`.
- 47 pages soltas no root com naming inconsistente.
- Sub-CLAUDE.md presentes em apenas 5 áreas frágeis; resto sem ownership documentado.

Time atual: CTO + 1 dev junior + 3 subagentes Claude Code. Mental model está na cabeça do CTO; sem âncoras físicas por domínio, AI agents se perdem e onboarding humano vira oral history.

CONTEXT.md (raiz) já documenta **14 bounded contexts** explícitos. A arquitetura lógica existe — só não está refletida na arquitetura física.

## Decisão

Adotar **monolito modular** como padrão de organização física. Reorganizar `src/` em `src/modules/<bc>/` e `supabase/functions/` em `supabase/functions/<bc>/<fn>/`, derivando módulos do CONTEXT.md.

Cada módulo:
- API pública via `index.ts` (ou pasta `public/`)
- Sub-CLAUDE.md descrevendo escopo, áreas frágeis, owner
- Cross-imports inter-módulo proibidos fora da API pública

Boundary enforcement:
- `eslint-plugin-boundaries` (warn → error após 2 slices)
- `dependency-cruiser` (grafo de deps, falha CI em ciclo)
- CI gate bloqueando PR que viola fronteira

Continua sendo **1 frontend + 1 Supabase**. Sem microsserviços. Sem comunicação via rede entre módulos do mesmo runtime.

## Fundamentação conceitual

Tese central de [Augusto Galego — "Acabou o hype de microsserviços. Voltamos pra 2010"](../../Clippings/(1197)%20Acabou%20o%20hype%20de%20microsserviços.%20Voltamos%20pra%202010.md):

> "Monolito modular: 1 aplicação, 1 banco, 1 deploy. Dentro, módulos por domínio com **contratos/interfaces** definindo o que entra e sai. Módulos não chamam funções uns dos outros — comunicam via API pública do módulo (ports and adapters, hexagonal)."

Aplica direto ao Torque pelas razões abaixo.

## Alternativas consideradas

| Opção | Por que NÃO |
|-------|-------------|
| **Status quo + doc melhor** | Não resolve blast radius nem onboarding. Documentação fica desatualizada sem âncora física. |
| **Microsserviços** | Overhead devops gigante (orquestração de deploys, logging distribuído, observabilidade distribuída, latência de rede, bancos separados). [Justifica-se acima de centenas de devs](../../Clippings/(1197)%20Acabou%20o%20hype%20de%20microsserviços.%20Voltamos%20pra%202010.md) — Torque tem 2 humanos + 3 AI agents. |
| **Microfrontends** | Mesmo problema. Monolito React funciona; fragmentar = custo > benefício. |
| **Reorganizar só `src/`** | Deixa `supabase/functions/` (metade do código de negócio) no caos. |
| **Domain-driven em arquivo (sem mover)** | Zero ganho de blast radius. AI agents continuam perdidos sem âncora física. |

## Consequências

### Positivas
- Onboarding linear: lê 1 módulo, entende 1 domínio.
- Blast radius limitado: PR toca 1-2 módulos.
- AI subagentes operam com âncoras claras (sub-CLAUDE.md por módulo).
- **Caminho aberto pra extrair módulo em serviço se um dia precisar** — interfaces já expostas, só troca call de função por GRPC (consequência diretamente apontada no vídeo do Augusto).
- Disciplina enforced por tooling (não depende de boa vontade).

### Negativas
- Custo único de ~80h refactor (18 slices, ~10 dias úteis 1 dev).
- Período transitório com codebase em 2 padrões (slice por slice).
- Disciplina contínua exigida (ESLint + revisão).

## Aplicabilidade ao Torque

Vídeo descreve **3 cenários** de organização:

1. **MVP single-dev** (Pieter Levels): monolito puro. Bota em 3-4 máquinas, acabou.
2. **Empresa média 10-50 devs**: monolito espaguete vira problema; microsserviços é overkill. **Monolito modular**.
3. **Big tech 100+ devs** (Uber/iFood/Google): microsserviços de verdade.

Torque está saindo do cenário 1 (MVP single-dev = CTO sozinho até pouco tempo) e indo pro cenário 2 (CTO + dev junior + 3 AI agents, planos de crescer). **Monolito modular é a janela exata**.

## Critérios de sucesso (overall)

- [ ] 0 arquivos no root de `src/components/`, `src/hooks/`, `src/pages/`
- [ ] 0 edge functions no root de `supabase/functions/`
- [ ] Cada módulo com `index.ts` + sub-CLAUDE.md
- [ ] ESLint `boundaries` em error mode + CI gate ativo
- [ ] CI verde + smoke manual OK
- [ ] CLAUDE.md raiz + AGENTS.md + llms.txt + vault atualizados
- [ ] Bundle size delta ±5%

## Plano de execução

Decomposto em 18 slices vertical thin, mergeáveis em `develop` independente. Detalhe completo em `.specs/features/modularizacao/SPEC.md`.

Branch atual: `feat/modularizacao/planejamento` (este ADR + SPEC).

## Reversibilidade

Parcialmente reversível:
- **Reversível**: tooling (ESLint config), estrutura (pode reverter um slice por vez).
- **Irreversível com ganho**: sub-CLAUDE.md por módulo — fica de qualquer forma como doc de domínio.

## Refs

- SPEC: [`/.specs/features/modularizacao/SPEC.md`](../../../.specs/features/modularizacao/SPEC.md)
- Glossário de domínio: `/CONTEXT.md` (14 BCs)
- Fundamentação: [Clipping — Augusto Galego — Monolito Modular](../../Clippings/(1197)%20Acabou%20o%20hype%20de%20microsserviços.%20Voltamos%20pra%202010.md)
- Regras de processo já firmadas:
  - `feedback_branch_discipline_during_feature.md` — só `feat/modularizacao/*` ou `hotfix/*` durante feature
  - `feedback_hotfix_during_feature.md` — protocolo hotfix sai de main, sync main→develop, rebase slices
