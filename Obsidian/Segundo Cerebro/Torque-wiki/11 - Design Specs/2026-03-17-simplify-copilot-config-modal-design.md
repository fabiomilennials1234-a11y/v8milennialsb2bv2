---
tags:
  - torque-crm
  - docs
  - design
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/specs/2026-03-17-simplify-copilot-config-modal-design.md
---

# Design: Simplificar AgentConfigModal - 6 tabs para 2 tabs

**Data:** 2026-03-17
**Status:** Aprovado

---

## Contexto

O modal de configuração do Copilot (`AgentConfigModal.tsx`) tem 6 tabs (Visão Geral, WhatsApp, Funis, Automação, Revisão, Regras) + 1 condicional (Follow-up). Isso é excessivo - Automação, Regras e Follow-up já são configuráveis via Wizard (rota `/copilot/{id}/editar`), e Revisão é monitoramento (não configuração).

---

## Mudança

**De 6 tabs → 2 tabs:**

| Antes | Depois |
|-------|--------|
| Visão Geral | **Geral** (Visão Geral + WhatsApp fundidos) |
| WhatsApp | *(fundido em Geral)* |
| Funis | **Funis** (melhorado com custom pipelines) |
| ~~Automação~~ | *(removida)* |
| ~~Revisão~~ | *(removida)* |
| ~~Regras~~ | *(removida)* |
| ~~Follow-up~~ | *(removida)* |

---

## Tab "Geral"

### Seção 1: Informaçoes do Agente (read-only, como hoje)
- Nome, Template (badge), Status (badge), Padrão (badge)
- Personalidade (3 badges: tone, style, energy)
- Objetivo Principal (texto)
- Habilidades (badges)

### Seção 2: Instância WhatsApp
- Separada visualmente da seção acima com `<Separator />` e heading "Instância WhatsApp"
- Conteúdo idêntico ao da tab WhatsApp atual: instância vinculada, botão vincular/desvincular, lista de instâncias disponíveis

---

## Tab "Funis" (melhorada)

### Problema atual
A tab usa `PIPE_TYPES` hardcoded (6 pipes fixos). Custom pipelines criados pelo usuário não aparecem. Além disso, `useAllPipelineStageOptions()` só retorna stages para `whatsapp`, `confirmacao` e `propostas` - os pipes `campanha`, `upsell_base` e `upsell_gestao` mostram zero stages (bug pré-existente).

### Melhoria
1. Manter o loop `PIPE_TYPES.map(...)` para pipes padrão
2. Carregar custom pipelines via `useCustomPipelines()` (já existe em `src/hooks/useCustomPipelines.ts`)
3. Exibir custom pipelines em seção separada "Pipes Custom" abaixo dos padrão

### Custom pipeline stages - padrão sub-componente
Hooks não podem ser chamados dentro de `.map()`. Criar um sub-componente interno:
```tsx
function CustomPipeRow({ pipeline, activePipes, activeStages, onToggle, onToggleStage }) {
  const { data: stages } = useCustomPipelineStages(pipeline.id);
  // render checkbox + expand com stages
}
```

### Chave em `active_pipes` / `active_stages`
Custom pipelines usam UUID como chave (mistura com strings dos pipes padrão). Isso é seguro pois `active_pipes` não é lido por edge functions - apenas armazenado e relido no modal.

---

## Save handler - preservar campos da Automação

### Problema
O `handleSave` chama `updatePipeline.mutateAsync()` com campos obrigatórios: `canMoveCards`, `autoMoveOnQualify`, `autoMoveOnObjective`, `moveRules`. Remover o estado desses campos quebraria a compilação.

### Solução
**NÃO remover os `useState` desses campos.** Eles continuam sendo inicializados a partir de `agent.*` no `useEffect` existente e passados no `handleSave` sem modificação. Apenas o JSX das tabs que permitem editá-los é removido. Assim o save preserva os valores configurados via Wizard sem sobrescrevê-los.

Remover apenas:
- Os handlers de interação (`handleAddMoveRule`, `handleRemoveMoveRule`, `handleUpdateMoveRule`)
- O JSX das tabs removidas
- Os imports de componentes de tab não mais renderizados

---

## Tabs removidas - edição pós-criação

### Kanban Rules e Follow-up Rules
Esses são editáveis via rota `/copilot/{id}/editar` que abre o Wizard em modo edição. O Wizard cobre a configuração de kanban rules (step `kanbanRulesReview`) e follow-up rules. A remoção das tabs do modal não causa regressão funcional pois o botão "Editar Copilot" no modal continua existindo.

### Componentes preservados (não deletar)
- `AgentMetricsTab` (`src/components/copilot/AgentMetricsTab.tsx`)
- `AgentTasksTab` (`src/components/copilot/AgentTasksTab.tsx`)
- `AgentKanbanRulesTab` (`src/components/copilot/AgentKanbanRulesTab.tsx`)
- `AgentFollowupRulesTab` (`src/components/copilot/AgentFollowupRulesTab.tsx`)

---

## Imports e ícones a remover

Remover imports não mais usados:
- Componentes: `AgentMetricsTab`, `AgentTasksTab`, `AgentKanbanRulesTab`, `AgentFollowupRulesTab`
- Ícones que ficam órfãos após remoção das tabs: verificar quais de `ArrowRightLeft`, `BarChart3`, `Clock`, `LayoutList`, `Plus`, `Trash2` não são mais referenciados no JSX restante

Adicionar imports:
- `useCustomPipelines` de `@/hooks/useCustomPipelines`
- `Separator` de `@/components/ui/separator` (para dividir seçoes na tab Geral)

---

## Arquivo modificado

- `src/components/copilot/AgentConfigModal.tsx` - único arquivo

## Não modificar

- Nenhum componente de tab é deletado (preservar para uso futuro)
- Nenhuma tabela ou campo do banco é alterado
- O Wizard continua funcionando normalmente
- `UpdatePipelinePayload` não é alterado


## Links relacionados

- [[MOC - Arquitetura]]

- [[Upsell]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
