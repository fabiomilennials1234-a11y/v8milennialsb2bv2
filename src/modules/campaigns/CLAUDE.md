# Module — campaigns

**Status:** 🟡 Skeleton (slice 9 popula)
**BC:** campaigns
**Entidade primária:** Campaign + Mass Send
**Owner:** marketing / vendas

## Escopo

Campanhas paralelas aos pipes. Cada campanha:
- Objetivo + deadline
- Agente IA (opcional — pra conversar com lead)
- Metas (volume, conversão)
- Round-robin entre membros do time
- Sequence de mensagens (com delay entre)
- Templates pré-aprovados

Mass send: envio em massa one-shot para lista de leads (separado de campanha contínua).

## Não-escopo

- Lead enrichment → `leads`
- Workflow disparado por campanha → `workflows`
- Mensagem em si (delegate ao MessageSender) → `communication`
- Landing page de captura → `marketing`

## API pública (`index.ts`) — TBD slice 9

Provável superfície:
- Hooks: `useCampanhas`, `useUpsellCampanhas`, `useCampaignTemplates`, `useMassSendJobs`, `useDispatchQueueItems`, `useOutboundMetrics`
- Components: `<CampaignList>`, `<CampaignDetail>`, `<MassSendForm>`
- Types: `Campaign`, `CampaignStage`, `MassSendJob`
- Eventos (post slice 19): `campaign.dispatched`, `campaign.completed`

## Áreas frágeis

- Sequence de mensagens com delays — workflow-like, mas próprio
- Mass send + rate limit (não pode estourar instance da Uazapi)
- Templates: variáveis `{{lead.name}}`, `{{lead.empresa}}`, etc.

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/campanhas/`
- `src/hooks/useCampanhas.ts`, `useCampaignTemplates.ts`, `useMassSendJobs.ts`, `useDispatchQueueItems.ts`, `useOutboundMetrics.ts`, `useUpsellCampanhas.ts`
- `src/pages/Campanhas.tsx`, `CampanhaDetail.tsx`, `campaigns/` (pasta em pages, distinta de components/campanhas/)

Backend:
- `supabase/functions/campaign-rule-dispatch/`
- `supabase/functions/process-outbound-dispatches/`
- `supabase/functions/outbound-trigger/`
- `supabase/functions/mass-send-create/`
- `supabase/functions/mass-send-status/`
- `supabase/functions/mass-send-control/`
- `supabase/functions/_shared/campaign-distribution.ts`

## Slice de migração

**Slice 9** — `feat/modularizacao/08-campaigns` (4h)

## Dedup pendente

- `pages/campaigns/` (EN) vs `components/campanhas/` (PT) — naming consolidar pra `campanhas` (alinhar com PT do resto, OU migrar tudo pra EN — decisão de slice 9)

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
