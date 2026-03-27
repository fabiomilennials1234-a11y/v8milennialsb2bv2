# Central de Comandos B2B — Design Spec

**Data:** 2026-03-27
**Objetivo:** Reformulação profunda da dashboard para linguagem executiva/comercial B2B, substituindo a temática automotiva/gamificada infantil por uma experiência premium, dinâmica e orientada a performance comercial.

---

## 1. Abordagem

**Híbrida:** Nova página Dashboard.tsx com layout de tabs e novos componentes visuais, reutilizando e estendendo RPCs e hooks existentes. Backend recebe apenas adições necessárias.

---

## 2. Estrutura Geral

### Layout
- **3 tabs:** Visão Geral | Performance | Inteligência Comercial
- **Cabeçalho fixo** acima das tabs (não scrollável)
- **Oráculo flutuante** no canto inferior direito (position fixed, fora das tabs)

### Cabeçalho
```
Bom dia, [Nome].                                 Março 2026
Aqui está o panorama do seu mês.                  [< >] navegação de mês
```
- Saudação dinâmica: Bom dia / Boa tarde / Boa noite (baseado na hora local)
- Nome do usuário do `useAuth()`
- Seletor de mês com navegação anterior/próximo

### Comportamento por Perfil
- **Admin/Gestor:** Dados org-wide em todas as tabs
- **Vendedor (não-admin):** Dados do time + seção "Meu Desempenho" com números pessoais

---

## 3. Tab: Visão Geral

### Row 1 — KPIs Principais (6 cards em grid responsivo)

| Card | Métrica | Fonte | Status |
|------|---------|-------|--------|
| Receita do Mês | Soma vendas (status=vendido) | RPC existente | Reutilizar |
| Leads Captados | Total de leads no período | RPC existente | Reutilizar |
| Ticket Médio | Receita / nº vendas | Calculado | Reutilizar |
| Propostas Enviadas | Nº de propostas criadas | `pipe_propostas` | **Adicionar ao RPC** |
| Taxa de Conversão | Vendas / Propostas % | Calculado | Novo (frontend) |
| Tempo Médio de Resposta | Lead criado → primeiro contato | `leads` vs `pipe_confirmacao` | **Novo no RPC** (aproximação) |

Cada card:
- Ícone + label executivo
- Valor grande em destaque (`text-3xl font-bold`)
- Tendência vs mês anterior (seta ↑↓ verde/vermelho)
- Animação de count-up ao carregar

**Gap — Tempo Médio de Resposta:** Sem timestamp de "primeiro contato" explícito. Aproximação: `pipe_confirmacao.created_at - leads.created_at` para o primeiro registro de confirmação do lead.

### Row 2 — Velocímetro de Metas + Funil de Vendas

**Velocímetro (60% da largura):**
- Visual de velocímetro automotivo real — arco semicircular
- Escala de 0% a 120%+ da meta
- **Ponteiro vermelho:** onde deveria estar hoje (dia_atual / dias_do_mês × meta)
- **Ponteiro verde/azul:** onde realmente está (realizado / meta × 100%)
- Efeito glow quando real > esperado
- Pulso sutil de alerta quando real < esperado
- Labels abaixo: "Meta: R$ X" / "Realizado: R$ Y" / "Dia Z de W"
- Toggle: meta de faturamento ↔ meta de reuniões
- Dados: `useTeamGoals` + `useIndividualGoals` existentes

**Funil de Vendas (40% da largura):**
- 4 etapas verticais: Leads → Reuniões → Propostas → Vendas
- Barras horizontais proporcionais com degradê
- % de conversão entre cada etapa
- Dados: `useFunnelData` existente

### Row 3 — Top 5 Vendedores + Receita por Tipo

**Top 5 Vendedores (60%):**
- Lista: posição, nome, valor vendido, % da meta
- Medalhas top 3 (ouro, prata, bronze)
- Mini barra de progresso por vendedor
- Dados: `useRankingData` existente

