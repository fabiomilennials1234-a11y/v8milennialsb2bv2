# 2026-06-11 — Comando v2: redesign da Central de Comando

**Branch:** `feat/comando-v2-dashboard`
**Escopo:** frontend only — zero migration, zero edge function.

## O que mudou

Tab Visão Geral do `/dashboard` redesenhada a partir de mockup aprovado pelo
CTO (3 rodadas, variação "Cluster" — painel de instrumentos automotivo).

- Velocímetro novo (SVG 270°, redline, agulha com idle oscillation, leitura
  digital) substitui `SpeedometerGauge` (canvas, azul hardcoded fora da paleta).
- 8 KPI cards compactos com delta vs período anterior e quick action no hover.
- Range funcional Hoje/Semana/Mês/Trim. via `useCommandMetrics` (mesma RPC
  `get_dashboard_metrics`, datas arbitrárias). `useDashboardMetrics` intocado.
- Funil trapezoidal com taxas entre etapas + gargalo. Receita acumulada com
  projeção por run-rate. Ticker de telemetria + feed ao vivo
  (`useRecentActivity`). Oráculo vira painel de insights derivados + atalho ⌘J
  (FAB removido da página).
- `index.css`: Inter 900 + JetBrains Mono + keyframes `cmd-*` com
  `prefers-reduced-motion`.

## Refs

- Spec: `.specs/features/comando-v2/SPEC.md` (+ mockup HTML aprovado)
- Legados (`TabVisaoGeral`, `KPICard`, `SpeedometerGauge`, `FunnelChart`,
  `DashboardHeader`, `OraculoFloatingButton`) mantidos pra rollback barato.
