---
tags:
  - claude-code
  - feature
  - torque-crm
  - vendas
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Pipelines Customizados

## O que faz

Funis customizados por org com kanban, stages configuraveis, e auto-routing para outros pipes. Suporta permanent (sempre ativo) e temporary (time-boxed com metas de time/individuais).

## Regras de negocio

- Stages tem `is_final_positive` e `is_final_negative`
- Stage final pode auto-transferir lead para outro pipe (`target_pipeline` routing)
- `lifecycle_type`: permanent (sempre disponivel) ou temporary (com deadline e goals)
- Status: draft → active → paused → ended
- Goals: team_goal e individual_goal (metricas de campanha)
- Cada stage tem cor, icon, e posicao customizaveis

## Como o usuario usa

1. Funis Hub → Criar Pipeline Customizado
2. Define nome, icone, cor, tipo (permanente/temporario)
3. Configura stages com cores e opcoes finais (positivo/negativo)
4. Se temporario: define deadline e metas
5. Adiciona leads ao pipe
6. Opera o kanban normalmente (drag-drop)

## Edge cases

- Pipeline ended nao aceita novos leads
- Stage final com target_pipeline que nao existe falha silenciosamente
- Deletar pipeline nao deleta os leads (apenas remove entries)

---

## Como funciona (tecnico)

### Componentes

- `src/pages/CustomPipeline.tsx` - Pagina do pipe customizado
- `src/components/custom-pipelines/CustomPipelineKanban.tsx` - Kanban
- `src/components/custom-pipelines/AddLeadToPipeModal.tsx` - Adicionar leads
- `src/components/custom-pipelines/CustomPipeSettingsDialog.tsx` - Config (stages, cor, icon)
- `src/components/custom-pipelines/CreatePipelineModal.tsx` - Wizard de criacao

### Hooks

- `useCustomPipelines.ts` - Lista pipelines da org
- `useCustomPipelineStages.ts` - Stages de um pipe
- `useCustomPipeEntries.ts` - Entries (leads) com stage atual
- `useCustomPipelineMembers.ts` - Membros associados

### Tabelas

- `custom_pipelines` - name, slug, icon, color, lifecycle_type, status, team_goal, individual_goal, organization_id
- `custom_pipeline_stages` - stage_key, color, is_final_positive, is_final_negative, target_pipeline (routing), position
- `custom_pipe_entries` - lead_id, stage_id, assigned_to, stage_changed_at

### Fluxo de dados

```
Admin cria pipeline → define stages com routing
  → Adiciona leads → entries criadas na stage inicial
    → Equipe move leads entre stages (drag-drop)
      → Se stage final positiva com target_pipeline:
        → Auto-transfer lead para pipe destino (whatsapp, confirmacao, etc.)
      → Se stage final negativa: lead marcado como perdido
```

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Metas]]

- [[WhatsApp Evolution]]

- [[Funis Hub]]
- [[Campanhas]]
- [[Pipe WhatsApp]]
