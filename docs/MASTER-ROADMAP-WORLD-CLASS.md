# Torque CRM — Master Roadmap World-Class

> **Status:** Planejamento estratégico. 47 gaps mapeados, 7 waves, dependências explícitas.
> **Baseline:** 390 migrations, 58 pages, 236 tables, 36 colunas em leads, 0 tabelas Contact/Company/Deal/Activity.
> **Data:** 2026-05-08

---

## Visão geral das Waves

| Wave | Nome | Pré-req | Estimativa | Items |
|------|------|---------|------------|-------|
| **0** | Quick Wins | Nenhum | 2-4 sem cada | 12 |
| **1** | Data Model Foundation | Nenhum (paralelo W0) | 6-8 sem | 3 |
| **2** | Communication Expansion | W1 (Contact model) | 4-6 sem | 5 |
| **3** | Analytics & Reporting | W1 (Deal + Activity) | 4-6 sem | 9 |
| **4** | Deal Enhancement | W1 (Deal model) | 4-5 sem | 5 |
| **5** | Automation Evolution | Nenhum (pode paralelo) | 3-4 sem | 5 |
| **6** | AI Next-Gen | W1 + W2 (multi-canal) | 4-5 sem | 5 |
| **7** | Platform & Compliance | W1 | 3-4 sem | 3 |
| **Total** | | | | **47** |

---

## Wave 0 — Quick Wins (sem dependência de refactor)

Podem iniciar imediatamente. Cada item é independente. Prioridade interna por impacto diário no usuário.

### 0.1 — Bulk Actions nos Leads e Pipes
**Prioridade:** ★★★★★ (maior ganho de produtividade imediato)
**Hoje:** Só export e "deletar todos do stage". Sem mass-edit/move/tag/assign.
**Target:** Checkbox em rows/cards → bulk bar flutuante: Mover stage, Atribuir responsável, Adicionar/remover tag, Deletar, Enviar mensagem.
**Escopo:**
- [ ] Componente `BulkActionBar` com contagem de selecionados
- [ ] Checkbox em `LeadRow` (tabela) e `KanbanCard` (board)
- [ ] Select all / deselect all
- [ ] Actions: move_stage, assign_responsible, add_tag, remove_tag, delete (com confirmação)
- [ ] Batch RPC no backend (atomic, com limite 500/batch)
- [ ] Keyboard: Shift+click pra range select

### 0.2 — Saved Views / Smart Filters
**Prioridade:** ★★★★★
**Hoje:** Filtros resetam ao navegar. Cada pessoa reconfigura toda vez.
**Target:** Salvar combinações de filtros como views nomeadas. Compartilhar com time.
**Escopo:**
- [ ] Tabela `saved_views` (name, filters JSON, entity_type, owner_id, is_shared, organization_id)
- [ ] UI: dropdown "Views" ao lado dos filtros. Create/edit/delete/share
- [ ] Views padrão do sistema: "Meus leads", "Sem contato 7d", "Hot leads (score > 70)"
- [ ] Aplicar em: Leads page, cada Pipe page, Campanhas
- [ ] Filtros compostos: campo + operador + valor, AND/OR agrupáveis
- [ ] URL sync (view_id no query param)

### 0.3 — List ↔ Board Toggle
**Prioridade:** ★★★★☆
**Hoje:** Leads = tabela. Pipes = kanban. Sem alternância.
**Target:** Toggle icon no header. Mesmo dataset, muda visualização.
**Escopo:**
- [ ] Toggle button (Table | Board | Timeline) no header de cada pipe page
- [ ] Leads page ganha modo Board (agrupa por stage do pipe_whatsapp ou tag)
- [ ] Pipes ganham modo Table (com sort, filter, column resize)
- [ ] Persistir preferência por page (localStorage ou saved_views)

### 0.4 — Inline Edit no Kanban
**Prioridade:** ★★★★☆
**Hoje:** Qualquer edição requer abrir drawer.
**Target:** Click em campo do card → edita inline. Double-click nome → rename.
**Escopo:**
- [ ] Click em responsible badge → popover de seleção
- [ ] Click em tag → popover add/remove
- [ ] Double-click nome → inline text edit
- [ ] Click em score → detalhes do score
- [ ] Escape cancela, Enter confirma, click outside salva

### 0.5 — Duplicate Detection + Merge UI
**Prioridade:** ★★★★☆
**Hoje:** `_lead_duplicates_audit` existe. Sem UI. Sem merge.
**Target:** Painel de duplicatas. Side-by-side comparison. Merge com escolha de qual valor manter.
**Escopo:**
- [ ] Page ou drawer "Duplicatas" acessível via sidebar/settings
- [ ] Detecção: normalized_phone match, email match, fuzzy name+company match
- [ ] Preview lado a lado: Lead A vs Lead B, highlight diferenças
- [ ] Merge: escolher valor por campo. Consolidar histórico + tags + pipes
- [ ] Auto-suggest no create: "Lead similar já existe: [nome]. Vincular?"

