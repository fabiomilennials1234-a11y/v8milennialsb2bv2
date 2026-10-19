# Alavanca 6 — tirar do Postgres o que não precisa estar lá

Data: 19/10/2026. Prod `jsjsmuncfkbsbzqzqhfq` (Medium, 4 GB, 2 vCPU), **só leitura**. Nada aplicado.
Contexto: `.specs/perf/ram-pool-postgrest/README.md` (branch `claude/supabase-high-ram-4bf64d`). Régua de
carga: ~1.256 s de SQL por hora no pico (314 s em 15 min, 16/10).

## Resumo

| Frente | Estado | Corte neste PR | Ganho estimado |
|---|---|---|---|
| `runtime_logs` INSERT | O grosso já saiu em 05/10 (`a406dc718`): 92 mil → ~9,5 mil linhas/dia | Amostra mais 3 ações de sucesso do webhook | −4,4 mil linhas/dia (−46%), ~−3 POST/min no PostgREST, ~−9 s/dia de banco |
| `runtime_logs` purga | Roda a cada 10 min e custa **2× todos os INSERTs** | Migration: 1×/dia às 06:09 UTC | ~−37 s/dia (−14 s no expediente), −143 backends/dia |
| `runtime_logs` índice | `idx_runtime_logs_org_created`: 147 MB, nenhuma query do app usa | Nenhum: a migration `20271107130003` já está no repo. O portão passou hoje. | −147 MB de índice mantido a cada INSERT |
| Outras purgas | `wa-health-checks` e `audit-log` a cada 10 min | Migration: 1×/hora | ~−25 s/dia (teto: cada execução horária apaga 6× mais), −240 backends/dia |
| Varreduras de avisos | 2 jobs por minuto, os mais caros do pg_cron | Migration separada: a cada 2 min (**decisão de produto**) | ~−11,5 s/h, −1.440 backends/dia |
| Realtime → Broadcast (G0) | **O bloqueio provavelmente não existe mais.** Ver G0. | Nenhum (só levantamento) | 16,2% do banco em jogo |

Leitura honesta: fora o Realtime, esta alavanca é pequena. Somadas, as migrations e o logger tiram
~1–2% do tempo de SQL do pico. O pg_cron inteiro pesa ~2,4% do banco, e o `runtime_logs` ficou
barato depois de 05/10. O ganho que não aparece nos segundos de SQL é **processo**: com
`cron.use_background_workers = off`, cada disparo do pg_cron é uma conexão libpq nova, ou seja,
um backend que monta o catálogo do zero (1.092 policies, 1.327 funções). As três migrations tiram
~1.800 desses por dia. A alavanca grande daqui é o G0.

---

## 1. `runtime_logs`

### Escritores
- **Edge functions**: um só caminho, `supabase/functions/_shared/logger.ts` (`logRuntime`, 449 chamadores).
  Grava em lote via PostgREST como `service_role`, redige, amostra sucesso por `module:action` e manda
  o descartado para `console.info` com `rt:1` (function_logs, 7 dias).
- **SQL**: `fn_voip_apply_vps_event` e `inv_scan_public_tables_readable_by_anon` (INSERT direto, baixo volume).
- **Front**: não escreve. O erro do cliente vai para o anel do Chamado e para o Sentry (ADR-0038).

### Leitores
| Leitor | O que lê | Efeito da amostragem |
|---|---|---|
| `useIncidentFeed.ts:76` | `status='error'`, 24 h | nenhum (erro nunca é amostrado) |
| `useMasterOperations.ts:91,103` | contagem e lista por status/módulo | contagem crua; a linha amostrada carrega `_sample_rate` |
| `get_operations_overview` | contagem ponderada por `1/_sample_rate` | nenhum (já pondera) |
| `master_org_finance` | tokens de LLM, 30 dias | nenhum (copilot não é amostrado; retenção ≠ webhook = 30 d) |
| `infra-watchdog/index.ts:122` | `support:notify_staff` | nenhum |
| `useCopilotReasoning.ts:44` | `copilot:reasoning` | nenhum |

