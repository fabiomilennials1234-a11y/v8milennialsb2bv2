---
type: feature
title: "Automações — Trigger Negócio Criado + Node Criar Negócio"
status: active
created: 2026-08-24
updated: 2026-09-04
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

**Não configura pipeline/stage em `deals`.** Posição pertence a
`pipeline_entries`, nunca à identidade do Negócio. O node cria a identidade; o
gatilho `deal_created` só nasce quando uma porta liga esse Negócio a uma posição
canônica completa.

## Trigger — Negócio Criado (`deal_created`)

Triggers em `pipeline_entries` emitem o evento na primeira transição para uma
posição completa: `deal_id`, `pipeline_id` e `stage_id` presentes. Isso cobre
entrada já completa e vínculo completado por `UPDATE`. Movimento posterior não
reemite. O trigger legado `AFTER INSERT` em `deals` é removido.

Lead do workflow = `deals.source_lead_id`. O snapshot persistido inclui
`deal_id`, `pipeline_entry_id`, `pipeline_id`, `stage_id`, título, valor,
responsável, Procedência e execução pai. A posição não é recalculada no worker.

Filtros (`trigger_config`, validados em `matchesTriggerConfig`):

- `require_lead` — **default true, fail-closed**. Negócio sem lead não tem quem receber mensagem/tag/etapa; o downstream inteiro assume lead.
- `source` — espelha `deals.source`: `any` | `human` | `workflow` | `api` | `import`
- `min_value`, `filter_owner_id`
- `pipeline_ids` — vários funis; `OU` dentro da lista
- `stage_ids` — várias etapas; `OU` dentro da lista

Dimensões preenchidas combinam com `E`. Configuração `{}` aceita qualquer
nascimento operacional com posição completa. Funis selecionados sem etapas
aceitam qualquer etapa desses funis. Existindo qualquer `stage_id`, somente as
etapas listadas casam; etapa sem `pipeline_ids` falha fechada.

O matcher SQL recusa incompatíveis antes do `INSERT workflow_executions`. O
matcher TypeScript revalida o mesmo snapshot antes do primeiro nó.

Materializações e backfills (`entrada_materializada`, `backfill` e
`backfill_funil_custom`) não representam nascimento comercial e não emitem o
evento.

### Exclusão de etapa referenciada

A exclusão consulta `pipeline_stage_delete_impact`, mostra o número de
automações afetadas e só confirma depois da prévia. `delete_pipeline_stage`
move os cards, desativa os workflows que citam o UUID e desativa a etapa numa
única transação. Destino de outra organização ou de outro funil é recusado.

## Guard de laço

`create_deal → deal_created → create_deal` é laço óbvio. Corte em duas camadas:

1. O handler grava `metadata.workflow_execution_id`; o PG trigger lê esse campo e o passa como `p_triggered_by_execution_id` — o `chain_depth` (máx. 5) de `fire_workflow_trigger` corta a cadeia.
2. `dealSkipIfOpenExists` (default) impede o segundo negócio aberto do mesmo lead.

Negócio inserido já com `deleted_at` (import/backfill) não dispara.

## Onde roda

O banco captura o nascimento, filtra em SQL e enfileira em
`workflow_executions`. `process-workflow-executions` revalida o snapshot e
executa o DAG. A interface apenas grava IDs canônicos na configuração.

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

## Prova em preview — 2026-09-04

Preview efêmera `deal-created-2002`:

- 23/23 asserts pgTAP cobrindo nascimento, snapshot, dedup, filtros, isolamento
  e exclusão transacional;
- 189/189 testes direcionados do matcher TypeScript e da interface;
- smoke remoto: uma posição completa criou uma execução; o worker concluiu com
  um único passo `trigger` e zero passos de ação externa;
- workflow do smoke usou funil + etapa específicos; contexto persistiu os quatro
  IDs do sujeito e da posição;
- ensaio dos quatro rollbacks, dentro de transação, restaurou o trigger legado
  em `deals`, removeu os triggers de posição, removeu as RPCs novas e restaurou
  o matcher anterior;
- após `ROLLBACK`, o teste de etapa voltou a passar, provando que a preview
  permaneceu no estado novo;
- fixture e segredo temporário do smoke foram removidos.

Limitação herdada: replay frio integral da `main` ainda para em migrations
anteriores desta feature. `20270920000000_demolicao_dos_espelhos.sql` depende de
funções reparadas depois; `20270925000000_aposenta_calor_e_rating.sql` exige
backup histórico inexistente em banco vazio. A preview aplicou o baseline até
`20270922000010` e as quatro migrations desta entrega. O contrato relevante foi
validado; o replay integral da cadeia continua dívida anterior.

## Deploy

Ordem obrigatória:

1. deploy de `process-workflow-executions` com matcher TypeScript novo;
2. aplicar as quatro migrations `20271006000000`–`20271006000030`;
3. smoke controlado com workflow só de gatilho;
4. publicar o frontend.

Frontend antes do backend permitiria salvar filtros que o runtime antigo
ignoraria. Produção exige autorização explícita e árvore limpa.

## Relacionado

- Histórico: o módulo Negócios já esteve ligado em 3 orgs com 0 registros. Hoje prod tem 34.966 negócios em 69 orgs.
- [[copy-paste-nodes]], [[marcar-item-checklist]] — outros nodes do editor.