### 0.6 — Loss Reason Taxonomy
**Prioridade:** ★★★☆☆
**Hoje:** `pipe_propostas.loss_reason` é texto livre.
**Target:** Enum estruturado + analytics.
**Escopo:**
- [ ] Tabela `loss_reasons` (id, name, category, organization_id, is_system, display_order)
- [ ] Reasons padrão: Preço, Timing, Concorrente, Sem Budget, Sem Decisão, Escopo, Outro
- [ ] Orgs podem adicionar reasons custom
- [ ] Dropdown no PropostaModal ao marcar "Perdido"
- [ ] Dashboard: chart de loss reasons por período

### 0.7 — Deal Aging / Stagnation Alerts
**Prioridade:** ★★★☆☆
**Hoje:** Sem detecção de deal parado.
**Target:** Alerta visual + automático quando deal fica X dias no mesmo stage.
**Escopo:**
- [ ] Configuração por pipeline: max_days_per_stage
- [ ] Visual: badge "🔴 parado 14d" no card do kanban
- [ ] Cron job: detecta deals estagnados → cria follow_up automático
- [ ] Workflow trigger novo: `deal_stagnant` (days_threshold)

### 0.8 — Soft Delete + Lixeira
**Prioridade:** ★★★☆☆
**Hoje:** Hard delete. Sem undo.
**Target:** deleted_at column. Lixeira com restore dentro de 30 dias.
**Escopo:**
- [ ] Adicionar `deleted_at TIMESTAMPTZ` em leads, pipe_*, campanhas
- [ ] RLS: filtrar `WHERE deleted_at IS NULL` por padrão
- [ ] UI: botão "Lixeira" no sidebar settings
- [ ] Restore individual ou bulk
- [ ] Cron job: purge definitivo após 30 dias
- [ ] Audit log: quem deletou, quando

### 0.9 — Keyboard Shortcuts Contextuais
**Prioridade:** ★★☆☆☆
**Hoje:** Só ⌘K (command palette).
**Target:** Shortcuts contextuais por página.
**Escopo:**
- [ ] Global: `n` novo lead, `g d` go dashboard, `g c` go chat, `g f` go funis
- [ ] Kanban: `j/k` navegar cards, `Enter` abrir drawer, `m` mover stage, `t` taguear
- [ ] Tabela: `j/k` navegar rows, `e` editar, `Space` selecionar
- [ ] Drawer: `Esc` fechar, `Tab` próxima tab, `1-5` ir pra tab N
- [ ] Help overlay: `?` mostra todos shortcuts da página atual

### 0.10 — Recent Items
**Prioridade:** ★★☆☆☆
**Hoje:** Sem histórico de navegação.
**Target:** "Recentes" no command palette e sidebar.
**Escopo:**
- [ ] Tabela `recent_items` (user_id, entity_type, entity_id, viewed_at, organization_id)
- [ ] Hook `useTrackView(entityType, entityId)` — chamado ao abrir drawer/page
- [ ] Command palette: seção "Recentes" com últimos 10 items
- [ ] Sidebar: widget opcional "Visto recentemente"

### 0.11 — Field-level Changelog
**Prioridade:** ★★☆☆☆
**Hoje:** `lead_history` logga ação genérica. Não mostra "campo X: A → B".
**Target:** Trigger que captura OLD vs NEW em cada UPDATE e grava diff.
**Escopo:**
- [ ] Trigger `track_field_changes()` em leads (e pipes futuramente)
- [ ] Tabela `field_changes` (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at)
- [ ] Timeline do lead: mostra "Responsável: João → Maria" em vez de "lead atualizado"
- [ ] Filtro na timeline: por campo específico

### 0.12 — Import/Export Robusto
**Prioridade:** ★★☆☆☆
**Hoje:** Import básico. Sem field mapping visual. Sem dry-run.
**Target:** Wizard de import com mapping, preview, validação, rollback.
**Escopo:**
- [ ] Step 1: Upload CSV/Excel
- [ ] Step 2: Mapear colunas → campos do lead (drag-and-drop ou dropdown)
- [ ] Step 3: Preview 10 primeiras rows mapeadas. Mostra erros/warnings
- [ ] Step 4: Dry-run — "145 leads serão criados, 23 atualizados, 5 erros"
- [ ] Step 5: Executar com progress bar
- [ ] Rollback: marcar batch_id em cada lead importado. Botão "desfazer import"
- [ ] Export: filtros avançados, escolha de colunas, formatos CSV/Excel/JSON

---

## Wave 1 — Data Model Foundation (REFACTOR ESTRUTURAL)

> **Esta é a wave mais importante.** Tudo de Wave 2-4 e 6-7 depende dela.
> Pode rodar em paralelo com Wave 0. Requer migration strategy cuidadosa (backward-compatible).

