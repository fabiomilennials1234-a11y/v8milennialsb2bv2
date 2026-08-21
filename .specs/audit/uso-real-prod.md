# Uso real em PROD — medição de adoção por feature

**Autor**: Lanterna (diagnosticador) — Frente 1 da auditoria competitiva
**Data da medição**: 2026-07-27
**Fonte**: PROD `jsjsmuncfkbsbzqzqhfq`, via MCP Supabase em `read_only` (só SELECT). Nenhuma escrita.
**Escopo**: agregados e contagens. **Nenhum dado pessoal (nome/telefone/email/mensagem de lead) foi copiado para este documento.**

---

## 0. Denominador — o "~30 orgs ativas" está errado

| Métrica | Valor |
|---|---|
| Organizações no banco | **93** |
| Sandbox | 0 |
| `subscription_status = 'active'` | 82 |
| Orgs com ao menos 1 evento de uso em **90d** | **87** |
| Orgs com ao menos 1 evento de uso em **30d** | **66** |
| Orgs que criaram lead em 90d / 30d | 59 / 44 |
| Orgs com team_member ativo | 70 (208 membros ativos) |

```sql
select (select count(*) from organizations) orgs_total,
 (select count(*) from organizations where coalesce(is_sandbox,false)) orgs_sandbox,
 (select count(*) from organizations where subscription_status='active') orgs_sub_active,
 (select count(distinct organization_id) from leads where created_at > now()-interval '90 days') orgs_lead_90d,
 (select count(distinct organization_id) from leads where created_at > now()-interval '30 days') orgs_lead_30d,
 (select count(distinct organization_id) from usage_events where created_at > now()-interval '90 days') orgs_usage_90d,
 (select count(distinct organization_id) from usage_events where created_at > now()-interval '30 days') orgs_usage_30d,
 (select count(*) from team_members where is_active) tm_ativos,
 (select count(distinct organization_id) from team_members where is_active) orgs_com_tm_ativo;
```

> **Use 93 como denominador e 66 (30d) / 87 (90d) como base ativa.** O `CLAUDE.md` diz "~30 orgs ativas" — está desatualizado por 3×. Confirmado independentemente pela Bancada.

### Limite de telemetria — leia antes de interpretar qualquer "zero"

`usage_events.event_type='module_visited'` instrumenta **apenas 7 módulos**:
`pipe_whatsapp`, `chat_whatsapp`, `pipe_propostas`, `pipe_confirmacao`, `leads`, `disparos`, `funis`.

Não existe evento de visita para `/duplicatas`, `/automacoes`, `/copilot`, `/metas`, `/tv`, `/insights`, `/performance`, `/comissoes`, `/premiacoes`, `/checklists`, `/templates`, `/lixeira`, `/agenda`, `/negocios`, `/produtos`, `/carteira`, `/upsell`, `/ranking`, `/gestor`, `/faq`.

**Ausência de evento nessas rotas NÃO é prova de não-uso.** Para elas medi *pegada de dado* (rows criadas na tabela que a feature escreve) — sinal mais forte que page-view, porque prova ação, mas não mede quem abriu e desistiu. Está rotulado em cada linha.

Série de `usage_events` começa em **2026-03-14** → janela de 90d é quase toda a série.

---

## 1. Ranking de adoção (ordenado — do mais usado ao morto)

Métrica de ordenação: **nº de orgs com uso real em 90d**. `[V]` = medido por page-view instrumentado; `[D]` = medido por pegada de dado (proxy forte); `[C]` = medido por configuração existente (proxy fraco — configurar ≠ usar).