### Volume em prod (últimas 24 h, 9.476 linhas)
Top sucesso/skipped: `webhook:uazapi_external_read_applied` 3.449 · `uazapi_group_reaction_skipped` 875 ·
`uazapi_process` 625 (já a 1%) · heartbeats de cron 5 × 288 · `uazapi_group_message_captured` 272 ·
`notificame_process` 263.

INSERT pelo PostgREST: ~2,1 ms cada, ~8,5/min em média desde 05/10 (171.980 chamadas, 328 s).
**A purga custou mais que isso**: `purge_runtime_logs()` acumulou 670 s em 2.011 execuções (333 ms cada).

### Corte (neste PR)
`SUCCESS_SAMPLE_RATE` ganha três entradas, com teste em `logger.test.ts`:
- `webhook:uazapi_external_read_applied` → 5%. Foi posta para o Chamado 6ebb4b73. Mesmo rebaixada,
  a prova continua em function_logs, com instância, `message_count` e `rows_written` (teste novo
  garante isso). A investigação passa a ser por `query_logs`, não por SQL. A falha
  (`uazapi_external_read_failed`) é `error` e continua 100%.
- `webhook:uazapi_group_reaction_skipped` → 1%.
- `webhook:uazapi_group_message_captured` → 5%.

Ficaram de fora de propósito:
- Heartbeats dos crons (288/dia cada). São a única trilha por execução das edge functions de cron.
- `notificame_process`: canal oficial, volume baixo.

O destino fora do Postgres que já existe é o function_logs da edge, mais o Sentry para exceção.
Não precisa de destino novo.

### Retenção
Já é curta: `webhook` 2 dias, o resto 30 dias (`master_org_finance` depende dos 30). Não mexi.
Mudou a **cadência** da purga: 144×/dia → 1×/dia às 06:09 UTC (03:09 BRT). Cada DELETE tem
LIMIT 50.000 para um volume de ~9,5 mil/dia, então um dia perdido drena no seguinte.

### Índice
`idx_runtime_logs_org_created` (147 MB) ainda existe em prod. Portão da `20271107130003` rodado em 19/10:
- Nenhuma query do app **filtra** por `organization_id`. Só seleciona a coluna (`useIncidentFeed`).
- O resto são consultas forenses ad-hoc (MCP/Management API), 1 chamada cada. Sem o índice, ficam
  mais lentas (varredura de ~160 MB), e isso é aceitável.

Pronta para aplicar pela receita dela (psql autocommit, `CONCURRENTLY`). `idx_scan = 63` desde 05/10
são essas forenses.

### Follow-ups (fora deste PR)
- **Erros recorrentes que viraram ruído**. São 100% gravados, com custo e sem sinal:
  - `whatsapp:session_watchdog_instance_unmapped`: 288/dia, todo ciclo.
  - `whatsapp:health_monitor_run` (error): 288/dia.
  - `sz_chat:webhook_process` (error): 402/dia.

  O certo é consertar na origem, não amostrar erro.
- Bloat: 161 MB de heap para 162 mil linhas. `REINDEX CONCURRENTLY` / `pg_repack` depois do drop do índice.

---

## 2. Crons

### Inventário (prod, 19/10)
- 73 jobs em `cron.job`, **54 ativos**. Os 19 inativos são os absorvidos pelo `cron-dispatch-minute`
  (job 165), que os executa por dentro e ignora o `active`.
- Snapshot congelado em `scripts/cron/prod-snapshot-2026-10-19.json`.
- **Limite da medição:** `cron.job_run_details` guarda só ~1 dia, porque o job
  `cron-job-run-details-retention` apaga o que passa de 1 dia. Os "7 dias" pedidos não existem.
  Usei ~1,5 dia de `job_run_details` para média e máximo, mais `pg_stat_statements` desde
  05/10 15:55 (13,9 dias) para o total.

