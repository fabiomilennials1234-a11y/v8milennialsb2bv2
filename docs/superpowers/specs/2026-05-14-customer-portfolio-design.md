# Customer Portfolio & Reorder Management — Design Spec

## Contexto

Torque CRM hoje é forte em aquisição (lead → qualificação → fechamento). Pra ICP indústria/fábrica/distribuidor B2B, 70%+ da receita vem de recompra recorrente de commodity. Falta gestão ativa da carteira pós-venda: previsão de recompra, detecção de churn, ação automática via copilot, e visão 360 do cliente.

Módulo upsell existe (`upsell_clients`, `upsell_orders`, `upsell_client_products`, `upsell_campanhas`) mas é parcialmente usado. Essa feature **evolui** o módulo existente — não substitui.

## Feature Flag

Flag `customer_portfolio` no mesmo padrão de `unified_message_gateway`:

- Tabela `feature_flags`: `key: 'customer_portfolio'`, `default_enabled: false`
- Ativação por org via `organization_features`
- Frontend: menu "Carteira" só aparece se flag ON pra org
- Backend: cron de health score só processa orgs com flag ON
- Copilot: bloco de retenção só injeta se flag ON pra org do agente
- Rollout: Milennials primeiro → orgs selecionadas → global

## Arquitetura

Evolução do módulo upsell existente. Peças novas:

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND                              │
│                                                          │
│  Carteira Overview ──── Cliente 360 ──── Quick Order     │
│  (lista + KPIs)        (detalhe)        (3 caminhos)    │
│                                                          │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────┐
│                    BACKEND                               │
│                                                          │
│  Cron: health-score-calculator (diário)                  │
│    → calcula health, ciclo, segmento pra cada cliente    │
│    → gera client_alerts quando sinal detectado           │
│                                                          │
│  Copilot: switch retencao_ativa no agente                │
│    → prompt de retenção injetado automaticamente         │
│    → contexto de carteira no business_context            │
│                                                          │
│  Workflow trigger: recompra_atrasada                     │
│    → dispara workflow ou copilot                         │
│                                                          │
│  Import: CSV upload + parse + bulk insert                │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Data Model

### Campos novos em `upsell_clients`

```sql
-- Ciclo de recompra (calculado por cron)
reorder_cycle_days    INTEGER           -- média dias entre compras
days_since_last_order INTEGER           -- dias desde última compra
last_order_at         TIMESTAMPTZ       -- data última compra
next_order_expected   TIMESTAMPTZ       -- previsão próxima compra
order_count           INTEGER DEFAULT 0 -- total pedidos
lifetime_value        NUMERIC(14,2) DEFAULT 0 -- soma vendas

-- Health score
health_score          INTEGER DEFAULT 100   -- 0-100
health_status         TEXT DEFAULT 'saudavel'
                      CHECK (health_status IN ('saudavel','atencao','risco','inativo'))
health_updated_at     TIMESTAMPTZ

-- Segmento automático
segment               TEXT DEFAULT 'novo'
                      CHECK (segment IN ('ouro','prata','novo','resgate','dormindo'))

-- Ticket
avg_ticket            NUMERIC(12,2)

-- Bridge Wave 1
company_id            UUID REFERENCES companies(id) ON DELETE SET NULL
```

### Nova tabela: `client_purchase_items`

Items granulares por pedido (quantidade, preço unitário, unidade). Indústria vende por kg, litro, caixa — não só "1 unidade".

```sql
CREATE TABLE client_purchase_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES upsell_orders(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT NOT NULL,
  quantity      NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12,2) NOT NULL,
  total_price   NUMERIC(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  unit          TEXT DEFAULT 'un', -- un, kg, l, m, cx, pc
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Nova tabela: `client_alerts`

Sinais detectados pelo cron. Alimenta banner de alertas e timeline.

```sql
CREATE TABLE client_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  alert_type      TEXT NOT NULL CHECK (alert_type IN (
    'reorder_overdue', 'ticket_declining', 'product_missing',
    'cycle_stretching', 'engagement_cold', 'nps_low'
  )),
  severity        TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  title           TEXT NOT NULL,
  description     TEXT,
  metadata        JSONB DEFAULT '{}',
  is_resolved     BOOLEAN DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Campo novo em `upsell_orders`

