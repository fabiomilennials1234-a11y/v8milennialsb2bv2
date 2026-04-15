---
tags:
  - torque-crm
  - diretiva
  - data_processing
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: directives/data_processing/ajuste_metricas_leads.md
---

# Ajuste de métricas: leads sem movimentação

## Objetivo
Atribuir ao mês desejado (ex.: janeiro) os leads que existem no banco até uma data de corte e que **não tiveram nenhuma movimentação** até essa data. Isso “libera” esses leads para contarem nas métricas daquele mês no dashboard, sem alterar código do frontend.

## Critério “lead sem movimentação até data X”
- **Movimentação** = presença em pelo menos uma das tabelas:
  - `pipe_confirmacao` (por `lead_id`, com `created_at <= X`)
  - `pipe_propostas` (por `lead_id`, com `created_at <= X`)
  - `pipe_whatsapp` (por `lead_id`, com `created_at <= X`)
  - `follow_ups` (por `lead_id`, com `created_at <= X`)
- **Lead elegível**: `leads.created_at <= X` e sem nenhum registro nessas quatro tabelas com `created_at <= X`.

## Como atribuir ao mês Y
- Atualizar em massa: `UPDATE public.leads SET metrics_period_at = '<primeiro dia do mês Y em UTC>' WHERE id IN (...)`.
- Exemplo: janeiro/2026 → `metrics_period_at = '2026-01-01T00:00:00.000Z'`.
- O dashboard já usa `COALESCE(metrics_period_at, created_at)` para filtrar por período; não é necessária mudança no frontend.

## Ferramentas
- **Script SQL (one-off janeiro/2026):** `supabase/scripts/ajuste_metricas_leads_jan2026.sql`
  - ETAPA 1: identificação (SELECT count + lista opcional) - rodar primeiro para auditoria.
  - ETAPA 2: UPDATE em `leads` com a mesma lógica do passo 1.
  - ETAPA 3: verificação (contagem de leads em janeiro/2026 após o ajuste).
- Execução: Supabase Dashboard → SQL Editor. Usar role com permissão para UPDATE em `leads`.

## Parâmetros (para scripts reutilizáveis)
- **Data de corte (cutoff):** até quando considerar “sem movimentação” (ex.: `2026-02-03T23:59:59.999Z`).
- **Mês/ano de destino:** primeiro dia do mês em UTC para `metrics_period_at` (ex.: janeiro/2026 → `2026-01-01T00:00:00.000Z`).

## Saídas
- Contagem de leads que serão atualizados (Etapa 1).
- Número de linhas afetadas pelo UPDATE (Etapa 2).
- Total de leads contabilizados no mês após ajuste (Etapa 3).

## Edge cases
- **RLS:** executar com usuário/service role que possa atualizar `leads` (ex.: no SQL Editor do projeto).
- **Idempotência:** reexecutar o mesmo script não altera resultado para leads que já têm `metrics_period_at` igual ao destino.
- **Múltiplas organizaçoes:** o critério é por lead; não é necessário filtrar por organização para “sem movimentação”.

## Aprendizados
(Atualizado automaticamente pelo sistema)


## Links relacionados

- [[MOC - Diretivas]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Follow-ups]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
- [[Fluxos de Trabalho]]