**Primeiro Pedido vs Base Ativa (40%):**
- Ring chart com dois segmentos
- Primeiro pedido = lead cuja primeira proposta vendida (`MIN(closed_at)`) é no mês atual
- Base ativa = leads com proposta vendida anterior ao mês atual
- **Novo** — subquery no RPC `get_dashboard_metrics`

---

## 4. Tab: Performance

### Row 1 — Ranking Completo de Vendas
- Tabela com todos os vendedores
- Colunas: Posição, Nome, Vendas (R$), Nº Vendas, Ticket Médio, Meta, % Atingido
- Barra de progresso inline no % Atingido
- Linha do vendedor logado destacada
- Ordenável por qualquer coluna
- Dados: `useRankingData` existente

### Row 2 — Análise de Vendedores (Score + Breakdown)

**Card por vendedor (grid 2-3 por linha):**

Estado compacto:
- Avatar/iniciais + nome
- Score de Atividade (0-100) com ring chart
- Cor semáforo: verde (>70), amarelo (40-70), vermelho (<40)

Estado expandido (ao clicar):
- Mini-barras: leads movimentados, follow-ups completados, reuniões realizadas, propostas enviadas, vendas fechadas
- Valor absoluto + comparativo com média do time

**Fórmula do Score:**
```
score_bruto = (leads × 10) + (followups × 15) + (reunioes × 20) + (propostas × 25) + (vendas × 30)
score_normalizado = (score_bruto / max_score_do_time) × 100
```

**Novo** — RPC `get_seller_activity_scores(p_org_id, p_start_date, p_end_date)`

### Row 3 — Produtos Mais Vendidos

**Gráfico de barras horizontais (55%):**
- Top 10 produtos por faturamento
- Cor diferente para MRR vs Projeto

**Tabela detalhada (45%):**
- Produto, Tipo, Qtd Vendida, Valor Total, Ticket Médio
- Ordenável

**Novo** — RPC `get_product_ranking(p_org_id, p_start_date, p_end_date)`

### Row 4 — Gráfico Diário + Atividades Recentes

**Gráfico de performance diária (60%):**
- Área/barras: receita acumulada dia a dia
- Linha de referência: ritmo para bater a meta
- Reutilizar `PerformanceChart` com ajuste visual

**Atividades Recentes (40%):**
- Feed cronológico: vendas, propostas, reuniões, leads
- Ícone + texto + timestamp
- Max 15 itens com scroll interno
- Reutilizar `ActivityFeed` com nova linguagem

---

## 5. Tab: Inteligência Comercial

### Row 1 — Metas Detalhadas

**Meta do Time:**
- Grid com metas da org (faturamento, clientes, reuniões)
- Barra de progresso grande, valor atual vs alvo, %
- Indicador de ritmo: "No ritmo" / "Acima da meta" / "Abaixo do ritmo"
- Dados: `useTeamGoals` existente

**Metas Individuais:**
- Tabela: Nome, Meta (R$), Realizado (R$), %, Status (semáforo)
- Dados: `useIndividualGoals` existente

### Row 2 — Comparativo Meta Esperada vs Real

- Gráfico de linha dupla mensal:
  - Tracejada: ritmo ideal (meta ÷ dias, acumulado)
  - Sólida: realizado acumulado
- Área entre linhas: verde quando acima, vermelho quando abaixo
- Tooltip com valores por dia
- **Novo** — query de vendas agrupadas por dia

### Row 3 — Insights de IA

**Diagnóstico do Mês:**
- 3-4 bullets gerados pela IA com base nos dados reais
- Exemplos: "Ticket médio caiu 12% vs fevereiro", "SDR João 40% abaixo do ritmo"
- Via edge function `oraculo-comercial` modo "diagnóstico"
- Cache 1x por dia
- **Novo** — estender edge function