| # | Feature / rota | Orgs 90d | Orgs 30d | Volume 90d | Sinal |
|---|---|---|---|---|---|
| 1 | `/pipe-whatsapp` (kanban principal) | **77** | 65 | 20.312 visitas | [V] |
| 2 | `/chat-whatsapp` (inbox) | **71** | 56 | 11.901 visitas | [V] |
| 3 | Origens de lead (`lead_origins`) | 89 (total) | — | 1.161 origens | [C] |
| 4 | `/pipe-propostas` | **64** | 47 | 2.103 visitas | [V] |
| 5 | `/leads` (lista) | **60** | 37 | 1.275 visitas | [V] |
| 6 | `/pipe-confirmacao` | **50** | 23 | 1.301 visitas | [V] |
| 7 | `/disparos` (tela) | **47** | 45 | 820 visitas | [V] |
| 8 | Campos customizados de lead | 46 (total) | — | 45.934 valores/90d | [D] |
| 9 | Workflows / automações (ter workflow) | 72 (total) | — | 270 workflows | [C] |
| 10 | Workflows **executando** | **40** | 35 | 14.071 execuções | [D] |
| 11 | Funis custom (`/funis`) | **30** (visita) / 37 (têm funil) | 25 | 563 visitas; 12.104 entries/90d em 17 orgs | [V]+[D] |
| 12 | Tags | 28 (total) | — | 2.981 vínculos/90d | [D] |
| 13 | `sale_events` (venda registrada) | 26 (total) | — | 365 eventos | [D] |
| 14 | Follow-ups (`/follow-ups`, menu "**Revisão**") | **23** | 17 | 272 criados/90d | [D] |
| 15 | Copilot — orgs com agente criado | 42 (total) | — | 44 agentes | [C] |
| 16 | Copilot — conversas reais | **18** | 13 | 2.444 conversas / 18.327 msgs | [D] |
| 17 | Copilot — orgs com agente **ativo** | 18 | — | 18 de 44 agentes ativos | [C] |
| 18 | Produtos (`/produtos`) | 17 (total) | — | 2.023 produtos (1.393 em 90d) | [D] |
| 19 | UTM / marketing atribuído | 17 | — | 2.463 leads com UTM/90d | [D] |
| 20 | Carteira / upsell — clientes | 12 (total) | — | 738 clientes | [D] |
| 21 | Metas (`/metas`) | 11 (atualizadas/90d) | 9 (mês atual) | 78 metas, 12 orgs | [D] |
| 22 | Oráculo | 11 (total) | — | 34 usos/90d | [D] |
| 23 | Agenda / reuniões (`/agenda`) | 11 (total) | — | 32 reuniões/90d | [D] |
| 24 | Checklists (`/checklists`) | **9** | 6 | 923 checklists/90d | [D] |
| 25 | Lixeira (`/lixeira`) | **8** | 8 | 392 exclusões/90d | [D] |
| 26 | Premiações — competições | 6 (total) | — | 11 competições | [C] |
| 27 | Carteira — pedidos (`upsell_orders`) | **4** | — | 244 pedidos/90d | [D] |
| 28 | Templates de campanha | 6 (total) | — | 10 templates | [C] |
| 29 | Configuração de investimento mkt | 5 (total) | — | 55 linhas | [C] |
| 30 | API keys | 3 (total) | — | 6 chaves | [C] |
| 31 | Templates de mensagem (`/templates`) | **2** | — | 3 templates | [D] |
| 32 | Disparo em massa **executado** (`blast_plans`) | **2** | 2 | 3 planos, 54 destinatários | [D] |
| 33 | Métricas montáveis (#1194: `dashboard_pages`/`widgets`) | **1** | — | 2 páginas, 15 widgets | [D] |
| 34 | Google Calendar conectado | **1** | — | 4 tokens | [C] |
| 35 | Meta / Facebook conectado | **1** | — | 1 conexão, 1 leadgen config | [C] |
| 36 | Mensagens agendadas por pipe | **1** | — | 289/90d | [D] |
| 37 | Mensagens agendadas por usuário | 8 (total) | — | 34/90d | [D] |

### Adoção **ZERO** (candidatas diretas a REMOVER ou ESCONDER)

| Feature | Evidência | Query |
|---|---|---|
| **Comissões** (`/comissoes`) | `commissions` = **0 linhas**, 0 orgs, desde sempre | `select count(*), count(distinct organization_id) from commissions;` |
| **Negócios / deal-centric** (`/negocios`) | `deals`, `deal_items`, `deal_contacts`, `companies`, `contacts`, `activities`, `import_batches` = **0 linhas** cada (medido pelo Cais, reconferido: schema vazio nas 93 orgs) | `select count(*) from deals;` etc. |
| **Saved views** | `saved_views` = **0 linhas** | `select count(*) from saved_views;` |
| **Relatórios customizados** (`reports`, `report_schedules`) | `reports` = **0**, `report_schedules` ativos = **0** | `select count(*) from reports;` |
| **Dashboards legados** (`dashboards`) | **0 linhas** | `select count(*) from dashboards;` |
| **Motivo de perda** | **0 das 93 orgs** jamais preencheu (medido pela Bancada; `loss_reasons` tem 581 linhas de *catálogo*, zero uso) | ver frente Bancada |
| **Premiações / `awards`** | 1 linha, com `organization_id` NULL → **0 orgs** | `select count(*), count(distinct organization_id) from awards;` |
| **Webhooks de saída** (`webhooks`) | 0 orgs | `select count(distinct organization_id) from webhooks;` |
| **Merge de leads** (`/duplicatas`) | **0 merges já executados** — ver §4.1 | ver §4.1 |
| **Revisão de stage-roles** (`/master/stage-roles`) | **0 revisões** desde a criação — ver §4.2 | ver §4.2 |
| **`campanhas` novas** | 12 campanhas no total, **0 criadas em 90d**; `scheduled_campaign_messages` em 90d = **0** | `select count(*) from campanhas where created_at > now()-interval '90 days';` |

### Adoção **1 org só**

Métricas montáveis (#1194) · Google Calendar · Meta/Facebook · `scheduled_pipe_messages` · `composable_metrics_enabled`.

---

## 2. Tabela por feature — número + query

### 2.1 Duplicatas (`/duplicatas`)

| Métrica | Valor |
|---|---|
| Merges já executados (todo o histórico) | **0** |
| Linhas em `_lead_duplicates_audit` | **0** |
| Duplicatas por **telefone** hoje | **0** — impossível por construção (ver abaixo) |
| Duplicatas por **email** hoje (leads vivos) | **447 grupos**, **728 leads excedentes**, **22 orgs** |
| Duplicatas por **nome exato** hoje | **1.003 grupos**, **2.122 excedentes**, **43 orgs** |
| Total de leads vivos | 31.763 |

```sql
-- duplicatas vivas por chave
with de as (select organization_id, lower(trim(email)) e, count(*) n from leads
            where deleted_at is null and email is not null and email<>'' group by 1,2 having count(*)>1),
     dn as (select organization_id, lower(trim(name)) nm, count(*) n from leads
            where deleted_at is null and name is not null and length(trim(name))>3 group by 1,2 having count(*)>1),
     dp as (select organization_id, normalized_phone p, count(*) n from leads
            where deleted_at is null and normalized_phone is not null and length(normalized_phone)>=10 group by 1,2 having count(*)>1)
select (select count(*) from de) grupos_email, (select coalesce(sum(n-1),0) from de) excedente_email,
       (select count(distinct organization_id) from de) orgs_email,
       (select count(*) from dn) grupos_nome, (select coalesce(sum(n-1),0) from dn) excedente_nome,
       (select count(distinct organization_id) from dn) orgs_nome,
       (select count(*) from dp) grupos_phone;

-- merges executados: merge_leads faz DELETE FROM leads (hard). audit_log não registra
-- NENHUM DELETE em leads desde 2026-07-13 (início da série):
select operation, count(*) from audit_log where table_name='leads' group by 1;
--  UPDATE 9906 | INSERT 4159 | (DELETE ausente)
select count(*) from _lead_duplicates_audit;  -- 0
```

**Nota de proxy**: `728`/`2.122` são **PISO**. A RPC real (`find_duplicate_leads`) casa nome por trigram `similarity >= 0.6`, que é mais permissivo que igualdade exata — o número real que a tela mostra é **maior**. A contagem exata com trigram sobre 31.763 leads estourou o timeout do MCP; não a inventei.

### 2.2 Revisão — as DUAS features

**(a) `/follow-ups`, rotulada "Revisão"** (`src/modules/platform/lib/feature-registry.ts:87`, flag `review`, `sidebarPath: "/follow-ups"`)

| Métrica | Valor |
|---|---|
| Orgs com linha `review` em `organization_features` (todas ON) | 4 |
| Follow-ups criados 90d / 30d | 272 / 95 |
| Orgs criando follow-up 90d / 30d | **23 / 17** |
| Follow-ups **vencidos e abertos** (due_date passou, sem completar, não arquivado) | **415** em **23 orgs** |
| Follow-ups concluídos (histórico) | 609 de 1.122 |
| Follow-ups **automáticos** (`is_automated`) | 425 de 1.122 (38%) |
| Mensagens agendadas por usuário | 35 total, 8 orgs, 34 em 90d |

```sql
select (select count(*) from follow_ups where created_at > now()-interval '90 days') fu_90d,
 (select count(distinct organization_id) from follow_ups where created_at > now()-interval '90 days') fu_orgs_90d,
 (select count(distinct organization_id) from follow_ups where created_at > now()-interval '30 days') fu_orgs_30d,
 (select count(*) from follow_ups where completed_at is null and due_date < now() and archived_at is null) vencidos_abertos,
 (select count(distinct organization_id) from follow_ups where completed_at is null and due_date < now() and archived_at is null) orgs_vencidos,
 (select count(*) from follow_ups where is_automated) automatizados;
select count(distinct organization_id) from organization_features where feature_key::text='review' and is_enabled;
```

> **Caveat de flag**: `organization_features` tem só **118 linhas cobrindo 38 keys** — é tabela de *override*, não de estado efetivo. O default vem do plano/registry, que não consegui resolver por SQL puro (`feature_permissions` é a matriz de *ações por papel*, não de módulos: não tem `plan_id` nem as keys `review`/`tv_dashboard`). **"4 orgs com `review`" é um PISO de override, não o total de orgs que veem a tela.** Quem quiser o número efetivo tem que resolver o registry no front — pedir à Bancada via Palco.

**(b) `/master/stage-roles`** — ver §4.2. É master-only, **0 revisões**.

### 2.3 Métricas / dashboards

| Métrica | Valor |
|---|---|
| `dashboard_pages` (#1194) | **2**, em **1 org** |
| `dashboard_widgets` | **15**, em **1 org** |
| `organizations.composable_metrics_enabled = true` | **1** |
| `dashboards` (legado) | **0** |
| `reports` / `report_schedules` ativos | **0** / **0** |
| Orgs com override `tv_dashboard` ligado | 4 |
| Orgs com override `analytics` ligado | 4 |
| Orgs com override `performance` ligado | 5 |

```sql
select (select count(*) from dashboard_pages) dp, (select count(distinct organization_id) from dashboard_pages) dp_orgs,
 (select count(*) from dashboard_widgets) dw, (select count(distinct organization_id) from dashboard_widgets) dw_orgs,
 (select count(*) from dashboards) dash, (select count(*) from reports) rep,
 (select count(*) from report_schedules where is_active) sched,
 (select count(*) from organizations where composable_metrics_enabled) composable;
```

**Não mensurável**: `/dashboard`, `/performance`, `/ranking`, `/insights`, `/tv`, `/copilot/metricas` não têm evento de visita nem tabela própria de escrita — são telas de **leitura**. A única pegada seria log de request; `runtime_logs` (336k linhas) não indexa rota de front. Ver §5.

### 2.4 Metas / gestão de metas / premiações / comissões

| Feature | Orgs | Volume |
|---|---|---|
| Metas (`goals`) | **12** orgs (78 metas) | 53 atualizadas em 90d, em 11 orgs |
| Metas do **mês corrente** (2026-07) | **9** orgs | 21 metas |
| Competições / premiações | **6** orgs | 11 competições |
| `awards` | **0** orgs (1 linha órfã, org NULL) | 1 |
| Comissões | **0** orgs | **0 linhas** |
| Badges | 64 linhas (sistema) | `user_badges` sem uso mensurável |

```sql
select (select count(*) from goals) g, (select count(distinct organization_id) from goals) g_orgs,
 (select count(distinct organization_id) from goals where year=2026 and month=7) g_orgs_mes,
 (select count(*) from competitions) c, (select count(distinct organization_id) from competitions) c_orgs,
 (select count(*) from awards) a, (select count(distinct organization_id) from awards) a_orgs,
 (select count(*) from commissions) com;
```

### 2.5 Automações (workflows)

| Métrica | Valor |
|---|---|
| Workflows totais / ativos | **270** / **115** |
| Orgs com ao menos 1 workflow | **72** (77% de 93) |
| Orgs com workflow **ativo** | **41** (44%) |
| Orgs que **executaram** workflow 90d / 30d | **40 / 35** |
| Execuções 90d / 30d | 14.071 / 5.412 |
| Workflows que **nunca executaram** | **162 de 270 (60%)** |
| Workflows **ativos** que nunca executaram | **33** |
| Orgs com ao menos 1 workflow zumbi | **61** |
| Workflows com `enrollment_criteria` preenchido | **178 (66%)**, em **47 orgs** |
| Workflows com `re_enrollment_enabled` | **1**, em 1 org |

```sql
with ex as (select workflow_id, count(*) n from workflow_executions group by 1)
select (select count(*) from workflows) wf, (select count(*) from workflows where is_active) wf_on,
 (select count(distinct organization_id) from workflows) orgs, (select count(distinct organization_id) from workflows where is_active) orgs_on,
 (select count(distinct organization_id) from workflow_executions where started_at > now()-interval '90 days') orgs_exec_90d,
 (select count(*) from workflows w left join ex on ex.workflow_id=w.id where ex.n is null) nunca_exec,
 (select count(*) from workflows w left join ex on ex.workflow_id=w.id where ex.n is null and w.is_active) ativo_nunca_exec,
 (select count(*) from workflows where enrollment_criteria is not null and enrollment_criteria::text not in ('null','{}','[]')) com_enrollment,
 (select count(distinct organization_id) from workflows where enrollment_criteria is not null and enrollment_criteria::text not in ('null','{}','[]')) orgs_enrollment;
```

### 2.6 Copilot

| Métrica | Valor |
|---|---|
| Agentes criados | **44**, em **42 orgs** |
| Agentes **ativos** | **18**, em **18 orgs** |
| Agentes **desativados** | **26 de 44 (59%)** |
| Conversas 90d / 30d | 2.444 / 878 |
| Orgs com conversa 90d / 30d | **18 / 13** |
| Mensagens de conversa IA 90d / 30d | 18.327 / 9.827 |
| Decisões de agente (30d) | 5.357 |
| Oráculo | 34 usos/90d, 11 orgs |

```sql
select (select count(*) from copilot_agents) ag, (select count(*) from copilot_agents where is_active) ag_on,
 (select count(distinct organization_id) from copilot_agents) orgs, (select count(distinct organization_id) from copilot_agents where is_active) orgs_on,
 (select count(distinct organization_id) from conversations where created_at > now()-interval '90 days') conv_orgs_90d,
 (select count(distinct organization_id) from conversations where created_at > now()-interval '30 days') conv_orgs_30d,
 (select count(*) from conversation_messages where created_at > now()-interval '30 days') msgs_30d;
```

### 2.7 Campanhas + disparo em massa

| Métrica | Valor |
|---|---|
| `campanhas` totais / ativas | 12 / 12, em **9 orgs** |
| Campanhas criadas em 90d | **0** |
| `blast_plans` totais / 90d / 30d | 3 / 3 / 3, em **2 orgs** |
| Destinatários somados 90d | **54** |
| `uazapi_sender_jobs` | 3 registros, 2 orgs |
| `scheduled_campaign_messages` 90d | **0** |
| Visitas à tela `/disparos` 90d | **820**, em **47 orgs** |

> **Funil 47 → 2**: 47 orgs abrem `/disparos` em 90d (45 em 30d) e apenas **2** geram um `blast_plan`. Ou a tela não converte, ou existe um caminho de disparo que não grava `blast_plans` — repassado ao Forja como pergunta aberta, **não afirmado como conclusão**.

### 2.8 Engagement (follow-up / checklist / agenda)

| Feature | Orgs 90d | Volume 90d |
|---|---|---|
| Follow-ups | 23 | 272 |
| Checklists | **9** (6 em 30d) | 923 (542 em 30d) |
| Reuniões (`meetings`) | 11 (total) | 32 |
| **`meeting_events`** (evento de reunião real) | **31** | **1.245** |
| `/pipe-confirmacao` (kanban de reunião) | **50** (23 em 30d) | 1.300 visitas |
| Google Calendar conectado | **1** org (4 tokens) | 254 eventos em cache |
| `activities` | **0** | 0 |

> **`/agenda` não fracassou por falta de demanda — é a visualização errada.** 50 orgs abrem o kanban de confirmação e **31 orgs geram `meeting_events`** em 90d, contra **11** com linha em `meetings` e **1** com calendário conectado. A reunião é operada em escala; só não é operada na tela de agenda. (Tese do Vitral, confirmada pelo dado.)
> ⚠️ `pipe_confirmacao` cai forte de 90d para 30d (50→23 orgs, 1.300→250 visitas). Não afirmar tendência com isso — pode ser sazonal.

```sql
select count(*), count(distinct organization_id) from meeting_events where created_at > now()-interval '90 days';
```

### 2.9 Carteira / upsell / produtos

| Feature | Orgs | Volume |
|---|---|---|
| `upsell_clients` | **12** | 738 |
| `upsell_orders` | **6** (4 em 90d) | 305 (244 em 90d) |
| `upsell_campanhas` | 8 | 78 |
| `products` | **17** | 2.023 (1.393 criados em 90d) |
| Produtos vindos de ERP (`external_source`) | **0** | 0 — 100% cadastro manual |

### 2.10 Funis custom vs. os 3 fixos

| Métrica | Valor |
|---|---|
| `custom_pipelines` totais / ativos | **79 / 61**, em **37 orgs** |
| Orgs com entrada em funil custom 90d / 30d | **17 / 9** |
| Entradas em funil custom 90d | 12.104 |
| Total de `pipeline_stages` | 3.695 (3.500 ativas), em 93 orgs |

> 37 orgs (40%) **criaram** funil próprio, mas só 17 (18%) **usam** — 20 orgs criaram funil que não recebe lead.

### 2.11 Acessórios

| Feature | Orgs | Volume |
|---|---|---|
| Tags | 28 | 134 tags; 2.981 vínculos/90d |
| Campos customizados | **46** | 464 campos; **439 com valor** (25 campos sempre nulos); 45.934 valores/90d |
| Lixeira (soft delete) | 8 (90d e 30d) | 392 exclusões |
| Templates de mensagem (`/templates`) | **2** | 3 |
| Templates de campanha | 6 | 10 |
| Saved views | **0** | 0 |

### 2.12 Marketing

| Feature | Orgs | Volume |
|---|---|---|
| `lead_origins` (catálogo) | 89 | 1.161 |
| Leads com UTM em 90d | **17** | 2.463 leads |
| `mkt_origin_config` (investimento) | **5** | 55 |
| Meta / Facebook conectado | **1** | 1 conexão, 1 leadgen config, 4 páginas |
| Lead forms / landing próprios | **não existe tabela** — ver §5 |

---

## 3. Features candidatas a REMOVER por adoção zero

Ordem de confiança (do mais defensável ao que precisa de confirmação):

1. **Comissões** — 0 linhas, 0 orgs, tabela existe. Nada a preservar.
2. **Negócios / deal-centric** (`deals`/`deal_items`/`companies`/`contacts`/`activities`) — schema inteiro vazio nas 93 orgs.
3. **Saved views** — 0 linhas.
4. **Relatórios customizados + agendamento de relatório** — 0 e 0.
5. **`dashboards` legado** — 0 linhas (o novo `dashboard_pages` tem 1 org).
6. **Premiações/`awards`** — 0 orgs. (Competições têm 6 orgs — separar as duas antes de cortar.)
7. **Webhooks de saída** — 0 orgs (a entrada, `lead-webhook`, é usada; não confundir).
8. **Templates de mensagem** — 2 orgs, 3 templates. Não é zero, mas é ruído.
9. **Motivo de perda** — 0 de 93 orgs preencheu (fonte: Bancada). Feature existe e ninguém usa.

⚠️ **Não corte por este número sozinho quando a feature for de leitura pura** (`/insights`, `/ranking`, `/performance`). Elas não deixam pegada de dado — o zero seria artefato de medição, não de uso. Ver §5.

---

## 4. Sinais de uso ERRADO (não só não-uso)

### 4.1 🔴 `/duplicatas` esteve QUEBRADA por ~2 meses — a feature não é inútil, era inoperante

**Mecanismo, com evidência:**

1. A página existe desde `bf3e51a1` (2026-05-26, slice 4 do modularização).
2. As RPCs que ela chama (`find_duplicate_leads`, `merge_leads`) só foram criadas em **2026-07-22**, pelo commit `0d3cc421` — cuja mensagem é literal: *"fix(leads): implementa RPCs find_duplicate_leads / merge_leads (**página /duplicados quebrada**) (#1192)"*.
3. Logo: de ~26/05 a 22/07 (**~8 semanas**) a tela chamava uma RPC inexistente → erro. `src/modules/leads/pages/Duplicates.tsx:105` renderiza "Não foi possível carregar as duplicatas".
4. **Zero merges já executados**, em toda a história: `_lead_duplicates_audit` = 0 e `audit_log` (série desde 2026-07-13) não tem **nenhum** DELETE em `leads`, sendo que `merge_leads` termina em `DELETE FROM public.leads WHERE id = p_merge_lead_id`.
5. Enquanto isso, **existem duplicatas reais**: piso de **728** leads excedentes por email em **22 orgs** e **2.122** por nome em **43 orgs**.

**Segundo mecanismo — a chave `phone` da RPC nunca retorna nada:**

```sql
select indexname, indexdef from pg_indexes where schemaname='public' and tablename='leads' and indexdef ilike '%normalized_phone%';
-- idx_leads_org_phone_unique: CREATE UNIQUE INDEX ... (organization_id, normalized_phone)
--   WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL
```

Existe **UNIQUE index parcial** em `(organization_id, normalized_phone)` para leads vivos. Duplicata por telefone é **impossível por construção**. Mas `find_duplicate_leads` gasta o primeiro (e prioritário) dos três branches do `UNION ALL` justamente em `a.normalized_phone = b.normalized_phone` — ramo que é matematicamente sempre vazio. Não é bug de correção; é trabalho morto e, mais importante, **um badge `phone` que nunca aparece na UI** (`Duplicates.tsx:65`).

**Veredito para o CTO — a pergunta do brief tem resposta clara:**
`/duplicatas` **NÃO é inútil. É útil, tem 728+ duplicatas reais esperando em 22 orgs, e não foi usada porque ficou quebrada por 2 meses.** A decisão certa não é remover — é confirmar que o fix #1192 chegou ao front em produção e medir de novo em 30 dias.

**✅ Deploy CONFIRMADO — o fix está servindo os clientes hoje.** Não é verificável por SQL (merge em main não deploya o front; redeploy no EasyPanel é manual), mas é verificável pelo bundle público:

```bash
curl -s https://torquecrm.com.br/ | grep -oE 'src="/assets/[^"]+\.js"'
#  → /assets/index-CzHF9jYn.js
curl -s https://torquecrm.com.br/assets/Duplicates-DASWO6hT.js | grep -o "find_duplicate_leads\|merge_leads\|custom_pipe_stage_counts"
#  find_duplicate_leads · merge_leads · custom_pipe_stage_counts   (todos presentes)
```

`custom_pipe_stage_counts` é a prova mais forte: é uma das queryKeys que o **próprio #1192** adicionou ao `onSuccess` do `useMergeLeads` (`src/modules/leads/hooks/useDuplicateLeads.ts:61-69`) — não existia no build anterior.

**Consequência para a recomendação**: a tela está operante em produção desde o redeploy. O zero de merges não tem mais explicação técnica daqui para frente. **Medir de novo em 30 dias; se continuar zero com a tela funcionando, aí sim é desinteresse e a conversa muda.**

### 4.2 🔴 A fila de `/master/stage-roles` nunca foi aberta — e há 26 stages com won/lost provavelmente errado

Hipótese do Pauta testada. Resultado: **refutada na forma, confirmada no impacto.**

| Métrica | Valor |
|---|---|
| `pipeline_stages` totais | 3.695 |
| Stages **sem** `stage_role` | **0** — todas as 3.695 têm role |
| Stages com `suggested_stage_role` pendente | **26**, em **22 orgs (24% da base)** |
| Stages já **revisadas** (`stage_role_reviewed_at`) | **0** — em nenhuma org, nunca |
| Data das sugestões | **todas** de 2026-07-08 (19 dias paradas) |
| Distribuição de `stage_role` | open=2.663 · meeting_booked=653 · lost=189 · meeting_held=96 · **won=94** |
| Distribuição do sugerido | won=16 · lost=10 |

**O que as 26 sugestões dizem** — todas, sem exceção, são `open → won` ou `open → lost`:

| Direção | Stages | Entries dentro dessas stages |
|---|---|---|
| `open` → **won** | 16 | **132** |
| `open` → **lost** | 10 | **289** |

Ou seja: o classifier acha que **16 stages que hoje contam como "em aberto" são na verdade VENDA**, e 10 são PERDA. Há **421 leads** parados nessas stages. Em 22 orgs, o funil está contando como pipeline aberto o que provavelmente já é receita fechada ou perda.

```sql
select (select count(*) from pipeline_stages where stage_role is null) sem_role,
 (select count(*) from pipeline_stages where suggested_stage_role is not null and stage_role_reviewed_at is null) pendentes,
 (select count(distinct organization_id) from pipeline_stages where suggested_stage_role is not null and stage_role_reviewed_at is null) orgs_pendentes,
 (select count(*) from pipeline_stages where stage_role_reviewed_at is not null) revisadas,
 (select min(stage_role_suggested_at)::date from pipeline_stages where stage_role_reviewed_at is null and stage_role_suggested_at is not null) mais_antiga;

select s.stage_role::text, s.suggested_stage_role::text, s.pipeline_type, count(*),
  (select count(*) from pipeline_entries pe where pe.stage_key=s.stage_key and pe.organization_id=s.organization_id)
from pipeline_stages s
where s.suggested_stage_role is not null and s.stage_role_reviewed_at is null
group by 1,2,3,s.stage_key,s.organization_id;
```

**Correção honesta da hipótese**: não é verdade que "o CRM não sabe o que foi vendido" de forma geral — 100% das stages têm role. É verdade que **em 22 orgs o role é suspeito de estar errado, na direção mais cara possível (venda contada como aberto), e a fila desenhada para corrigir isso tem adoção literalmente zero desde que existe.** O elo com a dor de métricas é *classificação errada*, não *classificação ausente*.

**Fechamento — medição da Bancada** (creditado; fecha a pergunta que deixei aberta):

| Métrica | Valor |
|---|---|
| Entries paradas nas 16 stages `open→won` | **131**, em **7 orgs** |
| Dessas, com `sale_event` registrado | **13** |
| **Vendas prováveis invisíveis a toda métrica de venda** | **118** |
| Valor recuperável | **R$ 11.869,72** — e é exatamente o das 13 que **já** contam |
| Entries em stages `open→lost` pendentes | 288, em 8 orgs |
| `stage_role_reviewed_at` preenchido em toda a base | **0** |

**Receita nas 118 não é mensurável, e o motivo É o achado**: `pipeline_entries` não tem coluna de valor; `deal_id` é NULO em 131 de 131 (a tabela `deals` está vazia — §3); `leads.faturamento` é TEXT de faixa declarada, não valor de venda. O único lugar com valor é `pipe_propostas.sale_value`, que cobre só as 13 que já contam. **Não é receita escondida esperando ser somada — é receita irrecuperável sem reabrir lead por lead.**

> Reconciliação com os meus números: eu reportei 132 entries e 22 orgs; a Bancada apurou 131 e 7. Ambos corretos, escopos diferentes — meus **22 orgs** são das 26 stages pendentes (won **+** lost); as 16 stages `won` estão em 16 orgs, das quais só **7** têm entry parada. A diferença 132 → 131 é da minha query, que agrupava por `(stage_key, organization_id)` e somava subqueries — vulnerável a contagem dupla se duas stages compartilham `stage_key` na mesma org. **Adote 131.**

### 4.3 🟠 Workflow-zumbi: 60% nunca rodou, e 47 orgs configuraram um campo que o backend não lê

- **162 de 270 workflows (60%) nunca executaram uma única vez.**
- **33 deles estão ATIVOS** — ligados, e mesmo assim nunca dispararam.
- **61 orgs** têm ao menos um workflow zumbi.
- **178 workflows (66%), em 47 orgs**, têm `enrollment_criteria` preenchido. O Forja verificou por grep que **nenhuma edge function lê essa coluna** — a UI escreve e o backend ignora. `re_enrollment_enabled` está ligado em exatamente **1** workflow.

47 orgs configuraram critério de entrada achando que filtra alguma coisa. É a explicação candidata mais direta para os 33 workflows ativos-mas-mudos — **cruzamento (os 33 têm `enrollment_criteria`?) entregue ao Forja, não fechado por mim.**

### 4.4 🔴 Copilot: 23 dos 26 agentes desligados NUNCA atenderam ninguém — o funil morre antes da primeira conversa

26 de 44 agentes estão `is_active = false`. 42 orgs criaram agente; **18** têm agente ativo; **18** têm conversa em 90d, **13** em 30d.

> **Correção de leitura minha.** Eu havia dito ao Crivo que o padrão era "experimentou e desligou". Está **errado** e o dado abaixo derruba: `is_active = false` descreve o estado de hoje, não prova que o agente esteve ligado antes. Cruzei com conversas reais:

| Grupo | Agentes | Nunca teve conversa | 1–5 conversas | >5 conversas | Conversas totais |
|---|---|---|---|---|---|
| **Desativados** | 26 | **23 (88%)** | 3 | 0 | **7** |
| **Ativos** | 18 | 1 | 2 | **15** | **2.633** |

```sql
with a as (select ca.id, ca.is_active,
   (select count(*) from conversations c where c.agent_id=ca.id) convs
 from copilot_agents ca)
select is_active, count(*) agentes, count(*) filter (where convs=0) nunca_conversou,
 count(*) filter (where convs between 1 and 5) conv_1a5,
 count(*) filter (where convs>5) conv_mais5, sum(convs) total
from a group by 1;
```

**Distribuição bimodal, sem meio-termo**: ou o agente pega tração de verdade (15 de 18 ativos passam de 5 conversas, somando 2.633), ou nunca sai do chão (23 de 26 desligados com **zero**). Os 3 desligados que chegaram a rodar somaram **7 conversas** — média 2,3, ou seja pararam quase imediatamente.

**Consequência**: a perda está **entre criar o agente e ele atender o primeiro lead** — configuração, ativação, vínculo com instância de WhatsApp — não em decepção com a qualidade da resposta. A hipótese de curva de onboarding volta a ser a principal.

**O que discrimina os dois grupos** (o Crivo eliminou `whatsapp_instance_id` e `active_pipes` do agente — nenhum dos dois separa. Fui um nível acima, para o estado da **org**):

| Sinal | Nunca atenderam (24) | Atenderam (20) |
|---|---|---|
| Org **sem nenhuma** instância de WhatsApp | **11 (46%)** | **1 (5%)** |
| Org sem instância **conectada** | 17 (71%) | 5 (25%) |
| `business_context` vazio | **10 (42%)** | **0 (0%)** |
| `finalized_at` nulo (wizard incompleto) | 1 | 0 — **não discrimina** |
| `system_prompt` vazio/curto | 0 | 0 — **não discrimina** |

```sql
with a as (
 select ca.id,
   (ca.business_context is null or ca.business_context::text in ('null','{}','')) as sem_ctx,
   (select count(*) from conversations c where c.agent_id=ca.id) convs,
   (select count(*) from whatsapp_instances wi where wi.organization_id=ca.organization_id) inst,
   (select count(*) from whatsapp_instances wi where wi.organization_id=ca.organization_id and wi.status='connected') conn
 from copilot_agents ca)
select case when convs=0 then 'nunca atendeu' else 'atendeu' end grupo, count(*) total,
 count(*) filter (where inst=0 or sem_ctx) explicado,
 count(*) filter (where conn>0 and not sem_ctx) sem_explicacao_estrita
from a group by 1;
```

**Cobertura conjunta**: `(org sem instância) OU (sem business_context)` explica **15 de 24** dos que nunca atenderam contra **1 de 20** dos que atenderam. Incluindo "instância existe mas desconectada": **19 de 24**.

**Resíduo = 5 agentes** que têm instância conectada **e** `business_context` preenchido e mesmo assim nunca atenderam ninguém. **Esse é o alvo do teste dirigido — não os 24.**

**Isolando os dois sinais (2×2) — e uma correção minha:**

| Org com canal conectado | `business_context` vazio | Agentes | Atenderam | % |
|---|---|---|---|---|
| sim | não | 20 | 15 | **75%** |
| sim | **sim** | 2 | 0 | **0%** |
| não | não | 14 | 5 | 36% |
| não | **sim** | 8 | 0 | **0%** |

1. **`business_context` é marcador, não causa** (leitura do Crivo, aceita). O campo nasce `{}` (`CopilotPlayground.tsx:230`) e só é populado no salvamento completo do playground (`useCopilotAgents.ts:906`) — vazio significa "nunca foi salvo pelo caminho completo", ou seja é **assinatura de configuração abandonada**, o mesmo evento visto de outro ângulo. Contexto vazio degrada a resposta (genérica), não emudece o agente. O dado acima **não distingue** marcador de causa — o estrato que faria isso tem n=2. A evidência de código é mais forte que meu n=2. **Exigir `business_context` no gate trataria sintoma.**
2. **Meu sinal de canal estava contaminado.** 36% dos agentes em org sem instância conectada **atenderam mesmo assim** (5 de 14), porque `whatsapp_instances.status='connected'` é **estado de agora**, não histórico: a org conectou, o agente atendeu, depois desconectou. Inferi passado a partir de estado atual — mesmo vício de ler `is_active=false` como "foi desligado".
3. **O sinal que sobrevive** é **org sem NENHUMA instância** (11 de 24 mortos vs 1 de 20 vivos), robusto porque a linha em `whatsapp_instances` persiste após desconexão.

> **Para o gate de prontidão**: o critério é canal, mas o predicado tem que ser *"a org já teve alguma instância"*. Barrar por `status='connected'` no momento da ativação bloquearia org legítima em desconexão temporária — desconexão é aviso, não bloqueio.

> Leitura: boa parte da mortalidade não é curva de configuração do agente, é **pré-requisito de org ausente** — a organização nem tem canal de WhatsApp conectado, e a UI deixa marcar o agente como ativo assim mesmo (`useCopilotAgents.ts:433` é um `.update({is_active})` cru; `validate-activation.ts:39-42` só exige nome + ~10 caracteres de prompt — achado do Crivo). Gate de prontidão ausente é achado independente e vale corrigir sozinho.

⚠️ **`copilot_agents.updated_at` está contaminado** e não serve para datar a desativação: **33 dos 44 agentes**, em **33 orgs distintas**, têm `updated_at` exatamente em **2026-07-11** — carimbo de update em massa (bate com a padronização de modelo para `gpt-4.1-mini`), não de ação de cliente. Dos 26 desligados, 19 caem nesse dia. Não existe trilha de auditoria de `is_active`: `useCopilotToggleAudit.ts` lê `lead_history`/`master_audit_logs`/`phone_ai_preferences`, que auditam toggle de IA **por lead/telefone**, não o liga-desliga do agente. **"Quando cada agente foi desativado" não é respondível com o schema atual.**

### 4.5 🟠 Funil criado e nunca usado

37 orgs criaram funil custom; só **17** têm entrada em 90d e **9** em 30d. ~20 orgs têm funil próprio que não recebe lead.

### 4.6 🟠 Metade do pipeline está congelado

`pipeline_entries` abertas: 36.530. Sem mudar de stage há **30+ dias: 18.532 (51%)**. Há 90+ dias: 2.521, em 10 orgs. (Zero em 180d porque a tabela é recente — não leia como "nada passa de 6 meses".)

### 4.7 🟠 Follow-up vencido e abandonado

**415 follow-ups** estão vencidos, não concluídos e não arquivados, espalhados por **23 orgs** — exatamente as 23 orgs que usam a feature. Quem usa, acumula pendência que não fecha. E 38% dos follow-ups são automáticos, ou seja parte do acúmulo é gerada pelo sistema, não pela pessoa.

### 4.8 🟡 Campos customizados: 25 sempre nulos

464 campos definidos; **439 têm ao menos um valor**. 25 campos foram criados em orgs e nunca receberam nada.

### 4.9 🟡 Produtos: 100% manual

2.023 produtos, **0** com `external_source` preenchido. A integração ERP (Tiny/Omie) não está populando o catálogo em nenhuma org, apesar de `tinyerp_product_mappings` ter 1.173 linhas.

---

## 4.11 🔴 CAUSA SISTÊMICA — o schema do Copilot guarda estado corrente sem trilha

Esta auditoria produziu **três erros com a mesma forma**, cometidos por dois agentes diferentes: **inferir passado a partir de estado presente**.

| Coluna lida | Leitura errada | O que o dado mostrou |
|---|---|---|
| `copilot_agents.is_active = false` | "foi ligado e depois desligado" | 23 dos 26 **nunca** atenderam ninguém |
| `whatsapp_instances.status = 'connected'` | "org tem/nunca teve canal" | 36% dos agentes em org sem canal *conectado agora* atenderam antes |
| `copilot_agents.updated_at` | "quando o cliente mexeu" | 33 agentes em 33 orgs carimbados no mesmo dia por update em massa |
| `copilot_agents.whatsapp_instance_id` (Crivo) | "vínculo com canal" | não é o mecanismo — dispatch resolve por `resolveInstance` |
| `copilot_agents.updated_at > created_at` | "o cliente voltou para editar" | 18 dos 21 são o bulk de 07-11; editado de verdade: **3** |

**Não é descuido repetido — é propriedade do schema.** O quarto caso apareceu depois de a armadilha já estar nomeada neste documento, atravessando três agentes diferentes (eu adotei o número, a Bancada o produziu, o Crivo o derrubou). **Nomear a armadilha não impediu a recaída** — o que a pegou foi um par reauditando dado já aceito. Quase todo estado do Copilot é valor corrente sem histórico. Consequência que vale além desta auditoria: **nem nós nem o cliente conseguimos responder "quando isso mudou"**.

**Confirmado com prova, não com ausência de prova** — a rota `/master/copilot-toggle-audit` **não** é ref fantasma: `useCopilotToggleAudit.ts:53-84` lê `lead_history` (ações `ai_disabled`/`ai_reactivated`/`ai_toggled`) e `master_audit_logs` (`copilot_disabled`/`copilot_enabled`), **ambas existentes e populadas** (47 eventos, 2026-04-27 → 2026-07-11). Mas auditam **outro objeto**:

```sql
select m.action, count(*) n,
 count(*) filter (where exists (select 1 from copilot_agents ca where ca.id::text = m.target_id::text)) aponta_para_AGENTE,
 count(*) filter (where exists (select 1 from leads l where l.id::text = m.target_id::text)) aponta_para_LEAD
from master_audit_logs m where m.action in ('copilot_disabled','copilot_enabled') group by 1;
--  copilot_disabled: 38 → AGENTE 0 · LEAD 37
--  copilot_enabled:   9 → AGENTE 0 · LEAD  9
--  details: {ai_disabled, normalized_phone, organization_id, synced_duplicates}
```

**Zero de 47 eventos apontam para um agente.** Todos apontam para lead, com `normalized_phone` no payload — é o toggle de IA **por lead/telefone**. A trilha do liga-desliga do **agente** não existe, e agora está provado por onde ela não passa, não por "procurei e não achei".

**Gap concreto, com a redação corrigida** (a versão anterior afirmava ausência de algo que existe — correção da Bancada, verificada):

| Objeto | O que existe | O que falta |
|---|---|---|
| `copilot_agents` | `finalized_at` (conclusão do wizard) e `activation_triggers` (**config**, não timestamp) | **nenhuma** coluna de data de ativação/desativação — `deactivated_at`/`activated_at` não existem |
| `whatsapp_instances` | `status` e **`last_connection_at`** (preenchido em 126 de 135 linhas) | **a série** — `last_connection_at` responde "quando conectou pela última vez", **não** "esteve conectada na época X" |

```sql
select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns
 where table_schema='public' and table_name='whatsapp_instances'
   and (column_name ilike '%connect%' or column_name ilike '%status%' or column_name ilike '%_at');
-- status, qr_code_expires_at, last_connection_at, created_at, updated_at
```

Ou seja: não é "falta carimbo de conexão", é **falta histórico**. O carimbo existe e responde à pergunta errada. Sem série, "nunca foi ligado" e "foi ligado e desligado" seguem indistinguíveis — e essa distinção decide se a recomendação é *apertar o gate de ativação* ou *descobrir por que ninguém aperta o botão*. São recomendações opostas.

### Quarto caso do mesmo vício — desta vez dentro de um número que este doc já tinha adotado

"20 foram editados depois de criados" (que eu incorporei como evidência de "voltaram para editar") **não se sustenta**. `updated_at` é o campo do bulk de 2026-07-11. Remedido:

| Grupo | Total | `updated_at > created_at` | ...no bulk de 07-11 | **Editado de verdade** | Concluiu wizard (`finalized_at`) | Idade média |
|---|---|---|---|---|---|---|
| Nunca atendeu | 24 | 21 | 18 | **3** | **23 (96%)** | 96 dias |
| Atendeu | 20 | 20 | 15 | **5** | **20 (100%)** | 89 dias |
| Nunca atendeu, **com** instância na org | 13 | 11 | 8 | **3** | 12 | 83 dias |

```sql
with a as (select ca.id, ca.created_at, ca.updated_at, ca.finalized_at,
  (select count(*) from conversations c where c.agent_id=ca.id) > 0 atendeu from copilot_agents ca)
select atendeu, count(*),
 count(*) filter (where updated_at > created_at + interval '5 min') editado_bruto,
 count(*) filter (where updated_at::date='2026-07-11') no_bulk,
 count(*) filter (where updated_at > created_at + interval '5 min' and updated_at::date<>'2026-07-11') editado_real,
 count(*) filter (where finalized_at is not null) concluiu_wizard
from a group by 1;
```

**"Voltaram para editar" era o script, não o cliente.** Editado de verdade: 3 contra 5 — não discrimina nada. Descartado. (Crédito: Crivo, que auditou o dado da Bancada que eu já havia adotado.)

**O que sobrevive é mais forte, porque `finalized_at` não é sobrescrito por bulk**: **23 de 24** dos que nunca atenderam **concluíram o wizard**, contra 20 de 20 do lado vivo. Concluir a configuração é **universal**.

> Isso **enfraquece a tese da curva de configuração** (registrado pelo próprio Crivo, contra o interesse dele): se praticamente todos terminam o wizard, ninguém abandona no meio das 7 abas. A curva segue pesada — isso é fato medido —, mas **não é onde o funil morre**.

**Onde o funil morre**: o agente fica pronto e **a org não tem WhatsApp**. 11 de 24 mortos em org que nunca teve instância, contra 1 de 20 vivos. O buraco está **entre concluir a configuração do agente e a org ter canal** — passo de infraestrutura que mora **fora** do fluxo do Copilot, sobre o qual o produto não avisa nada. O agente fica marcado como pronto e espera, em média, **96 dias** por um canal que não chega.

**Consequência para o gate (§4.4)**: o predicado "org nunca teve instância" está certo, mas a **função** dele estava errada. O valor não é bloquear — é **avisar cedo**. Apertar como punição adiciona atrito num passo que o usuário já conclui em 96% dos casos. Falta sinalização, não trava.

⚠️ **Os recortes são ANINHADOS, não divergentes** (verificado em prod pelo Crivo). Quem citar precisa dizer qual:

```
24  nunca atenderam
 └─ 13  org tem ALGUMA instância (qualquer status)
     └─ 7  org tem instância CONECTADA          ← base do dimensionamento da Bancada
         └─ 5  conectada + business_context preenchido  ← resíduo da §4.4
```

Todos corretos, critérios diferentes. Um número solto sem o critério é inútil — e três documentos desta auditoria citam esta cadeia.

---

## 5. O que NÃO foi mensurável — e por quê

| Item | Por que não dá para medir |
|---|---|
| `/dashboard`, `/performance`, `/ranking`, `/insights`, `/tv`, `/copilot/metricas` | Telas de **leitura pura**: não escrevem tabela e não estão nos 7 módulos instrumentados em `usage_events`. Qualquer "zero" aqui seria artefato. Precisa de instrumentação nova ou log de request por rota. |
| `/duplicatas`, `/lixeira`, `/templates`, `/checklists`, `/metas`, `/agenda`, `/negocios`, `/produtos`, `/comissoes`, `/premiacoes`, `/automacoes`, `/copilot`, `/carteira`, `/upsell`, `/gestor`, `/faq` | Sem evento de visita. Medi **pegada de dado** (rows criadas), que prova ação mas não mede quem abriu e desistiu. O funil "abriu → agiu" é cego nessas rotas. |
| Estado **efetivo** das feature flags por org | `organization_features` é tabela de override (118 linhas / 38 keys). O default vem do plano via registry no front; `feature_permissions` **não** é isso (é matriz de ações por papel — não tem `plan_id` nem as keys de módulo). Só dá para resolver executando o registry, não por SQL. |
| Contagem exata de duplicatas como a tela mostra | `find_duplicate_leads` usa trigram `similarity >= 0.6`; replicar isso sobre 31.763 leads estourou o timeout do MCP. Reportei o **piso** por igualdade exata e rotulei. |
| Volume de `whatsapp_messages` em 30d | `count(*)` sobre 1,9 M linhas estourou o timeout do MCP repetidas vezes. Contagem só de `reltuples` (≈1.912.219 no total) — **não use como número de janela**. Para o corte "IA é minoria ou maioria do chat", usei `conversation_messages` (o que passa pelo Copilot) contra o total, e rotulei como proxy. |
| Lead forms / landing pages (`/marketing`) | Não localizei tabela correspondente em `public`. Ou a feature é doc-only, ou vive em edge function sem persistência própria. Não afirmei zero. |
| Merges de lead antes de 2026-07-13 | `audit_log` começa em 2026-07-13. Antes disso não há trilha. Mas `_lead_duplicates_audit` = 0 desde a criação e a RPC não existia até 22/07 — o zero se sustenta por outro caminho. |
| ~~`/duplicatas` está servida em produção HOJE?~~ | **RESOLVIDO** — não por SQL, mas pelo bundle público: `Duplicates-DASWO6hT.js` em `torquecrm.com.br` contém `find_duplicate_leads`, `merge_leads` e `custom_pipe_stage_counts`. O fix #1192 **está** em prod. Ver §4.1. |

---

## CP-v2 — Lanterna

**Mapa verificado**
- PROD `jsjsmuncfkbsbzqzqhfq`, 93 orgs, 66 ativas em 30d / 87 em 90d. `CLAUDE.md` diz "~30" — errado.
- `usage_events` instrumenta **7 módulos apenas**, série desde 2026-03-14. Tudo fora disso foi medido por pegada de dado.
- `find_duplicate_leads` / `merge_leads` existem em prod (definição lida); criadas em 2026-07-22 pelo commit `0d3cc421` (#1192), cuja mensagem confirma que a página estava quebrada.
- UNIQUE index parcial `idx_leads_org_phone_unique` em `(organization_id, normalized_phone)` para leads vivos.
- `merge_leads` termina em `DELETE FROM public.leads` (hard delete), sem gravar log próprio.
- `pipeline_stages`: 3.695 linhas, **0** sem `stage_role`, **26** com sugestão pendente, **0** revisadas.
- `feature_permissions` **não** é a tabela de feature flags de módulo (é matriz de ação por papel).

**Achados**
1. `/duplicatas` quebrada ~8 semanas (26/05→22/07); 0 merges na história; 728+ duplicatas reais por email em 22 orgs. **Útil e ignorada, não inútil.**
2. Ramo `phone` da `find_duplicate_leads` é sempre vazio por causa do UNIQUE index — trabalho morto.
3. Fila `/master/stage-roles`: 26 sugestões, 22 orgs, 19 dias, **0 revisões desde sempre**; todas `open→won`(16) ou `open→lost`(10), com 421 entries dentro.
4. 60% dos workflows nunca executaram; 33 ativos-mudos; 47 orgs com `enrollment_criteria` que o backend não lê.
5. Adoção zero confirmada: comissões, deals/companies/contacts/activities, saved_views, reports, dashboards legado, awards, webhooks de saída, motivo de perda.
6. Funil `/disparos` 47 orgs visitam → 2 disparam.
7. 59% dos agentes de Copilot criados foram desativados.
8. 51% do pipeline aberto sem mover há 30+ dias; 415 follow-ups vencidos e abandonados em 23 orgs.
9. #1194 inerte: 1 org, 2 páginas, 15 widgets.
10. Produtos 100% manuais — ERP não popula catálogo em nenhuma org.

**Descartado**
- Hipótese "won/lost não classificado explica a dor de métricas": **refutada na forma** — 100% das stages têm `stage_role`. O que sobrevive é "role errado em 22 orgs".
- "Ninguém dispara em massa" como afirmação fechada: só provei que `blast_plans` tem 2 orgs; pode haver caminho que não grava nessa tabela.
- `audit_log.actor_function` como sinal de uso: 100% NULL, inútil.

**Aberto**
- ~~O front com o fix de `/duplicatas` (#1192) já foi redeployado?~~ **FECHADO** — sim. Verificado no bundle servido em `torquecrm.com.br` (§4.1). Método reaproveitável: quando o deploy do front for a incógnita, baixe o chunk nomeado e faça grep de um símbolo introduzido pelo PR em questão. Não depende de acesso ao EasyPanel.
- Os 33 workflows ativos-sem-execução têm `enrollment_criteria`? (cruzamento entregue ao Forja)
- ~~Quanta receita está nas 16 stages `open→won`?~~ **FECHADO pela Bancada**: 131 entries em 7 orgs, 118 sem `sale_event`, valor **irrecuperável** — não existe coluna de valor em `pipeline_entries`, `deal_id` é NULO em 131/131 e `deals` está vazia. Ver §4.2.
- Existe caminho de disparo em massa que não grava `blast_plans`? (Forja)
- Estado efetivo da flag `review` por org — só resolvível pelo front (Bancada, via Palco).
- Marketing/lead forms tem persistência? Não achei tabela.
