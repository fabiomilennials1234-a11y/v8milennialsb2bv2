# Onboarding System — Design Spec (v2 — post-grill)

**Data:** 2026-05-18
**Status:** Approved
**Autor:** Gabriel (CTO) + Claude Code
**Revisão:** Grelhada completa contra codebase. 10 decisões técnicas resolvidas.

## Sumário

Rebuild completo do onboarding. State machine em `organizations.onboarding_state`. Hard block total até completar. Master controla templates de pipeline e automação via `/master/onboarding`. Edge function `onboarding-advance` orquestra transições. Templates acessíveis só via RPC.

## Contexto

Onboarding atual: wizard 8 etapas, tabela `org_onboarding` separada, tudo pulável, zero automações criadas. Problemas: dessincronização, sem enforcement, cliente entra no sistema vazio.

## Decisões (brainstorming + grelhada)

| Decisão | Escolha | Razão |
|---------|---------|-------|
| Escopo | Rebuild completo | Wizard atual não atende |
| Enforcement | Hard block total | App inacessível até completar |
| Sequência | WhatsApp → Perfil → Pipelines → Automações | WhatsApp primeiro força compromisso |
| Templates | Master controla tudo | Padronização entre orgs |
| Admin | UI dedicada `/master/onboarding` | Padrão existente: `/master/*` |
| Orgs existentes | Só novas (migration seta completed) | Zero impacto |
| Copilot | Fora do escopo | Tratado separadamente |
| Data model | Consolidar em `organizations` (deprecar `org_onboarding`) | Sem dessincronização |
| match_criteria | Dot notation (`"perfil.sells": ["produto"]`) | Casa com JSONB aninhado do quiz |
| RLS templates | Só master + RPC SECURITY DEFINER | Templates são config de sistema |
| Atomicidade | RPC simples + edge function complexa | PL/pgSQL pra gates simples, edge fn pra pipeline/workflow creation |
| Editor automação | Import JSON + preview read-only | Sem refactor do WorkflowCanvas pro MVP |
| Pipelines | Ambos: default_pipelines_config + custom_pipelines | Compatível com código existente |
| Edge function | Uma `onboarding-advance` com action dispatch | Padrão do codebase |
| Refs org-específicas | Aceitar limitação MVP | Templates simples sem UUIDs |
| Waves | Tudo junto | Ship completo |

## Arquitetura

### State Machine

```
checkout-provision-org
  └→ organizations.onboarding_state = 'pending_whatsapp'
       └→ WhatsApp conectado → 'pending_profile'
            └→ Quiz respondido → 'pending_pipelines'
                 └→ Pipelines confirmados → 'pending_automations'
                      └→ Automações ativadas → 'completed'
                           └→ APP LIBERADO
```

Transições unidirecionais. Master pode resetar state via admin. Backend valida cada transição.

### Componentes

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND                              │
│                                                          │
│  OnboardingGate (refatorado) ── lê organizations.       │
│  │  onboarding_state (não mais org_onboarding)           │
│  ├── StepWhatsApp     (QR code, polling)                 │
│  ├── StepPerfil       (quiz 4 perguntas)                 │
│  ├── StepPipelines    (read-only, mostra resultado)      │
│  └── StepAutomacoes   (toggle + customizar mensagem)     │
│                                                          │
│  MasterOnboarding ─── /master/onboarding                 │
│  ├── Tab: Pipeline Templates (CRUD + stages + criteria)  │
│  ├── Tab: Automação Templates (import + JSON preview)    │
│  └── Tab: Preview (simulador quiz)                       │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                    BACKEND                                │
│                                                          │
│  Edge function: onboarding-advance (action dispatch)     │
│  ├── advance_whatsapp: verifica → advance state          │
│  ├── advance_profile: salva answers → advance state      │
│  ├── apply_pipelines: match→cria pipelines→advance       │
│  └── activate_automations: cria workflows→advance→done   │
│                                                          │
│  RPC: advance_onboarding_state() — helper interno        │
│  RPC: get_matched_onboarding_templates() — onboarding    │
│  RPC: get_onboarding_pipeline_templates() — admin CRUD   │
│  RPC: get_onboarding_automation_templates() — admin CRUD │
│                                                          │
│  checkout-provision-org (alterado):                       │
│    Seta onboarding_state = 'pending_whatsapp'            │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Data Model

