---
type: changelog
title: 2026-05-08 — WhatsApp Write Instance — Etapa C (frontend)
status: shipped
created: 2026-05-08
updated: 2026-05-08
tags: [uncategorized]
related: []
owner: gabriel
---

# 2026-05-08 — WhatsApp Write Instance — Etapa C (frontend)

## Mudanças

- **chat/composer**: novo `<ChatComposerShell>` unifica Estados 1/2/3 do composer humano (full + compact). Banner contextual + card de erro + skeleton de loading.
- **chat/admin**: novo `<InstanceOwnerModal>` para vincular número de WhatsApp a um responsável. Lista ordenada (Disponível → Em uso → Atual), confirmação inline ao substituir owner, validação RPC.
- **hooks**: novo `useLeadWriteInstance(leadId)` consome RPC `get_lead_write_instance` (Etapa A) + cruza com `useCurrentTeamMember/useIsAdmin/useMasterAuth`. Retorna estado tipado (`loading | ok | error`).
- **chat/send**: `useSendWhatsAppMessage` e `useSendWhatsAppMedia` aceitam param opcional `leadId`. Encaminhado ao body do proxy quando presente; legado preservado quando ausente.
- **chat/full + bubble**: `WhatsAppChat.tsx` e `ChatBubbleThread.tsx` usam o shell quando `leadId` resolvido. Quando ausente, fluxo legado intocado (sem regressão visual).

## Arquivos tocados

- `src/hooks/useLeadWriteInstance.ts` — hook novo.
- `src/components/chat/composer/ChatComposerShell.tsx` — shell novo.
- `src/components/chat/admin/InstanceOwnerModal.tsx` — modal novo.
- `src/components/chat/WhatsAppChat.tsx` — passa composer pelo shell + monta modal admin.
- `src/components/chat/bubble/ChatBubbleThread.tsx` — idem variant compact + resolve leadId via useLeadByPhone.
- `src/components/chat/bubble/ChatBubbleComposer.tsx` — aceita prop `leadId`.
- `src/hooks/chat/useWhatsAppSend.ts` — param `leadId` em ambas mutations + body do POST.
- `tests/unit/useLeadWriteInstance.test.tsx` — 8 cenários da matriz.
- `tests/unit/ChatComposerShell.test.tsx` — 8 cenários (Estados 1/2/3 + variants).
- `Obsidian/.../06 — Features/whatsapp-write-instance/03-frontend.md` — feature note.
- `Obsidian/.../00 — INDEX.md` — links 02 + 03.

## Decisões

- **Type cast intencional** em `supabase.rpc(...)` para `get_lead_write_instance` e `set_instance_owner` — types.ts ainda não regenerou pós-Etapa A (MCP bloqueado). Contrato preservado via `GetLeadWriteInstanceResult` em `src/types/user-write-instance.ts`. Nota explícita no código.
- **Estado 2 mantém innerComposer montado** (com `pointer-events-none` + `aria-hidden=true` + opacity 0.55) ao invés de desmontar. Justificativa: zero layout shift e permite reaproveitar atalhos de teclado p/ aba Notas no full.
- **Estado 3 substitui o composer** (não desabilita). Diferenciação semântica entre "configuração ausente" vs "permissão negada" — Stripe/Linear precedente.
- **Lookup de nomes paralelo**: `team_members` query separada com `staleTime: 5min`. RPC retorna IDs, frontend resolve display names.
- **Send hooks recebem leadId opcional**: param novo, body preservado quando ausente. `evolution-api-proxy` ignora; `whatsapp-api-proxy` (Etapa B) consome com flag ON. Não-breaking p/ orgs com flag OFF (default).
- **`useCanReplyOnInstance*` permanecem ativos** em paralelo. TODO marker dropped no código para Etapa D.
- **Modal: confirmação inline** no footer ao invés de AlertDialog separado (anti-pattern duplo modal).

## Follow-ups

- **Etapa D (limpeza)**: remover `useCanReplyOnInstanceByName` dos composers depois do rollout. Antes, regenerar `src/integrations/supabase/types.ts` (precisa MCP destravar).
- **Etapa E (rollout)**: backfill por org + flip da flag `user_write_instance_strict` por org com observabilidade (Sentry tags + logRuntime).
- **Refactor opcional**: extrair composer inline de `WhatsAppChat.tsx` para `<ChatComposerFull>` (hoje JSX inline).
- **Migration A**: ainda não aplicada em DEV (MCP bloqueado). Frontend está pronto para quando rodar.

## QA

- `npm run lint` — 0 errors em arquivos novos. 8 warnings pré-existentes em `WhatsAppChat.tsx` (não introduzidos por esta etapa).
- `npx tsc -p tsconfig.app.json --noEmit` — 0 errors em arquivos novos. Erros pré-existentes em outras superfícies (não tocadas).
- `npm run build` — passa (2m13s, exit 0).
- `vitest run tests/unit/useLeadWriteInstance.test.tsx tests/unit/ChatComposerShell.test.tsx` — 16/16 passing.
- Flag OFF: comportamento legado preservado (innerComposer renderiza direto quando leadId é null).
