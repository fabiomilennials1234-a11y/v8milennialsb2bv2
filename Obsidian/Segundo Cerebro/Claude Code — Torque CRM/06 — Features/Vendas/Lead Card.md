---
title: Lead Card (Kanban) — Trello-style
status: implementado-dev
created: 2026-05-17
diataxis: reference
related:
  - "[[Lead Detail Modal]]"
  - "[[Modulos]]"
---

# Lead Card (Trello-style)

Refactor do card do kanban pra layout inspirado em Trello. Avatar dividido em
metades verticais (qualificação), métricas inline de comentários/checklists/anexos,
labels como color stripes, calor arrastável.

## Localização

```
src/components/leads/
├── LeadCard.tsx                ← orchestrator (~600 linhas)
└── card/
    ├── LeadCardAvatar.tsx      ← split 32px (preQual + qual)
    ├── LeadCardLabels.tsx      ← color stripes top 3 + counter
    ├── LeadCardMetrics.tsx     ← comments/checklists/anexos + 2 mini avatars
    └── LeadCardCalor.tsx       ← fogo arrastável vertical
```

Hook agregador: [`src/hooks/useBatchedLeadMetrics.ts`](../../../../../src/hooks/useBatchedLeadMetrics.ts) — 2 queries `IN(...)` retornam contadores de comments + checklists pra N leads. Evita N+1.

## Anatomia

```
┌──────────────────────────────────┐
│ ▓▓▓  ░░░  ░░░    (label stripes) │
├──────────────────────────────────┤
│ [◐]  Nome do lead       🔥5  ⋮   │ ← avatar split + título + calor + kebab
│      Empresa                     │
│                                  │
│ Origem · Urgência · D-3          │ ← badges secundários
│                                  │
│ ┃ Telefone   +55…                │
│ ┃ Faturamento R$ 1M              │
│                                  │
│ [WhatsApp filled green]   [🎯]   │ ← quick actions
│                                  │
│ 💬 3   ☑ 2/5   📎 0   PV V   ⏰  │ ← métricas inline
└──────────────────────────────────┘
```

## Decisões

1. **Avatar split 32px** — esquerda = `pre_qualification_tier`, direita = `qualification_tier`. Mesmo design do modal mas menor.
2. **Stripes top 3 + counter** — tags sem texto, cores únicas. Tooltip on hover. `+N` se houver mais.
3. **Métricas inline com batched fetch** — 2 queries `IN(...)` por kanban inteiro. Cache 30s.
4. **Calor arrastável** — pointer events vertical, 8px = 1 unidade. Visual reage em tempo real:
   - Frio (1-3): w-3 ícone azul
   - Morno (4-6): w-3.5 amber
   - Quente (7-8): w-4 orange
   - Ardente (9-10): w-4 vermelho com drop-shadow glow
5. **Responsáveis mini (PV+V)** — 2 bolinhas empilhadas com `-space-x-1.5`, fallback iniciais.
6. **API mantida** — `LeadCardData` recebeu campos opcionais novos: `preQualTier`, `qualTier`, `avatarUrl`, `metrics`, `preSaleResponsible`, `saleResponsible`. Call sites antigos continuam funcionando.

## Layout Kanban — Wide

`MainLayout` agora detecta rotas wide (kanbans) e remove `max-w-[1600px]` + reduz padding. Kanban ocupa quase toda a largura disponível.

Rotas wide: `/pipe-whatsapp`, `/pipe-confirmacao`, `/pipe-propostas`, `/leads`, `/custom-pipeline/...`, `/campanhas/...`, `/upsell-*`, `/follow-ups`.

## Métricas card collapse

Botão `Recolher métricas` no header da `PipeWhatsapp`. Estado persistido em `localStorage` via `usePersistedState("pipe-whatsapp-metrics-collapsed")`. Reduz scroll vertical quando o usuário só quer ver o kanban.

## Call sites adaptados

- [PipeWhatsapp.tsx](../../../../../src/pages/PipeWhatsapp.tsx) — full Trello fields + batched metrics + collapse toggle
- [PipeConfirmacao.tsx](../../../../../src/pages/PipeConfirmacao.tsx) — Trello fields (sem metrics fetch ainda)
- [PipePropostas.tsx](../../../../../src/pages/PipePropostas.tsx) — Trello fields (sem metrics fetch ainda)

Outros call sites (Custom, Campanha, Upsell) continuam funcionando — campos novos ficam `undefined` → avatar mostra "?" e métricas zero. Migrar pra Trello fields em release futura.

## Out of scope v1

- Tabela `lead_attachments` (ícone 📎 fica em 0 placeholder).
- Quick actions no hover do card (manteve simples).
- Edit inline diretamente no card além de nome/empresa.
- Trazer batched metrics pra `PipeConfirmacao`/`PipePropostas` (release futura).
