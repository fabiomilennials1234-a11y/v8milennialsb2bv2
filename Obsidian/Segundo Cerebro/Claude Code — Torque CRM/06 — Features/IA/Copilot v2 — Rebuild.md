---
type: feature
title: Copilot v2 — Rebuild
status: design
created: 2026-05-29
updated: 2026-05-29
tags: [copilot, ia, rebuild, architecture]
related: ["[[Copilot]]"]
owner: gabriel
---

# Copilot v2 — Rebuild

> [!abstract] Design travado via grill-with-docs (2026-05-29)
> Reconstrução do Copilot do zero. Substitui o motor v1 ([[Copilot]]), instável e over-personalizado.
> Fonte: 5 web-clips em `Motor100/Obsidian/Clippings` (monolito modular, tracing Langfuse, guardrails, harness WhatsApp, RAG 3.0) + recon completo da v1.
> **ADR:** `docs/adr/0002-copilot-v2-architecture.md` · **SPEC:** `.specs/features/copilot-v2/SPEC.md`

## Por que reconstruir

v1 (medido no recon): `copilot_agents` 50+ colunas, ~20 JSONB free-text; capabilities **não gateadas** em runtime; sem tool-call budget; sem trace ponta-a-ponta; prompt ~20 seções/~9k tokens com truncamento silencioso; `bot-loop-detector` não plugado (incidente Bertin); ações NOOP que somem. Cliente edita prompt direto → spaghetti. Proposta não bate com B2B fábrica/distribuidora (que tem pós-venda).

## Os 3 arquétipos

| Arquétipo | Atende | Faz |
|-----------|--------|-----|
| **Qualificador** | lead novo/frio (anúncio, WhatsApp) | qualifica, seta `qualification_tier`, agenda discovery, handoff |
| **Vendedor** | lead qualificado | proposta, negocia, fecha, agenda, mídia aprovada |
| **Carteira** | cliente que já compra | recompra, upsell, resgate de dormindo |

Org habilita subset (≤1 de cada). Roteamento determinístico por `get_contact_status(phone)` + stage. Cada um = base prompt Torque-owned **imutável**; cliente nunca edita.

## As 12 decisões

1. 3 arquétipos, roteamento por contact-status + stage
2. Clean-slate total (fn + tabelas novas), **incidente → teste de regressão**
3. Qualificação híbrida: LLM extrai sinais → rúbrica determinística → `qualification_tier`
4. Contrato estrito: slots tipados + `companyParticularities` ≤1000c + escape-hatch ≤500c vigiado por LLM-linter. Capabilities **travadas por arquétipo** (server deriva do whitelist; cliente não edita)
5. Mídia de envio: gatilho estruturado + nuance + gate (máx 5 img/video)
6. Leitura Lead 360 + KB org + read-tools; **write sempre após introspect**
7. Guardrails: capability-gate, budget, loop-detector, output judge, input short-circuit (+ HITL toggle, PII v2); **notificação estruturada no handoff**
8. Tracing híbrido: trace_id + eval in-house agora, Langfuse depois
9. Wizard termina em simulador dry-run + botão eval-suite
10. Modelo por arquétipo (rápido Qualificador/Carteira, forte Vendedor)
11. Proatividade: first-touch ad + followup + resgate Carteira (massa → campaigns)
12. Acervos separados (envio vs conhecimento), ambos org-level, mídia→texto na ingestão

## Arquitetura (harness em camadas)

```
BORDA       ack · valida · rate-limit · normaliza phone · mídia→texto · debounce · enfileira
QUEUE       worker · retry · dead-letter
COGNIÇÃO    base prompt/arquétipo (trancado) + config injetada + RAG 1.5 + tool-loop real + budget
GUARDRAILS  input short-circuit · capability-gate · budget · output judge · loop-detector · HITL
SAÍDA       confirma envio · retry · dead-letter
OBSERV.     trace_id ponta-a-ponta · sessões · eval dataset · regression guard
SCHEDULER   first-touch · followup · resgate
```

## Incidentes que viram teste (condição do clean-slate)

human-pause phone-keyed (40% ai_disabled quebrado) · Bertin bot-loop · dedup race · `increment_conversation_turn` race · `is_group` chat vazio. Cada um vira caso no eval dataset, rodado a cada mudança de base prompt.

## Rollout

Milennials-first (dogfood, popular eval) → org-a-org (CTO re-preenche wizard, testa dry-run, flipa) → v1 coexiste até migrar tudo → decommission. Casa com o precedente Milennials-only do Copilot Builder.

## Wizard — toggle + 2 abas (redesign 2026-06-08)

O wizard de 12 seções planas misturava base imutável e dados-de-empresa, abrindo espaço pra misconfiguração. Redesenhado:

- **Toggle de personalidade** (qualificador/vendedor/carteira) = **navegação por rota** `/copilot/v2/:archetype` (radiogroup desktop com underline gold + status Ativo/Rascunho/Não criado; mobile = Select). Dirty-guard com `confirm` ao trocar.
- **Aba BASE (de fábrica, read-only)** — transmite solidez, nunca "desabilitado". Selo "Verificado pela Torque"; **tom em cards** com micro-exemplo (único editável da base); **capabilities como chips informativos** (não switches); accordion "Garantias" (Quem ele é · O que ele busca · Como ele age · **O que ele nunca faz** em verde · Segurança e limites). Conteúdo = `src/modules/copilot/lib/copilot-v2-base-narrative.ts` (`BASE_NARRATIVE`, curado à mão, **não regex do prompt**) protegido por `base-narrative-hash.test.ts`.
- **Aba ESPECIFICIDADES (editável)** — 5 grupos: Sua empresa · **Produtos e particularidades ★** (com `companyParticularities`) · Quem você atende · Como vender · Observações. `*` gold, validação on-blur.
- **Aba TESTAR** — o `SimulatorPanel` dry-run (criar E editar; aceita rascunho).
- **Criar = Editar** (mesmo layout 2-abas; stepper morto). Criar tem banner onboarding + prefill v1 visível; editar não.
- **Save**: 1 save transacional pras 2 abas; erro `not_activatable` pula pra aba do 1º campo faltante; tom faltando → aba Base.
- **Capabilities locked**: front envia o whitelist `true`; server re-deriva via `defaultCapabilitiesFor()` (payload do cliente ignorado). Activation "≥1 cap" sempre ok.
- **Novo slot `{{company_particularities}}`** injetado nos 3 base-prompts (subordinado a `commercial_policy`). `slots` JSONB → sem migration.

## Histórico

- 2026-06-08 — Wizard redesign (toggle + 2 abas Base/Especificidades + companyParticularities + capabilities locked). Changelog: `07 — Changelog/2026-06-08-copilot-v2-wizard-redesign.md`.

## Glossário relacionado

Termos canônicos atualizados em `CONTEXT.md`: **Qualification Tier** (enum diamante>ouro>prata>bronze>desqualificado, ≠ tag) e os 3 **Archetypes**.
