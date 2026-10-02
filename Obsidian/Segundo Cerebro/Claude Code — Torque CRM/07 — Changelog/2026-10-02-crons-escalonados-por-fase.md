---
type: changelog
title: Crons de prod escalonados por fase (anti-rajada)
status: active
created: 2026-10-02
updated: 2026-10-02
tags: [changelog, infra, pg-cron, incidente]
related: []
owner: claude-agent
---

# 2026-10-02 — Crons de prod escalonados por fase (anti-rajada)

## Mudanças
- **Infra / pg_cron**: migration que muda só a FASE de 20 jobs recorrentes de prod (`*/5` → `k-59/5`, `*/2` → `1-59/2`, `*/10` → `5-59/10`, `*/15` → `3`/`12-59/15`, `0 *` → `31 *`). Nenhuma frequência, nenhum corpo. **Escrita, NÃO aplicada** — aplicação é do CTO.
- Pico de disparos não-por-minuto no mesmo minuto da semana: **28 → 8** (com os 15 `* * * * *`: 43 → 23). Na hora comum, `:00` cai de 25 para 5; todos os 60 minutos ficam entre 5 e 8. Piso teórico 7.

## Por quê
- 2026-10-02 12:40:00 UTC: ~30 jobs no mesmo segundo → 7 FATAL `too many clients` às 12:40:01 (max_connections=90, 2 vCPU) → crash 12:46. `invoke_*` = net.http_post → edge function → conexão de volta via pooler: cada disparo custa uma conexão.

## Arquivos tocados
- `supabase/migrations/20271103000900_escalonar_crons_por_fase_anti_rajada.sql` — DO block por jobname; `antes`=`depois` → no-op; agenda divergente → NOTICE e não toca; job ausente → NOTICE. **Versão provisória: renumerar na hora de aplicar.**
- `scripts/cron/carga-por-minuto.mjs` — parser de cron + carga por minuto da semana + relatório antes/depois (CLI).
- `scripts/cron/prod-snapshot-2026-10-02.json` — snapshot de `cron.job` de prod (71 jobs) com duração média.
- `tests/unit/cron-escalonamento-contrato.test.ts` — teto 8, frequência idêntica, purgas fixas intocadas, pesadas sem colisão.

## Decisões
- Purgas já escalonadas em `20270915000010` (39, 82, 83, 84, 90, 99, 106, 141, 155, 160, 65, 144) não se movem.
- `avisos-varredura-reuniao-proxima` (2,35 s) em 3,18,33,48: único lugar sem purga pesada recorrente.
- `oraculo-admin-briefing` (1,30 s) fica em `:00`: todo outro resíduo de 5 tem purga pesada.
- Diários intocados: nenhum par de DELETE pesado divide minuto (medido).

## Follow-ups
- Aplicar em prod (CTO), renumerando a versão; depois reler `cron.job` e rodar o script contra o novo snapshot.
- O teto de conexões continua baixo: os 15 `* * * * *` disparam juntos todo minuto (pg_cron não tem fase de segundos para `* * * * *` sem mudar para a sintaxe `N seconds`).
