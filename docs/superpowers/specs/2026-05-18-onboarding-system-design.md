# Onboarding System — Design Spec

**Data:** 2026-05-18
**Status:** Draft
**Autor:** Gabriel (CTO) + Claude Code

## Sumário

Rebuild completo do onboarding. Sistema de gates obrigatórios com state machine no backend. Master controla templates de pipeline e automação via Admin UI dedicada. Cliente só customiza texto de mensagens. App 100% bloqueado até completar onboarding.

## Contexto

Onboarding atual: wizard 8 etapas com quiz → sugestões de pipeline → WhatsApp → primeiro lead. Problemas: tudo pulável, zero automações ativadas, nenhum workflow criado, cliente entra no sistema vazio. Nenhuma padronização entre orgs.

## Decisões

| Decisão | Escolha | Alternativas descartadas |
|---------|---------|--------------------------|
| Escopo | Rebuild completo | Evoluir wizard / Híbrido |
| Enforcement | Hard block total | Block gradual / Nag persistente |
| Sequência | WhatsApp → Perfil → Pipelines → Automações | Perfil primeiro |
| Templates | Master controla tudo | Quiz decide / Cliente ajusta |
| Admin | UI dedicada completa | Seed via migration / UI simples |
| Orgs existentes | Só novas | Todas obrigatórias / Opt-in |
| Copilot | Fora do escopo | Obrigatório / Opcional |
| Editor automação | Workflow canvas existente (React Flow) | Cards simplificados |

## Arquitetura

### State Machine

```
checkout-provision-org
  └→ onboarding_state = 'pending_whatsapp'
       └→ WhatsApp conectado → 'pending_profile'
            └→ Quiz respondido → 'pending_pipelines'
                 └→ Pipelines confirmados → 'pending_automations'
                      └→ Automações ativadas → 'completed'
                           └→ APP LIBERADO
```

Transições unidirecionais. Só master pode resetar state via admin. Backend valida cada transição — impossível burlar pelo frontend.

### Componentes

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND                              │
│                                                          │
│  OnboardingGate ─── renderiza step baseado em state      │
│  ├── StepWhatsApp     (QR code, polling status)          │
│  ├── StepPerfil       (quiz 4 perguntas)                 │
│  ├── StepPipelines    (read-only, mostra resultado)      │
│  └── StepAutomacoes   (toggle + customizar mensagem)     │
│                                                          │
│  AdminOnboarding ─── /admin/onboarding (master only)     │
│  ├── Tab: Pipeline Templates (CRUD + stages editor)      │
│  ├── Tab: Automação Templates (workflow canvas)          │
│  └── Tab: Preview (simulador quiz)                       │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                    BACKEND                                │
│                                                          │
│  RPC: advance_onboarding_state()                         │
│    - Valida transição (current → next)                   │
│    - pending_profile → pending_pipelines:                │
│      cruza onboarding_answers × match_criteria           │
│      → cria custom_pipelines + stages                    │
│    - pending_automations → completed:                    │
│      cria workflows reais a partir dos templates         │
│      com textos customizados pelo cliente                │
│                                                          │
│  checkout-provision-org (alterado):                       │
│    - Seta onboarding_state = 'pending_whatsapp'          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Data Model

### Alteração: organizations

```sql
ALTER TABLE organizations ADD COLUMN
  onboarding_state text NOT NULL DEFAULT 'pending_whatsapp'
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
  -- Respostas do quiz, usado para match com templates
```

Orgs existentes: migration seta `onboarding_state = 'completed'` e `onboarding_completed_at = now()` para todas as orgs que já existem.

### Nova tabela: onboarding_pipeline_templates

```sql
CREATE TABLE onboarding_pipeline_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  icon text,                    -- lucide icon name
  color text,                   -- hex color
  stages jsonb NOT NULL,        -- [{name, color, position, is_final_positive, is_final_negative}]
  match_criteria jsonb NOT NULL,-- regras de match com quiz: {venda_tipo: ["whatsapp_direto"], segment: ["industria"]}
  priority int DEFAULT 0,       -- desempate quando múltiplos templates fazem match
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
-- Sem organization_id — templates são globais (master-only)
-- RLS: SELECT para authenticated, INSERT/UPDATE/DELETE apenas master
```