**Benchmark do Segmento:**
- Comparativo com organizações do mesmo segmento/porte
- Métricas: ticket médio, taxa de conversão, leads/vendedor
- Barras lado a lado: "Sua operação vs Média do segmento"
- Fallback: "Dados comparativos disponíveis quando houver mais operações no seu segmento"
- **Novo** — RPC `get_segment_benchmark(p_org_id)`

### Row 4 — Gráfico Semanal
- Performance últimos 7 dias (leads, reuniões, vendas)
- Reutilizar `WeeklyChart` com visual novo

---

## 6. Oráculo Comercial (Chat de IA)

### Estado Fechado
- Ícone circular flutuante, canto inferior direito (position fixed)
- Glow animado sutil (pulso)
- Badge com perguntas restantes (3, 2, 1, 0)
- Tooltip: "Oráculo Comercial — X perguntas restantes"

### Animação de Abertura
1. Clique no ícone
2. Scale do ícone → centro da tela (~400ms, cubic-bezier)
3. Bordas expandem de circular para modal retangular
4. Chat aparece com fade-in
5. Framer Motion `layoutId` para transição suave

### Interface do Chat
- Header: "Oráculo Comercial" + botão fechar
- Área de mensagens com scroll
- Input + botão enviar
- Mensagem inicial: "Olá, [nome]. Posso analisar seus dados de vendas, performance da equipe, e sugerir estratégias. O que quer saber?"
- Chips de sugestão: "Como está meu mês?", "Quem precisa de atenção?", "Qual produto focar?"

### Rate Limiting (Backend)

