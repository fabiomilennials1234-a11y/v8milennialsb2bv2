---
type: changelog
title: 2026-06-29 — Motor 100 — colunas kanban de disparo por dia + 5 clones de Reativação
status: shipped
created: 2026-06-29
updated: 2026-06-29
tags: [workflows, pipelines, whatsapp, disparo, motor100, prod-data-change]
related: ["[[2026-06-29-send-to-number-workflow-node]]"]
owner: gabriel
---

# 2026-06-29 — Motor 100 — colunas kanban de disparo por dia da semana + 5 clones de Reativação

SHA **`557d55d4`** (`chore(motor100): day-of-week dispatch kanban columns + reactivation clones`), branch `chore/motor100-dispatch-columns`. **Sem PR** — é uma mudança de **dados de produção** (não de código), documentada e versionada como par `apply.sql` / `revert.sql` em `scripts/recovery/`. Aplicada em PROD via Data API; nada deployado de edge function / frontend.

Org **Motor 100** (`1003870a-ceea-487b-8dd5-910018c7a7d7`). Workflow-fonte: **"Reativação Inativos — Onda 1"** (`59219742-ecc2-4b28-b110-c6041aedd064`).

## Mudanças

- **5 colunas kanban de disparo por dia** no pipe `whatsapp`: `disparo_segunda`, `disparo_terca`, `disparo_quarta`, `disparo_quinta`, `disparo_sexta`. Stages ativas (cor `#6366f1`, posições 2–6) para que leads possam ser arrastados para a coluna do dia em que devem entrar na onda.
- **Reordenação das stages downstream** para o board ler da esquerda → direita: `recebeu_disparo`→7, `respondeu`→8, `vendedor`→9, `nao_respondeu`→10.
- **5 clones INATIVOS do workflow de Reativação**, um por coluna (`Reativação Inativos — Disparo Segunda` … `Disparo Sexta`). Cada clone é **cópia fiel** do workflow-fonte (mesma `definition`, `trigger_config`, `enrollment_criteria`, re-enrollment etc.), com apenas duas mutações por dia:
  - `trigger.stages` (no `trigger_config` e no nó `trigger` da `definition`) reapontado para o `stage_key` da coluna daquele dia.
  - Os **4 timeouts de `wait_response`** (nós `w1`–`w4`) ajustados para que cada onda caia **+3 dias úteis**, pulando o fim de semana.

### Timeline por coluna (4 envios + move terminal)

| Coluna | timeouts w1/w2/w3/w4 (h) | Envios | Terminal → Não Respondeu |
|---|---|---|---|
| Segunda | 72 / 120 / 72 / 120 | Seg → Qui → Ter → Sex | Qua |
| Terça | 72 / 120 / 120 / 72 | Ter → Sex → Qua → Seg | Qui |
| Quarta | 120 / 72 / 120 / 72 | Qua → Seg → Qui → Ter | Sex |
| Quinta | 120 / 72 / 120 / 120 | Qui → Ter → Sex → Qua | Seg |
| Sexta | 120 / 120 / 72 / 120 | Sex → Qua → Seg → Qui | Ter |

## Por quê

O cliente dispara reativação em lote para inativos. Sem colunas por dia, todas as ondas saíam concentradas e caíam em qualquer dia (inclusive fim de semana). Quebrar em 5 colunas/clones distribui a carga e ancora cada lead ao dia em que entrou, garantindo que os 4 toques caiam **+3 dias úteis** sempre em dia útil.

## Como o "pula fim de semana" funciona

O nó `wait_response` é um timeout **em horas puras** — `workflow-executor.ts:446-449` calcula `timeoutHours * 3_600_000` ms, **sem nenhuma lógica de dia útil** no executor. O salto de fim de semana é obtido **na escolha dos valores de hora** pelo operador: `72h` (3 dias corridos) quando a janela não cruza o fim de semana, `120h` (5 dias corridos) quando cruza — assim o resultado sempre cai +3 dias úteis no weekday correto. Não há código novo; é configuração de dados ancorada ao dia de entrada.

## Arquivos tocados

- `scripts/recovery/motor100_dispatch_columns/apply.sql` — **novo** (83 linhas). Idempotente/re-executável: `INSERT … ON CONFLICT DO NOTHING` nas 5 stages, `UPDATE` de posições downstream, e `INSERT … SELECT` que clona o workflow-fonte 5× via `CROSS JOIN (VALUES …)` por dia, com `jsonb_set` reapontando `{stages}` e `{nodes}` (`w1`–`w4` → `timeoutHours`). Guard `WHERE NOT EXISTS` por nome impede clone duplicado.
- `scripts/recovery/motor100_dispatch_columns/revert.sql` — **novo** (36 linhas). Remove os 5 clones (guardado a `is_active = false` para nunca apagar um workflow ativado/editado manualmente), restaura as posições originais downstream e dropa as 5 day-stages (warning: só seguro enquanto não houver lead nelas).

## Decisões

- **Mudança de dados versionada como `apply`/`revert`**, não migration: é específica de uma org, criada via Data API (o torque-mcp não escreve `pipeline_stages`/stage). O par dá rollback auditável.
- **Clones INATIVOS de propósito**: vão ao ar só quando a instância WhatsApp da org for re-pareada (atualmente **deslogada** → zero envios). `is_active = false` evita disparo prematuro.
- **Clone fiel + mutação cirúrgica**: copiar a `definition` inteira e mutar só `stages` + os 4 timeouts preserva todo o resto do fluxo (humanizer, change_stage, re-enrollment) sem reescrever o workflow.
- **`is_active = false` no guard do `revert`**: protege contra apagar um clone que o operador tenha ativado/editado depois.

## Verificação

Aplicado em PROD via Data API e conferido **read-only**: 5 stages criadas, 5 clones presentes e inativos, `trigger.stages` reapontado por dia, os 4 `timeoutHours` corretos por coluna. `revert.sql` reverte tudo.

## Follow-ups

- **Go-live gated**: re-parear a instância WhatsApp da Motor 100 (hoje deslogada) **antes** de ativar qualquer clone — enquanto morta, ativar só geraria 5xx da Uazapi (classe dead-session storm).
- Ao ativar, ligar os 5 clones e validar que leads arrastados para cada coluna de disparo entram na onda correta.
- Antes de rodar `revert.sql`, esvaziar as day-stages (mover leads) para não orfanar entradas.