```sql
source TEXT DEFAULT 'pipe' CHECK (source IN ('pipe','manual','erp','copilot','csv_import'))
```

Permite registro de pedido direto (sem pipe_propostas).

### Campo novo em `copilot_agents`

```sql
retention_enabled     BOOLEAN DEFAULT false
retention_config      JSONB DEFAULT '{}'
-- retention_config schema:
-- {
--   "max_frequency_days": 7,
--   "auto_approach": true,
--   "strategic_alert_only": false,
--   "business_hours_only": true
-- }
```

## Health Score — Cálculo

Cron diário `calculate-portfolio-health`. Processa apenas orgs com flag `customer_portfolio` ON.

### 4 dimensões

| Dimensão | Peso | Fórmula |
|----------|------|---------|
| Recência (R) | 35% | `max(0, 100 - ((dias_desde_ultimo / ciclo_medio - 1) * 100))`. Score 100 se dentro do ciclo, decai linearmente, 0 em 2× ciclo |
| Frequência (F) | 25% | `(freq_ultimos_90d / freq_historica) * 100`. Capped at 100 |
| Ticket (T) | 25% | `(avg_ticket_ultimos_3 / avg_ticket_historico) * 100`. Capped at 100 |
| Engajamento (E) | 15% | Composto: última resposta WhatsApp (50%) + NPS recente (50%) |

**Score final**: `R * 0.35 + F * 0.25 + T * 0.25 + E * 0.15`

### Derivação de status

| Score | Status | Cor |
|-------|--------|-----|
| 80-100 | `saudavel` | Verde |
| 60-79 | `atencao` | Amarelo |
| 30-59 | `risco` | Vermelho |
| 0-29 | `inativo` | Cinza |

### Clientes com menos de 3 pedidos

Score fixo = 70 (status `atencao`), segmento = `novo`. Dados insuficientes pra calcular padrão confiável.

## Detecção de Sinais

Executada junto com health score no mesmo cron. Gera registros em `client_alerts`.

| Sinal | Regra | Severity |
|-------|-------|----------|
| `reorder_overdue` | `dias_desde_ultimo > ciclo_medio * 1.15` | warning (1-7d) / critical (8+d) |
| `ticket_declining` | 3 pedidos consecutivos com valor decrescente | warning |
| `product_missing` | Produto presente em 80%+ dos pedidos ausente no último | info |
| `cycle_stretching` | Média últimos 3 gaps > ciclo histórico × 1.3 | warning |
| `engagement_cold` | Sem resposta WhatsApp 7+ dias + sem pedido | critical |
| `nps_low` | Último NPS ≤ 2 | critical |

Alertas auto-resolvem quando condição deixa de ser verdadeira (ex: cliente faz novo pedido → `reorder_overdue` resolved).

## Segmentação Automática

Calculada no cron junto com health score.

| Segmento | Regra | Ação copilot default |
|----------|-------|---------------------|
| `ouro` | health ≥ 80 + ticket ≥ avg da org + 5+ pedidos | Só age se recompra atrasar |
| `prata` | health ≥ 60 + frequência estável + 3+ pedidos | Checkin a cada ciclo |
| `novo` | Menos de 3 pedidos | Onboarding: satisfação 1ª e 2ª compra |
| `resgate` | health < 60 + já teve 5+ pedidos | Abordagem urgente |
| `dormindo` | 2+ ciclos sem compra (health < 30) | Campanha reativação ou só alerta |

Thresholds configuráveis por org via settings.

## Copilot — Switch de Retenção

### Mecanismo

1. Toggle `retention_enabled` no agente
2. Quando ON, sistema **injeta bloco de retenção no system prompt** automaticamente:

```
RETENÇÃO DE CLIENTES: Quando o contato for um cliente ativo (dados de carteira
disponíveis no contexto), priorize:
(1) Se recompra atrasada, ofereça renovação do último pedido com itens e valores.
(2) Se pós-entrega recente (3 dias), pergunte satisfação de 1 a 5.
(3) Se produto ausente detectado, sonde motivo sem ser invasivo.
(4) Se cliente pedir algo, interprete como pedido: confirme itens + quantidades + valores.
Nunca aborde retenção mais de 1x a cada {max_frequency_days} dias.
Dados do cliente: {contexto_carteira_json}
```

