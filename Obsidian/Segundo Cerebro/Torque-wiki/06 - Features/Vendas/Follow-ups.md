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

# Follow-ups

## O que faz

Tarefas de follow-up auto-geradas por mudanca de stage ou criadas manualmente. Filtro por data (hoje/atrasado/futuro), prioridade, e responsavel. Integra com Copilot para auto-assign e auto-complete.

## Regras de negocio

- Automacoes configuraveis por pipe/stage com trigger_type: stage_change, no_response, not_confirmed
- Prioridade: low, normal, high, urgent
- Dias de offset e delay configuraveis
- Acoes do Dia (daily standup) separadas dos follow-ups regulares
- Copilot pode ser assignado a follow-ups para execucao automatica
- Arquivo (soft-delete) mantem historico

## Como o usuario usa

1. Abre Follow-ups no menu lateral
2. Ve lista agrupada: hoje, atrasado, futuro
3. Pode filtrar por responsavel e prioridade
4. Clica para ver detalhes → completa ou arquiva
5. Pode criar follow-up manual para qualquer lead
6. Admin configura automacoes em AutomationSettings

## Edge cases

- Follow-up sem lead associado e orfao (possivel se lead deletado)
- Automacao que cria follow-ups duplicados se trigger dispara multiplas vezes
- Copilot follow-ups dependem de agente ativo e instancia WhatsApp online

---

## Como funciona (tecnico)

### Componentes

- `src/pages/PipeFollowUps.tsx` - Lista de follow-ups
- `src/components/followups/FollowUpCard.tsx` - Card da tarefa
- `src/components/followups/ScheduleFollowUpModal.tsx` - Criar follow-up
- `src/components/followups/AutomationSettings.tsx` - Config de automacoes
- `src/components/followups/AcoesDoDia.tsx` - Daily standup tasks

### Hooks

- `useFollowUps.ts` - Lista com filtros (data, completude, arquivo)
- `useCompleteFollowUp.ts` - Marcar como concluido
- `useArchiveFollowUp.ts` - Soft-delete
- `useAgentFollowupRules.ts` - Regras de automacao do copilot
- `useAutoFollowUp.ts` - Trigger automacao em mudanca de stage

### Edge Functions

- `process-followup-automations` - Cron 5 min, cria follow-ups automaticos
- `process-copilot-followups` - Cron 5 min, atribui e executa via Copilot

### Tabelas

- `follow_ups` - title, description, due_date, priority, source_pipe, is_automated, completed_at, archived_at, lead_id, assigned_to
- `follow_up_automations` - pipe_type, stage, trigger_type (stage_change/no_response/not_confirmed), days_offset, trigger_delay_hours
- `acoes_do_dia` - title, is_completed, team_member_id

### Fluxo de dados

```
Lead muda de stage no pipe
  → Trigger detectado → checa follow_up_automations
    → Se match: cria follow_up com due_date = now + days_offset
      → process-followup-automations (cron 5 min) processa
        → Se assigned ao Copilot: process-copilot-followups executa via IA
        → Se manual: equipe ve na lista e completa
```

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[WhatsApp Evolution]]

- [[Pipe WhatsApp]]
- [[Pipe Confirmacao]]
- [[Copilot]]
