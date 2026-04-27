# Feature: Analytics — Redesign de Arquitetura de Informação

**Status:** Design
**Scope:** Complex
**Created:** 2026-04-06
**Updated:** 2026-04-08 (rewrite based on /hm-design review)

## Contexto

A seção de Analytics do Dashboard (tabs Analytics + Marketing) reprovou na avaliação de design /hm-design em **Sofisticação**, **Diferenciação**, **Usabilidade** e **Beleza**. O problema não é cosmético — é uma falha de arquitetura de informação com revestimento visual genérico.

A spec anterior (2026-04-06) focava em "gamificação" e matching visual com a Central de Comando. O resultado: componentes visualmente atualizados (KPICard, FunnelChart, InsightCard, HealthScoreGauge) mas a estrutura permaneceu confusa — 11 destinos de navegação (5 tabs + 6 sub-tabs), dados relacionados fragmentados entre tabs distantes, e todos os charts com mesmo peso visual.

**Esta spec substitui a anterior** com foco na causa raiz: a arquitetura de informação.

## Problemas Identificados (/hm-design)

| # | Problema | Princípio Violado |
|---|----------|-------------------|
| 1 | Arquitetura fragmentada — 2 níveis de tabs (5+6=11 destinos), Marketing e Analytics sobrepostos | Usabilidade, Sofisticação |
| 2 | KPI cards sem hierarquia — 6-8 cards idênticos em fila, tudo grita ao mesmo tempo | Sofisticação, Experiência |
| 3 | Speedometer de Health Score — skeuomorfismo datado (canvas, agulha, tick marks) | Diferenciação, Beleza |
| 4 | Dois funis incompatíveis — FunnelChart (Marketing) vs FullFunnel (Analytics) para o mesmo conceito | Sofisticação |
| 5 | Placeholder desperdiçando espaço — ResponseHeatmapPlaceholder é um card que diz "vá pra outra aba" | Sofisticação |
| 6 | Insight Card trunca texto — .slice(0, 40) corta palavras no meio | Experiência, Usabilidade |
| 7 | Grid monótona — todas as sub-tabs usam grid-cols-2 gap-4 em 3 rows, sem variação | Beleza, Diferenciação |
| 8 | Filtros desconectados — AnalyticsFilters é uma fila solta sem agrupamento semântico | Usabilidade, Beleza |
| 9 | Inconsistência tipográfica — 5 padrões diferentes para labels de métrica | Sofisticação |
| 10 | Marketing tab duplica seletor de mês do DashboardHeader | Usabilidade |

## Requirements

### R1: Unificar Marketing + Analytics numa única tab [Problemas 1, 10]

Eliminar a separação entre Marketing e Analytics. Criar uma única tab "Analytics" no Dashboard com uma narrativa top-down coesa.

- **R1.1** Remover tab "Marketing" do Dashboard — todo o conteúdo migra para a tab "Analytics" unificada
- **R1.2** A tab unificada recebe `month` e `year` do DashboardHeader (sem seletor duplicado)
- **R1.3** Estrutura da tab: Hero section (sempre visível) → Deep-dive sections (sub-navegação simplificada)
- **R1.4** Sub-navegação reduzida de 6 tabs para 4 sections narrativas: **Aquisição**, **Pipeline**, **Receita**, **Equipe**

### R2: Hero Section com hierarquia visual [Problemas 2, 3, 6]

O topo da tab mostra os números mais importantes com tamanho e peso visual proporcional à importância.

- **R2.1** **Tier 1 (Hero KPIs):** 3 métricas primárias em cards grandes — Receita, Conversão Geral, CAC Efetivo. Valor em destaque máximo, sparkline mini, trend badge
- **R2.2** **Health Score Ring:** Substituir o speedometer canvas por um SVG ring progress minimalista (120px, stroke 8px). Inline com os hero KPIs, não em card separado
- **R2.3** **Tier 2 (Supporting KPIs):** 4-5 métricas em cards compactos — Leads, Ticket Médio, Ciclo de Venda, Tempo Resposta, Taxa Resposta
- **R2.4** **Insights Strip:** 2-3 insight cards com texto legível (line-clamp CSS, não slice JS). Expandir ao hover
- **R2.5** **Funil Unificado:** Um único funil visual full-width abaixo dos KPIs (Leads → Agendamentos → Comparecimentos → Vendas), clicável para filtrar

