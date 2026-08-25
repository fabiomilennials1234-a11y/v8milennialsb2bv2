---
type: changelog
title: "A automação passa a falar de Negócio"
status: shipped
created: 2026-08-25
updated: 2026-08-25
tags: [changelog, workflows, pipelines, leads, engagement]
related: []
owner: gabriel
branch: feat/automacao-sujeito-negocio
pr: pendente
---

# 2026-08-25 — A automação passa a falar de Negócio

Pedido do CTO, sem issue: *"os workflows/automações já respondem à nova lógica de
leads ↔ negócios? sinto que ainda conversam com a antiga"*. Sentiu certo.

Decisão dele na sequência, sobre o caso que levantou o assunto: **checklist é DO
NEGÓCIO**.

## O que estava errado

O motor de automação tinha um sujeito só, e esse sujeito era a pessoa.
`ActionInput` — o contrato que as 30 actions recebem — carregava `leadId` e mais
nada. `workflow_executions` idem. Os dois gatilhos de etapa rodam EM CIMA da
entrada do funil, têm `NEW.id` e `NEW.deal_id` na mão, e jogavam os dois fora.

Medido em prod (25/08):

| | |
|---|---|
| Execuções em 30d sobre lead com 2+ negócios | **399 de 14.185** |
| Checklists de template em lead com 2+ negócios | **146 de 759 (19%)** |
| Entradas de funil sem linha em `deals` | **12.021 de 46.684 (26%)** |
| Cards criados desde 24/08 sem virar Negócio | **353 cards, 14 negócios** |

## As cinco fatias

| # | O quê | Muda comportamento? |
|---|---|---|
| 1 | O sujeito atravessa a cadeia e é gravado | **Não** — colunas nascem nulas |
| 2 | Dedup por Negócio | Só passa a disparar o que hoje é engolido |
| 3 | Ações de funil param de chutar | Só com negócio declarado |
| 4 | Checklist do Negócio | Coluna nova, sem backfill |
| 5 | Vocabulário do Negócio no editor | Aditivo |

## Decisões que valem registro

**A chave é a entrada, não o negócio.** `pipeline_entries.id` existe para 100%
dos cards; `deals.id` para 74%, e para ~3% dos criados desde 24/08. Chavear em
`deals` deixaria a automação cega para a maioria do que entra.

**Ganhar e perder são posições, não colunas.** `deal_won`/`deal_lost` derivam de
`stage_changed` pelo papel da etapa. Não leem `deals.won` porque o backfill
deixou 34.662 linhas com `won = false` de negócios que ninguém perdeu.

**O conteúdo entra por slot, o helper mora fora do adapter.** 20 arquivos de
teste dublam `pipeline-adapter` com fábrica — lista fechada. Export novo lá
derrubou 53 casos numa rodada. `_shared/negocio-subject.ts` resolve.

**Nada muda para quem já desenhou workflow.** O lead nunca sai do contrato, e
toda ação de funil cai no critério antigo quando não há negócio declarado.

## Verificação

- **Ensaio transacional contra PROD** nas duas migrations (BEGIN / migration /
  asserções / ROLLBACK), com **controle positivo** provando que o bloco chegou
  ao fim. O da fatia 4 exercita o defeito de verdade: dois negócios do mesmo
  lead passando pela etapa, cada um sai com o SEU checklist.
- 41 casos novos em 3 arquivos; `deal-card-checklists-panel` reescrito.
- 5 vermelhos do baseline consertados (`shared-action-handler-branches` — dublê
  do adapter defasado).
- `deno task test` 768/768; `typecheck:ratchet`, `lint:ratchet` e
  `test:ratchet` com **0 introduzidos**; build verde.

## O que NÃO foi feito

- Nenhuma migration aplicada em prod — as duas estão escritas e ensaiadas.
- Follow-up e ação do dia continuam da pessoa. É a próxima pergunta ao CTO.
- O card entrando no funil sem virar Negócio (353 contra 14) é assunto
  separado — `lead-webhook` cria o card e ninguém abre o negócio.

Ver [[ADR-0031]] e [[ADR-0023]].