### Alteração: organizations

```sql
-- Novas colunas
ALTER TABLE organizations ADD COLUMN
  onboarding_state text NOT NULL DEFAULT 'completed'
    CHECK (onboarding_state IN (
      'pending_whatsapp',
      'pending_profile',
      'pending_pipelines',
      'pending_automations',
      'completed'
    ));

ALTER TABLE organizations ADD COLUMN
  onboarding_completed_at timestamptz;

ALTER TABLE organizations ADD COLUMN
  onboarding_answers jsonb;
```

**IMPORTANTE:** Default = 'completed' na coluna. Migration NÃO precisa UPDATE em orgs existentes — elas já nascem completed. `checkout-provision-org` seta explicitamente 'pending_whatsapp' pra novas orgs.

### Deprecação: org_onboarding

Tabela `org_onboarding` mantida temporariamente (não dropar). Trigger `auto_create_org_onboarding` desativado. Hook `useOnboarding()` refatorado pra ler de `organizations`.

### Nova tabela: onboarding_pipeline_templates

```sql
CREATE TABLE onboarding_pipeline_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  icon text,
  color text,
  default_pipelines_config jsonb NOT NULL DEFAULT '{}',
  -- { "pipe_whatsapp": {"visible": true, "label": "Oportunidades"},
  --   "pipe_confirmacao": {"visible": false},
  --   "pipe_propostas": {"visible": true, "label": "Propostas"} }
  custom_pipelines jsonb NOT NULL DEFAULT '[]',
  -- [{ "name": "Qualificação SDR", "icon": "Users", "color": "#7dc4e4",
  --    "stages": [{"name":"Novo","color":"#7dc4e4","position":0,"is_final_positive":false,"is_final_negative":false}] }]
  match_criteria jsonb NOT NULL,
  -- Dot notation: {"perfil.sells": ["produto","servico"], "estrutura.has_sdr": [true]}
  -- Semântica: AND entre campos, OR dentro do array
  priority int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- SEM organization_id — tabela global
-- RLS: DENY ALL pra authenticated. Acesso via RPC apenas.
ALTER TABLE onboarding_pipeline_templates ENABLE ROW LEVEL SECURITY;

-- Master pode tudo (ghost master policy)
CREATE POLICY "master_pipeline_templates_all"
  ON onboarding_pipeline_templates FOR ALL
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());
```

### Nova tabela: onboarding_automation_templates

```sql
CREATE TABLE onboarding_automation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL,
  -- 'boas_vindas' | 'follow_up' | 'confirmacao_reuniao'
  icon text,
  workflow_definition jsonb NOT NULL,
  -- DAG completo (nodes + edges) formato WorkflowCanvas
  trigger_type text NOT NULL,
  trigger_config jsonb DEFAULT '{}',
  customizable_fields jsonb NOT NULL DEFAULT '[]',
  -- [{ "field_path": "nodes.action_1.data.message",
  --    "label": "Mensagem de boas-vindas",
  --    "type": "textarea",
  --    "default_value": "Olá {{nome}}!...",
  --    "placeholder": "Digite a mensagem..." }]
  match_criteria jsonb,
  -- NULL = universal (aparece pra todo quiz result)
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE onboarding_automation_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_automation_templates_all"
  ON onboarding_automation_templates FOR ALL
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());
```

### RPC: advance_onboarding_state (helper interno)