### Nova tabela: onboarding_automation_templates

```sql
CREATE TABLE onboarding_automation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL,              -- 'boas_vindas' | 'follow_up' | 'confirmacao_reuniao'
  icon text,                       -- emoji ou lucide icon
  workflow_definition jsonb NOT NULL, -- DAG completo (nodes + edges) no formato do WorkflowCanvas
  trigger_type text NOT NULL,      -- 'lead_created' | 'lead_no_reply' | 'meeting_confirmed'
  trigger_config jsonb DEFAULT '{}',
  customizable_fields jsonb NOT NULL DEFAULT '[]',
  -- [{field_path: "nodes.action_1.data.message", label: "Mensagem de boas-vindas", type: "textarea", default_value: "...", placeholder: "..."}]
  match_criteria jsonb,            -- NULL = universal, ou filtro por quiz answers
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
-- Sem organization_id — templates são globais (master-only)
-- RLS: SELECT para authenticated, INSERT/UPDATE/DELETE apenas master
```

### RPC: advance_onboarding_state

```sql
CREATE OR REPLACE FUNCTION advance_onboarding_state(
  p_org_id uuid,
  p_expected_state text,
  p_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_state text;
  v_next_state text;
  v_result jsonb;
BEGIN
  -- Lock row
  SELECT onboarding_state INTO v_current_state
  FROM organizations WHERE id = p_org_id FOR UPDATE;

  -- Validate current state matches expected
  IF v_current_state != p_expected_state THEN
    RAISE EXCEPTION 'State mismatch: expected %, got %', p_expected_state, v_current_state;
  END IF;

  -- Determine next state
  v_next_state := CASE v_current_state
    WHEN 'pending_whatsapp' THEN 'pending_profile'
    WHEN 'pending_profile' THEN 'pending_pipelines'
    WHEN 'pending_pipelines' THEN 'pending_automations'
    WHEN 'pending_automations' THEN 'completed'
    ELSE RAISE EXCEPTION 'Cannot advance from state: %', v_current_state
  END;

  -- State-specific logic
  CASE v_current_state
    WHEN 'pending_profile' THEN
      -- Save quiz answers
      UPDATE organizations SET onboarding_answers = p_payload WHERE id = p_org_id;

    WHEN 'pending_pipelines' THEN
      -- Pipelines already created by separate RPC call during this step
      NULL;

    WHEN 'pending_automations' THEN
      -- Mark completion timestamp
      UPDATE organizations SET onboarding_completed_at = now() WHERE id = p_org_id;
  END CASE;

  -- Advance state
  UPDATE organizations SET onboarding_state = v_next_state, updated_at = now()
  WHERE id = p_org_id;

  RETURN jsonb_build_object('new_state', v_next_state);
END;
$$;
```

### RPC: apply_onboarding_pipelines

```sql
-- Chamado durante transição pending_profile → pending_pipelines
-- Cruza onboarding_answers com match_criteria dos templates
-- Cria custom_pipelines + custom_pipeline_stages para a org
CREATE OR REPLACE FUNCTION apply_onboarding_pipelines(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER;
```

### RPC: apply_onboarding_automations

```sql
-- Chamado durante transição pending_automations → completed
-- Recebe: array de {template_id, customized_fields: {field_path: value}}
-- Cria workflows reais na org com textos customizados
CREATE OR REPLACE FUNCTION apply_onboarding_automations(
  p_org_id uuid,
  p_selections jsonb  -- [{template_id, enabled: bool, customizations: {field_path: value}}]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER;
```

## UI — Fluxo do Cliente

### Estrutura geral

