# Carteira de Clientes — Waves para World-Class

> **Data:** 2026-05-15
> **Status:** Planejamento
> **Baseline:** Feature entregue com health score, segmentos, alertas, copilot retention, quick order. Nota atual: 7.5/10.
> **Objetivo:** Elevar para 9.5/10 — dados corretos, performance, UX polido, intelligence layer.

---

## Wave 1 — Dados Corretos

**Tema:** Corrigir dados falsos/ausentes. Sem dados corretos, todo o resto é fachada.

**Duração estimada:** 2-3 dias

### W1.1 — Coluna Tendência (hoje é placeholder)

- **Arquivo:** `supabase/functions/_shared/portfolio-health.ts`
- **Arquivo:** `supabase/functions/calculate-portfolio-health/index.ts`
- **Arquivo:** `src/components/carteira/CarteiraClientTable.tsx` (linha 250)
- **Problema:** Coluna "Tendência" renderiza `"—"` hardcoded. Nenhum cálculo.
- **Ação:**
  - Adicionar campo `trend` em `upsell_clients` (`up | stable | down`)
  - No cron, calcular: média últimos 3 tickets vs média histórica. >10% acima = up, >10% abaixo = down, resto = stable
  - Renderizar seta colorida na tabela (verde ↑, cinza →, vermelho ↓)
- **Migration:** ALTER TABLE upsell_clients ADD COLUMN trend TEXT CHECK (trend IN ('up','stable','down'))
- **Testes:** Atualizar `portfolio-health.test.ts` com cenários de trend

### W1.2 — Engagement real (hoje fixo em 50)

- **Arquivo:** `supabase/functions/calculate-portfolio-health/index.ts` (linha 43, 155)
- **Arquivo:** `supabase/functions/_shared/portfolio-health.ts`
- **Problema:** `ENGAGEMENT_DEFAULT = 50`. 15% do health score não mede nada. `daysSinceLastWhatsAppReply: null` e `lastNpsScore: null` passados sem dados.
- **Ação:**
  - No cron, puxar última mensagem RECEBIDA do cliente em `conversation_messages` (type = 'received')
  - Calcular `daysSinceLastWhatsAppReply` real
  - Puxar último NPS de `lead_history` ou campo dedicado (se existir)
  - Engagement score = f(resposta WhatsApp recente, NPS, interações últimos 30d)
- **Dependência:** Verificar estrutura de `conversation_messages` e como ligar a `upsell_clients` (via lead_id → conversations)
- **Testes:** Cenários com engagement real no test suite

### W1.3 — Tipar `any` em 5 componentes

- **Arquivos:**
  - `src/components/carteira/ClienteCopilotSuggestion.tsx` (linhas 10-11)
  - `src/components/carteira/ClienteProductsTable.tsx` (linha 15)
  - `src/components/carteira/ClienteOrderHistory.tsx` (linha 9)
  - `src/components/carteira/ClienteTimeline.tsx` (linha 9)
  - `src/components/carteira/ClienteDetailPage.tsx` (linhas 101-110)
- **Problema:** Props tipadas como `any[]`. Erros silenciosos se schema mudar.
- **Ação:**
  - Importar `Tables<"upsell_orders">`, `Tables<"client_alerts">`, etc de `@/integrations/supabase/types`
  - Criar interfaces derivadas onde necessário
  - Eliminar todo `as any` cast
- **Risco:** Nenhum. Mudança segura, sem alteração de comportamento.

### W1.4 — Extrair `formatBRL` duplicado

- **Arquivos:** 7 componentes definem `formatBRL` localmente
  - CarteiraKPIs, CarteiraAlertBanner, CarteiraClientTable, CarteiraClientPreview, ClienteMetrics, ClienteOrderHistory, ClienteTimeline
- **Ação:**
  - Criar `src/lib/format.ts` com `formatBRL(value, opts?)` e `formatDate(iso, opts?)`
  - Substituir em todos os 7 componentes
- **Risco:** Nenhum. Refactor puro.

---

## Wave 2 — Tabela World-Class

**Tema:** Tabela principal é a view mais usada. Precisa escalar e ser operacional.

**Duração estimada:** 2-3 dias

### W2.1 — Sorting nos headers

- **Arquivo:** `src/components/carteira/CarteiraClientTable.tsx`
- **Problema:** Zero sort. Headers não clicáveis.
- **Ação:**
  - State `sortBy: keyof CarteiraClient` + `sortDir: 'asc' | 'desc'`
  - Headers clicáveis com indicador visual (seta)
  - Colunas sortáveis: health_score, days_since_last_order, avg_ticket, next_order_expected, lifetime_value, order_count
  - Sort client-side (dados já em memória nesta wave)

