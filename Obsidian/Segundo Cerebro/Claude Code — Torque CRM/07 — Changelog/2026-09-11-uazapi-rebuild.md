---
type: changelog
title: Reconstrução UAZAPI — início isolado
status: draft
created: 2026-09-11
updated: 2026-09-11
tags: [whatsapp, uazapi, contract-tests]
related: ["[[whatsapp-stability-plan]]"]
owner: gabriel
---

# Reconstrução UAZAPI — início isolado

## Mudanças

Cliente/provider alinhados a campos documentados de criação, mídia, menus, reações, histórico e quotas. Circuito isolado por servidor e credencial; criação não repetida após resposta perdida. Nenhum deploy em produção.

## Referências

- `supabase/functions/_shared/uazapi-client.ts`
- `supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts`
- `tests/unit/uazapi-openapi-contract.test.ts`
- `.specs/uazapi-rebuild/STATE.md`

## Pendências

Provisionamento Supabase, contrato do servidor efetivo e homologação com destinatário controlado. Auditoria inicial usou checkout antigo; não representa main atual.