- Fullscreen, sem sidebar, sem navegação
- Progress bar no topo: 4 segmentos coloridos
- Labels: WhatsApp · Perfil · Pipelines · Automações
- Dark theme, estilo Linear/Stripe
- `OnboardingGate` wrappa toda app — se `onboarding_state !== 'completed'`, renderiza step correspondente

### Gate 1: Conectar WhatsApp

- Input: nome da instância (ex: "principal", "vendas")
- QR code centralizado (200x200, fundo branco)
- Polling status a cada 4 segundos
- QR expira em 60s → botão refresh
- Auto-avança quando status = connected
- Sem botão pular. Sem navegação alternativa.
- Fallback: erro persistente → link para suporte

### Gate 2: Perfil da Operação (Quiz)

- Uma pergunta por vez, formato de cards selecionáveis
- Indicador "Pergunta X de 4"
- 4 perguntas:
  1. **Tipo de venda**: Consultiva B2B / WhatsApp direto / Híbrido
  2. **Segmento**: Indústria / Distribuição / Serviços / SaaS / Agência / Outro
  3. **Estrutura do time**: Solo / Time sem SDR / Time com SDR+Closer
  4. **Processo**: Usa reuniões? / Envia propostas formais?
- Respostas salvas em `organizations.onboarding_answers` como JSONB
- Transição animada entre perguntas

### Gate 3: Pipelines Aplicados

- Título: "Seus pipelines estão prontos"
- Subtítulo: "Baseado no seu perfil, configuramos os pipelines ideais"
- Read-only: mostra pipelines criados com seus stages como badges coloridos
- Stages mostram setas entre eles (→)
- Stages finais positivos (verde ✓) e negativos (vermelho ✗) diferenciados
- Único botão: "Confirmar e continuar"
- Backend já criou pipelines via `apply_onboarding_pipelines()` durante transição anterior

### Gate 4: Ativação de Automações

- Título: "Ative suas automações"
- Subtítulo: "Personalize as mensagens e ative"
- Lista de automações disponíveis (matched por quiz ou universal)
- Cada automação:
  - Ícone + nome + descrição
  - Toggle ativar/desativar
  - Quando ativado: expande textarea com mensagem default (editável)
  - Suporta variáveis: `{{nome}}`, `{{empresa}}`, etc.
- Requisito: pelo menos 1 automação ativa para prosseguir
- Botão: "Finalizar configuração"
- Nota: "Você pode editar depois nas configurações"

## UI — Admin (Master)

### Localização: /admin/onboarding

Acessível apenas por master. 3 tabs.

### Tab 1: Pipeline Templates

- Header: "Pipeline Templates" + botão "+ Novo Template"
- Lista de cards com:
  - Nome + cor + badge ATIVO/INATIVO
  - Stages como badges inline
  - Match criteria como código inline
  - Prioridade
  - Ações: Editar / Remover
- **Editor** (drawer ou página):
  - Nome, descrição, ícone, cor
  - Stages: lista draggable (nome, cor, posição, flags final +/-)
  - "+ Adicionar etapa"
  - Match criteria: builder visual (campo + operador + valor)
  - "+ Adicionar condição (AND)"
  - Prioridade (número)

### Tab 2: Automação Templates

- Header: "Automação Templates" + botões "Importar de org" + "+ Criar do zero"
- Lista de cards com:
  - Ícone + nome + trigger + contagem de nodes + campos editáveis
  - Badge ATIVO/INATIVO
  - Ação: "Abrir editor"
- **Editor**: WorkflowCanvas existente (React Flow) com overlay de templates:
  - Toolbar adicional: "Marcar campos editáveis" + "Salvar template"
  - Modo "marcar campos": click em node → popup pra definir campo editável (label, tipo, JSON path, default, placeholder)
  - Nodes com campo editável: borda roxa + badge ✎
  - Legenda na bottom bar
- **Importar de org** (modal):
  - Step 1: dropdown seleciona organização
  - Step 2: lista workflows ativos da org selecionada (radio select)
  - Botão "Importar como template"
  - Aviso: "Cópia independente — alterações não afetam org original"

