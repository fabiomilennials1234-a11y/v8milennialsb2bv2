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

# Pipe WhatsApp

## O que faz

Kanban de qualificacao de leads WhatsApp. Stages: novo → abordado → respondeu → esfriou → agendado. Drag-drop com realtime updates. Entry point principal do fluxo de vendas.

## Regras de negocio

- Lead pode estar em multiplos pipes simultaneamente
- Stage "agendado" move automaticamente pra pipe_confirmacao
- Distribution automatica de leads entre SDRs/closers via `process-pipe-distribution`
- Stages customizaveis via `pipeline_stages`
- Workflows podem ser associados a stages (badges de contagem)

## Como o usuario usa

1. Abre Pipe WhatsApp no menu lateral
2. Ve kanban com colunas por stage
3. Arrasta lead entre stages (drag-drop)
4. Clica no card do lead → abre drawer com detalhes completos
5. Pode filtrar por responsavel, tags, origem

## Edge cases

- Lead sem dados de contato aparece mas nao pode ser abordado via WhatsApp
- Realtime debounce 2s pode causar lag perceptivel
- onUpdate recebe apenas deltas — dados aninhados (tags, responsible) vem do cache

---

## Como funciona (tecnico)

### Componentes

- `src/pages/PipeWhatsapp.tsx` — Pagina principal
- `src/components/kanban/DraggableKanbanBoard.tsx` — Board com drag-drop (dnd-kit)
- `src/components/kanban/KanbanCard.tsx` — Card do lead no kanban
- `src/components/leads/LeadCard.tsx` — Card detalhado
- `src/components/leads/LeadDetailDrawer.tsx` — Drawer lateral com info completa

### Hooks

- `usePipeWhatsapp.ts` — queryKey: `["pipe_whatsapp", orgId]`, join com leads
- `usePipeMetrics.ts` — Metricas do pipe (contagens por stage, conversao)
- `usePipelineStages.ts` — Stages configuradas
- `useStageWorkflows.ts` — Contagem de workflows associados (badges)

### Edge Functions

- `process-pipe-distribution` — Distribui leads entre SDRs/closers
- `pipe-rule-dispatch` — Executa regras de stage (dispatch rules)
- `webhook-new-lead` — Integra leads de entrada

### Tabelas

- `pipe_whatsapp` — lead_id, status, stage_id, organization_id, created_at
- `leads` — Dados do lead (name, company, phone, email, origin, rating, segment)
- `team_members` — responsible_id, sdr_id para assignment
- `lead_tags` — Tags do lead (N:N via lead_tags)
- `lead_actions` — Historico de acoes

### Fluxo de dados

```
Lead entra (webhook/manual/n8n)
  → INSERT pipe_whatsapp (stage: novo)
    → Realtime → UI atualiza kanban
      → Usuario arrasta card → UPDATE stage
        → Trigger stage_changed → dispatch rules / workflows
          → Se stage=agendado → INSERT pipe_confirmacao
```

---

## Historico de mudancas

## Links relacionados

- [[Pipe Confirmacao]]
- [[Follow-ups]]
- [[Regras de Pipe]]
- [[Copilot]]
- [[Chat WhatsApp]]