3. Contexto de carteira injetado no `business_context`:
   - `is_active_client: true`
   - `health_score`, `health_status`, `segment`
   - `reorder_cycle_days`, `days_since_last_order`
   - `last_order_products: [{name, qty, value}]`
   - `active_alerts: [{type, severity, title}]`
   - `nps_last: {score, date}`

4. Condição: só injeta quando contato é cliente ativo (`upsell_clients.is_active = true`). Lead novo = ignora bloco.

### Regras de segurança

- NPS ≤ 2 no último feedback → não aborda, escala pra humano
- Máximo 1 abordagem a cada `max_frequency_days` (default 7)
- `strategic_alert_only = true` → notifica vendedor, não age sozinho
- `business_hours_only = true` → só 8h-18h seg-sex
- Rate limit por instância WhatsApp via message gateway

## Workflow Trigger: `recompra_atrasada`

Novo trigger adicionado ao workflow engine:

```typescript
{
  type: 'recompra_atrasada',
  payload: {
    client_id: string,
    lead_id: string,
    days_overdue: number,
    cycle_days: number,
    health_score: number,
    segment: string,
    last_order_value: number,
    last_order_products: string[]
  }
}
```

Disparado pelo cron de health score quando detecta `reorder_overdue`. Permite automações custom: "quando recompra atrasa 15+ dias, cria tarefa pra gerente".

## Registro de Pedido — 3 Caminhos

### Caminho 1: Repetir Último Pedido (v1)

- Abre modal no card do cliente
- Pré-popula com itens do último `upsell_orders` + `client_purchase_items`
- Vendedor ajusta quantidades
- Confirma → cria `upsell_orders` + `client_purchase_items` com `source: 'manual'`
- Métricas recalculam no próximo cron (ou inline se performance permitir)

### Caminho 2: WhatsApp → Pedido (v2, pós-validação)

- Copilot com `retention_enabled` interpreta mensagem natural do cliente
- Faz match com produtos do catálogo (`products` table)
- Cria pedido draft (status pendente)
- Vendedor aprova com 1 clique no CRM
- Ou copilot confirma sozinho se `auto_approach = true`

### Caminho 3: ERP Auto-sync (v2)

- Webhook do TinyERP notifica quando NF emitida
- CRM faz match por CNPJ com `upsell_clients`
- Mapeia produtos por SKU/nome
- Cria `upsell_orders` + `client_purchase_items` com `source: 'erp'`
- Zero intervenção humana

## Import de Carteira

### CSV Import (v1)

Template CSV:

```csv
nome,empresa,cnpj,telefone,email,produto,quantidade,valor_unitario,unidade,data_pedido
"Ricardo Silva","Ind. Quimica Nordeste","12345678000190","81999990000","ricardo@iqn.com","Resina Epoxi 20kg",2,2400.00,"un","2026-01-28"
"Ricardo Silva","Ind. Quimica Nordeste","12345678000190","81999990000","ricardo@iqn.com","Solvente P-100",4,1100.00,"un","2026-01-28"
"Ricardo Silva","Ind. Quimica Nordeste","12345678000190","81999990000","ricardo@iqn.com","Resina Epoxi 20kg",2,2400.00,"un","2026-03-02"
```

Múltiplas linhas = múltiplos pedidos. Sistema agrupa por CNPJ/telefone:
1. Cria/match `upsell_client` (match por CNPJ ou telefone com lead existente)
2. Agrupa linhas por `data_pedido` → cada grupo = 1 `upsell_orders`
3. Cada linha dentro do grupo = 1 `client_purchase_items`
4. Calcula ciclo, health, segmento automaticamente

UI: página de import com drag-and-drop, preview de dados, mapeamento de colunas, validação antes de confirmar.

### Migração retroativa (automática)