### Tab 3: Preview

- Simulador do quiz: master responde perguntas de teste
- Mostra resultado: quais pipeline templates matcharam + quais automações seriam oferecidas
- Útil para testar match_criteria sem criar org real

## Fluxo de Dados

### Provisão → Onboarding

```
1. checkout-provision-org cria org
2. org.onboarding_state = 'pending_whatsapp'
3. Frontend: OnboardingGate detecta state, renderiza StepWhatsApp
```

### WhatsApp → Profile

```
1. Cliente escaneia QR, WhatsApp conecta
2. Frontend chama advance_onboarding_state('pending_whatsapp')
3. State → 'pending_profile'
4. OnboardingGate renderiza StepPerfil (quiz)
```

### Profile → Pipelines

```
1. Cliente responde 4 perguntas
2. Frontend chama advance_onboarding_state('pending_profile', {answers})
3. Backend salva answers em onboarding_answers
4. State → 'pending_pipelines'
5. Frontend chama apply_onboarding_pipelines(org_id)
6. Backend: cruza answers × match_criteria → cria custom_pipelines + stages
7. OnboardingGate renderiza StepPipelines (read-only)
```

### Pipelines → Automações

```
1. Cliente confirma pipelines
2. Frontend chama advance_onboarding_state('pending_pipelines')
3. State → 'pending_automations'
4. Frontend busca automation templates (matched por answers ou universal)
5. OnboardingGate renderiza StepAutomacoes
```

### Automações → Completed

```
1. Cliente customiza mensagens + ativa automações
2. Frontend chama apply_onboarding_automations(org_id, selections)
3. Backend cria workflows reais com textos customizados + is_active=true
4. Frontend chama advance_onboarding_state('pending_automations')
5. State → 'completed', onboarding_completed_at = now()
6. OnboardingGate libera app
```

## Segurança

- State machine no backend: frontend não pode pular steps
- RPC `advance_onboarding_state` é SECURITY DEFINER com validação de transição
- Templates são globais (sem org_id) — RLS: SELECT para todos, write apenas master
- `apply_onboarding_pipelines` e `apply_onboarding_automations` validam que org está no state correto antes de agir
- Orgs existentes: migration seta `completed` — zero impacto
- OnboardingGate no frontend é UX convenience — enforcement real é no backend

## Migração

### Orgs existentes (~30)

```sql
UPDATE organizations
SET onboarding_state = 'completed',
    onboarding_completed_at = now()
WHERE onboarding_state IS NULL OR onboarding_state != 'completed';
```

### Wizard antigo

- `OnboardingWizard.tsx` e steps existentes: mantém temporariamente, mas `OnboardingGate` assume controle
- Deprecar wizard antigo após validação do novo fluxo em produção
- `useOnboarding()` hook: refatorar para ler `onboarding_state` ao invés de estado local

## Escopo explicitamente fora

- Copilot (agentes IA) — será tratado separadamente
- Edição de pipeline pelo cliente durante onboarding (read-only)
- Onboarding para orgs existentes (só novas)
- Templates de tags, produtos ou equipe
- Notificações/emails durante onboarding

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Cliente não consegue conectar WhatsApp (celular com problema) | Link suporte no step. Master pode resetar state via admin. |
| Nenhum pipeline template faz match com respostas do quiz | Fallback: template "default" com prioridade mais baixa que sempre matcha |
| Workflow template inválido causa erro ao criar workflow | Validação do workflow definition no save do template |
| Cliente fecha browser no meio do onboarding | State machine persiste. Retoma de onde parou no próximo login. |

## Métricas de sucesso

- 100% das novas orgs completam onboarding (vs ~40% hoje que completam wizard)
- Tempo médio de onboarding < 10 minutos
- 0 orgs com WhatsApp desconectado na primeira semana
- Todas novas orgs com pelo menos 1 automação ativa desde dia 1
