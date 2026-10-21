# 40. Cobrança é um contexto próprio

Date: 2026-10-21

## Status

Accepted (CTO, 2026-10-21). Desenho no board Miro `uXjVHlzya2A=` (BPMN, régua, etapas, mockups). Entrega 1 na migration `20271212000000_cobranca_fundacao.sql`.

## Context

O CTO abriu uma área nova no Torque, **Cobrança de inadimplência**, com duas telas: **Inadimplentes** (uma lista no molde de Leads em que cada linha é um devedor, não um lead nem um negócio) e **Fluxo de Cobrança** (um kanban que "parece um funil", com automações por etapa e **métricas isoladas** das de venda). Decisões fechadas em 21/10:

1. um card por inadimplente;
2. a dívida entra pelo ERP, por planilha e por cadastro manual;
3. o valor vem do ERP (planilha e manual usam o valor informado); o Torque não calcula juros nem multa;
4. negativação, protesto e jurídico são só registrados;
5. cobrança e comercial são **setores separados** — o inadimplente não se liga a lead;
6. sem alçada: o Torque só notifica, a negociação é sempre humana e o acordo só é registrado;
7. dívida sem ERP baixa por "Registrar pagamento";
8. acesso por permissão própria; a régua envia de um número de WhatsApp exclusivo.

Três caminhos do produto pareciam servir e não servem:

- **Funil (`pipelines` / `pipeline_entries`).** Um funil de cobrança entraria em `sale_events` pela etapa `won`, no `get_dashboard_metrics` ("de TODOS os funis"), nos seletores do Estúdio de Métricas e em "Todos os funis" da lateral. Isolar exigiria um discriminador de tipo de funil — exatamente o que o **ADR-0034** rejeita ("funil tipado por sujeito").
- **Motor de automações (`workflows`).** O sujeito da execução é sempre um Lead (**ADR-0031**): `ExecuteWorkflowParams.leadId`, dedup por `lead_id`, `send-whatsapp` e `move-stage` recusam lead nulo, os gatilhos periódicos são por lead. Um caso de cobrança não cabe sem reescrever o motor.
- **Gate de plano (`feature_catalog` + `organization_features`).** Para master, `hasFeature` é sempre verdadeiro e `org_get_features_and_limits` devolve tudo ligado. A TorqueCRM — a única org da entrega 1 — não tem membros: só masters entram. A área apareceria para eles em **todas** as orgs.

## Decision

**1. Cobrança é um bounded context próprio, com tabelas próprias** (`cobranca_*`), no precedente de `org_implementations`. Nenhuma FK para `leads`, nenhuma linha em `pipelines`. As métricas da área leem só essas tabelas — isoladas por construção, não por filtro.

**2. O sujeito é o Caso de Cobrança**, um por inadimplente enquanto aberto (índice único parcial). O caso atravessa etapas próprias (`cobranca_etapas`, com `papel` aberta/recuperado/perdido/cancelado) e termina num desfecho. Saldo zero fecha em Recuperado em qualquer etapa.

**3. A flag é `organizations.feature_flags->'cobranca' = true`**, lida pelo `useFeatureFlag` (fail-closed, sem bypass de master) e, no banco, por `private.cobranca_habilitada`. Ligada só na TorqueCRM. Toda RPC passa por `private.cobranca_exigir(org, ação)`: sessão → flag → `assert_org_access` → `has_feature_permission('cobranca.<ação>')`.

**4. Acesso por permissão própria** (`cobranca.view`, `cobranca.edit`, `default_value = false`): admin e master passam; membro só com liberação. O comercial não vê a área por padrão.

**5. Escrita só por RPC SECURITY DEFINER; leitura pela RLS** contra `private.cobranca_orgs_visiveis()` (avaliada uma vez por consulta). O histórico (`cobranca_eventos`) é append-only.

**6. A régua (entrega 2) tem motor próprio** — cron + `_shared/whatsapp-dispatch.ts` numa instância exclusiva da cobrança —, não o motor de `workflows`. As "automações da etapa" do Fluxo são configuração de régua por etapa, não DAGs de workflow.

## Consequences

- O Fluxo de Cobrança não ganha de graça o que os funis têm (filtros salvos, bulk, export, Copilot). Cada um entra quando a cobrança precisar, escrito para ela.
- Uma tela de cobrança não aparece em métricas de venda, comissão, ranking nem Estúdio. Quem quiser cruzar as duas coisas cruza no relatório, não no modelo.
- A entrega 3 (ERP → cobrança) liga `cobranca_titulos.titulo_receber_id` a `titulos_receber`; o saldo desses títulos passa a vir do ERP e a baixa deles é a conciliação, nunca o botão manual.
- Ligar a área em outra org é um `UPDATE` em `organizations.feature_flags` (master), seguido das permissões dos membros.
