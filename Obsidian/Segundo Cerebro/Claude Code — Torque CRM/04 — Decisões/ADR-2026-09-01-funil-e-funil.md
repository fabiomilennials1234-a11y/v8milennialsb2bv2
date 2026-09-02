---
type: adr
title: "Funil é funil — um tipo de funil, comportamento por stage_role, nunca por slug"
status: accepted
created: 2026-09-01
updated: 2026-09-01
tags: [adr, funis, pipelines, negocio, multi-tenant]
related: []
owner: gabriel
supersedes: []
superseded_by: []
---

# ADR-2026-09-01 — Funil é funil

**Data:** 2026-09-01
**Status:** accepted (grill com o CTO, 2026-09-01)
**Fonte canônica:** `docs/adr/0034-funil-e-funil.md` (este espelho resume; o repo decide)
**Escopo:** `pipelines`, `pipeline_stages`, `pipeline_entries`, views `custom_*`, `_shared/pipeline-adapter.ts`, ~20 RPCs `p_pipeline_type`, `lead-webhook`, API v1
**Relações:** completa ADR-0023 (Negócio é a unidade do funil); emenda ADR-0030 (Procedência — Amendment 1, mesma data); apoia-se em ADR-0031 (sujeito da execução). Plano: `.specs/features/funis-unificacao/spec.md` (D1–D11, F0–F6).

## Contexto

Dois cidadãos onde o mercado tem um. Produção, 2026-09-01:

- 47,7 mil entradas de funil; **34,7% já em 79 funis custom de 45 orgs** — um terço da operação no cidadão de segunda classe.
- Matriz de paridade do custom quase vazia: sem disparo por etapa, sem Copilot, sem analytics, sem filtros/saved views/bulk, sem paginação (trunca em 1.000 em silêncio), sem export dinâmico; `api_move_deal` recusa com `custom_pipeline_not_supported`.
- Comportamento pendurado no slug: `PipeSlug` fechado + filtro `type='system'` no adapter; ~20 RPCs `p_pipeline_type text`; CHECK de 5 valores literais em `pipeline_stages`; `lead-webhook` responde **200 e descarta** slug desconhecido.
- A parte difícil já foi feita (Wave 1): pipes de sistema viram views sobre `pipeline_entries`; `pipelines` é registro único; 16.565 entries custom 100% espelhadas; comissão/gamificação já disparam por `stage_role` → `sale_events` (funil custom **já** gera comissão); `stage_role` populado nas 4,2 mil etapas.
- O layout canônico não descreve os funis reais: **283 dos 396 funis ativos (71%) não têm etapa `won`** (Emenda 1 do ADR-0023).

## Decisão

1. **Um tipo de funil (D1).** Todo funil é criado, renomeado, editado e deletado pelo usuário. Os de fábrica são **seed** na criação da org (server-side; `ensureDefaultStagesInDb` do front morre). Os 3 slugs antigos viram aliases dos funis semeados. Nenhum comportamento em slug — só configuração explícita ou `stage_role`. `pipelines.type` fica sem leitor: vira marca de origem do seed, sem efeito.
2. **Etapa por UUID (D3).** `pipeline_stages.pipeline_id` FK real; `pipeline_entries.stage_id` NOT NULL; `stage_key` vira espelho transitório por trigger até a última view de compat cair. Papel da etapa = `stage_role`. Trilha default é seed, não lei. Deletar etapa com cards exige "mover os N cards para ___".
3. **Destino por porta; um fallback (D4).** Cada porta de entrada declara o destino na própria config (webhook, import, Cal.com, agente Copilot, nó de workflow); o único fallback é o **funil padrão** da org. **Receita = negócio ganho em qualquer funil**: etapa `stage_role='won'` marca desfecho via `deals.outcome` → `sale_events`, cadeia já agnóstica de funil.
4. **Espelhos com data pra morrer (D5).** `custom_pipe_entries`/`custom_pipelines`/`custom_pipeline_stages` viram views com INSTEAD OF (playbook Wave 1). Entregue = espelhos removidos (F6), com zero leitura em 7 dias de `runtime_logs` antes de cada DROP.

## Opções rejeitadas

- **(B) Manter os 2 funis semeados "protegidos"** — preserva o if/else que produz a paridade vazia; cada feature nova continuaria escrita 2× ou 1× só pro lado system.
- **Papéis de funil como enum** — slug com outro nome; 71% dos funis ativos já não seguem o layout que o enum previu. O papel que sobrevive é o da **etapa** (`stage_role`).
- **Funil tipado por sujeito (pessoa vs negócio)** — o mercado (Pipedrive, HubSpot, Kommo) põe Deal em todo pipeline com valor opcional; dois sujeitos = duas APIs, duas métricas, e "quanto vale este funil" sem resposta em metade do produto. Negócio de R$ 0 é normal.

## Consequências

- **Comportamento novo pendurado em slug é regressão** — revisão barra; lint R3 já barra em métrica; os 6 `metric-lint-allow` são dívida com prazo (F3).
- Webhook **erra alto**: funil inexistente → 4xx (fim do 200 + descarte); levantamento dos robôs n8n antes da virada (F0); aliases seguram quem não migrou.
- Todo card é Negócio (D2, Emenda 1 do ADR-0030): backfill **1 Negócio por card custom**, procedência `backfill_funil_custom`, valor nulo.
- Pendurar comportamento em slug de seed quebra na primeira org que renomear/deletar o funil semeado — direito que a D1 dá a todas.
- Aceito: aliases dos 3 slugs pra sempre na API (aditivo, D10 — 73 chaves em 49 orgs não quebram); espelhos temporários até F6; janelas de prod aprovadas pelo CTO uma a uma (D7), piloto Milennials → lotes.

## Efeitos no vault

- [[Glossario]] / `CONTEXT.md`: verbetes **Pipeline** (some "System pipes"; todo funil editável; fábrica = seed; slug = alias), **Stage** (identidade UUID; papel `stage_role`; trilha default é seed), **Negócio** (ocupa etapa em qualquer funil; valor opcional; nasce ao entrar no funil por porta explícita) e **Procedência** (+`webhook`, +`backfill_funil_custom`) atualizados em 2026-09-01.
