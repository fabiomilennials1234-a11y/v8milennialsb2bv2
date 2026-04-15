---
tags:
  - claude-code
  - feature
  - torque-crm
  - automacao
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Campanhas

## O que faz

Campanhas temporarias de vendas com metas individuais/time, bonus, e deadline. Modes: automatico, semi-automatico, manual. Kanban com stages customizaveis. Distribuicao de leads round-robin ou random.

## Regras de negocio

- Objetivos: qualificacao, agendamentos, propostas, livre
- Status lifecycle: draft → active → paused → ended
- Cada membro tem meetings_count e bonus_earned trackados
- Dispatch rules disparam sequences de mensagens por stage
- Lead pode estar em campanha E no pipe simultaneamente
- Distribuicao de leads: round-robin ou random entre membros

## Como o usuario usa

1. Campanhas → Criar Campanha
2. Define: objetivo, deadline, metas time/individual, valor do bonus
3. Adiciona membros do time
4. Adiciona leads (manual, busca, ou import XLSX)
5. Configura dispatch rules (sequences de mensagens por stage)
6. Configura stages do kanban
7. Ativa campanha
8. Monitora analytics e progresso dos membros

## Edge cases

- Campanha com status `ended` nao aceita novos leads
- Membro removido mantem historico de bonus
- Lead em multiplas campanhas pode receber mensagens duplicadas (dispatch rules devem evitar overlap)
- Import de leads pode adicionar duplicatas se mesmo lead ja existe na campanha

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Campanhas.tsx` - Lista/grid de campanhas
- `src/pages/CampanhaDetail.tsx` - Detalhe com kanban, analytics, config
- `src/components/campanhas/CampanhaCard.tsx` - Card na lista
- `src/components/campanhas/CreateCampanhaModal.tsx` - Wizard de criacao
- `src/components/campanhas/CampanhaKanban.tsx` - Kanban com stages customizaveis
- `src/components/campanhas/CampanhaAnalytics.tsx` - Metricas da campanha
- `src/components/campanhas/CampanhaDispatchRulesSection.tsx` - Config de dispatch rules
- `src/components/campanhas/AddLeadToCampanhaModal.tsx` - Adicionar leads
- `src/components/campanhas/ImportLeadsModal.tsx` - Import via XLSX
- `src/components/campanhas/ManageStagesModal.tsx` - CRUD de stages

### Hooks

- `useCampanhas()` - Lista campanhas da org
- `useCampanha(id)` - Detalhe
- `useCreateCampanha()` / `useUpdateCampanha()` / `useDeleteCampanha()` - CRUD
- `useCampanhaMembers()` - Membros e metricas
- `useCampanhaLeads()` - Leads na campanha com stage

### Edge Functions

- `campaign-rule-dispatch` - Cron 1 min. Processa dispatch rules e sequences de mensagens.

### Tabelas

- `campanhas` - name, description, deadline, team_goal, individual_goal, bonus_value, is_active, objective, status, organization_id
- `campanha_stages` - campanha_id, name, color, position, is_reuniao_marcada
- `campanha_members` - campanha_id, team_member_id, meetings_count, bonus_earned
- `campanha_leads` - campanha_id, lead_id, stage_id, sdr_id, notes
- `campanha_dispatch_rules` - campanha_id, trigger_type, action_type, template_id
- `campanha_dispatch_rule_steps` - Steps sequenciados com delays e condicoes

### Fluxo de dados

```
Admin cria campanha → define stages, metas, dispatch rules
  → Adiciona leads (manual/import)
    → Leads entram no kanban (stage inicial)
      → Dispatch rules disparam sequences de mensagens
        → campaign-rule-dispatch (cron 1 min) processa fila
          → Membro move lead entre stages → metricas atualizam
            → Ao atingir deadline ou meta → campanha pode ser encerrada
```

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Metas]]

- [[Workflow Builder]]
- [[Pipelines Customizados]]
- [[Follow-ups]]
- [[Templates de Mensagem]]