### 1.1 — Contact / Company / Deal Separation
**Prioridade:** ★★★★★ CRÍTICA
**Hoje:** Tudo é `leads`. Company é campo texto. Deal = pipe_propostas entry.
**Target:** 3 entidades first-class com relacionamentos.

**Novo modelo:**

```
┌─────────────┐     N:1      ┌─────────────┐
│  contacts   │─────────────▶│  companies   │
│             │              │              │
│ id          │              │ id           │
│ name        │              │ name         │
│ email       │              │ domain       │
│ phone       │              │ industry     │
│ job_title   │              │ size_range   │
│ company_id  │              │ revenue_range│
│ linkedin_url│              │ website      │
│ avatar_url  │              │ address      │
│ org_id      │              │ org_id       │
│ source_lead │              │ parent_id    │ ← hierarquia
│ created_at  │              │ health_score │
└──────┬──────┘              └──────────────┘
       │ N:M
       ▼
┌─────────────┐
│   deals     │
│             │
│ id          │
│ title       │
│ value       │
│ currency    │
│ pipeline_id │
│ stage_id    │
│ company_id  │
│ owner_id    │
│ probability │
│ expected_close│
│ closed_at   │
│ won         │
│ loss_reason │
│ org_id      │
└─────────────┘
       │ N:M
       ▼
┌──────────────┐
│ deal_contacts│  (junction + role)
│              │
│ deal_id      │
│ contact_id   │
│ role         │  ← decisor/influencer/champion/user/blocker
└──────────────┘
```

**Migration strategy (backward-compatible):**
- [ ] Phase A: Criar tabelas `contacts`, `companies`, `deals`, `deal_contacts`
- [ ] Phase B: View de compatibilidade — `leads_compat` que une contacts+companies pra não quebrar frontend existente
- [ ] Phase C: Migrar dados: cada lead → 1 contact + 1 company (pelo campo texto). Dedup companies por nome normalizado
- [ ] Phase D: Criar FK: `leads.contact_id` → contacts, `leads.company_id` → companies
- [ ] Phase E: Migrar frontend page-by-page (Leads → Contacts, Empresas como page nova, Deals como page nova)
- [ ] Phase F: Deprecar campos texto (company) no leads. Manter como computed/view por 2 releases
- [ ] Phase G: Drop colunas legadas após confirmação

**RLS:** Todas novas tabelas seguem padrão `organization_id = get_user_organization_id()`.

**Impacto:** ~30 hooks, ~20 pages, ~15 edge functions. Maior refactor da história do projeto. Mas sem isso, o CRM tem teto.

### 1.2 — Pipeline Consolidation
**Prioridade:** ★★★★★ CRÍTICA
**Hoje:** `pipe_whatsapp` (10 cols), `pipe_confirmacao` (14 cols), `pipe_propostas` (18 cols) — 3 tabelas separadas. `custom_pipe_entries` (11 cols) já é genérica.
**Target:** Uma tabela `pipeline_entries` unificada.

**Novo modelo:**

```
┌────────────────┐     N:1    ┌────────────────┐
│pipeline_entries│────────────▶│   pipelines    │
│                │            │                │
│ id             │            │ id             │
│ lead_id        │            │ name           │ ← "WhatsApp", "Confirmação", "Propostas", custom
│ pipeline_id    │            │ slug           │
│ stage_id       │            │ type           │ ← system | custom
│ deal_id (opt)  │            │ org_id         │
│ assigned_to    │            │ display_order  │
│ metadata JSONB │ ← sale_value, meeting_date, etc│ config JSONB   │
│ entered_at     │            └────────────────┘
│ stage_changed_at│
│ closed_at      │
│ org_id         │
│ notes          │
└────────────────┘
```

**`metadata` JSONB** absorve campos pipe-specific:
- WhatsApp: `{ scheduled_date }`
- Confirmação: `{ meeting_date, meet_link, is_confirmed }`
- Propostas: `{ sale_value, product_id, calor, loss_reason_id, contract_duration, commitment_date }`
- Custom: qualquer coisa que o user definir

**Migration strategy:**
- [ ] Criar `pipelines` (se não existir como tabela genérica) + `pipeline_entries`
- [ ] Seed pipelines sistema: whatsapp, confirmacao, propostas
- [ ] Migrar dados de cada pipe_* → pipeline_entries com metadata JSONB
- [ ] Views de compat: `pipe_whatsapp_compat` que lê de pipeline_entries WHERE pipeline.slug = 'whatsapp'
- [ ] Migrar hooks: 3 hooks → 1 `usePipelineEntries(pipelineSlug)`
- [ ] Migrar pages: 3 pages → 1 `PipelinePage` parametrizado
- [ ] Drop tabelas legadas após validação

**Ganho:** Elimina ~60% da duplicação de código nos hooks e pages de pipeline.

### 1.3 — Unified Activity Model
**Prioridade:** ★★★★★ CRÍTICA
**Hoje:** `lead_history` (audit log genérico), `follow_ups` (tasks), nada mais.
**Target:** Atividades como entidades first-class.

