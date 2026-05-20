---
date: 2026-05-19
type: changelog
related:
  - "[[Lead Detail Modal]]"
---

# 2026-05-19 — Modal V2 pipes: refatoração layout horizontal (rails + pills + strip)

## Mudanças
- **Lead Modal V2**: `LeadCrossPipeAccordion` (acordeão vertical alto) substituído pelo `CrossPipePanel` (layout horizontal compacto, 3 zonas: StageRails → ActionPills+Panel → OtherPipesStrip).
- **MoveStageButton removido** — controle de stage agora vive nas StageRails (sempre visíveis, sem popover intermediário).
- **CustomPipeSection / UpsellPipeSection deletados** — entradas em pipes customizados e Carteira passam pelo strip (add) e pelas rails (move).
- **MeetingFieldBlock / BudgetFieldBlock** ganharam prop `bare?: boolean` para suprimir o card externo quando renderizados dentro do `ActionPanel`.
- **Keyframes novos** em `src/index.css`: `stage-confirm` (flash de sucesso pós-move) e `panel-down` (slide-down do panel). Ambos com prefixo `motion-safe:` nas chamadas.

## Arquivos tocados
### Criados
- `src/components/lead-detail/modal/pipes/CrossPipePanel.tsx`
- `src/components/lead-detail/modal/pipes/StageRail.tsx`
- `src/components/lead-detail/modal/pipes/ActionPill.tsx`
- `src/components/lead-detail/modal/pipes/ActionPanel.tsx`
- `src/components/lead-detail/modal/pipes/InactivePipeChip.tsx`
- `src/components/lead-detail/modal/pipes/OtherPipesStrip.tsx`
- `src/components/lead-detail/modal/pipes/useCrossPipeMove.ts`
- `src/components/lead-detail/modal/pipes/__tests__/StageRail.test.tsx`
- `src/components/lead-detail/modal/pipes/__tests__/ActionPill.test.tsx`
- `src/components/lead-detail/modal/pipes/__tests__/InactivePipeChip.test.tsx`
- `src/components/lead-detail/modal/pipes/__tests__/CrossPipePanel.test.tsx`

### Modificados
- `src/components/lead-detail/modal/LeadDetailDialogV2.tsx` — troca `<LeadCrossPipeAccordion>` por `<CrossPipePanel>` (mobile + desktop).
- `src/components/lead-detail/cross-pipe/MeetingFieldBlock.tsx` — prop `bare`.
- `src/components/lead-detail/cross-pipe/BudgetFieldBlock.tsx` — prop `bare`.
- `src/index.css` — keyframes `stage-confirm` e `panel-down`.
- `src/components/lead-detail/modal/__tests__/gates-applied.test.tsx` — bloco MoveStageButton substituído por equivalente StageRail.

### Deletados
- `src/components/lead-detail/modal/pipes/LeadCrossPipeAccordion.tsx`
- `src/components/lead-detail/modal/pipes/CustomPipeSection.tsx`
- `src/components/lead-detail/modal/pipes/UpsellPipeSection.tsx`
- `src/components/lead-detail/modal/header/MoveStageButton.tsx`
- `src/components/lead-detail/modal/pipes/__tests__/LeadCrossPipeAccordion.test.tsx`
- `src/components/lead-detail/modal/pipes/__tests__/CustomPipeSection.test.tsx`
- `src/components/lead-detail/modal/pipes/__tests__/UpsellPipeSection.test.tsx`
- `src/components/lead-detail/modal/header/__tests__/MoveStageButton.test.tsx`

## Decisões
- **Single hook unificado** (`useCrossPipeMove`) para move em sistema + custom — antes era lógica duplicada entre `MoveStageButton` e `CustomPipeSection`. Payload típed por discriminated union `kind: "system" | "custom"`.
- **localStorage retroativo**: chave `lead-modal:expanded:{userId}:{leadId}` continua existindo; o parse migra `confirmacao → meeting`, `propostas → budget`, e descarta valores antigos (`carteira`, ids de custom pipes etc.) silenciosamente. Sem flush forçado — usuários migram on next read.
- **Kebab no panel substitui Remover inline**: removido `RemoveFromPipeAction` que vivia ao fim de cada section do acordeão; agora "Remover de {pipe}" é item do dropdown `⋯` no canto superior direito do panel. AlertDialog de confirmação preservado igual.
- **Pipe terminal (propostas vendido/perdido)** segue na rail, com o segmento final marcado como current. Removido o badge "Encerrado" — visual do segment já comunica.

## Follow-ups
- **Custom pipe remove via kebab**: por ora o kebab só aparece em meeting/budget panels. Remover de um custom pipe continua restrito à tela de gerenciamento do pipe customizado. Avaliar exposição quando houver sinal de uso.
- **Upsell add**: a chip de Carteira no strip só fica habilitada com `propostas.status = "vendido"`. A mutation real ainda usa `useAddLeadToStandardPipe` (pipeType `upsell`) — promotion-to-cliente avançada continua na `UpsellPipeSection` ant — agora deletada. Se houver demanda de promote-to-cliente direto do modal, abrir backlog.
- **CI baseline red**: 70 testes pré-existentes seguem falhando em main (não tocados por esta PR — copilot/cancellation, evolution-api, permissions-fail-closed, etc). Documentado em `MEMORY.md`.
