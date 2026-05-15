---
type: adr
title: ADR-2026-05-15 — Consolidação de subagentes 10→3
status: accepted
created: 2026-05-15
updated: 2026-05-15
tags: [adr, subagentes, claude-code, harness, time]
related: ["[[Subagentes]]", "[[ADR-2026-04-27-refactor-agent-engine-modular]]"]
supersedes: ["ADR-2026-04-15-agente-security (não escrito; setup obsoleto)"]
owner: gabriel
---

# ADR-2026-05-15 — Consolidação dos subagentes do harness Claude Code (10 → 3)

**Data:** 2026-05-15
**Status:** aceita
**Escopo:** harness de desenvolvimento (subagentes do Claude Code), não toca produto (Copilot).

## Contexto

Setup anterior do harness operava com 10 subagentes especializados, evolução documentada em fragmentos:

| Marco | Setup | Evidência |
|---|---|---|
| Estado original | 6 agentes: Architect, Backend, Frontend, Security, QA, Documenter | `07 — Changelog/2026-04-30.md:13` |
| 2026-04-15 | +Security, +outros → 10 agentes | INDEX linha 85 ("9 → 10"); `Permissoes Sistema.md:85` |
| 2026-05-15 (CLAUDE.md atual) | 3 subagentes: `arquiteto`, `design`, `engenheiro` | `CLAUDE.md` raiz do projeto |

ADR formal da adição do Security (`ADR-2026-04-15-agente-security`) referenciado no INDEX mas nunca escrito. ADR formal da consolidação 10→3 nunca escrito. Esta ADR fecha lacuna documental retroativa + registra rationale.

## Forças em jogo

**Restrições operacionais (CTO + 1 dev junior):**
- Time pequeno. Overhead de coordenação entre 10 subagentes especializados maior que ganho por especialização em maioria de tasks.
- Maioria de tasks toca múltiplas camadas (fullstack + DB + tests) — splits artificiais geravam handoffs custosos.
- Junior dev se beneficia mais de pipeline previsível que de matriz de especialização.

**Restrições de qualidade:**
- Padrão world-class inegociável (`CLAUDE.md` global). Consolidar não pode degradar.
- Segurança não-negociável — sub-agente Security tinha poder de veto em mudanças sensíveis (auth/PII/RLS/multi-tenant). Esse veto não pode sumir.
- Design world-class (Apple/Airbnb/Linear/Stripe/Vercel) não-negociável.

**Restrições técnicas do harness:**
- Cada subagente extra = overhead de routing + context bloat no orquestrador.
- Skill `hm-designer` + `hm-engineer` + `hm-qa` já agregam disciplina sem precisar de subagente dedicado.

## Opções consideradas

### Opção (a) — Manter 10 subagentes especializados
Vantagem: especialização máxima, paralelismo natural.
Desvantagem: overhead de coordenação, custom para time atual, handoffs lentos. **Descartada.**

### Opção (b) — Achatar pra 1 só (orquestrador universal)
Vantagem: zero overhead de routing.
Desvantagem: sem disciplina de roteamento, sem entry/exit point claro, design e engenharia caem no mesmo balaio. **Descartada.**

### Opção (c) — 3 subagentes funcionais: arquiteto + design + engenheiro ⭐ ESCOLHIDA
Pipeline: `CTO → arquiteto → [design | engenheiro | ambos] → arquiteto (commit+push) → CTO`.
- **arquiteto** = entry/exit + sanity-check + roteamento + commit+push branch nova. Nunca implementa.
- **design** = UI/UX completo (visual + interação + microcopy + motion). Invoca skill `hm-designer`.
- **engenheiro** = fullstack (TS/React/Deno + DB/RLS/RPC + tests + segurança + docs Obsidian/`.specs` + auto-QA). Skills `hm-engineer` + `hm-qa` embutidas.

Vantagem: 1 entry point, 1 exit point, 2 executores. Roteamento trivial. Disciplina via skills, não via subagente extra. Junior previsível.
Desvantagem: arquiteto vira gargalo se sessão muito longa; engenheiro acumula responsabilidade ampla.