**Tabela nova:**
```sql
CREATE TABLE oraculo_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  organization_id UUID NOT NULL,
  question TEXT NOT NULL,
  response TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**RPC:** `check_oraculo_limit(p_user_id)` → `{ used: integer, remaining: integer }`
- Conta registros do dia (UTC) para o user
- Limite: 3 perguntas/dia/usuário

**Edge function:** Valida limite ANTES de processar. Frontend nunca é confiado.

**Quando esgotar:** Input desabilitado + "Você utilizou suas 3 consultas de hoje. Novas consultas disponíveis amanhã."

### Contexto Enviado à IA
- Métricas do mês (via RPC existente)
- Ranking de vendedores
- Metas e progresso
- Dados de atividade
- Pergunta do usuário
- Prompt: responder com dados reais, nunca inventar, tom executivo

### Fechamento
- Animação inversa: modal encolhe para ícone
- Histórico mantido em state local enquanto página aberta

---

## 7. Sistema Visual

### Cores
| Uso | Variável |
|-----|----------|
| Primária | `--primary` (manter) |
| Sucesso/Acima | `--success` (verde) |
| Alerta | `--warning` (âmbar) |
| Crítico/Abaixo | `--destructive` (vermelho) |
| Meta esperada | Vermelho suave customizado |
| Cards | Glassmorphism: `bg-white/80 backdrop-blur` com borda fina |

### Animações
| Elemento | Efeito | Lib |
|----------|--------|-----|
| Cards ao carregar | Fade-in + slide-up escalonado | Framer Motion |
| KPIs | Count-up de 0 ao valor | Hook `useCountUp` |
| Velocímetro | Ponteiros giram do 0 à posição | Framer Motion rotate |
| Barras de progresso | Preenchimento progressivo | CSS/Framer |
| Funil | Barras crescem | Framer Motion |
| Oráculo | Scale + fade (ícone ↔ modal) | Framer Motion layoutId |
| Tabs | Crossfade | Framer AnimatePresence |
| Score vendedor | Ring preenche ao entrar na viewport | IntersectionObserver + Framer |

### Tipografia
- Valores KPI: `text-3xl font-bold`
- Labels: `text-sm font-medium text-muted-foreground`
- Títulos de seção: `text-lg font-semibold`

---

## 8. Substituição de Linguagem

| Remover | Substituir por |
|---------|---------------|
| Central de Comando Torque | Central de Comandos |
| Combustível | Leads Captados |
| Velocímetro de Metas | Meta do Mês |
| Pista de Conversão | Funil de Vendas |
| Pilotos em Ação | Top Vendedores |
| Pit Lane | Atividades Recentes |
| Voltas / Volta X de Y | Dia X de Y |
| Hora de Acelerar | (removido) |
| Velocidade Total | Receita do Mês |
| Ticket Médio MRR | Ticket Médio Recorrente |
| Ticket Médio Projeto | Ticket Médio Projeto (manter) |

### Terminologia Nova
- Pipeline, Carteira, Base Ativa, Primeiro Pedido
- Índice de Atividade, Ritmo, Operação Comercial

---

## 9. Backend — Itens Novos

### Extensões de RPCs Existentes
1. **`get_dashboard_metrics`** — adicionar:
   - Contagem de propostas enviadas
   - Tempo médio de resposta (aproximação)
   - Primeiro pedido vs base ativa (subquery)
   - Vendas agrupadas por dia (série temporal)

### RPCs Novos
2. **`get_seller_activity_scores(p_org_id, p_start_date, p_end_date)`**
   - Agrega por vendedor: leads, follow-ups, reuniões, propostas, vendas
   - Calcula score normalizado

3. **`get_product_ranking(p_org_id, p_start_date, p_end_date)`**
   - Top produtos por faturamento via `pipe_proposta_items` + `products`
   - Retorna: nome, tipo, qtd, valor total, ticket médio

4. **`get_segment_benchmark(p_org_id)`**
   - Métricas anônimas agregadas por segmento
   - Retorna comparativo: org vs média do segmento

5. **`check_oraculo_limit(p_user_id)`**
   - Conta uso do dia, retorna used/remaining

### Migrations Novas
6. **Tabela `oraculo_usage`** — rate limiting do Oráculo

### Edge Function
7. **`oraculo-comercial`** — estender para:
   - Modo `chat` (conversacional, recebe pergunta)
   - Modo `diagnostico` (gera bullets automáticos)
   - Validação de rate limit no backend

---

## 10. Componentes — Inventário

### Reutilizar (com visual novo)
- `PerformanceChart` → ajuste de cores/labels
- `ActivityFeed` → nova linguagem
- `WeeklyChart` → visual atualizado
- `FunnelChart` → nova paleta

### Criar do Zero
- `SpeedometerGauge` — velocímetro automotivo SVG/Canvas
- `KPICardNew` — card de métrica com count-up e tendência
- `ProductRanking` — gráfico + tabela de produtos
- `SellerActivityCard` — score + breakdown expandível
- `MetaComparativeChart` — linha dupla esperado vs real
- `SegmentBenchmark` — barras comparativas
- `OraculoChat` — modal de chat com animação
- `OraculoFloatingButton` — ícone flutuante com badge
- `DashboardTabs` — container de tabs com AnimatePresence

### Hooks Novos
- `useProductRanking(month, year)`
- `useSellerActivityScores(month, year)`
- `useSegmentBenchmark()`
- `useOraculoChat()` — estado do chat + rate limit
- `useCountUp(target, duration)` — animação de contagem

---

## 11. Gaps e Limitações Conhecidas

| Item | Limitação | Mitigação |
|------|-----------|-----------|
| Tempo de resposta | Sem timestamp de 1º contato | Usar `pipe_confirmacao.created_at` como proxy |
| Benchmark segmento | Depende de volume de orgs no mesmo segmento | Fallback com mensagem explicativa |
| Insights IA | Qualidade depende do volume de dados | Prompt bem estruturado + fallback para poucos dados |
| Primeiro pedido | Depende de histórico de `closed_at` | Funciona bem se dados históricos existirem |

---

## 12. Mockups

Serão criados mockups visuais no browser conforme cada parte for implementada, para validação incremental pelo usuário antes de avançar.

---

## 13. Branch e Banco

- **Branch:** `Refactor-Dashboard` (sem push para main ou develop)
- **Banco:** Apenas DEV (`bcfadphgsibjzivtbjvc`)
