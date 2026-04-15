---
tags:
  - torque-crm
  - docs
  - design
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/specs/2026-03-27-funis-campanhas-redesign.md
---

# Redesign: Campanhas → Funis Unificados

**Data:** 2026-03-27
**Decisao Central:** Campanhas deixam de existir como entidade separada. Tudo vira funil.
`custom_pipelines` ganha `lifecycle_type: 'permanent' | 'temporary'`.
Campanhas existentes ficam read-only ate encerrarem (depreciation suave).

---

## Modelo de Dominio

### custom_pipelines (extender)
Novos campos:
- `lifecycle_type text NOT NULL DEFAULT 'permanent'` - permanent | temporary
- `starts_at timestamptz` - inicio (so temporarios)
- `ends_at timestamptz` - deadline (so temporarios)
- `status text NOT NULL DEFAULT 'active'` - draft | active | paused | ended
- `team_goal integer` - meta equipe
- `individual_goal integer` - meta individual
- `bonus_value integer` - bonus em centavos
- `bonus_description text` - descricao do premio
- `objective_pipe_type text` - pipe-alvo do objetivo
- `objective_stage_key text` - stage-alvo do objetivo
- `template_type text` - indicacao | prospeccao | reativacao | null
- `lead_source_config jsonb` - config de intake (formulario, import, filtro)

### custom_pipeline_members (nova tabela)
- `id uuid PK`
- `organization_id uuid FK organizations`
- `pipeline_id uuid FK custom_pipelines ON DELETE CASCADE`
- `team_member_id uuid FK team_members`
- `role text` - sdr | closer | participant
- `goal_count integer DEFAULT 0`
- `achieved_count integer DEFAULT 0`
- `bonus_earned boolean DEFAULT false`
- `created_at timestamptz DEFAULT now()`
- `UNIQUE(pipeline_id, team_member_id)`

### campanhas (DEPRECIAR - read-only)
Tabela e dependencias (`campanha_stages`, `campanha_leads`, `campanha_members`,
`campanha_pipe_automations`, `campanha_dispatch_rules`) ficam intocadas.
Rota `/campanhas/:id` acessivel mas sem link no sidebar.
Campanhas existentes terminam naturalmente.

---

## Quiz Impact

- `pipeline_display_config` ja implementa naming/visibility por quiz
- FunisHub e Sidebar passam a consumir de la (hoje FunisHub hardcoda DEFAULT_FUNNELS)
- Templates de criacao ordenados/sugeridos conforme quiz answers
- Funis ocultos reativaveis via "Ativar funil oculto"
- Novos nomes: Oportunidades, Agendamentos, Orcamentos (variam por segmento)

---

## Feature Flags

Remove: campaigns_manual, campaigns_semi, campaigns_auto
Renomeia:
- campaigns_indicacao → funnels_template_indicacao
- campaigns_prospeccao → funnels_template_prospeccao
- campaigns_reativacao → funnels_template_reativacao
Novo: max_temporary_funnels
Mantem: funnels, funnels_custom, max_funnels, carteira

---

## UI

### FunisHub (/funis)
3 secoes: Estruturais (de pipeline_display_config) → Custom Permanentes → Temporarios Ativos
Temporarios com progress bar, meta, dias restantes
Encerrados colapsados embaixo

### Modal de Criacao
3 opcoes: Funil permanente | Funil temporario | Ativar funil oculto
Cada opcao leva a templates especificos
Templates sugeridos conforme quiz

### Sidebar
Temporarios ativos aparecem sob Funis com icone diferenciado
"Campanhas" some do menu como item top-level
Rota legacy /campanhas/:id mantida sem link

---

## Fases de Implementacao

1. **Migration SQL** - ALTER custom_pipelines + CREATE custom_pipeline_members (additive, zero breaking change)
2. **Feature registry** - rename flags, add max_temporary_funnels
3. **Hooks** - extend useCustomPipelines, novo useCustomPipelineMembers
4. **Componentes** - FunisHub, CreateModal, TemporaryFunnelConfig, ActivateHiddenFunnel, FunnelMembersPanel
5. **Rotas** - remover /campanhas do sidebar, manter rota legacy
6. **Sidebar** - temporarios ativos, labels dinamicos de pipeline_display_config
7. **Quiz integration** - garantir FunisHub/Sidebar consomem pipeline_display_config


## Links relacionados

- [[Dashboard]]
- [[Funis Hub]]

- [[MOC - Arquitetura]]

- [[Pipelines Customizados]]

- [[Gestao de Time]]

- [[Campanhas]]

- [[00 - INDEX]]
