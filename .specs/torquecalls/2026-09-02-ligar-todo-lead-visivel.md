# 2026-09-02 — Ligar em todo lead visível

Regra: **vê o lead → pode ligar**. O gate de dono do lead (`useCanCallLead` no front,
`not_lead_owner` no `call-plane.ts`) saiu. Servidor pergunta à RLS de `leads` com o JWT do
chamador (`Caller.asUser`) e recusa com `lead_not_visible` (403). `voip_can_see_call` passa a
olhar o dono canônico (`20270915000000`). Botão nas 4 superfícies: chat mesa, chat celular, Card
do Lead, Card do Negócio. Detalhe e motivo medido: `docs/adr/0024-torquecalls-voice-call-plane.md`,
Emenda 1.
