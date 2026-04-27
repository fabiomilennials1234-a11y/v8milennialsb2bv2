# Design: Modulo Upsell

**Data:** 2026-02-21
**Status:** Aprovado

---

## 1. Objetivo

Modulo para organizar e monetizar a base de clientes existentes. Duas abas:
- **Base de Clientes**: Kanban por tempo de contrato (colunas customizaveis por org)
- **Campanhas**: Kanban com 8 status para abordagem comercial de upsell

---

## 2. Decisoes Confirmadas

| # | Decisao | Alternativas consideradas | Motivo |
|---|---------|--------------------------|--------|
| 1 | Venda rapida no card do cliente, sem Pipe Propostas | Mini-proposta interna, auto-criar no Pipe Propostas | Simplicidade operacional |
| 2 | Flag `origin` em `upsell_orders` (upsell vs new_business) | Sem flag, metas separadas | Relatorios separados, comissao unificada |
| 3 | Colunas Kanban customizaveis via `pipeline_stages` | Fixas, ciclo contratual | Flexibilidade por org |
| 4 | Potencial: categorias fixas enum (baixo/medio/alto/estrategico) | Score numerico, calculado, combinacao | Simplicidade de filtro |
| 5 | Inativo com badge no Kanban, vendas zeradas | Lista separada, fluxo em risco | Visibilidade sem complexidade |
| 6 | Status "proposta" na campanha e apenas label visual | Auto-criar no Pipe Propostas, label manual | Evita acoplamento |
| 7 | `upsell_client` vinculado ao lead (`lead_id`), herda dados | Registro independente, ambos | Rastreabilidade + dados herdados |
| 8 | Metricas = vendas totais + vendas do mes | MRR/LTV separados | Alinhado com modelo de negocio |
| 9 | Trigger AFTER UPDATE (nao BEFORE) | Frontend, n8n | Atomicidade, sem alterar fluxo existente |
| 10 | Nova migration separada, sem alterar existentes | Modificar migrations existentes | Zero risco de regressao |
| 11 | Trigger so READS tabelas existentes | Writes cruzados | Zero side-effects no sistema atual |

---

## 3. Modelagem de Banco

### 3.1 Enums

```sql
CREATE TYPE upsell_campanha_status AS ENUM (
  'cliente', 'planejado', 'abordado', 'interesse',
  'proposta', 'vendido', 'futuro', 'perdido'
);

CREATE TYPE upsell_potencial AS ENUM (
  'baixo', 'medio', 'alto', 'estrategico'
);
```

### 3.2 Tabela: upsell_clients

```sql
CREATE TABLE upsell_clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  company         TEXT,
  email           TEXT,
  phone           TEXT,
  potencial       upsell_potencial NOT NULL DEFAULT 'medio',
  tipo_cliente_tempo TEXT NOT NULL DEFAULT 'novo',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  closer_id       UUID REFERENCES team_members(id) ON DELETE SET NULL,
  first_sale_at   TIMESTAMPTZ NOT NULL,
  churned_at      TIMESTAMPTZ,
  reactivated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, lead_id)
);
```

### 3.3 Tabela: upsell_client_products

```sql
CREATE TABLE upsell_client_products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name     TEXT NOT NULL,
  product_type     TEXT NOT NULL CHECK (product_type IN ('mrr', 'projeto', 'unitario')),
  sale_value       NUMERIC(12,2) NOT NULL CHECK (sale_value >= 0),
  contract_duration INTEGER,
  status           TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'cancelado')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.4 Tabela: upsell_orders

```sql
CREATE TABLE upsell_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id),
  client_id        UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  closer_id        UUID REFERENCES team_members(id) ON DELETE SET NULL,
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name     TEXT NOT NULL,
  product_type     TEXT NOT NULL CHECK (product_type IN ('mrr', 'projeto', 'unitario')),
  sale_value       NUMERIC(12,2) NOT NULL CHECK (sale_value > 0),
  origin           TEXT NOT NULL DEFAULT 'upsell' CHECK (origin IN ('new_business', 'upsell')),
  campanha_id      UUID REFERENCES upsell_campanhas(id) ON DELETE SET NULL,
  pipe_proposta_id UUID REFERENCES pipe_propostas(id) ON DELETE SET NULL,
  sold_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.5 Tabela: upsell_campanhas

