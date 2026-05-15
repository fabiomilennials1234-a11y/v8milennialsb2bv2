---
type: reference
title: Webhooks Outbound
status: draft
created: 2026-05-15
updated: 2026-05-15
tags: [reference, webhooks, outbound]
related: ["[[Cron Jobs]]", "[[Runbook — Cron e Webhooks]]"]
owner: gabriel
---

# Webhooks Outbound — Reference

> Webhooks que o Torque CHAMA (out). Para webhooks que o Torque RECEBE,
> ver edge functions `*-webhook` em [[Edge Functions]].

## Tabela `webhook_deliveries`

| Coluna | Descrição |
|---|---|
| `id` | uuid PK |
| `organization_id` | scope tenant |
| `url` | destino |
| `payload` | jsonb body |
| `status` | pending / sending / delivered / failed / dead |
| `attempts` | counter |
| `next_retry_at` | timestamptz |
| `last_error` | text |
| `delivered_at` | timestamptz |
| `created_at` | timestamptz |

## Cron `webhook-deliveries`

Schedule: `* * * * *` (1min)

Drena `status='pending' OR (status='failed' AND next_retry_at <= now())`.
Backoff exponencial: 1m → 5m → 30m → 2h → 12h → dead.

## Tipos de webhook

(a preencher — eventos que disparam webhooks: lead_created, stage_changed,
deal_won, etc.)

## Como configurar

Frontend `/configuracoes/webhooks`. Por evento + URL + headers customizados.

## Segurança

- HMAC signature opcional (`X-Torque-Signature`) — chave por config
- Retry exponencial
- DLQ após N tentativas
