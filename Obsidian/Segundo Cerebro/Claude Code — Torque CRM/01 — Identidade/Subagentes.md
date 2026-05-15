---
type: identity
title: Subagentes — Time Claude Code
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [identidade, subagentes, claude-code, harness, time]
related: ["[[ADR-2026-05-15-consolidacao-subagentes]]", "[[Copilot]]"]
owner: gabriel
---

# Subagentes — Time Claude Code (Torque CRM)

Pipeline de execução do harness Claude Code neste projeto. **Não confundir** com agentes do produto Copilot (IA conversacional pra leads — ver [[Copilot]]).

Fonte canônica: `CLAUDE.md` raiz do projeto. Este doc expande contexto e exemplos.

## Pipeline

```
CTO → arquiteto → [design | engenheiro | ambos] → arquiteto (commit+push) → CTO
```

Regra: **arquiteto é entry point e exit point obrigatório.** Sem atalhos.

## Os 3 subagentes

### arquiteto

**Função:** porta de entrada e saída do harness. Sanity-check estratégico (vale fazer?), desenho arquitetural quando aplicável, roteamento pra design/engenheiro, e ao final fecha ciclo com **commit + push em branch nova**.

**Skill associada:** `arquiteto`.

**Nunca implementa.** Decide, roteia, commita.

**Quando invocar diretamente:**
- Decisão arquitetural ("vale migrar X pra Y?")
- Sanity-check de feature ("vamos adicionar gamificação?")
- Avaliação de fit estratégico
- Routing ambíguo

**Exit checklist (ao final do ciclo):**
1. Branch nova criada com nome do fix/feature
2. Commit message clara (conventional commits)
3. Push pra origin (nunca direto em main/develop — memória `feedback_push_new_branch.md`)
4. Resumo do trabalho devolvido pro CTO

### design

**Função:** UI/UX completo. Visual, interação, microcopy, motion. Padrão world-class — Apple, Airbnb, Linear, Stripe, Vercel. Dark-first. Sensibilidade cinematográfica.

**Skill associada:** `design` (invoca `hm-designer` para validação).

**Quando invocar:**
- Criar tela nova
- Refinar tela existente
- Review visual de componente
- Definir interação/microcopy
- Escolher padrão de display

**Princípios não-negociáveis (`CLAUDE.md` global):**
- Se parece template → reprovou
- Se poderia pertencer a qualquer produto → reprovou
- Se escolheu opção segura em vez de opção certa → reprovou

**Output esperado:** spec visual completa (estados, interações, motion, microcopy) pronta pra engenheiro consumir. Não escreve código de produção.

### engenheiro

**Função:** fullstack. TS/React/Deno + DB/RLS/RPC + tests + segurança + docs Obsidian/`.specs` + auto-QA. Implementação ponta-a-ponta.

**Skills associadas:** `engenheiro` + `hm-engineer` + `hm-qa` (embutidas no fluxo).

**Quando invocar:**
- Bug fix
- Refactor
- Schema change / migration
- Edge function nova ou alterada
- Feature técnica sem UI nova
- Implementação após spec do design

**Cobertura padrão (pula seções não aplicáveis):**
1. **Impl** — código de produção
2. **DB** — migration, RLS, RPC, índices
3. **Tests** — Vitest (unit/integration) + Playwright (E2E) quando relevante
4. **Segurança** — seção obrigatória se task toca auth/PII/RLS/multi-tenant
5. **Docs** — Obsidian (`Segundo Cerebro/`) + `.specs/` atualizados
6. **Auto-QA** — `hm-qa` antes de devolver pro arquiteto

**Output esperado:** diff completo + migration aplicada (se aplicável) + tests rodando + docs atualizados.

## Roteamento (matriz de decisão)

| Tipo de task | Pipeline |
|---|---|
| Conversacional / sanity-check | só arquiteto |
| Decisão arquitetural | só arquiteto |
| Bug fix backend / refactor / schema / edge fn | arquiteto → engenheiro → arquiteto |
| Visual / modal feio / microcopy errado | arquiteto → design → arquiteto |
| Feature UI completa (visual + impl) | arquiteto → design + engenheiro (paralelo) → arquiteto |
| Componente novo com lógica nova | arquiteto → design → engenheiro → arquiteto |