Custo total do pg_cron: ~9.850 s em 13,9 dias ≈ **29,5 s/h ≈ 2,4% do SQL do pico**.

### Expediente (12–21 UTC): quem pesa
**Nenhum job tem média > 1 s.** Os que passam de 1 s no pico (máximo em ~1,5 dia):

| Job | Agenda | Média | Máx | Total desde 05/10 | Ação |
|---|---|---:|---:|---:|---|
| `cron-dispatch-minute` (19 jobs) | `* * * * *` | 0,15 s | 1,3 s | 2.811 s | manter (já é a consolidação) |
| `avisos-varredura-reuniao-proxima` | `* * * * *` | 0,20 s | 2,1 s | 1.868 s | **→ `1-59/2`** (migration B) |
| `avisos-varredura-followups` | `* * * * *` | 0,18 s | 1,5 s | 1.532 s | **→ `*/2`** (migration B) |
| `purge-runtime-logs` | `9-59/10` | 0,26–0,33 s | 2,2 s | 670 s | **→ `9 6 * * *`** (migration A) |
| `cron-health-monitor` | `2-59/5` | 0,14 s | 1,4 s | 571 s | manter: lê `job_run_details`, alerta |
| `oraculo-admin-briefing` | `*/5` | 0,13 s | 3,5 s | 518 s | follow-up: olhar o corpo |
| `oraculo-member-briefing` | `1-59/5` | 0,06 s | 3,6 s | 233 s | follow-up |
| `oraculo-admin-briefing-shrinkage` | `7,22,37,52` | 0,07 s | 1,7 s | — | manter |
| `oraculo-benchmark-weekly` | `15 13 * * 1` | 1,0 s | 1,0 s | — | manter: a função recusa semana ainda aberta em qualquer fuso de org; mover exige checar `oraculo_benchmark_week_is_closed` |

Madrugada, já fora do expediente: `raw-payload-retention` 17,5 s (03:33), `cleanup_usage_events_180d`
2,2 s (04:00), `cleanup-automation-jobs` 1,4 s (02:00).

### Migrations propostas (no repo, **não aplicadas**)
- **A · `20271127000000_crons_purga_fora_do_expediente.sql`**. Sem efeito visível.
  - `purge-runtime-logs`: `9-59/10` → `9 6 * * *`.
  - `cleanup-wa-health-checks-7d`: `4-59/10` → `4 * * * *`.
  - `cleanup-audit-log-14d`: `6-59/10` → `6 * * * *`.

  Os dois últimos não vão para a madrugada porque ~28 mil linhas/dia ficariam perto do LIMIT
  30.000. De hora em hora sobra folga de 25×. `audit_log` tem ~3,6 mil linhas/dia, contra LIMIT
  20.000. Ganho: −383 execuções/dia (−144 no expediente), ~−62 s/dia de banco (~−23 s no
  expediente). É um teto: nas duas purgas horárias, cada execução apaga 6× mais linhas.
- **B · `20271127000001_avisos_varreduras_a_cada_2_min.sql`**. **Decisão de produto:** o aviso pode
  sair até +1 min mais tarde. Nenhum aviso se perde: as janelas têm 20 min e a dedupe é por chave.
  As fases são diferentes (ímpar/par), então os dois jobs nunca caem no mesmo minuto. Ganho:
  ~−11,5 s/h, −1.440 backends/dia.

As duas seguem o contrato da `20271103000900`: casam por jobname, mexem só no schedule e só tocam
o job cuja agenda é exatamente a medida. Cada uma tem rollback exato em `supabase/migrations/rollback/`.
Contrato: `tests/unit/cron-fora-do-banco-contrato.test.ts`. Ele confere:
- o "antes" de cada job é o que prod tem hoje;
- a frequência só cai;
- a purga sai do expediente;
- nenhuma purga pesada cai no mesmo minuto de outra;
- o pico de disparos fica ≤ 8 (hoje 6, depois 7).

