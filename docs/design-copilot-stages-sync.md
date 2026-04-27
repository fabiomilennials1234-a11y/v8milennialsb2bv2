# Design: Sincronização Copilots ↔ Pipeline Stages

## Data: 2026-02-19

---

## Resumo do Entendimento

- **O que**: Sistema de sincronização completa entre copilots e etapas do pipeline (`pipeline_stages`)
- **Por que**: Hoje os copilots usam listas fixas no código (hardcoded), desconectadas da tabela `pipeline_stages`. Criar/excluir etapas não se reflete nos copilots.
- **Para quem**: Admins que gerenciam pipelines e copilots dentro de uma organização
- **Constraints**: Multi-tenant (cada org tem suas etapas); real-time (pipeline_stages já tem subscription)
- **Non-goals**: Migração de copilots existentes; etapas custom por copilot

---

## Assumptions

1. A tabela `pipeline_stages` é a fonte de verdade para etapas
2. Constantes hardcoded (`PIPE_STAGES`, `PIPE_CONFIRMACAO_STAGES`, `PIPE_PROPOSTAS_STAGES`) serão removidas
3. Limpeza silenciosa não gera log/auditoria
4. Auto-config de kanban rules usa textos genéricos
5. Todos os 3 pipes (WhatsApp, Confirmação, Propostas) são dinâmicos — sem etapas obrigatórias fixas

---

## Decision Log

| # | Decisão | Alternativas | Motivo |
|---|---------|-------------|--------|
| 1 | Sync bidirecional + auto-config | Apenas leitura; Sync sem auto-config | Experiência sem fricção |
| 2 | Auto-config com sugestão | Modal obrigatório; Notificação + ação manual; Bloqueio | Menos fricção, badge `needs_review` |
| 3 | Limpeza automática silenciosa | Limpeza + notificação; Alerta antes | Operação limpa |
| 4 | Todos os pipes dinâmicos | Só WhatsApp; Dinâmicos com mínimo | Máxima flexibilidade |
| 5 | Wizard busca 100% do banco | Template pré-seleciona; Sugestão | Fonte única de verdade |
| 6 | Move rules validadas sempre | Só UI; Não prioridade | Consistência end-to-end |
| 7 | Triggers SQL + Hook (Abordagem A) | 100% frontend; Edge Function | Consistência fora da UI |

---

## Design Final

### Camada de Banco de Dados

#### 1. Nova coluna `needs_review` em `agent_kanban_rules`
```sql
ALTER TABLE agent_kanban_rules ADD COLUMN needs_review BOOLEAN DEFAULT false;
```

#### 2. Trigger `on_stage_deactivated` (UPDATE pipeline_stages, is_active → false)
- Remove `stage_key` de `active_stages[pipeline_type]` nos `copilot_agents` da org
- Remove `move_rules` que referenciam a etapa
- Desativa `agent_kanban_rules` com esse `stage_name`

#### 3. Trigger `on_stage_deleted` (DELETE pipeline_stages)
- Mesma lógica de limpeza

#### 4. Trigger `on_stage_created` (INSERT pipeline_stages)
- Adiciona `stage_key` ao `active_stages[pipeline_type]` dos copilots da org
- Insere `agent_kanban_rules` genérica com `needs_review = true`

#### 5. Validação `validate_copilot_move_rules` (BEFORE INSERT/UPDATE copilot_agents)
- Cada etapa em `move_rules` deve existir e estar ativa em `pipeline_stages`

### Camada Frontend

| Arquivo | Mudança |
|---------|---------|
| `src/types/copilot.ts` | Remover `PIPE_STAGES`, `PIPE_CONFIRMACAO_STAGES`, `PIPE_PROPOSTAS_STAGES` |
| `src/components/copilot/AgentConfigModal.tsx` | Usar `usePipelineStages()` |
| `src/components/copilot/AgentKanbanRulesTab.tsx` | Usar hook + badge `needs_review` |
| `src/components/copilot/wizard-steps/AutomationActionsStep.tsx` | Usar hooks dinâmicos |
| `src/components/copilot/wizard-steps/ConfirmationFunnelStep.tsx` | Usar `usePipelineStages("confirmacao")` |
| `src/hooks/useAgentKanbanRules.ts` | Incluir `needs_review` no tipo |