### W2.2 — Paginação

- **Arquivo:** `src/components/carteira/CarteiraClientTable.tsx`
- **Arquivo:** `src/hooks/usePortfolioHealth.ts`
- **Problema:** Renderiza todos clientes. 200+ = lento.
- **Ação:**
  - Paginação com 50 clientes por página
  - Navegação bottom: "← Anterior | Página X de Y | Próxima →"
  - Manter filtro e sort ao trocar página

### W2.3 — Split de query (KPIs vs Lista)

- **Arquivo:** `src/hooks/usePortfolioHealth.ts`
- **Problema:** 1 query faz tudo — KPIs + lista completa. Mistura concerns.
- **Ação:**
  - `usePortfolioKPIs()` — RPC ou view que retorna aggregates (totalClients, avgHealth, overdueCount, etc)
  - `usePortfolioClients({ page, pageSize, sort, filter })` — query paginada só dos campos necessários
  - KPIs atualizam independente da tabela
- **Migration:** Criar RPC `get_portfolio_kpis(org_id)` que faz aggregates no Postgres (muito mais eficiente que puxar tudo pro JS)

### W2.4 — Export CSV

- **Arquivo:** `src/components/carteira/CarteiraClientTable.tsx` (botão novo)
- **Problema:** Sem export de dados.
- **Ação:**
  - Botão "Exportar" no header da tabela
  - Gera CSV dos dados FILTRADOS (respeita search + tab ativa)
  - Colunas: Nome, Empresa, Health, Segmento, Ticket Médio, Dias Atrasado, Próximo Pedido, LTV
  - Download direto no browser (Blob + anchor)

---

## Wave 3 — UX Polido

**Tema:** Detalhes que fazem diferença entre "funciona" e "encanta".

**Duração estimada:** 2-3 dias

### W3.1 — Realtime

- **Arquivos:** `src/hooks/usePortfolioHealth.ts` (ou hooks novos da Wave 2)
- **Problema:** Dados stale até refresh.
- **Ação:**
  - `useRealtimeSubscription('upsell_clients', ['portfolio-health', orgId])` — invalidar query quando row muda
  - `useRealtimeSubscription('client_alerts', ['client-alerts', orgId])` — alertas em tempo real
  - Pattern já existe no projeto, só aplicar

### W3.2 — WhatsApp abre chat interno

- **Arquivo:** `src/components/carteira/ClienteDetailPage.tsx` (linhas 192-200)
- **Arquivo:** `src/components/carteira/CarteiraClientPreview.tsx` (linhas 241-252)
- **Problema:** `window.open(wa.me/...)` tira vendedor do CRM.
- **Ação:**
  - Se `lead_id` existe → `navigate(/chat?lead=${leadId})`
  - Fallback: `wa.me` externo só se não tem lead vinculado
  - Aplicar nos 2 componentes

### W3.3 — Empty state com onboarding

- **Arquivo:** `src/components/carteira/CarteiraKPIs.tsx` (melhorar bloco `!data`)
- **Arquivo:** Novo componente `src/components/carteira/CarteiraEmptyState.tsx`
- **Problema:** Org nova vê 5 KPIs "—" e tabela vazia. Nenhum guidance.
- **Ação:**
  - Componente dedicado quando `totalClients === 0`
  - Ilustração + texto: "Sua carteira ainda está vazia"
  - 3 CTAs: "Importar CSV", "Vincular leads existentes", "Como funciona"

### W3.4 — Dedup de pedido

- **Arquivo:** `src/hooks/useQuickOrder.ts` (mutationFn do useCreateOrder)
- **Problema:** Nada impede pedido duplicado no mesmo dia.
- **Ação:**
  - Antes de inserir: query `upsell_orders` WHERE `client_id = X AND sold_at::date = today`
  - Se existe: dialog de confirmação "Já existe pedido hoje. Criar outro?"
  - Ou: constraint no DB com partial unique index

---

## Wave 4 — Performance Backend

**Tema:** Cron precisa escalar. Histórico precisa existir.

**Duração estimada:** 2 dias

### W4.1 — Cron paralelo

