---
data: 2026-07-14
tipo: feature
área: communication + leads
origem: feedback Sorvfoods (#2 de 6)
branch: feat/lead-visibility-and-round-robin
---

# Inbox por vendedor + round-robin de lead novo

## Contexto

Sorvfoods #2: (1) "recebemos todas as mensagens independente do vendedor"; (2)
"leads novos deveriam ser distribuídos automática e aleatoriamente".

Mapeamento revelou que ~80% já existia: RLS de `leads`/pipes já esconde lead de
outro (feature perm `leads.view_all` default false); round-robin já existe
(`get_next_pipe_sdr` + `pipe_distribution_*`). Faltavam 2 gaps.

## Gap 1 — Chat mostrava tudo (T2a)

Filtro por vendedor era só client-side, com furos: default "all" + resolvia
vendedor pelo campo legado `responsible_id` (que a atribuição moderna deixa NULL —
grava só `pre_sale_responsible_id`/`sale_responsible_id`).

**Fix:** `useLeadResponsibleMap` resolve por COALESCE(pre_sale, sale, responsible)
(helper puro `resolveLeadResponsible`, testado); `ChatShellWithContext` default
`vendorFilter = isAdmin ? "all" : "mine"` — vendedor abre vendo só os dele.

## Gap 2 — Lead novo sem dono (T2b)

`lead-webhook` só distribuía com `place_in_pipe`. Lead Meta Ads/n8n → unassigned.

**Fix:** bloco no ingest — lead novo sem place_in_pipe + flag
`organizations.auto_distribute_new_leads` ON → `get_next_pipe_sdr('whatsapp',org)`
grava `pre_sale_responsible_id` + metadata da entry. Flag opt-in default OFF
(migration 20270317000000). Toggle na barra do funil WhatsApp.

## Arquivos

- `supabase/migrations/20270317000000_org_auto_distribute_new_leads.sql`
- `supabase/functions/lead-webhook/index.ts`
- `src/modules/communication/hooks/chat/useLeadResponsibleMap.ts` (+ test)
- `src/modules/communication/components/chat/ChatShellWithContext.tsx`
- `src/modules/identity/org-team/hooks/useAutoDistributeSetting.ts` (+ barrels)
- `src/modules/pipelines/components/shared/LeadDistributionToggle.tsx` + PipeWhatsapp
- Spec: `.specs/features/lead-visibility-round-robin/SPEC.md`

## Pendente

- Aplicar migration dev → prod + redeploy `lead-webhook`.
- Config Sorvfoods: pool de distribuição whatsapp com os 3 vendedores + ligar
  toggle + confirmar `leads.view_all` OFF nos 3.
- Follow-up: RLS server-side por responsável em conversations/whatsapp_messages;
  dual-owner (SDR≠closer) no filtro do chat.

## Refs

- Problema **#2** dos 6 do feedback Sorvfoods. #1 (janela de envio) = PR #1093.
  Faltam #3 assinatura vendedor, #4 import base, #5 nome interno vs exibição,
  #6 grupos WhatsApp.
