---
type: feature
title: "Automações — Trigger Negócio Criado + Node Criar Negócio"
status: active
created: 2026-08-24
updated: 2026-08-24
tags: [workflows, negocios, deals, automacao]
area: automacao
related: []
owner: gabriel
---

# Trigger `deal_created` + Node `create_deal`

Par de peças que liga o módulo **Negócios** (`deals`) ao motor de automações: um gatilho que dispara quando um negócio nasce e um node de ação que cria o negócio a partir de um lead.

## Por que existe

`deals` existia sem porta de entrada automática. Negócio só nascia na mão, na tela de Negócios, e nada acontecia depois que nascia. Faltavam os dois lados: o produtor (automação cria negócio quando o lead atinge a condição de venda) e o consumidor (a criação do negócio inicia a esteira de fechamento).

## Node — Criar Negócio (`create_deal`)

Categoria **Negócios** no picker de ações. Config (`ActionNodeData`):

| Campo | Efeito |
|---|---|
| `dealTitleTemplate` | Título; aceita variáveis (`{{nome}}`, `{{empresa}}`). Default `Negócio — {{nome}}` |
| `dealValueMode` | `fixed` (valor digitado) ou `proposal` (lê `pipeline_entries` do pipe propostas → `metadata.sale_value`) |
| `dealValue` | Valor fixo, quando `fixed` |
| `dealProbability` | 0–100, clampado no handler. Default 50 |
| `dealOwnerMode` / `dealOwnerId` | Responsável do lead (cascata `responsible_id` → `sale_responsible_id` → `closer_id` → `pre_sale_responsible_id` → `sdr_id`) ou membro fixo |
| `dealExpectedCloseDays` | Offset em dias → `expected_close_date` |
| `dealNotes` | Observações; aceita variáveis |
| `dealSkipIfOpenExists` | Default **true** — não cria segundo negócio aberto (`won IS NULL`) para o mesmo lead |

Handler: `_shared/action-handlers/deal-operations.ts`. Sempre grava `source_lead_id` — negócio de automação nasce vinculado. Sem lead na execução o node falha explicitamente (`retryable: false`).

Expõe para os nós seguintes: `{{negocio_id}}`, `{{negocio_titulo}}`, `{{negocio_valor}}` (e `deal_id` no contexto).

**Não configura pipeline/stage — as colunas não existem em prod.** Medido em 2026-08-24: `public.deals` em produção não tem `pipeline_id` nem `stage_id`, embora `src/integrations/supabase/types.ts` os declare (drift do types.ts, gerado contra outro projeto). A tela de Negócios lê `deal.stage_id` e por isso empilha tudo em "Sem estágio". Node e trigger seguem o schema real.

## Trigger — Negócio Criado (`deal_created`)

PG trigger `trg_workflow_deal_created` (AFTER INSERT em `deals`) → `fire_workflow_trigger`. Migration `20270213000000_workflow_trigger_deal_created.sql`.

Lead do workflow = `deals.source_lead_id`. Contexto: `deal_id`, `deal_title`, `deal_value`, `owner_id`, `created_by_workflow` + aliases pt-BR.

Filtros (`trigger_config`, validados em `matchesTriggerConfig`):

- `require_lead` — **default true, fail-closed**. Negócio sem lead não tem quem receber mensagem/tag/etapa; o downstream inteiro assume lead.
- `source` — espelha `deals.source`: `any` | `human` | `workflow` | `api` | `import`
- `min_value`, `filter_owner_id`

## Guard de laço

`create_deal → deal_created → create_deal` é laço óbvio. Corte em duas camadas:

1. O handler grava `metadata.workflow_execution_id`; o PG trigger lê esse campo e o passa como `p_triggered_by_execution_id` — o `chain_depth` (máx. 5) de `fire_workflow_trigger` corta a cadeia.
2. `dealSkipIfOpenExists` (default) impede o segundo negócio aberto do mesmo lead.

Negócio inserido já com `deleted_at` (import/backfill) não dispara.

## Onde roda

Como todo action node: só no worker `process-workflow-executions`. O trigger apenas enfileira em `workflow_executions`; os filtros de `trigger_config` são avaliados no worker antes do primeiro node.

## Procedência (`deals.source`)

`public.deals` exige procedência: CHECK `deals_source_check` (`human`/`workflow`/`api`/`import`/`backfill`)
mais o trigger `fn_deals_exige_procedencia`, que recusa o INSERT com "Procedência é obrigatória ao
abrir um Negócio". O node grava `source = 'workflow'`, e o trigger propaga `deal_source` no contexto
(`created_by_workflow` é derivado dele, não mais de `metadata`).

Isso chegou em prod **depois** do pré-voo desta feature e só apareceu no smoke em produção — o
ensaio transacional tinha rodado contra um schema sem a regra. Migration de correção:
`20270824050000_deal_created_trigger_usa_deals_source.sql`.

## Estado em prod (2026-08-24)

Migration aplicada em prod e registrada no ledger (`supabase_migrations.schema_migrations`,
version `20270213000000`). Trigger habilitado em `public.deals` — que tem **34.966 linhas
e ~150 inserções/dia em 69 orgs**, todas com `source_lead_id`. Enquanto nenhuma org tiver
workflow com `trigger_type = 'deal_created'`, o custo por INSERT é um SELECT indexado em
`workflows` (org + trigger_type) e zero execuções.

Smoke end-to-end em prod (2026-08-24, dados removidos depois): node criou o negócio com título
resolvido pela variável, `source=workflow`, dono herdado do lead e `metadata.workflow_execution_id`;
o INSERT disparou `deal_created` com `chain_depth = 1` e `triggered_by_execution_id` apontando para
a execução que o criou; ambas as execuções terminaram `completed`.

O ensaio transacional contra prod (BEGIN/asserções/ROLLBACK) cobriu: insert sem workflow → 0
execuções; com workflow ativo → 1 execução e contexto correto; `deleted_at` → pula;
`metadata.workflow_execution_id` → `chain_depth > 1`; metadata com uuid inválido → INSERT não
quebra. `deals.value` é `numeric`, então `deal_value`/`{{negocio_valor}}` vêm com escala
(`2500.00`) — comparar como número, nunca como texto.

## Deploy

Migration + redeploy de `process-workflow-executions` (importa `_shared/workflow-*`). Sem o redeploy, execuções `deal_created` entram na fila e o worker antigo não conhece o node `create_deal`.

## Relacionado

- Histórico: o módulo Negócios já esteve ligado em 3 orgs com 0 registros. Hoje prod tem 34.966 negócios em 69 orgs.
- [[copy-paste-nodes]], [[marcar-item-checklist]] — outros nodes do editor.