- **Arquivo:** `supabase/functions/calculate-portfolio-health/index.ts` (linhas 334-350)
- **Problema:** `for (const client of batch)` — sequencial. 500 clientes = minutos.
- **Ação:**
  - Processar em chunks de 15 clientes com `Promise.all`
  - Semáforo simples pra controlar concorrência
  - Exemplo: batch 100 → 7 rounds de 15 paralelos em vez de 100 sequenciais
  - Adicionar métricas de tempo por org no log

### W4.2 — Health Score History (sparkline)

- **Migration:** Nova tabela `client_health_snapshots`
  ```sql
  CREATE TABLE client_health_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    health_score INTEGER NOT NULL,
    health_status TEXT NOT NULL,
    segment TEXT NOT NULL,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE(client_id, snapshot_date)
  );
  ```
- **Arquivo:** `supabase/functions/calculate-portfolio-health/index.ts` — inserir snapshot após update
- **Arquivo:** Novo hook `src/hooks/useHealthHistory.ts`
- **Arquivo:** Novo componente sparkline em `CarteiraClientPreview.tsx` e `ClienteDetailPage.tsx`
- **RLS:** Política org-scoped + service_role pra cron
- **Retention:** Manter últimos 90 dias (cron job de cleanup ou partition)

---

## Wave 5 — Ações e Automação

**Tema:** Transformar insights em ações. Dashboard que só mostra dados é metade do valor.

**Duração estimada:** 3-4 dias

### W5.1 — Bulk actions

- **Arquivo:** `src/components/carteira/CarteiraClientTable.tsx`
- **Arquivo:** Novo componente `src/components/carteira/CarteiraBulkBar.tsx`
- **Problema:** Cada cliente tratado individualmente.
- **Ação:**
  - Checkbox na primeira coluna da tabela
  - "Selecionar todos" no header
  - Barra flutuante quando seleção > 0: "X selecionados | Acionar Copilot | Adicionar Tag | Reatribuir | Exportar"
  - Acionar Copilot em massa: trigger workflow `recompra_atrasada` pra cada lead_id selecionado
  - Reatribuir: modal com dropdown de vendedores

### W5.2 — Alertas via WhatsApp pro vendedor

- **Arquivo:** `supabase/functions/calculate-portfolio-health/index.ts` (dentro de syncAlerts)
- **Arquivo:** Novo ou existente edge function de notificação
- **Problema:** Alerta critical existe só na UI.
- **Ação:**
  - Quando cron cria alerta com severity `critical`:
    - Buscar `closer_id` do cliente → telefone do vendedor
    - Enviar mensagem via Uazapi: "Cliente X (Ouro) está 15 dias atrasado. Ticket médio R$ 12k."
  - Rate limit: max 1 notificação por cliente por dia
  - Config por org: `portfolio_alerts_whatsapp: boolean` em organization settings
- **Dependência:** Uazapi adapter funcional

### W5.3 — Integração ERP (TinyERP)

- **Arquivo:** Nova edge function `supabase/functions/erp-order-webhook/index.ts`
- **Problema:** `source: 'erp'` existe no schema mas nada preenche.
- **Ação:**
  - Endpoint que recebe webhook do TinyERP com dados de pedido
  - Match client por CNPJ/nome → cria `upsell_order` com `source: 'erp'`
  - Cria `client_purchase_items` com line items do pedido
  - Invalida health score → cron recalcula no próximo ciclo
- **Auth:** Webhook secret por org
- **Edge case:** Cliente não existe → criar ou ignorar (config por org)

---

## Wave 6 — Intelligence Layer

**Tema:** Transformar CRM em plataforma analítica. Dados viram insights preditivos.

**Duração estimada:** 4-5 dias

### W6.1 — Churn Prediction

- **Arquivo:** `supabase/functions/_shared/portfolio-health.ts`
- **Arquivo:** `supabase/functions/calculate-portfolio-health/index.ts`
- **Migration:** ADD COLUMN `churn_probability` INTEGER (0-100) em upsell_clients
- **Problema:** Score reativo. Não antecipa.
- **Ação:**
  - Modelo simples: combinar sinais existentes com pesos
    - Ciclo esticando (+20%)
    - Ticket declining (+25%)
    - Sem resposta WhatsApp 7d (+20%)
    - Produto faltando (+10%)
    - Health < 40 (+15%)
    - NPS <= 2 (+10%)
  - Score 0-100 de probabilidade de churn
  - Exibir no preview e detail como "Risco de Churn: 73%"
  - Threshold configurable pra trigger de ação automática

### W6.2 — Cohort Analysis