```sql
CREATE OR REPLACE FUNCTION advance_onboarding_state(
  p_org_id uuid,
  p_expected_state text,
  p_next_state text DEFAULT NULL,
  p_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_state text;
  v_next text;
  v_valid_transitions jsonb := '{
    "pending_whatsapp": "pending_profile",
    "pending_profile": "pending_pipelines",
    "pending_pipelines": "pending_automations",
    "pending_automations": "completed"
  }'::jsonb;
BEGIN
  SELECT onboarding_state INTO v_current_state
  FROM organizations WHERE id = p_org_id FOR UPDATE;

  IF v_current_state IS NULL THEN
    RAISE EXCEPTION 'Organization not found: %', p_org_id;
  END IF;

  IF v_current_state != p_expected_state THEN
    RAISE EXCEPTION 'State mismatch: expected %, got %', p_expected_state, v_current_state;
  END IF;

  v_next := COALESCE(p_next_state, v_valid_transitions ->> v_current_state);
  IF v_next IS NULL THEN
    RAISE EXCEPTION 'No valid transition from: %', v_current_state;
  END IF;

  -- Save quiz answers if provided during profile step
  IF v_current_state = 'pending_profile' AND p_payload IS NOT NULL THEN
    UPDATE organizations SET onboarding_answers = p_payload WHERE id = p_org_id;
  END IF;

  -- Mark completion
  IF v_next = 'completed' THEN
    UPDATE organizations SET onboarding_completed_at = now() WHERE id = p_org_id;
  END IF;

  UPDATE organizations SET onboarding_state = v_next, updated_at = now()
  WHERE id = p_org_id;

  RETURN jsonb_build_object('previous_state', v_current_state, 'new_state', v_next);
END;
$$;
```

### RPC: get_matched_onboarding_templates

```sql
-- Retorna templates que matcham com onboarding_answers da org
-- Chamado durante onboarding, via SECURITY DEFINER (cliente não precisa SELECT na tabela)
CREATE OR REPLACE FUNCTION get_matched_onboarding_templates(
  p_org_id uuid,
  p_template_type text  -- 'pipeline' | 'automation'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER;
-- Lógica: busca onboarding_answers da org, cruza com match_criteria usando dot notation
-- Retorna templates ordenados por priority DESC
```

## Edge Function: onboarding-advance

```
POST /onboarding-advance
Headers: Authorization: Bearer <jwt>
Body: { action: string, org_id?: string, payload?: object }
```

**Actions:**

### advance_whatsapp
- Verifica que org tem whatsapp_instance com status = 'connected'
- Chama `advance_onboarding_state(org_id, 'pending_whatsapp')`

### advance_profile
- Payload: `{ answers: OnboardingAnswers }`
- Chama `advance_onboarding_state(org_id, 'pending_profile', null, answers)`

### apply_pipelines
- Busca matched pipeline templates via `get_matched_onboarding_templates`
- Cria `pipeline_display_config` entries pra defaults
- Cria `custom_pipelines` + `custom_pipeline_stages` pra customs
- Chama `advance_onboarding_state(org_id, 'pending_pipelines')`
- Retorna pipelines criados pro frontend mostrar

### get_automation_templates
- Busca matched automation templates via `get_matched_onboarding_templates`
- Retorna com customizable_fields e default_values
- NÃO avança state — só retorna dados pro frontend

### activate_automations
- Payload: `{ selections: [{ template_id, enabled, customizations: {field_path: value} }] }`
- Valida pelo menos 1 enabled
- Pra cada enabled: clona workflow_definition, aplica customizations nos field_paths, cria workflow real na org
- Chama `advance_onboarding_state(org_id, 'pending_automations')`

## UI — Fluxo do Cliente

### Estrutura geral

- Fullscreen, sem sidebar, sem navegação
- Progress bar 4 segmentos: WhatsApp · Perfil · Pipelines · Automações
- `OnboardingGate` lê `organizations.onboarding_state`
- Master bypassa gate (comportamento existente mantido)
- Non-admin member vê "Configuração em andamento" (comportamento existente mantido)

### Gate 1: Conectar WhatsApp

- Input: nome da instância
- QR code centralizado (200x200, fundo branco)
- Polling status a cada 4s
- QR expira 60s → refresh
- Auto-avança quando connected (chama `onboarding-advance?action=advance_whatsapp`)
- Sem botão pular

### Gate 2: Perfil da Operação (Quiz)

- Uma pergunta por vez, cards selecionáveis
- 4 perguntas:
  1. Tipo de venda: Consultiva B2B / WhatsApp direto / Híbrido
  2. Segmento: Indústria / Distribuição / Serviços / SaaS / Agência / Outro
  3. Estrutura time: Solo / Time sem SDR / Time com SDR+Closer
  4. Processo: Usa reuniões? / Envia propostas formais?
