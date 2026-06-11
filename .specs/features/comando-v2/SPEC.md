# Comando v2 — Central de Comando

Redesign da tab Visão Geral do `/dashboard` a partir do mockup aprovado
(`mockup-v3-cluster.html`, variação "Cluster" — painel de instrumentos).
Aprovado pelo CTO em 2026-06-11 após 3 rodadas de mockup.

## Decisões

- **Velocímetro mantido como velocímetro** (exigência explícita): 270°, redline
  acima de 100%, agulha com contrapeso e micro-oscilação idle, leitura digital
  JetBrains Mono, status `// NO RITMO +XPP`. Sempre **mensal** (meta de
  faturamento é do mês), independente do range selecionado.
- **Range Hoje/Semana/Mês/Trim. é real** — a RPC `get_dashboard_metrics` aceita
  `p_start_date/p_end_date` arbitrários. `useCommandMetrics` é a variante
  range-aware; `useDashboardMetrics` permanece intocado (contract congelado,
  consumido por engagement).
- **Deltas vs período anterior**: 2ª chamada da mesma RPC com o range anterior
  equivalente (mês anterior, semana anterior, ontem, trimestre anterior).
- **KPI cards compactos** com quick action que sobe no hover (padrão aprovado);
  card inteiro navega pra rota da métrica.
- **Funil trapezoidal** monocromia gold → fechamento verde, taxas de conversão
  entre etapas, gargalo (menor taxa) apontado no rodapé. Fonte: campos
  `funnel*` da RPC (sempre total da org).
- **Oráculo**: FAB substituído por painel com insights derivados
  deterministicamente das métricas (propostas em queda, follow-ups atrasados,
  tempo de resposta melhorando) + input que abre o chat. Atalho **⌘J/Ctrl+J**.
- **Ticker de telemetria** e **feed ao vivo** reusam `useRecentActivity`
  (engagement).
- **Receita acumulada**: cumsum de `dailySales` + projeção por run-rate +
  período anterior em cinza.
- Animações CSS centralizadas no `index.css` (seção "Comando v2", prefixo
  `cmd-`), com `prefers-reduced-motion` desligando tudo. Needle via rAF com
  cleanup e pausa em aba oculta.

## Arquivos

- `src/modules/analytics/hooks/useCommandMetrics.ts`
- `src/modules/analytics/components/dashboard/v2/` — ClusterGauge,
  KpiCardCompact, RevenueAccumulatedChart, TrapezoidFunnel, TelemetryTicker,
  OraculoPanel, LiveOpsFeed, CommandHeader, TabVisaoGeralV2
- `src/modules/analytics/pages/Dashboard.tsx` — header novo + tab v2
- `src/index.css` — fontes (Inter 900, JetBrains Mono) + keyframes `cmd-*`

## Componentes legados não mais referenciados pela página

`DashboardHeader`, `TabVisaoGeral`, `OraculoFloatingButton`, `SpeedometerGauge`,
`KPICard`, `FunnelChart` — mantidos no repo nesta primeira entrega (rollback
barato); remover numa faxina futura se o v2 estabilizar.