**Novo modelo:**

```
┌──────────────┐
│  activities  │
│              │
│ id           │
│ type         │ ← call, email, meeting, note, task, whatsapp_msg, system
│ subject      │
│ description  │
│ contact_id   │
│ company_id   │
│ deal_id      │
│ lead_id      │ (compat, nullable — aponta pra legacy)
│ owner_id     │ (quem executou)
│ assigned_to  │ (quem deveria executar, se task)
│ due_date     │
│ completed_at │
│ duration_sec │ ← pra calls
│ outcome      │ ← connected, voicemail, no_answer, busy, cancelled
│ metadata     │ JSONB ← email_message_id, call_recording_url, etc
│ is_automated │
│ source       │ ← manual, automation, email_sync, call_log, webhook
│ org_id       │
│ created_at   │
└──────────────┘
```

**Absorve:**
- `follow_ups` → activities WHERE type = 'task'
- `lead_history` → activities WHERE type = 'system' (ou mantém como audit trail separado)
- WhatsApp messages → activities WHERE type = 'whatsapp_msg' (referência, não duplica)
- Futuras calls, emails → activities nativas

**Escopo:**
- [ ] Criar tabela `activities` com RLS
- [ ] Migrar follow_ups existentes
- [ ] Hook `useActivities(contactId | dealId | companyId)`
- [ ] Timeline component unificada: mostra todas atividades + messages em ordem cronológica
- [ ] Auto-log: quando WhatsApp msg é enviada → activity criada
- [ ] Activity metrics: calls/dia, emails/dia, meetings/semana por membro

---

## Wave 2 — Communication Expansion

> **Depende de:** Wave 1.1 (Contact model) pra vincular emails/calls a contacts, não leads.

### 2.1 — Email Sync (Gmail / Outlook)
**Prioridade:** ★★★★☆
**Hoje:** Sem integração de email.
**Target:** Sync bidirecional. Emails auto-logados como activities. Send from CRM.
**Escopo:**
- [ ] OAuth2 connect: Gmail API + Microsoft Graph API
- [ ] Tabela `email_accounts` (user_id, provider, access_token, refresh_token, sync_cursor)
- [ ] Tabela `emails` (message_id, thread_id, from, to, cc, subject, body_html, body_text, sent_at, read_at, contact_id, deal_id)
- [ ] Background sync worker: poll novos emails a cada 2min
- [ ] Matching: email address → contact.email → auto-link
- [ ] Activity auto-creation: email recebido/enviado → activity
- [ ] Send from CRM: composer no drawer do contact/deal
- [ ] Email tracking: pixel pra open detection, link wrapping pra click detection
- [ ] Thread view: emails agrupados por thread

### 2.2 — Unified Inbox
**Prioridade:** ★★★★☆
**Hoje:** Chat page é só WhatsApp.
**Target:** Todos canais numa timeline por contact. WhatsApp + Email + (futuro: SMS, Instagram DM).
**Escopo:**
- [ ] Refactor ChatShell: aceitar múltiplos channel types
- [ ] Tab selector: All | WhatsApp | Email | SMS
- [ ] Timeline unificada: mensagens de todos canais em ordem cronológica
- [ ] Composer multi-canal: dropdown pra escolher canal de envio
- [ ] Contact-centric (não phone-centric): inbox mostra contacts, não números

### 2.3 — Call Logging / VoIP Integration
**Prioridade:** ★★★☆☆
**Hoje:** Inexistente.
**Target:** Log calls manual + integração VoIP. Click-to-call.
**Escopo:**
- [ ] Manual call log: botão "Log call" no drawer → form (duration, outcome, notes)
- [ ] Activity criada automaticamente
- [ ] Integração VoIP (Twilio Voice ou similar): click-to-call do CRM
- [ ] Auto-log: call iniciada/recebida → activity com duration
- [ ] Call recording (opt-in, com consent): link no activity
- [ ] Call analytics: calls/dia, duration média, outcome distribution

### 2.4 — SMS Integration
**Prioridade:** ★★☆☆☆
**Hoje:** Inexistente.
**Target:** Envio de SMS via CRM. Templates. Integrado na timeline.
**Escopo:**
- [ ] Provider: Twilio SMS ou Zenvia
- [ ] Send SMS: do drawer do contact, do bulk action, de workflows
- [ ] SMS templates com variáveis
- [ ] Inbox: SMS aparece na timeline unificada
- [ ] Activity auto-log

### 2.5 — LinkedIn Enrichment
**Prioridade:** ★★☆☆☆
**Hoje:** Sem integração LinkedIn.
**Target:** Enrich contact data via LinkedIn. Link profile.
**Escopo:**
- [ ] Campo `linkedin_url` no contact
- [ ] Enrichment API (Proxycurl, Apollo, ou similar): job_title, company, industry, photo
- [ ] Auto-enrich ao criar contact (se email match)
- [ ] Botão "Enrich" manual no drawer

