# PROTOTYPE — Observability cockpit

**Pergunta:** qual layout torna a observabilidade do sistema (hoje espalhada em
~7 páginas master) "fácil de entender" pra CTO + outros devs, numa única tela?

**Rota:** `/master/observability-prototype` (`?variant=A|B|C`, ou ← → no switcher).
Dados mockados (`data.ts`), shape igual às tabelas reais (runtime_logs,
application_logs, system_alerts, audit_log, whatsapp_health_checks).

## Variantes
- **A — NOC status board:** semáforo no topo (uptime/erros/alertas/p95) + grid
  denso (integrações, cron, drift, erros/hora, alertas, top grupos de erro,
  edge fns). Scan-first. Estilo Datadog/Grafana-clean.
- **B — Stream + filtros:** rail de filtros à esquerda (tipo/org) + stream
  cronológico unificado (erro/alerta/auditoria/saúde). "O que acabou de
  acontecer". Estilo Linear inbox.
- **C — Triage:** headline de saúde grande + fila "precisa de ação" (alertas
  acionáveis) à esquerda + tabs de drill-down (erros/edge/integrações/auditoria)
  à direita. Ação-first.

## Veredito
_(preencher: variante vencedora + o que roubar de cada — ex. "A com a fila de
ação do C")_

## Próximo (depois do veredito)
- Dobrar o vencedor numa página real `/master/observabilidade` (reescrever
  sem constraints de protótipo), trocar mocks pelos hooks reais.
- Gap a fechar: sink de erro frontend (`window.onerror`/`unhandledrejection` +
  ErrorBoundary) → `application_logs`.
- Deletar este `_prototype-observability/` + rota + lazy no App.tsx.
