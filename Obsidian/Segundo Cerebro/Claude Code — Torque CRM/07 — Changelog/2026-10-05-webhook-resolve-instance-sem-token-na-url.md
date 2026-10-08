---
type: changelog
title: Webhook resolve instância por RPC, sem token na URL
status: active
created: 2026-10-05
updated: 2026-10-05
tags: [changelog, whatsapp, uazapi, seguranca, performance]
related: []
owner: claude-agent
---

# 2026-10-05 — Webhook resolve instância por RPC, sem token na URL

## Mudanças
- **DB**: `resolve_uazapi_instance(text,text)` (DEFINER) e `count_exhausted_uazapi_dlq_by_token(text,integer)` (INVOKER), EXECUTE só `service_role`. Migration `20271107100000_resolve_uazapi_instance_rpc.sql` — **escrita, NÃO aplicada**; versão provisória, reconferir o topo do ledger antes de aplicar.
- **whatsapp-webhook**: 1 POST de RPC no lugar de 3 leituras com `uazapi_token=eq.` na query string; ERR-4 via RPC; `instanceName` nunca resolve tenant; log sem payload cru, SHA-256 do token no lugar do prefixo.
- **whatsapp-dlq-replay**: resolução = 1 RPC, sem `instanceName`.
- **whatsapp-health-monitor**: leitura de instâncias em lote.

## Por quê
- Pico de 05/10: ~5,5 mil linhas/h no `edge_logs` com token em claro em `request.search` (90 tokens distintos).
- ~5,6 mil logs/h de `uazapi_resolved_by_token_fallback`: o payload V2 traz `instanceName` (nome de exibição), não o id `r…`; nome é único só por org.

## Ordem de aplicação (obrigatória)
1. Migration (reconferir ledger) → 2. `has_function_privilege` (anon/authenticated false, service_role true) → 3. deploy de `whatsapp-webhook`, `whatsapp-dlq-replay`, `whatsapp-health-monitor` de worktree limpo em `origin/main` → 4. imagem de `services/whatsapp-ingress`. Webhook antes da migration = todo evento cai na DLQ `unknown_instance`.

## Follow-ups
- `url_path` da DLQ guarda o segredo global; replay deveria remontar pelo env.
- Índice UNIQUE parcial em `uazapi_token` / `uazapi_instance_id`.
- Guarda `!=` de `get_uazapi_credentials`.
- Fatiar `.in()` do health-monitor acima de ~200 instâncias.
- Rotacionar os 90 tokens só depois do deploy de webhook + dlq-replay.
- Consumidores de `runtime_logs` que liam `instance_ref` / `raw_truncated`.