```sql
CREATE TABLE upsell_campanhas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  client_id         UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  closer_id         UUID REFERENCES team_members(id) ON DELETE SET NULL,
  status            upsell_campanha_status NOT NULL DEFAULT 'cliente',
  mrr_planejado     NUMERIC(12,2) DEFAULT 0,
  projeto_planejado NUMERIC(12,2) DEFAULT 0,
  data_abordagem    TIMESTAMPTZ,
  data_venda        TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.6 Indices

```sql
CREATE INDEX idx_upsell_clients_org ON upsell_clients(organization_id);
CREATE INDEX idx_upsell_clients_lead ON upsell_clients(lead_id);
CREATE INDEX idx_upsell_orders_org_sold ON upsell_orders(organization_id, sold_at);
CREATE INDEX idx_upsell_orders_client ON upsell_orders(client_id);
CREATE INDEX idx_upsell_orders_closer_sold ON upsell_orders(closer_id, sold_at);
CREATE INDEX idx_upsell_campanhas_org_status ON upsell_campanhas(organization_id, status);
CREATE INDEX idx_upsell_campanhas_client ON upsell_campanhas(client_id);
CREATE INDEX idx_upsell_client_products_client ON upsell_client_products(client_id);
```

---

## 4. Automacao: Propostas -> Upsell

### Trigger: handle_proposta_vendida

- Dispara em AFTER UPDATE de pipe_propostas quando status muda para 'vendido'
- READS: leads, pipe_proposta_items, products (SELECT apenas)
- WRITES: upsell_clients, upsell_client_products, upsell_orders, upsell_campanhas (tabelas NOVAS)
- Idempotente: ON CONFLICT para upsell_clients, check de pipe_proposta_id existente para orders
- Fallback: propostas sem items usam sale_value/product_type do nivel da proposta
- Origin: 'new_business' para vendas vindas do Pipe Propostas

### Venda Rapida (origin = 'upsell')

- Frontend insere direto em upsell_orders + upsell_client_products
- Sem trigger, operacao direta via Supabase client
- Se veio de campanha, seta campanha_id na order

---

## 5. Metricas

### Stats Base de Clientes (topo)
- Total clientes (count upsell_clients WHERE is_active)
- Total vendas (sum upsell_orders.sale_value)
- Clientes ativos (count WHERE is_active = true)
- Clientes inativos (count WHERE is_active = false)

### Stats Campanhas
- Vendas totais (sum upsell_orders.sale_value)
- Vendas do mes (sum WHERE sold_at no mes corrente)
- Campanhas ativas (count WHERE status NOT IN vendido, perdido, futuro)
- Taxa de conversao (campanhas vendidas / total do periodo)

---

## 6. Analise de Impacto

### Arquivos modificados (minimo)
- `src/App.tsx` - adicionar 1 rota /upsell (append)
- `src/components/layout/Sidebar.tsx` - adicionar 1 item em navItems (append)

### Arquivos NAO tocados
- PipePropostas.tsx, usePipePropostas.ts, usePipePropostaItems.ts
- usePipeMetrics.ts, useAutoFollowUp.ts
- Campanhas.tsx, useCampanhas.ts
- useTeamMembers.ts, useLeads.ts, useProducts.ts
- Todos os componentes de proposals/*
- Todas as migrations existentes
- Tabelas existentes (leads, pipe_propostas, products, team_members)

---

## 7. Estrutura de Arquivos (frontend)

```
src/
  pages/
    Upsell.tsx
  components/
    upsell/
      UpsellBaseKanban.tsx
      UpsellBaseList.tsx
      UpsellCampanhasKanban.tsx
      UpsellClientCard.tsx
      UpsellCampanhaCard.tsx
      CreateClientModal.tsx
      ClientDetailModal.tsx
      CreateCampanhaModal.tsx
      CampanhaDetailModal.tsx
      QuickSaleModal.tsx
      UpsellStats.tsx
  hooks/
    useUpsellClients.ts
    useUpsellClientProducts.ts
    useUpsellOrders.ts
    useUpsellCampanhas.ts
    useUpsellMetrics.ts
```

---

## 8. RLS

Todas as tabelas novas:
- ENABLE ROW LEVEL SECURITY
- SELECT/INSERT/UPDATE/DELETE por organization_id = get_user_organization_id()
- upsell_client_products: via JOIN com upsell_clients

---

## 9. Pipeline Stages (Kanban customizavel)

Novo pipeline_type: 'upsell_base'
Default stages: 0-3m, 3-6m, 6-9m, 9-12m, 12-18m, 18m+
Admin pode customizar via mesmo mecanismo existente

---

## 10. Navegacao

Sidebar: dentro do grupo "Funis", novo item "Upsell" com icone TrendingUp
Rota: /upsell com ProtectedRoute + LayoutWrapper