Pra orgs que já têm `upsell_clients` + `upsell_orders`:
- Migration script popula campos novos (ciclo, health, segmento) com base nos orders existentes
- Roda uma vez quando flag é ativada pra org

## Frontend

### Navegação

Menu lateral: "Carteira" (só visível se flag `customer_portfolio` ON). Substitui/evolui "Upsell" existente.

### Páginas

**Carteira Overview** (`/carteira`)
- KPIs: receita recorrente, pedidos previstos, recompras atrasadas, ticket médio, health médio
- Banner de alerta: clientes com ação urgente + botão "copilot abordar"
- Tabs: Todos, Pedido previsto, Recompra atrasada, Em crescimento, Novos
- Filtros: segmento, vendedor, produto
- Tabela: cliente, health badge, status recompra, ticket, tendência, segmento, ações
- Sidebar: preview rápido ao clicar (métricas, produtos, timeline, ações)

**Cliente 360** (`/carteira/:clientId`)
- Header: avatar, dados empresa, health ring, ações rápidas
- Strip de alertas ativos
- Grid de métricas (6 cards)
- Previsão de recompra visual (barra de progresso no ciclo)
- Card copilot: sugestão contextual com ações (enviar, editar, deixar copilot agir)
- Produtos recorrentes: lista com frequência, trend, flag de ausente
- Histórico de pedidos: timeline com gap entre pedidos
- Contatos: múltiplos por empresa com papel
- NPS/Satisfação: score médio + histórico
- Timeline unificada: pedidos, WhatsApp, alertas, notas
- Notas internas

**Quick Order** (modal, acessível de qualquer tela)
- Seleciona cliente → pré-popula com último pedido
- Ajusta quantidades, adiciona/remove produtos
- Total calculado em tempo real
- Confirma → registra

**Import CSV** (`/carteira/import`)
- Upload drag-and-drop
- Preview de dados parseados
- Mapeamento de colunas (auto-detect + ajuste manual)
- Validação: duplicatas, campos obrigatórios, formato
- Confirmação com resumo (X clientes, Y pedidos)
- Progress bar durante processamento

### Config do Copilot (seção existente)

Na página de configuração do agente, nova seção "Retenção & Carteira":
- Toggle retenção on/off
- Frequência máxima de abordagem (slider: 3-30 dias, default 7)
- Modo: automático vs alertar vendedor
- Clientes estratégicos: sempre alertar antes (toggle)

## Fases de entrega

| Fase | Escopo | Estimativa |
|------|--------|-----------|
| **0** | Feature flag + migration (campos novos, tabelas novas) | 1 dia |
| **1** | Cron health score + segmentação + client_alerts | 2 dias |
| **2** | Frontend: Carteira Overview + Cliente 360 | 3-4 dias |
| **3** | Quick Order (repetir último pedido) + registro manual | 2 dias |
| **4** | Import CSV + migração retroativa | 2 dias |
| **5** | Copilot: switch retenção + prompt injection + contexto carteira | 2 dias |
| **6** | Workflow trigger `recompra_atrasada` + NPS pós-entrega | 1-2 dias |
| **Total** | | **~12-14 dias úteis** |

Cada fase é deployável e testável independentemente. Flag OFF = zero impacto em produção.

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Dados de carteira vazios (sem histórico) | Import CSV + migração retroativa + quick order low-friction |
| Copilot abordando cliente indevidamente | Rate limit por cliente + segmento estratégico alerta vendedor + NPS gate |
| Health score impreciso com poucos dados | Clientes com < 3 pedidos = score fixo 70, segmento "novo" |
| Performance do cron com muitos clientes | Processa em batches por org, índices otimizados |
| Vendedor não adota | UI mínima fricção, "repetir pedido" em 2 cliques, alertas proativos |

## Métricas de sucesso

- 80%+ dos clientes ativos com health score calculado (dados suficientes)
- Redução de 30%+ em recompras atrasadas não detectadas
- 50%+ dos pedidos recorrentes registrados via quick order (vs zero hoje)
- Copilot de retenção com taxa de resposta ≥ taxa de outbound atual
- Zero falsos positivos em alertas de churn (primeiros 30 dias: monitorar e ajustar thresholds)