- **Migration:** View SQL `portfolio_retention_cohorts`
- **Arquivo:** Novo componente `src/components/carteira/CarteiraCohortHeatmap.tsx`
- **Ação:**
  - View agrupa clientes por mês de `first_sale_at`
  - Pra cada cohort, calcula % que recomprou nos meses 1, 2, 3... 12
  - Heatmap visual: verde (alta retenção) → vermelho (baixa)
  - Filtro por segmento e vendedor
- **Localização:** Nova aba "Analytics" na página de carteira

### W6.3 — Revenue at Risk

- **Arquivo:** Novo componente `src/components/carteira/CarteiraRevenueAtRisk.tsx`
- **Ação:**
  - Card com 3 horizontes: 7d / 14d / 30d
  - Soma `avg_ticket` dos clientes cujo `next_order_expected` cai em cada janela
  - Visual: barra de progresso ou gauge com valor em BRL
  - Destaque: clientes Ouro contribuindo pro risco
- **Localização:** Abaixo dos KPIs ou na aba Analytics

### W6.4 — Performance por Vendedor

- **Arquivo:** Novo componente `src/components/carteira/CarteiraVendedorRanking.tsx`
- **Arquivo:** Novo hook `src/hooks/usePortfolioByVendedor.ts`
- **Ação:**
  - Agrupar `upsell_clients` por `closer_id`
  - Por vendedor: total clientes, health médio, churn rate, ticket growth, % recompra no prazo
  - Ranking visual com avatar + métricas
  - Drill-down: clicar no vendedor filtra tabela principal
- **Localização:** Aba "Performance" ou seção no dashboard

### W6.5 — Next-Best-Action com IA

- **Arquivo:** Substituir lógica de `src/components/carteira/ClienteCopilotSuggestion.tsx`
- **Arquivo:** Nova edge function `supabase/functions/suggest-retention-action/index.ts`
- **Problema:** Sugestão baseada em template estático.
- **Ação:**
  - Edge function recebe: client_id → busca contexto completo (health, alerts, produtos, histórico, conversas)
  - Monta prompt estruturado → Gemini gera sugestão personalizada
  - Retorna: ação recomendada + mensagem sugerida + reasoning
  - Frontend: botão "Gerar sugestão IA" com loading state
  - Cache: sugestão válida por 24h ou até novo alerta
- **Custo:** 1 chamada Gemini por cliente por solicitação (não automático)

---

## Mapa de Dependências

```
Wave 1 (Dados Corretos)
  ↓
Wave 2 (Tabela) ←── pode rodar paralelo com Wave 1.3 e 1.4
  ↓
Wave 3 (UX) ←── depende de Wave 2.3 (query split) pra realtime eficiente
  ↓
Wave 4 (Backend) ←── independente, pode rodar paralelo com Wave 3
  ↓
Wave 5 (Ações) ←── depende de Wave 1 (dados corretos) e Wave 2 (bulk selection)
  ↓
Wave 6 (Intelligence) ←── depende de Wave 4.2 (health history) pra sparkline/cohort
```

## Critérios de Conclusão por Wave

| Wave | Pronto quando... |
|------|-------------------|
| **1** | Zero `any` nos componentes carteira. Tendência mostra seta real. Engagement score varia por cliente. `formatBRL` importado de 1 lugar. |
| **2** | Tabela ordena por qualquer coluna. Paginação funcional. KPIs carregam instantâneo (RPC). CSV exporta dados filtrados. |
| **3** | Mudança em `upsell_clients` reflete em <3s sem refresh. WhatsApp abre chat interno. Org sem dados vê onboarding. Pedido duplicado é alertado. |
| **4** | Cron processa 500 clientes em <30s. Sparkline de health visível no preview e detail com dados de 90 dias. |
| **5** | Selecionar 10 clientes e acionar copilot em massa funciona. Vendedor recebe WhatsApp quando cliente ouro atrasa. Pedido ERP entra automático. |
| **6** | Churn probability visível. Heatmap de cohort renderiza. Revenue at Risk mostra 3 horizontes. Ranking vendedor funcional. IA gera sugestão contextual. |

---

## Estimativa Total

| Wave | Dias | Complexidade |
|------|------|-------------|
| 1 | 2-3 | Baixa-Média |
| 2 | 2-3 | Média |
| 3 | 2-3 | Média |
| 4 | 2 | Média |
| 5 | 3-4 | Alta |
| 6 | 4-5 | Alta |
| **Total** | **15-20 dias** | — |