## Invariantes não-negociáveis

1. **arquiteto nunca implementa.** Só decide, roteia, commita.
2. **engenheiro cobre Impl+DB+Tests+Security+Docs** (pula o que não aplica). QA antigo absorvido como auto-QA.
3. **design invoca `hm-designer`** pra validação visual.
4. **Tasks sensíveis (auth/PII/RLS/multi-tenant) = seção Segurança obrigatória** no engenheiro. Antigo veto Security vive aqui como gate explícito.
5. **Commit + push é exclusividade do arquiteto.** Sempre branch nova.
6. **Default = dev.** Prod (deploy edge fn / migration apply em prod) só com pedido explícito do CTO na sessão. Memórias `feedback_dev_only.md`, `feedback_never_deploy_prod.md`.
7. **Push sempre em branch nova** nomeada pelo fix/feature. Nunca direto em main/develop. Memória `feedback_push_new_branch.md`.

## Exemplos canônicos

### Exemplo 1 — Decisão estratégica
> CTO: "vamos adicionar gamificação pros gestores?"

→ **arquiteto** avalia fit (alinha com produto? complexidade? prioridade?), se sim desenha arquitetura, roteia pra design + engenheiro. Ao final commita + push.

### Exemplo 2 — Bug específico
> CTO: "botão salvar não invalida query"

→ **arquiteto** roteia direto pro **engenheiro**. engenheiro localiza, fixa, testa, atualiza docs se aplicável. arquiteto commita + push.

### Exemplo 3 — Refino visual
> CTO: "modal de reagendar tá feio"

→ **arquiteto** roteia pro **design**. design refina (visual + microcopy + interação). Se mudou código de produção, **engenheiro** implementa. arquiteto commita + push.

### Exemplo 4 — Feature completa
> CTO: "quero página nova de oraculo comercial com dashboard de forecasting"

→ **arquiteto** desenha arquitetura, roteia **design + engenheiro em paralelo** (design entrega spec; engenheiro entrega schema/RPCs/hooks). Convergem. arquiteto commita + push em branch nova.

### Exemplo 5 — Migration sensível
> CTO: "muda RLS de products pra fechar leak"

→ **arquiteto** roteia pro **engenheiro** com flag de task sensível. engenheiro cobre Impl+DB+Tests+**Segurança** (seção obrigatória)+Docs. arquiteto revisa diff de segurança, commita + push. Aplicação em prod **só** com pedido explícito.

## Histórico de evolução

| Data | Setup | Decisão |
|---|---|---|
| Original | 6 agentes (Architect, Backend, Frontend, Security, QA, Documenter) | `07 — Changelog/2026-04-30.md` |
| 2026-04-15 | +Security explícito → 10 agentes | INDEX referência (ADR não escrita) |
| 2026-05-15 | Consolidação → 3 agentes | [[ADR-2026-05-15-consolidacao-subagentes]] |

## Skills disponíveis (refs)

| Skill | Owner subagente | Função |
|---|---|---|
| `arquiteto` | arquiteto | entry/exit, sanity-check, roteamento, commit+push |
| `design` | design | UI/UX world-class |
| `hm-designer` | design | validação visual contra padrão |
| `engenheiro` | engenheiro | fullstack impl |
| `hm-engineer` | engenheiro | validação de código (todas camadas) |
| `hm-qa` | engenheiro | auto-QA antes de devolver |
| `hm-init` | arquiteto | start de projeto novo |
| `hm-align` | arquiteto | checar se é a coisa certa pra construir |

## Não confundir

- **Subagente do harness Claude Code** = ferramenta interna do dev (arquiteto, design, engenheiro). Este doc.
- **Agente do produto Copilot** = IA conversacional que fala com leads via WhatsApp/SZ.Chat. Ver [[Copilot]].
- **Agente IA de campanha** = mesma coisa que Copilot, apenas attached a uma campanha específica.
