# Inbox por vendedor + round-robin de lead novo

**Origem:** feedback Sorvfoods (2026-07-14), problema #2 dos 6.
**Status:** implementado — branch `feat/lead-visibility-and-round-robin`.

## Problema

1. **"Continuamos recebendo todas as mensagens, independente do vendedor."** — o
   inbox do chat mostrava tudo pra todo mundo.
2. **"Novos leads deveriam ser distribuídos automática e aleatoriamente."** — lead
   novo caía sem dono.

## Achado (mapeamento)

~80% da infra já existia. Os gaps reais:

- **RLS de `leads`/pipes JÁ enforça** "membro vê só os seus" via feature permission
  `leads.view_all` (default false) + campos responsáveis. Sorvfoods já tem os 3
  vendedores como `membro`.
- **Round-robin JÁ existe** (`get_next_pipe_sdr` + `distribute_pipe_round_robin` +
  `pipe_distribution_rules`/`pipe_distribution_members`).

Faltavam 2 coisas.

## Gap 1 — Chat mostra tudo (T2a)

O filtro por vendedor do inbox era **só client-side**, com dois furos:
- Default `vendorFilter = "all"` → todos veem tudo ao abrir.
- Resolvia o vendedor lendo o campo **legado `responsible_id`**, mas a atribuição
  moderna (`ResponsibleSlot`) grava os canônicos `pre_sale_responsible_id` /
  `sale_responsible_id` e deixa `responsible_id` NULL → "minhas conversas" ficava
  furado.

**Fix:**
- `useLeadResponsibleMap` passa a resolver por
  `resolveLeadResponsible(row)` = COALESCE(pre_sale, sale, responsible_id).
- `ChatShellWithContext`: default `vendorFilter = isAdmin ? "all" : "mine"`.
  Vendedor abre o chat vendo só os leads dele; admin vê tudo. Pode trocar manual.

RLS server-side em `conversations`/`whatsapp_messages` por responsável fica como
**follow-up** de hardening (hoje é org-level; o filtro client + RLS de `leads`
que já esconde os leads cobrem o caso prático).

## Gap 2 — Lead novo sem dono (T2b)

`lead-webhook` só fazia round-robin quando o payload trazia `place_in_pipe`
(via `autoDistributePipe`). Lead Meta Ads / n8n sem isso → UNASSIGNED.

**Fix:** bloco novo no ingest — quando `isNewLead && !assigned_user_id &&
!place_in_pipe && !skipWhatsappSeed` E `organizations.auto_distribute_new_leads`
ON, chama `get_next_pipe_sdr('whatsapp', org)` e grava `pre_sale_responsible_id`
(trigger espelha `sdr_id`) + `metadata.sdr_id`/`assignedTo` da entry whatsapp.
Como o filtro do chat agora lê `pre_sale`, o lead aparece pro vendedor certo.

**Flag opt-in** `organizations.auto_distribute_new_leads` (migration
`20270317000000`, default false) — não muda as ~30 orgs sem pedido. Requer pool
configurado (`pipe_distribution_members`); sem pool, degrada silencioso.

## Arquivos

- `supabase/migrations/20270317000000_org_auto_distribute_new_leads.sql`
- `supabase/functions/lead-webhook/index.ts` — bloco de auto-distribuição.
- `src/modules/communication/hooks/chat/useLeadResponsibleMap.ts` (+ `.test.ts`)
- `src/modules/communication/components/chat/ChatShellWithContext.tsx` — default por papel.
- `src/modules/identity/org-team/hooks/useAutoDistributeSetting.ts` (+ barrels)
- `src/modules/pipelines/components/shared/LeadDistributionToggle.tsx` + render em
  `pages/PipeWhatsapp.tsx` (ao lado do AutoCreateLeadToggle).

## Config Sorvfoods (não-código, pós-merge)

- Montar pool de distribuição do funil WhatsApp (`pipe_distribution_members`) com
  os 3 vendedores.
- Ligar o toggle "Distribuir leads (round-robin)" no funil WhatsApp.
- Confirmar `leads.view_all` OFF nos 3 membros.

## Testes

`useLeadResponsibleMap.test.ts` — 4 casos de `resolveLeadResponsible` (pré-venda,
fallback venda [o bug], fallback legado, unassigned). Verdes.

## Deploy

- Migration: aplicar manual dev → prod.
- Redeploy edge fn `lead-webhook`.
- Frontend: auto-deploy no merge (EasyPanel).

## Follow-ups

- RLS server-side por responsável em `conversations`/`whatsapp_messages`.
- Dual-owner (SDR≠closer): o chat atribui a conversa ao pré-venda. Se precisar que
  o closer também veja como "minha", evoluir o filtro p/ membership (array).