- No submit: chama `onboarding-advance?action=advance_profile`

### Gate 3: Pipelines Aplicados

- OnboardingGate detecta state=pending_pipelines
- Chama `onboarding-advance?action=apply_pipelines` (cria pipelines + avança)
- Mostra resultado read-only: default pipelines ativos + custom pipelines criados
- Botão "Confirmar e continuar" (state já avançou, botão navega pro próximo step)

### Gate 4: Ativação de Automações

- Busca templates via `onboarding-advance?action=get_automation_templates`
- Lista com toggle + textarea customizável
- Mínimo 1 ativa
- Submit: `onboarding-advance?action=activate_automations`
- App liberado

## UI — Admin (Master)

### Rota: /master/onboarding

Componente `MasterOnboarding.tsx`. 3 tabs.

### Tab 1: Pipeline Templates

- CRUD list: nome, cor, stages badges, match_criteria, prioridade, ativo/inativo
- Editor (dialog/drawer):
  - Nome, descrição, ícone (lucide picker), cor (palette)
  - Default pipelines config: toggles pra pipe_whatsapp/confirmacao/propostas + label customizável
  - Custom pipelines: list de pipelines, cada um com stages draggable
  - Match criteria: builder visual (dot notation path + operator + values)
  - Prioridade (number)

### Tab 2: Automação Templates

- CRUD list: ícone, nome, type, trigger, node count, campos editáveis count
- Actions: "Importar de org" + "Criar do zero"
- **Importar de org** (dialog):
  - Dropdown: lista todas orgs (master tem acesso cross-org)
  - Lista workflows da org selecionada (query via ghost master policy)
  - Importa como cópia: salva workflow_definition no template
  - Nota: master deve limpar referências org-específicas manualmente
- **Editor** (page ou dialog):
  - Metadados: nome, tipo, ícone, trigger_type, trigger_config, match_criteria
  - JSON preview: mostra workflow_definition formatado
  - Campos editáveis: form pra definir field_path + label + type + default + placeholder
  - NÃO usa WorkflowCanvas visual (MVP — import JSON + preview read-only)

### Tab 3: Preview

- Simulador: master responde quiz de teste
- Mostra: quais pipeline templates matcham + quais automação templates matcham
- Testa match_criteria sem criar org real

## Migração

### organizations (novas colunas)

```sql
-- Default = 'completed' — orgs existentes ficam completed automaticamente
ALTER TABLE organizations ADD COLUMN
  onboarding_state text NOT NULL DEFAULT 'completed' ...;
```

### org_onboarding (deprecação)

- Não dropar tabela (pode ter dados úteis)
- Desativar trigger `auto_create_org_onboarding`
- `useOnboarding()` refatorado pra ler `organizations.onboarding_state`

### checkout-provision-org (alteração)

- Após criar org: `UPDATE organizations SET onboarding_state = 'pending_whatsapp' WHERE id = new_org_id`

## Segurança

- State machine no backend: frontend não pode pular steps
- Edge function `onboarding-advance` valida state antes de cada ação
- Templates: RLS deny-all + master-only policy. Onboarding via RPC SECURITY DEFINER
- `advance_onboarding_state` usa FOR UPDATE (row lock)
- Master bypass em OnboardingGate mantido
- Orgs existentes: default='completed' na migration

## Escopo fora

- Copilot (agentes IA)
- Edição de pipeline pelo cliente
- Onboarding para orgs existentes
- Templates de tags/produtos/equipe
- Notificações/emails durante onboarding
- WorkflowCanvas visual pra edição de templates (MVP = JSON preview)
- Sanitização de referências org-específicas em workflow importados

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| WhatsApp não conecta | Link suporte. Master resetar state. |
| Nenhum template faz match | Template "default" com priority 0 que sempre matcha |
| Workflow template inválido | Validação JSON no save |
| Browser fecha mid-onboarding | State persiste. Retoma no login. |
| org_onboarding legado causa confusão | Desativar trigger, doc no CLAUDE.md |
| Edge fn falha após criar pipelines mas antes de avançar state | Edge fn faz advance como última ação. Se falha antes, pipelines criados mas state não avançou — retry é safe (idempotent check) |