---

## Wave 3 — Analytics & Reporting

> **Depende de:** Wave 1.1 (Deal model pra métricas de deal), Wave 1.3 (Activity model pra métricas de atividade).

### 3.1 — Custom Report Builder
**Prioridade:** ★★★★★
**Hoje:** Dashboard fixo com métricas hardcoded.
**Target:** Builder drag-and-drop. Qualquer campo como dimensão/métrica. Salvar e compartilhar.
**Escopo:**
- [ ] Page `/reports` com lista de reports salvos
- [ ] Builder: escolher entity (leads, deals, contacts, activities, pipelines)
- [ ] Dimensions: qualquer campo (date, owner, stage, tag, origin, company, ...)
- [ ] Metrics: count, sum, avg, min, max, conversion rate
- [ ] Chart types: bar, line, pie, table, number card, funnel
- [ ] Filters: mesmo engine de smart filters (Wave 0.2)
- [ ] Tabela `reports` (name, entity_type, config JSON, owner_id, is_shared, org_id)
- [ ] Date range selector + comparison (vs período anterior)

### 3.2 — Funnel Conversion Analytics
**Prioridade:** ★★★★☆
**Hoje:** Funil visual existe mas sem % de conversão entre stages.
**Target:** Stage-to-stage conversion rates com drill-down.
**Escopo:**
- [ ] Widget: funil com % entre cada stage
- [ ] "100 leads → 60 abordados (60%) → 30 agendados (50%) → 15 propostas (50%) → 5 vendidos (33%)"
- [ ] Drill-down: click no % → lista de leads que converteram/não converteram
- [ ] Filter por período, por responsável, por origem
- [ ] Comparison: este mês vs mês passado

### 3.3 — Sales Cycle Analysis
**Prioridade:** ★★★★☆
**Hoje:** Sem tracking de tempo por stage.
**Target:** Tempo médio por stage. Tempo total lead→venda. Bottleneck detection.
**Escopo:**
- [ ] Cálculo: `stage_changed_at` diffs entre transições
- [ ] Dashboard widget: "Tempo médio: Novo→Abordado: 2d | Abordado→Agendado: 5d | Agendado→Proposta: 3d | Proposta→Vendido: 7d"
- [ ] Bottleneck highlight: stage com maior tempo fica vermelho
- [ ] Filtros: por responsável, por origem, por segment, por período
- [ ] Trend: como tempo médio evolui mês a mês

### 3.4 — Revenue Attribution
**Prioridade:** ★★★★☆
**Hoje:** UTM fields existem mas sem analytics de atribuição.
**Target:** "Meta Ads gerou R$ 500k. Google Ads gerou R$ 200k." Multi-touch attribution.
**Escopo:**
- [ ] First-touch: crédito pra origem do lead
- [ ] Last-touch: crédito pra última interação antes da venda
- [ ] Linear: crédito dividido igualmente entre touchpoints
- [ ] Dashboard: chart receita por canal/campanha/UTM
- [ ] ROI por canal (se custo de ads disponível)

