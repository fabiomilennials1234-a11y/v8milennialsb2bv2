---
type: changelog
title: Nó de automação "Enviar p/ grupo" (send_to_group)
status: active
created: 2026-10-02
updated: 2026-10-02
tags: [changelog, workflows, whatsapp, uazapi]
related: [2026-06-29-send-to-number-workflow-node]
owner: claude-agent
---

# 2026-10-02 — Nó de automação "Enviar p/ grupo" (send_to_group)

## Mudanças
- **Workflows / WhatsApp**: nó novo `send_to_group` manda UM texto para UM grupo (`…@g.us`) pela instância Uazapi nomeada no nó. Template resolvido contra o lead + resumo/telefone opcionais (mesmo contrato do `send_to_number`).
- **Proxy**: action nova `listGroups` no `whatsapp-api-proxy` — exige `workflows.edit` (Master e Gestor passam), só Uazapi (422 `groups_not_supported` nos demais), depois da fronteira de tenant existente (403 + `cross_tenant_attempt`).
- Sem migration. Sem mídia, sem múltiplos grupos, sem canal oficial/Evolution.

## Como funciona
- Instância PRESA (`resolvePinnedInstance`): sem atalho de "uma viva só", sem recuo. Inexistente/outra org/não-uazapi → `no_instance_resolved`; caída → `instance_disconnected`. Sempre `retryable:false`, nunca troca de número.
- `sendTextToGroupViaInstance` (whatsapp-dispatch): JID validado em formato estrito (`isValidGroupJid`) e entregue intacto ao `/send/text`. Governor recebe `recipientPhone: null` — o gate frio P4 barraria grupo em enforce.
- Falha de envio usa `isRetryableSendFailure`: ambígua (5xx/timeout) é terminal — reenviar duplicaria para o grupo inteiro.
- Dedup (`reserveSendOrSkip`) chaveado por `<jid>#<leadId>` (template estático não suprime aviso de outro lead) e NÃO consultado em retentativa (`params._retryAttempt > 0`): a 1ª passada já consumiu a reserva sem release, e consultar de novo transformaria o retry em sucesso falso.
- Linha em `whatsapp_messages` com `is_group=true`, `remote_jid=jid`, `lead_id=null`, `sent_source='workflow'` — é o único registro (o eco `wasSentByApi` é descartado pelo webhook).

## Arquivos tocados
- `supabase/functions/_shared/whatsapp-jid.ts` — `isValidGroupJid`.
- `supabase/functions/_shared/whatsapp-dispatch.ts` — núcleo privado `sendTextGoverned` + `sendTextToGroupViaInstance`.
- `supabase/functions/_shared/instance-routing.ts` — `GROUP_PROVIDERS`, `resolvePinnedInstance`.
- `supabase/functions/_shared/action-handlers/{send-to-group.ts,whatsapp-helpers.ts}` — handler + `getPinnedWhatsAppInstance`.
- `supabase/functions/_shared/whatsapp-group-list.ts` — `listInstanceGroups` + `authorizeGroupListing`.
- `supabase/functions/whatsapp-api-proxy/index.ts` — case `listGroups` + gate.
- `src/modules/workflows/components/sidebar-panels/SendToGroupConfig.tsx`, `hooks/useInstanceGroups.ts`, `lib/instance-routing.ts`.

## Follow-ups
- `resolve_message_lead_id`: `IF NEW.is_group THEN RETURN NEW` (match por sufixo de dígitos pode colar lead em linha de grupo).
- `send_to_number` grava `sent_source` fora do CHECK (chip separado).
