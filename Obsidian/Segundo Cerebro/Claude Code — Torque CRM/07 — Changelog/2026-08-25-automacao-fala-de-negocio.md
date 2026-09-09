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
pr: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/pull/1822
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

## Aplicado em produção — 2026-08-25 ~14:05 UTC

PR #1822 mesclado (`2d2ad3d9`). As duas migrations foram aplicadas numa
transação só, pela receita cirúrgica (ensaio → asserções → ledger):

1. **Pré-voo**: as três funções que a migration faz `CREATE OR REPLACE` tiveram
   o `md5(prosrc)` conferido contra o que o ensaio usou — divergência abortaria
   antes de escrever. Colunas e índices confirmados ausentes.
2. **`SET LOCAL lock_timeout = '3s'`**: `ALTER TABLE` pega ACCESS EXCLUSIVE, e
   `workflow_executions` tem 28.750 linhas / 29 MB. Sem teto, a transação
   enfileira gravação de produção enquanto espera.
3. **Ensaio do arquivo EXATO** com `ROLLBACK`, e controle positivo provando que
   as asserções chegaram ao fim.
4. **Apply com `COMMIT` + ledger** — `20270827000010` e `20270827000020` em
   `supabase_migrations.schema_migrations`, com a versão do ARQUIVO.

Asserções pós-apply: 2 colunas em cada tabela, 4 FKs, 4 índices, os 3 gatilhos
carimbando o sujeito, e **0 linhas existentes tocadas**.

### Edge functions deployadas

`process-workflow-executions` (o motor), `agent-message`, `process-ai-actions`,
`webhook-new-lead`, `notificame-webhook`, `calculate-portfolio-health`.

Migration ANTES do deploy, não depois: o código novo escreve nas colunas novas,
e a ordem inversa faria todo INSERT de execução falhar.

### Medido em produção, 25 min depois

| | |
|---|---|
| `stage_changed` com o negócio gravado | **2 de 2** |
| `lead_created` com negócio | **0 de 3** — correto, gatilho da pessoa |
| Falhas / erros | **0** |

O primeiro `stage_changed` pós-apply gravou `pipeline_entry_id` e `deal_id` nulo
— a entrada não tem linha em `deals`. É o caso dos 26% que decidiu chavear na
entrada e não no negócio, aparecendo na primeira medição.

Front conferido por literal nos três chunks (`index`, `workflow`,
`AutomacoesEditor`) — está no ar.

## Fatia 6 — follow-up e ação do dia (mesmo dia, PR #1831)

Segunda decisão do CTO: *"follow-up e ação do dia seguem o checklist, do
negócio"*. Aplicada em prod às ~15:05 UTC, ledger `20270828000030`.

Duas diferenças em relação ao checklist, e as duas são de propósito:

**`ON DELETE SET NULL`, não CASCADE.** Uma tarefa tem dono e prazo e está na
agenda de alguém. Apagar o card não pode apagar o compromisso. O checklist do
negócio morre com o card porque sem card ele não tem assunto; a tarefa não.

**Aqui há backfill.** `follow_ups` já carregava meia-ponte — `source_pipe`
(text) + `source_pipe_id` (uuid, sem FK). Medido: **373 das 1.185 linhas já
diziam de qual card vieram**, e 63 apontavam para card que não existe mais.
Idem `acoes_do_dia.proposta_id` (10 de 10). Copiar isso registra um fato já
escrito; no checklist eu estaria inventando um. Números do apply, conferidos
pelo controle positivo antes do COMMIT: **373 / 10 / 63 órfãos preservados**.

### O ensaio pagou por si de novo

A guarda `f.lead_id = pe.lead_id` funciona em `follow_ups` (coluna NOT NULL).
Em `acoes_do_dia` ela descartava **as 10 linhas em silêncio**: todas têm
`lead_id` NULO — a ação sabe de qual card veio e não sabe de qual pessoa. A
guarda de lá virou "não contradiz", e o `lead_id` que falta é preenchido do
card no mesmo passo.

### De brinde

A aba "Atividades" do card do Negócio deixa de nascer vazia. Ela lia só
`activities`, que tem **0 linhas em produção** — abria vazia para todo mundo
desde que nasceu. Agora mostra as tarefas do negócio.

### Uma colisão de timestamp evitada

A migration nasceu `20270828000010` e colidiu com
`metrics_studio_panel_por_org`, que entrou na main enquanto isto era escrito.
Renomeada para `...030`. Colisão de prefixo faz o CLI pular uma delas em
silêncio, e o ledger dá falso verde.

## O que NÃO foi feito
- O card entrando no funil sem virar Negócio (353 contra 14) é assunto
  separado — `lead-webhook` cria o card e ninguém abre o negócio.

Ver `docs/adr/0031-o-sujeito-da-automacao-e-o-negocio.md` e
`docs/adr/0023-negocio-is-the-funnel-unit.md` — os ADRs moram no repo, não no vault.