### R3: Deep-dive sections com narrativa [Problemas 7, 1]

Cada section conta uma história sobre uma dimensão do negócio, com charts que se complementam.

- **R3.1** **Aquisição:** Attribution table, Origin ranking, Origin cards, CAC por origem, UTM breakdown. Responde: "De onde vêm meus leads e quanto custa cada um?"
- **R3.2** **Pipeline:** Full funnel detalhado, Stage analysis, Pipeline aging, Weekly flow, Conversion trends, Weighted forecast. Responde: "Como está a saúde do meu pipeline?"
- **R3.3** **Receita:** Revenue composition, MRR evolution, Ticket evolution, Projection 90d, Unit economics, Seller profitability. Responde: "Quanto estou faturando e pra onde vai?"
- **R3.4** **Equipe:** Team response times, Hourly pattern, Speed-conversion correlation, Copilot vs Human, Ranking evolution, Win/Loss, Radar comparison. Responde: "Como está a performance do meu time?"

### R4: Design system consistente [Problemas 9, 7, 4]

Todos os componentes da seção seguem uma escala tipográfica e visual única.

- **R4.1** Escala tipográfica unificada (6 tokens: metric-label, metric-sublabel, chart-title, chart-subtitle, value-lg, value-md, value-sm)
- **R4.2** Cards com profundidade variável: charts primários com `shadow-sm`, secundários sem sombra com border sutil
- **R4.3** Grid variado: charts importantes podem ter `col-span-2` (full-width). Não forçar 2x3 em tudo
- **R4.4** Section headers com heading + description + separador visual
- **R4.5** Um único componente Funnel reutilizável (substituir FunnelChart + FullFunnel)
- **R4.6** Semantic color coding nos KPIs: receita=emerald, conversão=blue, custos=amber, alertas=red

### R5: Filtros integrados e sticky [Problema 8]

- **R5.1** Filtros agrupados semanticamente: tempo à esquerda, dimensões à direita
- **R5.2** Filter bar sticky durante scroll (`sticky top-0 z-10`)
- **R5.3** Date presets com active state claro
- **R5.4** Remover seletor de mês inline do antigo Marketing — usar apenas DashboardHeader

### R6: Cleanup [Problema 5]

- **R6.1** Remover `ResponseHeatmapPlaceholder.tsx` completamente
- **R6.2** Remover componente `TabMarketing` do Dashboard (conteúdo migrado para Analytics)
- **R6.3** Remover lazy import de `TabMarketing` no `Dashboard.tsx`
- **R6.4** Remover rotas/redirects de `/marketing` se existirem

## Não-requisitos

- **NR1** Não alterar a lógica dos hooks de dados — apenas reorganizar como os dados são apresentados
- **NR2** Não criar novas RPCs no Supabase
- **NR3** Não alterar permissões (a tab unificada continua master-only: `isMaster`)
- **NR4** Não alterar as outras tabs do Dashboard (Visão Geral, Performance, Inteligência)
- **NR5** Não alterar o Oraculo (chat AI)

## Métricas de Sucesso

- Todos os dados antes acessíveis em Marketing + Analytics continuam acessíveis na tab unificada
- Navegação reduzida de 11 destinos (5+6 tabs) para 5 (1 tab + 4 sections)
- Hierarquia visual clara: hero KPIs > supporting KPIs > charts
- Tipografia consistente em todos os componentes
- Dark mode correto em todos os componentes
- Zero regressão funcional nos charts existentes
- Build passa sem erros (`npm run build`)