### Opção (d) — 5 subagentes: arquiteto + design + frontend + backend + security
Vantagem: split natural front/back; Security explícito.
Desvantagem: maioria de tasks fullstack faria 2 handoffs por padrão; Security puro raramente é gargalo (cobertura via seção obrigatória dentro de engenheiro). **Descartada.**

## Decisão

**Adotada opção (c).** Sub-decisões abaixo refletem o estado já em vigor em `CLAUDE.md` raiz.

### D1 — 3 subagentes funcionais
`arquiteto`, `design`, `engenheiro`. Definidos em `.claude/agents/` (verificar arquivos). Skills associadas: `arquiteto`, `design`+`hm-designer`, `engenheiro`+`hm-engineer`+`hm-qa`.

### D2 — Pipeline fixa
`CTO → arquiteto → [design | engenheiro | ambos] → arquiteto → CTO`. Sem atalhos.

### D3 — arquiteto nunca implementa
Roteamento, decisão arquitetural, commit, push. Implementação delegada sempre.

### D4 — Segurança via seção obrigatória dentro de engenheiro
Tasks sensíveis (auth/PII/RLS/multi-tenant): seção "Segurança" obrigatória no escopo do engenheiro. Poder de veto do antigo agente Security agora vive como gate explícito no template do engenheiro.

### D5 — Auto-QA dentro do engenheiro
Antigo subagente QA absorvido. engenheiro roda `hm-qa` antes de devolver pro arquiteto. QA não é mais step separado.

### D6 — Documenter absorvido pelo engenheiro
Obsidian (`Segundo Cerebro/`) + `.specs/` atualizados pelo engenheiro como parte do entregável. Skip se não aplica.

### D7 — Commit + push é responsabilidade exclusiva do arquiteto
Exit point. Sempre em branch nova nomeada pelo fix/feature. Nunca push direto em develop/main (memória `feedback_push_new_branch.md`).

### D8 — Default dev / prod só com pedido explícito
Deploy edge functions e migrations em prod: só com autorização direta do CTO na sessão. Default = branch + push (memórias `feedback_dev_only.md`, `feedback_never_deploy_prod.md`).

## Consequências

### Positivas
- Pipeline previsível pro junior dev.
- 1 entry point + 1 exit point — overhead de coordenação mínimo.
- Disciplina world-class preservada via skills (`hm-designer`, `hm-engineer`, `hm-qa`).
- Segurança preservada como gate dentro do engenheiro (não some, vira invariante explícito).
- Commit + push centralizado no arquiteto reduz risco de push em branch errada.

### Negativas
- arquiteto pode virar gargalo em sessões longas — mitigação: arquiteto é leve (decisão + roteamento, sem código).
- engenheiro acumula responsabilidade ampla (TS + Deno + DB + tests + sec + docs). Mitigação: skills isolam disciplina; engenheiro pula seções não aplicáveis.
- Especialização frontend/backend perdida — mitigação: maioria de tasks fullstack na real; benefício marginal.
- Risco de "seção Segurança" virar checkbox vazio em vez de gate real. Mitigação: revisão CTO em PRs sensíveis.

### Pendências geradas
- LOW: documentar prompt template de cada subagente em `.claude/agents/` (se não existe).
- LOW: registrar exemplos canônicos de roteamento em `[[Subagentes]]`.
- MEDIUM: rever em 60 dias se arquiteto realmente não virou gargalo; se virou, considerar opção (d).

## Alternativas rejeitadas

- **Manter 10 subagentes** — overhead > ganho pro tamanho do time.
- **Orquestrador único** — perde disciplina de entry/exit + design vs engenharia.
- **5 subagentes (split front/back + Security explícito)** — handoffs extras em tasks fullstack; Security funciona melhor como gate dentro do engenheiro que como subagente raramente invocado.

## Notas históricas

- Setup 6 → 10 registrado fragmentadamente; ADR-2026-04-15 prometido em `Permissoes Sistema.md:85` mas nunca escrito. Esta ADR fecha gap retroativo registrando consolidação 10→3 como estado vigente.
- Wikilinks órfãos no `00 — INDEX.md` da era 10-agentes (Permissoes, Comportamentos, Overview Segurança) devem ser limpos em pass separado de housekeeping do vault.
