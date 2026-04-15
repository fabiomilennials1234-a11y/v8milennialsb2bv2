---
tags:
  - torque-crm
  - docs
  - reference
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/plan-upsell-implementation.md
---

# Plano de Implementacao: Modulo Upsell

**Referencia:** docs/design-upsell-module.md
**Data:** 2026-02-21

---

## Fase 1: Banco de Dados (migration)

### 1.1 Criar migration unica
Arquivo: `supabase/migrations/YYYYMMDD_upsell_module.sql`

Conteudo:
- [ ] Criar enum `upsell_campanha_status`
- [ ] Criar enum `upsell_potencial`
- [ ] Criar tabela `upsell_clients` com UNIQUE(org, lead_id)
- [ ] Criar tabela `upsell_client_products` com CHECK constraints
- [ ] Criar tabela `upsell_campanhas`
- [ ] Criar tabela `upsell_orders` com CHECK(sale_value > 0)
- [ ] Criar todos os indices
- [ ] ENABLE ROW LEVEL SECURITY em todas as tabelas
- [ ] Criar RLS policies (SELECT/INSERT/UPDATE/DELETE por org)
- [ ] Inserir pipeline_stages default para 'upsell_base'
- [ ] Atualizar funcao create_default_pipeline_stages para incluir upsell_base

### 1.2 Criar trigger handle_proposta_vendida
- [ ] Funcao handle_proposta_vendida() SECURITY DEFINER
- [ ] Idempotencia: ON CONFLICT para clients, check pipe_proposta_id para orders
- [ ] Fallback: propostas sem items
- [ ] Trigger AFTER UPDATE em pipe_propostas

### 1.3 Gerar tipos TypeScript
- [ ] Rodar `supabase gen types` para atualizar types.ts

---

## Fase 2: Hooks (data layer)

### 2.1 useUpsellClients.ts
- [ ] useUpsellClients() - lista com realtime
- [ ] useUpsellClient(id) - detalhe
- [ ] useCreateUpsellClient() - criacao manual
- [ ] useUpdateUpsellClient() - update (inclui drag-and-drop)
- [ ] useDeleteUpsellClient() - remocao (soft? hard?)

### 2.2 useUpsellClientProducts.ts
- [ ] useUpsellClientProducts(clientId) - produtos do cliente
- [ ] useCreateUpsellClientProduct()
- [ ] useUpdateUpsellClientProduct()
- [ ] useDeleteUpsellClientProduct()

### 2.3 useUpsellOrders.ts
- [ ] useUpsellOrders() - todas as orders da org
- [ ] useUpsellOrdersByClient(clientId)
- [ ] useCreateUpsellOrder() - venda rapida

### 2.4 useUpsellCampanhas.ts
- [ ] useUpsellCampanhas() - lista com realtime
- [ ] useCreateUpsellCampanha()
- [ ] useUpdateUpsellCampanha() - inclui drag-and-drop + logica data_abordagem
- [ ] useDeleteUpsellCampanha()

### 2.5 useUpsellMetrics.ts
- [ ] vendasTotal, vendasMes
- [ ] totalClientes, clientesAtivos, clientesInativos
- [ ] campanhasAtivas, taxaConversao

---

## Fase 3: Componentes Base

### 3.1 UpsellStats.tsx
- [ ] Stats cards no topo (reutilizar padrao visual existente)

### 3.2 UpsellClientCard.tsx
- [ ] Card do cliente para Kanban (nome, empresa, potencial badge, vendas, status ativo/inativo badge)

### 3.3 UpsellCampanhaCard.tsx
- [ ] Card da campanha para Kanban (cliente, closer, valores planejados, status)

---

## Fase 4: Modais

### 4.1 CreateClientModal.tsx
- [ ] Selecionar lead existente OU criar dados manuais
- [ ] Campos: nome, empresa, email, phone, potencial, closer, first_sale_at

### 4.2 ClientDetailModal.tsx
- [ ] 3 abas: Dados, Produtos, Pedidos
- [ ] Aba Dados: info do cliente, potencial, status ativo/inativo
- [ ] Aba Produtos: lista de produtos ativos/cancelados
- [ ] Aba Pedidos: historico de upsell_orders

### 4.3 QuickSaleModal.tsx
- [ ] Selecionar produto (da lista de products da org)
- [ ] Valor da venda, notas
- [ ] Insere em upsell_orders + upsell_client_products

### 4.4 CreateCampanhaModal.tsx
- [ ] 3 passos: Selecionar cliente -> Dados da campanha -> Confirmar
- [ ] Campos: cliente, closer, mrr_planejado, projeto_planejado, notes

### 4.5 CampanhaDetailModal.tsx
- [ ] 3 abas: Campanha, Cliente, Produtos
- [ ] Aba Campanha: status, closer, valores, datas
- [ ] Aba Cliente: dados do upsell_client vinculado
- [ ] Aba Produtos: produtos do cliente

---

## Fase 5: Kanbans

### 5.1 UpsellBaseKanban.tsx
- [ ] Kanban com colunas de pipeline_stages WHERE pipeline_type = 'upsell_base'
- [ ] Drag-and-drop atualiza tipo_cliente_tempo
- [ ] Calculo de vendas total por coluna
- [ ] Badge inativo (cinza, sem somar vendas)

### 5.2 UpsellBaseList.tsx
- [ ] Tabela alternativa com mesmos dados
- [ ] Colunas: nome, empresa, potencial, vendas total, closer, tempo, status

### 5.3 UpsellCampanhasKanban.tsx
- [ ] 8 colunas por status enum
- [ ] Drag-and-drop com logica especial:
  - Saida de "planejado" -> seta data_abordagem
  - Entrada em "vendido" -> abre QuickSaleModal
- [ ] Stats mensais no topo

---

## Fase 6: Pagina Principal + Integracao

### 6.1 Upsell.tsx
- [ ] Tabs: "Base de Clientes" | "Campanhas"
- [ ] Toggle Kanban/Lista na aba Base
- [ ] Filtros (busca, potencial, tipo_cliente_tempo, closer, status ativo/inativo)
- [ ] Filtros campanhas (mes/ano, status, potencial, closer, busca)
- [ ] Botoes de criacao (Novo Cliente, Nova Campanha)

### 6.2 Integracoes
- [ ] Adicionar rota em App.tsx
- [ ] Adicionar item no Sidebar.tsx
- [ ] Adicionar realtime subscriptions

---

## Fase 7: Testes e Validacao

- [ ] Testar trigger: criar proposta, mover para vendido, verificar upsell_client criado
- [ ] Testar idempotencia: mover vendido->outro->vendido, verificar sem duplicatas
- [ ] Testar venda rapida: registrar order, verificar metricas
- [ ] Testar drag-and-drop em ambos Kanbans
- [ ] Testar multi-tenant: org A nao ve dados de org B
- [ ] Testar RLS policies
- [ ] Build TypeScript sem erros

---

## Ordem de Execucao Recomendada

1. Fase 1 (banco) - fundacao
2. Fase 2 (hooks) - data layer
3. Fase 3 (componentes base) - blocos visuais
4. Fase 4 (modais) - interacoes
5. Fase 5 (kanbans) - views principais
6. Fase 6 (pagina + integracao) - montagem final
7. Fase 7 (testes) - validacao

Cada fase pode ser commitada e testada independentemente.


## Links relacionados

- [[Produtos]]

- [[Permissoes Sistema]]

- [[Upsell]]

- [[Campanhas]]

- [[Pipe Propostas]]

- [[00 - INDEX]]
