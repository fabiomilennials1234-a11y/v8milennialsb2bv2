# SPEC — Editar funil/etapa, responsáveis e qualificação direto no chat

**Status:** Aprovado (grill 2026-07-27, CTO confirmou)
**Escopo:** `src/modules/communication/components/chat/context-panel/` (aba INFOS do painel de contexto)
**Mockup aprovado:** Variação B — https://claude.ai/code/artifact/e918b5ac-616e-497c-bc02-0ada45ee51c2

---

## Problem Statement

Pra mover um lead de etapa/funil, trocar responsável ou (re)qualificar, o vendedor hoje sai do chat e vai pro kanban ou abre o modal do lead. No meio de uma conversa quente isso quebra o fluxo. O painel de contexto do chat mostra Origem/Responsável/Rating mas quase nada é acionável, e não mostra **em que funil/etapa** o lead está. Além disso o painel do chat ainda usa o modelo **antigo** de responsável único (`responsible_id`), enquanto o resto do produto já migrou pra **Pré-venda + Vendas**.

## Solution

No painel de contexto (aba INFOS), tornar acionável, sem sair da conversa:

1. **Card de Funis (mockup B)** — seção própria listando cada funil em que o lead está, com a etapa como chip clicável pra mover, mais "+ adicionar a funil". Honra o invariante "lead em múltiplos funis ao mesmo tempo".
2. **Responsáveis no modelo novo** — substitui o "Responsável" único por **Pré-venda** (`pre_sale_responsible_id`) + **Vendas** (`sale_responsible_id`), reusando o `ResponsibleSlot` já existente.
3. **Qualificação + Pré-qualificação** — dois seletores de tier reusando o `QualificationSlot` já existente.

Quase tudo é **wiring de peças existentes e testadas**. Nenhuma migration esperada.

## Decisões travadas (grill)

1. **Escrita só em `pipeline_entries`** (canônico) via `useMovePipelineEntry` / `useCreatePipelineEntry`. **Nunca** nos writers legacy (`useMove/AddLeadToStandardPipe` inserem nas views de compat `pipe_*`). Verificado: `pipe_whatsapp/confirmacao/propostas` são views sobre `pipeline_entries`.
2. **Ganho/Perdido (won/lost) com dialog de confirmação** — mover pra etapa terminal registra receita/comissão (ADR-0017), então exige confirmação explícita. Detecta terminal via `stage_role` (`won`/`lost`) das etapas.
3. **Adicionar a funil** mantém o responsável do lead (não mexe em atribuição — responsável vive no lead, não na entry), **sem** round-robin (é ação manual, não inbound), **com** workflows/eventos de `stage_changed` normais (paridade com o kanban).
4. **Responsável novo** = Pré-venda (`pre_sale_responsible_id`) + Vendas (`sale_responsible_id`) — substitui o `responsible_id` único no painel do chat.
5. **Qualificação** (`qualification_tier`) + **Pré-qualificação** (`pre_qualification_tier`) — enum `diamante/ouro/prata/bronze/desqualificado`.
6. **Optimistic update** ao mover etapa (+ rollback no erro), invalida no sucesso.
7. **Sem "remover de funil"** no card (destrutivo — fica no kanban).
8. **Gate de permissão** = `useLeadActionGates` (mesmo do kanban/lead-detail) — paridade.

## Peças reusadas (já prontas/testadas)

- `useLeadAllPipelines(leadId)` — funis do lead (standard + custom) com etapa, lista de etapas, cor. **Ajuste:** rótulos vêm de `usePipelineDisplayConfig` (customizável por org), não hardcode.
- `useMovePipelineEntry({id, stageKey})` / `useCreatePipelineEntry` — escrita em `pipeline_entries`.
- `ResponsibleSlot` (`field: pre_sale_responsible_id | sale_responsible_id`) — save + gate + conflito. **Exportar no barrel de leads.**
- `QualificationSlot` (`field: pre_qualification_tier | qualification_tier`) — save + gate. **Exportar no barrel.**
- `ContextPanelPipe.tsx` — display read-only morto; vira a base do card B interativo.

## User Stories

1. Como vendedor, mover o lead de etapa no funil sem sair do chat.
2. Como vendedor, ver todos os funis em que o lead está + a etapa em cada.
3. Como vendedor, adicionar o lead a outro funil pelo chat.
4. Como vendedor, ser avisado (confirmação) quando a etapa que escolho registra receita.
5. Como vendedor, definir Pré-venda e Vendas do lead no chat.
6. Como vendedor, ajustar qualificação e pré-qualificação no chat.
7. Como admin, que permissão/eventos sejam idênticos ao kanban (nada burla gate nem pula workflow).

## Fatiamento

- **S1 — Responsáveis + Qualificação no chat:** exporta `ResponsibleSlot`/`QualificationSlot` no barrel de leads; substitui o "Responsável" único por Pré-venda + Vendas; adiciona Qualificação + Pré-qualificação. Wiring puro. Testes de render/gate.
- **S2 — Card de Funis (mover etapa):** `ContextPanelFunnels` interativo a partir do `ContextPanelPipe`; move via `useMovePipelineEntry`; rótulos via display config; optimistic + rollback; dialog de confirmação won/lost (via `stage_role`). Testes da lógica de terminal + optimistic.
- **S3 — Adicionar a funil + acabamento:** picker "+ adicionar a funil" via `useCreatePipelineEntry`; paridade de workflow; a11y/motion; wire no `ContextPanelTabInfo`; e2e se houver harness.

## Riscos / notas

- **Dual model:** standard pipes via view de compat; escrever `pipeline_entries` direto é o caminho certo, mas confirmar que a entry de pipe de sistema tem `pipeline_id` resolvível (via `pipelines` slug=system) pro add-to-funnel.
- **Won/lost:** confirmar empiricamente o que o trigger de `stage_role=won` dispara (receita/comissão) antes de liberar — o dialog é a rede, mas o efeito é real.
- Multi-tenancy: toda escrita filtra `organization_id`; RLS é o gate final.