### 3.5 — Pipeline Velocity
**Prioridade:** ★★★☆☆
**Hoje:** Sem métrica de velocidade.
**Target:** Deals entrando vs saindo vs estagnando. Velocity = (# deals × win rate × avg value) / cycle length.
**Escopo:**
- [ ] Widget: pipeline velocity score por período
- [ ] Breakdown: por stage, por responsável, por segmento
- [ ] Trend chart: velocity ao longo do tempo
- [ ] Alert: velocity caiu > 20% vs período anterior

### 3.6 — Cohort Analysis
**Prioridade:** ★★★☆☆
**Hoje:** Sem análise por cohort.
**Target:** Leads que entraram em Jan vs Fev — qual grupo converte melhor?
**Escopo:**
- [ ] Cohort por: mês de entrada, origem, campanha, responsável
- [ ] Métricas: conversion rate, time-to-close, LTV
- [ ] Heatmap: cohort × mês → % convertido

### 3.7 — Win/Loss Analysis
**Prioridade:** ★★★☆☆
**Hoje:** `loss_reason` texto livre. Sem analytics.
**Target:** Dashboard de win/loss com breakdown por razão, competidor, segmento.
**Escopo:**
- [ ] Depende de 0.6 (Loss Reason Taxonomy)
- [ ] Chart: win rate por período, por responsável, por segmento
- [ ] Loss breakdown: pie chart por razão
- [ ] Competitor tracking (campo opcional no deal): win rate vs cada competidor
- [ ] Insights: "Deals > R$50k têm 40% win rate. Deals < R$10k têm 65%."

### 3.8 — Scheduled Reports
**Prioridade:** ★★☆☆☆
**Hoje:** Sem reports automáticos.
**Target:** Email semanal/mensal com métricas pra gestão.
**Escopo:**
- [ ] Config por report: frequency (daily, weekly, monthly), recipients (team members ou emails)
- [ ] Edge function cron: gera report → envia email HTML
- [ ] Template email com charts renderizados server-side (ou link pra dashboard)

### 3.9 — Activity Metrics Dashboard
**Prioridade:** ★★★☆☆
**Hoje:** Sem métricas de atividade.
**Target:** "João fez 45 calls, 23 emails, 12 meetings esta semana."
**Escopo:**
- [ ] Depende de Wave 1.3 (Activity model)
- [ ] Dashboard: activities por tipo, por membro, por período
- [ ] Leaderboard: quem faz mais calls, quem converte mais meetings
- [ ] Targets: "SDR deve fazer 50 calls/dia" — progress bar
- [ ] Correlation: atividade → conversão (quem faz mais X vende mais?)

---

## Wave 4 — Deal Enhancement

> **Depende de:** Wave 1.1 (Deal model), Wave 1.2 (Pipeline consolidation).

### 4.1 — Weighted Pipeline / Forecasting
**Prioridade:** ★★★★☆
**Hoje:** Sem probability por stage. Sem forecast.
**Target:** Cada stage tem % padrão. Override por deal. Forecast = Σ(value × probability).
**Escopo:**
- [ ] Campo `probability` em pipeline_stages (default por stage: 10%, 25%, 50%, 75%, 90%, 100%)
- [ ] Campo `probability` override no deal
- [ ] Dashboard widget: "Forecast: R$ 450k weighted | R$ 1.2M total pipeline"
- [ ] Forecast por período: este mês, próximo mês, trimestre
- [ ] Forecast vs meta: "85% da meta de R$ 500k"
- [ ] Forecast por responsável

### 4.2 — Multi-product Deals
**Prioridade:** ★★★☆☆
**Hoje:** `pipe_propostas.product_id` = 1 produto por deal.
**Target:** Deal com line items: múltiplos produtos com quantidade, preço unitário, desconto.
**Escopo:**
- [ ] Tabela `deal_items` (deal_id, product_id, quantity, unit_price, discount_percent, total)
- [ ] Deal value = Σ(deal_items.total)
- [ ] UI: tabela editável de line items no deal drawer
- [ ] Auto-calc total ao adicionar/editar items

### 4.3 — Quote / Proposal Builder
**Prioridade:** ★★★☆☆
**Hoje:** Sem geração de proposta.
**Target:** Gerar PDF de proposta com line items, termos, logo da empresa, assinatura.
**Escopo:**
- [ ] Tabela `quotes` (deal_id, version, status: draft/sent/accepted/rejected, valid_until, terms, discount)
- [ ] Template engine: layout da proposta customizável por org
- [ ] PDF generation: edge function com template → PDF
- [ ] Send: email ou WhatsApp com link pra PDF
- [ ] Accept/Reject: link no PDF que atualiza status
- [ ] Versioning: quote v1, v2, v3 por deal

### 4.4 — Multi-currency
**Prioridade:** ★★☆☆☆
**Hoje:** `sale_value` sem currency.
**Target:** Deals em BRL, USD, EUR. Dashboard converte pra moeda base.
**Escopo:**
- [ ] Campo `currency` no deal (default: BRL)
- [ ] Tabela `exchange_rates` (from, to, rate, date)
- [ ] Auto-fetch rates via API (diário)
- [ ] Dashboard: conversão automática pra moeda da org
- [ ] Display: "R$ 50.000" ou "US$ 10,000" conforme deal

### 4.5 — Approval Workflows
**Prioridade:** ★★☆☆☆
**Hoje:** Sem chain de aprovação.
**Target:** "Desconto > 20% precisa aprovação do admin."
**Escopo:**
- [ ] Tabela `approval_rules` (entity_type, condition JSON, approvers, org_id)
- [ ] Tabela `approval_requests` (rule_id, entity_id, status: pending/approved/rejected, requested_by, approved_by)
- [ ] Conditions: discount > X%, deal_value > Y, custom field matches
- [ ] Notification: approver recebe alerta. Approve/reject com comentário
- [ ] Block: deal não avança de stage até aprovação (if configured)

---

## Wave 5 — Automation Evolution

> **Sem dependência forte.** Pode rodar em paralelo com outras waves.

### 5.1 — SLA / Deadline Automation
**Prioridade:** ★★★★☆
**Hoje:** Precisa criar workflow manual pra "deal parado X dias".
**Target:** SLA built-in por pipeline stage. Auto-escalation.
**Escopo:**
- [ ] Campo `sla_hours` em pipeline_stages
- [ ] Cron check: entries que excederam SLA → trigger `sla_breached`
- [ ] Visual: badge de SLA no kanban card (verde/amarelo/vermelho)
- [ ] Auto-actions: notificar responsável, escalar pra manager, criar follow-up
- [ ] Dashboard: SLA compliance rate por stage, por membro

### 5.2 — Workflow Enrollment Criteria
**Prioridade:** ★★★☆☆
**Hoje:** Workflow dispara pra todos leads que matcham trigger. Sem filtro fino.
**Target:** "Só leads com faturamento > R$100k AND origin = meta_ads."
**Escopo:**
- [ ] Campo `enrollment_criteria` JSON no workflow trigger config
- [ ] Mesmo engine de conditions do workflow (20+ operators)
- [ ] UI: seção "Quem entra?" no trigger config do workflow editor
- [ ] Re-enrollment toggle: "Pode re-entrar após X dias?"

### 5.3 — Workflow Analytics (Branch Stats)
**Prioridade:** ★★★☆☆
**Hoje:** Sem visibilidade de quantos leads passaram por cada path.
**Target:** No editor visual, cada edge mostra contagem de leads que passaram.
**Escopo:**
- [ ] Aggregate `workflow_execution_steps` por node_id
- [ ] Overlay no editor: "324 leads passaram aqui" em cada connection
- [ ] Conversion por branch: "true: 60% | false: 40%"
- [ ] Split A/B: métricas por variante (já existe parcialmente)

### 5.4 — Workflow Templates Marketplace
**Prioridade:** ★★☆☆☆
**Hoje:** Cada org cria workflows do zero.
**Target:** Templates pré-prontos. "Onboarding lead Meta Ads", "Follow-up post-reunião", "Re-engajamento 30 dias".
**Escopo:**
- [ ] Tabela `workflow_templates` (name, description, category, definition JSON, is_system, popularity)
- [ ] Page: gallery de templates com preview
- [ ] "Usar template" → clona definition pra workflow novo
- [ ] Orgs podem compartilhar templates (opt-in)

### 5.5 — Re-enrollment Rules
**Prioridade:** ★★☆☆☆
**Hoje:** Lead entra no workflow 1 vez. Sem controle de re-entrada.
**Target:** Configurar se e quando lead pode re-entrar.
**Escopo:**
- [ ] Config no workflow: `re_enrollment: { enabled: true, cooldown_days: 30, max_times: 3 }`
- [ ] Check no executor: antes de criar execution, verifica cooldown + count
- [ ] UI: toggle + inputs no workflow editor

---

## Wave 6 — AI Next-Gen

> **Depende de:** Wave 1 (Contact/Activity model), Wave 2 (multi-canal).

### 6.1 — AI Email Writer
**Prioridade:** ★★★★☆
**Hoje:** AI só responde WhatsApp.
**Target:** Gerar emails personalizados baseado no contexto do deal/contact.
**Escopo:**
- [ ] Depende de Wave 2.1 (Email sync)
- [ ] Botão "AI Draft" no composer de email
- [ ] Context: deal stage, últimas interações, company info, meeting notes
- [ ] Styles: formal, casual, follow-up, proposal, intro
- [ ] Edit before send (nunca auto-send email)

### 6.2 — Deal Insights & Predictions
**Prioridade:** ★★★★☆
**Hoje:** `lead_scores` existe mas é scoring simples.
**Target:** "Este deal tem 73% chance de fechar porque: faturamento alto, 3 meetings, champion identificado. Risco: sem resposta há 5 dias."
**Escopo:**
- [ ] Model: analyze deal history, activity patterns, similar deals outcomes
- [ ] Card no deal drawer: "Health: 73% 🟢" com fatores positivos/negativos
- [ ] Alerts: "Deal at risk" quando health cai > 20%
- [ ] Suggestions: "Deals similares que fecharam tinham meeting com decisor neste stage"

### 6.3 — Next-Best-Action Dashboard
**Prioridade:** ★★★☆☆
**Hoje:** Sem painel de ações prioritárias.
**Target:** Painel: "1. Ligue pra João (deal esfriando). 2. Envie proposta pra Maria. 3. Follow-up Pedro."
**Escopo:**
- [ ] Algorithm: prioriza por deal value × urgency × staleness
- [ ] Sources: deals sem atividade, follow-ups vencidos, SLA breaches, meetings hoje
- [ ] Page `/today` ou widget no dashboard
- [ ] Quick actions: click → abre drawer, click call → loga call, click email → abre composer

### 6.4 — Real-time Coaching
**Prioridade:** ★★★☆☆
**Hoje:** `conversation_summaries` tem `coaching_tips` mas post-hoc.
**Target:** Durante conversa WhatsApp, sugerir resposta baseada no contexto.
**Escopo:**
- [ ] Sidebar no chat: "Sugestão: lead mencionou preço, considere..."
- [ ] Battle cards: quando lead menciona concorrente → card com diferencias
- [ ] Tone analysis: "Sentimento da conversa caiu — considere abordagem empática"
- [ ] Objection handling: detecta objeção → sugere resposta

### 6.5 — Competitive Intelligence
**Prioridade:** ★★☆☆☆
**Hoje:** Sem tracking de concorrentes.
**Target:** Quando lead menciona concorrente em conversa → flag + battle card.
**Escopo:**
- [ ] Tabela `competitors` (name, aliases, strengths, weaknesses, battlecard_md, org_id)
- [ ] Detection: keyword match em conversation_messages
- [ ] Auto-tag deal: "Concorrente: [nome]"
- [ ] Battle card popup no chat
- [ ] Win rate vs competitor no analytics

---

## Wave 7 — Platform & Compliance

> **Depende de:** Wave 1 (Contact model pra GDPR).

### 7.1 — GDPR / LGPD Tools
**Prioridade:** ★★★★☆
**Hoje:** Sem ferramentas de privacidade.
**Target:** Data export por subject. Right-to-erasure. Consent tracking.
**Escopo:**
- [ ] "Exportar dados do contact" → JSON com tudo (activities, messages, deals, pipeline entries)
- [ ] "Apagar dados do contact" → cascata completa com audit log
- [ ] Tabela `consent_records` (contact_id, consent_type, granted, granted_at, source, ip)
- [ ] Consent types: marketing_email, marketing_whatsapp, data_processing
- [ ] Data retention policy: auto-delete dados de contacts sem atividade > X meses (configurable)

### 7.2 — Public API
**Prioridade:** ★★★☆☆
**Hoje:** Webhooks inbound/outbound existem. Sem REST API documentada.
**Target:** API REST versionada pra integrações externas.
**Escopo:**
- [ ] API gateway edge function: `/api/v1/contacts`, `/api/v1/deals`, `/api/v1/activities`
- [ ] Auth: API key por org (tabela `api_keys`)
- [ ] Rate limiting: 100 req/min por key
- [ ] CRUD: create, read, update, delete contacts/deals/activities
- [ ] Search/filter: query params
- [ ] Webhooks: subscribe to events via API
- [ ] Docs: Swagger/OpenAPI auto-gerado

### 7.3 — Sandbox / Staging per Org
**Prioridade:** ★★☆☆☆
**Hoje:** Tudo vai direto pra prod.
**Target:** Modo sandbox pra testar workflows/configs sem afetar dados reais.
**Escopo:**
- [ ] Flag `is_sandbox` na org
- [ ] Sandbox org: clona schema mas sem dados reais
- [ ] Test mode: workflows rodam mas não enviam mensagens reais
- [ ] "Promote to prod": copiar workflow/config de sandbox → prod

---

## Mapa de Dependências

```
Wave 0 (Quick Wins) ──────────────── pode começar AGORA
    │
    │ (paralelo)
    ▼
Wave 1 (Data Model) ──────────────── fundação
    │
    ├──▶ Wave 2 (Communication) ───── precisa Contact model
    │
    ├──▶ Wave 3 (Analytics) ────────── precisa Deal + Activity model
    │
    ├──▶ Wave 4 (Deal Enhancement) ── precisa Deal model + Pipeline consolidation
    │
    │    Wave 5 (Automation) ────────── independente, pode paralelo
    │
    ├──▶ Wave 6 (AI Next-Gen) ──────── precisa Contact + Activity + multi-canal
    │
    └──▶ Wave 7 (Platform) ─────────── precisa Contact model (LGPD)
```

---

## Ordem de execução recomendada

```
Mês 1-2:   Wave 0.1-0.5 (quick wins alto impacto) + Wave 1 planning/design
Mês 2-4:   Wave 1 (data model foundation) — refactor principal
Mês 3-4:   Wave 0.6-0.12 (quick wins restantes, paralelo com W1)
Mês 4-5:   Wave 5 (automation, independente)
Mês 5-7:   Wave 2 (communication) + Wave 3.1-3.2 (reports MVP)
Mês 7-8:   Wave 4.1-4.2 (deals core) + Wave 3.3-3.7 (analytics)
Mês 8-9:   Wave 6.1-6.3 (AI core)
Mês 9-10:  Wave 4.3-4.5 + Wave 3.8-3.9 + Wave 7
Mês 10+:   Wave 6.4-6.5 + restante
```

---

## Métricas de sucesso

| Métrica | Hoje | Target |
|---------|------|--------|
| Entidades first-class | 1 (lead) | 4 (contact, company, deal, activity) |
| Canais integrados | 1 (WhatsApp) | 4+ (WhatsApp, Email, SMS, Phone) |
| Report types | 1 (dashboard fixo) | ∞ (custom builder) |
| Bulk actions | 1 (export) | 7+ (move, tag, assign, delete, email, sms, archive) |
| Pipeline tables | 4 (3 hardcoded + 1 custom) | 1 (unified) |
| Activity types tracked | 0 structured | 6+ (call, email, meeting, note, task, msg) |
| Hooks duplicados em pipes | ~60% overlap | 0% (unified) |
| Time-to-insight (filtros) | reconfigure cada vez | 1 click (saved views) |
