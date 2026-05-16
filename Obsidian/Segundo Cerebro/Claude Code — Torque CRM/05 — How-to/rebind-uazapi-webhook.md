---
type: howto
title: Rebind Uazapi Webhook
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [howto, whatsapp, uazapi, webhook]
related: ["[[debug-whatsapp]]", "[[whatsapp-stability-plan]]"]
owner: gabriel
---

# Como reconfigurar (rebind) webhook Uazapi

> Necessário quando Uazapi reseta config de webhook ou após mudança de URL.
> Incidente 2026-05-14 foi resolvido por rebind massivo.

## Pré-flight

- `UAZAPI_ADMIN_TOKEN` válido (verificar env)
- Lista de instâncias afetadas (geralmente: todas as ativas)

## Rebind scoped (1 instância)

```bash
curl -X POST https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/whatsapp-rebind-webhook \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{"instance_id": "<uuid>"}'
```

Output:
```json
{
  "ok": true,
  "instance_id": "<uuid>",
  "old_webhook_url": "...",
  "new_webhook_url": "https://.../whatsapp-webhook"
}
```

## Rebind massa (todas as instâncias)

```bash
curl -X POST https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/whatsapp-rebind-webhook \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{"scope": "all"}'
```

> **Cuidado**: rebind massa toca todas as orgs. Confirmar autorização CTO.

## Verificar pós-rebind

1. Logs `whatsapp-webhook` devem mostrar tráfego retomando:
   ```bash
   supabase functions logs whatsapp-webhook --project-ref jsjsmuncfkbsbzqzqhfq
   ```

2. Métrica `uazapi_missing_instance` deve cair a 0/min.

3. Teste manual: enviar msg WhatsApp pra instância → verificar chegada em
   `channel_messages`.

## Rollback

Não tem. Rebind sobrescreve config no provider. Se URL nova quebrar, fazer
novo rebind apontando pra URL anterior.

## Histórico

- 2026-05-15 13:28 UTC: rebind massa de 39 instâncias durante incidente
  Uazapi V2 schema change.

## Referências

- [[debug-whatsapp]] — diagnóstico
- [[whatsapp-stability-plan]] — contexto estabilidade
- `supabase/functions/whatsapp-rebind-webhook/index.ts` — implementação
