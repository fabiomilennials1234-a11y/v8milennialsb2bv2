---
type: changelog
title: "Checklists no card do Negócio"
status: shipped
created: 2026-08-24
updated: 2026-08-24
tags: [changelog, leads, pipelines, engagement]
related: []
owner: gabriel
branch: feat/checklists-no-card-de-negocio
pr: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/pull/1818
---

# 2026-08-24 — Checklists no card do Negócio

Pedido do CTO, sem issue: *"quero que nos cards de negócios apareçam os
checklists que temos no sistema, assim como antes aparecia no card do lead — e
dentro do card de negócio também. Ao clicar em Checklists no menu, nada
acontece, só abre o card do negócio."*

## O que estava quebrado

Três coisas, e as três se explicam por uma só: o card do Negócio
(`deal-card/`, PR #1411) substituiu o `DealDetailDialog`, e o
`DealDetailDialog` era quem montava a coluna de atividade — com o
`LeadModalChecklist` dentro. Checklist não foi migrado junto.

1. **Dentro do card do Negócio não havia checklist nenhum.** A aba
   "Atividades" mostra a tabela `activities`, que é outra coisa: ela responde
   "o que foi feito com a pessoa", não "o que falta marcar".
2. **O item "Checklists" do menu `⊕` do card do funil chamava `abrirFicha`** —
   a mesma função dos itens com selo FICHA. Abria o negócio na primeira aba e
   parava ali. Da tela isso se lê como "não faz nada", e era o print do CTO.
3. **No card do funil, a linha de atividades só era clicável com
   `totalCk > 0`.** Ou seja: justamente o card SEM checklist — o que precisa
   aplicar o primeiro — não tinha por onde. O ramo confortável
   (`LeadCardMetrics`) já tinha corrigido isso em julho; o card do funil ficou
   para trás. E o popover, mesmo aberto, não oferecia os templates: dizia
   "Nenhum checklist neste lead" e acabava.

O número que o card anuncia — *"9 atividades em aberto"* — sai de CHECKLIST
(`useBatchedLeadMetrics`). O card prometia esse número e o painel não tinha
onde cumpri-lo.

## Mudança

| Arquivo | O quê |
|---|---|
| `deal-card/DealCardChecklists.tsx` (novo) | A aba: lista, marca item, cria item, cria checklist, aplica template, remove |
| `deal-card/DealCard.tsx` | Quarta aba "Checklists", com selo em fração (`3/7`); `abaInicial`; slot `painelChecklists` |
| `deal-card/DealCardPanel.tsx` | Monta o slot e passa a aba pedida |
| `deal-card/useDealCardData.ts` | `resumoChecklists` — só o selo da aba |
| `deal-detail/deal-sheet-context.ts` + `DealPanelProvider.tsx` | `aba` + `pedirAba()`; `useDealSheetOpcional()` |
| `leads/LeadCard.tsx` | "Checklists" abre o negócio **e pede a aba** |
| `leads/card/LeadCardCompact.tsx` | Portão vira só `leadId` — "Sem atividades" volta a ser porta |
| `leads/card/LeadCardChecklistPopover.tsx` | Aplica template de dentro do popover; sem checklist, a lista abre sozinha |

## Decisões

**O checklist é do LEAD, não do negócio.** `checklists` tem `lead_id` e não tem
`deal_id` nem `pipeline_entry_id`. Mudar isso é migration e decisão de modelo —
não entra por baixo de um pedido de UI. A aba mostra os checklists da pessoa,
mesma regra que os comentários já seguem no card (`DealCardComments`), pelo
mesmo motivo: o histórico existente é todo por lead.

**Aba, não bloco.** O card já tem três abas, e a regra escrita nele é "só entra
aba com fonte de dado ligada". Checklist tem tabela própria e tem o número que
o card do funil anuncia — entra. O selo é FRAÇÃO (`3/7`), não total: "quanto
falta" é a pergunta que se faz de checklist, e `7` sozinho não responde.

**O conteúdo entra por SLOT, não por import.** `DealCardChecklists` fala com
banco (`@/modules/engagement` → supabase + react-query). Importá-lo dentro do
`DealCard` põe esse caminho no grafo de quem monta o card — inclusive
`/preview.html`, que só é segura porque **não tem de onde ler**
(`inv:H5-17`). O teste `preview-cards-sem-banco.test.ts` pegou isso na
primeira volta. Mesmo padrão do `acaoWhatsapp` no `LeadCardCompact`. Sem o
slot, a aba não existe.

**A aba pedida atravessa o contexto, não o `onClick`.** `openDeal` continua
sendo de quem abre — cada superfície sabe se passa a entrada do funil ou o
lead. `pedirAba("checklists")` é chamado DEPOIS, no mesmo handler: abrir zera o
pedido, então a ordem é o que faz funcionar. E o pedido morre na abertura
seguinte, para não arrastar o card seguinte para a aba errada.

## Verificação

- `tests/unit/deal-card-checklists.test.tsx` — 11 casos: a aba, o selo, a aba
  pedida, e o contrato do `DealPanelProvider`
- `tests/unit/deal-card-checklists-panel.test.tsx` — 5 casos: lista, marcar,
  aplicar template, vazio, negócio sem lead
- `tests/unit/lead-card-menu-checklists.test.tsx` — 3 casos: o menu de verdade,
  incluindo que os itens com selo FICHA **não** pedem aba
- `LeadCardChecklistPopover.test.tsx` — 2 casos novos (templates)
- `npm run typecheck:ratchet` — 0 introduzidos
- `npm run test:ratchet` — 0 introduzidos. Os 12 que ele acusa
  (`protected-route`, `migration-version-collision-contract`,
  `notificame-lead-link-rpc`) foram medidos em `origin/main` e já falham lá:
  é baseline defasado, não regressão desta branch.

## O que NÃO foi feito

- Checklist por negócio (exigiria coluna nova em `checklists`)
- Nenhuma migration