### Follow-up que vale mais que a agenda
O custo está no **corpo** das varreduras de avisos, não na cadência:
- `fn_varredura_avisos_followups`: depois das 07h BRT, todo follow-up atrasado aberto (~500 hoje,
  e crescendo) roda `fn_donos_do_lead` e um `EXISTS` em `notifications` **a cada execução**. Só
  precisaria fazer isso 1×/dia, porque a chave é por dia. Exemplo: guardar o último dia varrido.
- `fn_varredura_avisos_reuniao_proxima`, 2º laço: varre as ~60 mil `pipeline_entries` abertas e
  converte `metadata->>'meeting_date'` linha a linha (1.339 candidatas) em plpgsql, todo minuto.
  Saída: coluna gerada ou tabela de agenda espelhada com índice em `start_at`, o que o S6 da agenda
  já prevê.

Isso derruba os ~6–8 mil blocos por chamada. É trabalho de engenharia com teste de comportamento,
não de cron.

---

## 3. Realtime → Broadcast (G0)

### O que o G0 diz (MACRO de 06/10 e ADR-0021 de 17/07)
"`CREATE POLICY ON realtime.messages` → 42501, `postgres` não é dono; só o suporte Supabase destrava."

### O que prod mostra hoje (19/10, só leitura)
- `realtime.messages`: dono `supabase_realtime_admin`, RLS ligado, **0 policies**. `postgres` não é membro.
- **`supautils.policy_grants` inclui `realtime.messages` para `postgres`.** O supautils delega ao
  `postgres` `CREATE/ALTER/DROP POLICY` nessa tabela, mesmo sem ser dono.
- O troubleshooting oficial do Supabase ["must be owner of table messages"](https://supabase.com/docs/guides/troubleshooting/realtime-must-be-owner-of-table-messages)
  descreve exatamente esse erro:
  - a culpa costuma ser um `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY` no mesmo
    arquivo. Ele falha sempre, porque o Postgres confere a posse antes de ver que o RLS já está ligado;
  - a falha aborta a transação e leva junto o `CREATE POLICY`;
  - a correção documentada é tirar o `ALTER TABLE` e manter a policy;
  - o mesmo doc diz que o grant do role é reservado: o suporte **não** consegue concedê-lo.
    O pedido "D1: ticket para conceder `supabase_realtime_admin`" não tem saída.
- Não achei número de ticket no repo nem nos specs. O MACRO lista o D1 como decisão, não como
  ticket aberto.

### Conclusão
O G0 se apoia num teste de julho que nunca foi refeito, e as evidências de hoje dizem que ele não
bloqueia mais, se é que bloqueou. A dúvida fecha com um ensaio transacional. **Ele precisa do OK do CTO**,
porque `CREATE POLICY` pega lock exclusivo e curto em `realtime.messages`, que o serviço Realtime usa:

```sql
BEGIN;
SET LOCAL lock_timeout = '2s';
CREATE POLICY g0_ensaio ON realtime.messages FOR SELECT TO authenticated USING (false);
SELECT count(*) FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages';  -- 1
ROLLBACK;
```

Se o ensaio passar, o G0 cai. A S1 do MACRO (fundação + piloto `pipeline_entries`) pode começar.
Em jogo: o poll do WAL do `postgres_changes` é **16,2% do tempo do banco** desde 05/10
(44.660 s de 275.650 s, 22,6 ms × 1,98 mi chamadas), fora do pool do PostgREST e com 11 backends
próprios de vida longa.

Cuidado ao escrever a S1: nenhuma migration pode ter `ALTER TABLE realtime.messages`, nem mesmo um
`ENABLE ROW LEVEL SECURITY` "defensivo". É exatamente o que quebra.
