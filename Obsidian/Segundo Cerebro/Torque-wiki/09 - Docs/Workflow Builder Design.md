---
tags:
  - torque-crm
  - docs
  - reference
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/workflow-builder-design.md
---

# Visual Workflow Builder - Design Document

> Data: 2026-03-10
> Status: Aprovado

---

## 1. Visão Geral

Editor visual de workflows de automação (estilo n8n/Kommo) que **substitui** as dispatch rules e follow-up automations existentes. O sistema Copilot (agentes IA) permanece independente.

### Objetivos
- Interface visual drag-and-drop para criar automaçoes complexas
- Execução síncrona por evento com suporte a delays e loops
- Migração automática das automaçoes existentes
- Acessível por todos os membros da organização

### Non-Goals (v1)
- Não substitui o sistema Copilot
- Não inclui sub-workflows (v2)
- Não inclui replay visual de execuçoes

---

## 2. Modelo de Dados

### Tabela `workflows`

| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | Tenant |
| name | text | Nome do workflow |
| description | text | Descrição opcional |
| is_active | boolean | Ativo/inativo |
| trigger_type | text | lead_created, stage_changed, tag_added, score_reached, cron |
| trigger_config | jsonb | Config do trigger (estágio, tag, valor score, expressão cron) |
| definition | jsonb | `{ nodes: [], edges: [] }` - JSON nativo do React Flow |
| loop_limit | int | Teto global de iteraçoes de loop (default: 100) |
| created_by | uuid FK | Quem criou |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Tabela `workflow_executions`

| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid PK | |
| workflow_id | uuid FK | |
| organization_id | uuid FK | |
| lead_id | uuid FK | Lead que disparou |
| status | text | running, paused, completed, failed, loop_limit_reached |
| current_node_id | text | Nó atual (para resume após delay) |
| loop_counters | jsonb | `{ "node_id": count }` |
| context | jsonb | Dados acumulados durante execução |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| error | text | Mensagem de erro se falhou |

### Tabela `workflow_execution_steps`

| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid PK | |
| execution_id | uuid FK | |
| node_id | text | ID do nó no JSON |
| node_type | text | trigger, action, condition, delay, end, copilot |
| node_label | text | Nome legível do nó |
| status | text | success, failed, skipped |
| input_data | jsonb | Dados de entrada do nó |
| output_data | jsonb | Resultado da execução |
| error | text | Erro se falhou |
| executed_at | timestamptz | |

### RLS
- Todas as tabelas com policy `organization_id = auth.jwt() -> organization_id`

---

## 3. Arquitetura do Frontend

### Estrutura de Arquivos

```
src/
├── pages/
│   ├── Automacoes.tsx                # Lista de workflows
│   └── AutomacoesEditor.tsx          # Editor visual (React Flow)
├── components/
│   └── automacoes/
│       ├── WorkflowList.tsx           # Lista com status, última execução, total
│       ├── WorkflowToolbar.tsx        # Nome, salvar, ativar/desativar, voltar
│       ├── WorkflowSidebar.tsx        # Painel lateral direito (config do nó)
│       ├── WorkflowCanvas.tsx         # React Flow + minimap + controles
│       ├── nodes/
│       │   ├── TriggerNode.tsx        # Nó azul - evento inicial
│       │   ├── ActionNode.tsx         # Nó verde - açoes
│       │   ├── ConditionNode.tsx      # Nó amarelo - if/else (2 saídas)
│       │   ├── DelayNode.tsx          # Nó roxo - esperar X tempo
│       │   ├── CopilotNode.tsx        # Nó cyan - handoff para agente
│       │   └── EndNode.tsx            # Nó cinza - fim do fluxo
│       ├── sidebar-panels/
│       │   ├── TriggerPanel.tsx       # Config do trigger
│       │   ├── ActionPanel.tsx        # Config da ação
│       │   ├── ConditionPanel.tsx     # Config da condição
│       │   ├── DelayPanel.tsx         # Config do delay
│       │   └── CopilotPanel.tsx       # Seleção do agente
│       └── edges/
│           └── AnimatedEdge.tsx       # Edge com animação
├── hooks/
│   ├── useWorkflows.ts               # CRUD (React Query)
│   ├── useWorkflowExecution.ts       # Consulta execuçoes e steps
│   └── useWorkflowMigration.ts       # Migração dispatch rules → workflows
├── types/
│   └── workflow.ts                   # Types completos
```

### Rotas

```
/automacoes          → Lista de workflows
/automacoes/novo     → Editor com workflow vazio
/automacoes/:id      → Editor com workflow existente
```

### Navegação
- Item próprio "Automaçoes" no sidebar principal

### Fluxo de Interação
1. `/automacoes` → lista com cards/tabela (nome, status ativo/inativo, última execução, total execuçoes)
2. "Novo workflow" → `/automacoes/novo` com canvas vazio + nó Trigger inicial
3. Arrastar/clicar para adicionar nós ao canvas
4. Clicar num nó → painel lateral direito com formulário de configuração
5. Conectar nós arrastando entre handles → edges animados
6. Toolbar superior: editar nome, salvar, ativar/desativar, voltar

---

## 4. Design Visual

### Anatomia dos Nós
- Bordas arredondadas (`rounded-xl`)
- Sombra suave (`shadow-md`)
- Borda esquerda colorida por tipo (4px)
- Largura fixa: ~280px
- Handle de entrada no topo, saída(s) embaixo

### Cores por Tipo

| Tipo | Cor borda | BG light | BG dark | Ícone Lucide |
|---|---|---|---|---|
| Trigger | blue-500 | blue-50 | blue-950 | Zap |
| Ação | green-500 | green-50 | green-950 | Play (varia por subtipo) |
| Condição | yellow-500 | yellow-50 | yellow-950 | GitBranch |
| Delay | purple-500 | purple-50 | purple-950 | Clock |
| Copilot | cyan-500 | cyan-50 | cyan-950 | Bot |
| End | gray-400 | gray-50 | gray-900 | CircleStop |

### Ícones por Subtipo de Ação

| Ação | Ícone |
|---|---|
| Enviar WhatsApp | MessageSquare |
| Mover estágio | ArrowRightLeft |
| Adicionar tag | Tag |
| Remover tag | Tag |
| Criar follow-up | CalendarPlus |

### Condição - Duas Saídas
- Handle esquerdo inferior: "Sim" (label verde)
- Handle direito inferior: "Não" (label vermelho)

### Canvas
- Background: grid pontilhado (`BackgroundVariant.Dots`)
- Minimap no canto inferior direito
- Controles de zoom (React Flow Controls)
- Edges animados (`animated: true`) com estilo `smoothstep`
- Tema claro/escuro seguindo `next-themes`

---

## 5. Arquitetura do Backend

### Edge Functions

#### `execute-workflow`
- Input: `{ workflow_id, lead_id, trigger_data }`
- Fluxo:
  1. Carrega workflow (definition JSON)
  2. Cria `workflow_executions` com status `running`
  3. Percorre o grafo a partir do nó Trigger
  4. Para cada nó: executa ação, registra em `workflow_execution_steps`
  5. **Condição**: avalia expressão, segue handle "sim" ou "não"
  6. **Loop**: incrementa `loop_counters[node_id]`, para se ultrapassar limite
  7. **Delay**: salva estado (current_node_id, context), status `paused`, cria agendamento pg_cron
  8. **Copilot**: handoff para agente, status `completed`
  9. **End**: status `completed`

#### `resume-workflow`
- Chamada pelo pg_cron após delay expirar
- Input: `{ execution_id }`
- Retoma a partir do `current_node_id`
- Continua execução normal

### Disparadores de Trigger

| Trigger Type | Mecanismo |
|---|---|
| lead_created | DB trigger na tabela `leads` |
| stage_changed | DB trigger em `pipe_confirmacao`, `pipe_propostas`, `pipe_whatsapp` |
| tag_added | DB trigger na tabela `lead_tags` |
| score_reached | DB trigger em `lead_scores` |
| cron | Entrada no pg_cron |

### Implementação das Açoes

| Ação | Implementação |
|---|---|
| Enviar WhatsApp | Chama `evolution-api-proxy` com texto/template renderizado |
| Mover estágio | UPDATE na tabela do pipe correspondente |
| Adicionar tag | INSERT em `lead_tags` |
| Remover tag | DELETE em `lead_tags` |
| Criar follow-up | INSERT em `follow_up_automations` |
| Copilot handoff | Marca lead como "em atendimento" pelo agente selecionado |

---

## 6. Triggers & Condiçoes

### Triggers Disponíveis

| Trigger | Config |
|---|---|
| Lead criado | Filtros opcionais: origin, pipe |
| Lead mudou de estágio | Pipe + estágio de origem e/ou destino |
| Tag adicionada | Qual tag |
| Score atingiu valor | Valor mínimo |
| Agendamento (cron) | Expressão cron |

### Condiçoes - Operadores

Acesso a qualquer dado: campos do lead, custom fields, conversa WhatsApp, dados do pipe.

| Operador | Descrição |
|---|---|
| equals | Igual a |
| not_equals | Diferente de |
| contains | Contém texto |
| not_contains | Não contém |
| greater_than | Maior que |
| less_than | Menor que |
| is_empty | Está vazio |
| is_not_empty | Não está vazio |
| has_tag | Lead tem tag X |
| not_has_tag | Lead não tem tag X |
| in_stage | Lead está no estágio X |

### Mensagens - Variáveis Disponíveis

Templates e texto livre suportam variáveis:
- `{{nome}}` - nome do lead
- `{{empresa}}` - empresa
- `{{email}}` - email
- `{{telefone}}` - telefone
- `{{estagio}}` - estágio atual
- `{{sdr}}` - nome do SDR atribuído
- `{{closer}}` - nome do Closer atribuído
- `{{custom.campo}}` - campos customizados

---

## 7. Loops

### Comportamento
- Um loop ocorre quando uma edge conecta um nó a um nó anterior no grafo
- O sistema detecta loops verificando se o `node_id` destino já existe em `loop_counters`
- A cada passagem, incrementa o contador

### Limites
- **Por nó**: configurável pelo usuário na edge de loop (campo "máximo de repetiçoes")
- **Global**: teto de segurança no campo `workflows.loop_limit` (default: 100)
- Ao atingir o limite: execução recebe status `loop_limit_reached`, registra no step log

---

## 8. Migração Automática

### Dispatch Rules → Workflows

Cada `pipe_dispatch_rule` + `pipe_dispatch_rule_steps` → 1 workflow:

| Step Type | Nó(s) Gerado(s) |
|---|---|
| send_template | Ação (Enviar WhatsApp) + Delay (se delay_minutes > 0) |
| wait_response | Delay (timeout) + Condição (respondeu?) |
| change_stage | Ação (Mover estágio) |
| assign_sdr | Ação (Atribuir SDR) |
| cancel_sequence | End |

Mesmo processo para `campanha_dispatch_rules`.

### Follow-up Rules → Workflows

Cada follow-up rule → 1 workflow com loop:

```
Trigger → Delay → Condição (filtros) → Ação → Loop (max_followups vezes)
```

### Edge Function `migrate-workflows`
- Chamada uma vez por organização
- Cria workflows como **inativos**
- Retorna relatório (migrados, falhas, ajustes manuais)
- Usuário revisa no editor visual, ajusta e ativa

### Pós-Migração
- Banner nas telas antigas indicando migração
- Remoção das telas e tabelas em migration futura

---

## 9. Decision Log

| # | Decisão | Alternativas | Motivo |
|---|---|---|---|
| 1 | Substitui dispatch rules e follow-ups, NÃO o Copilot | Complementar, englobar tudo | Copilot é sistema independente |
| 2 | Migração automática | Big bang, coexistência, ignorar | Preserva trabalho dos usuários |
| 3 | Execução síncrona + delays via pg_cron | Fila, híbrido | Simplicidade e previsibilidade |
| 4 | Copilot faz handoff (encerra workflow) | Gerar texto, gerar e enviar | Copilot assume conversa |
| 5 | Item "Automaçoes" próprio no sidebar | Config, substituir follow-ups | Visibilidade justifica |
| 6 | Loops v1, sub-workflows v2 | Ambos v1/v2, nenhum | Loops cobrem casos comuns |
| 7 | Loop: limite configurável + teto global | Fixo, só configurável, tempo | Flexibilidade + proteção |
| 8 | Todos da org podem gerenciar | Só admins, por role | Democratiza automação |
| 9 | Histórico por nó (sem replay visual) | Básico, replay | Equilíbrio utilidade/complexidade |
| 10 | Templates + texto livre com variáveis | Só um tipo | Máxima flexibilidade |
| 11 | Condiçoes avaliam qualquer dado | Conjunto fixo | Flexibilidade para cenários complexos |
| 12 | JSON único + engine síncrona | Nós como registros + fila | Simples, JSON nativo React Flow |
| 13 | Workflows inativos na migração | Ativos automaticamente | Permite revisão antes de ativar |

---

## 10. Plano de Implementação

### Fase 1 - Fundação
1. Instalar `@xyflow/react`
2. Criar tipos TypeScript (`src/types/workflow.ts`)
3. Criar migration Supabase (3 tabelas + RLS)
4. Criar hook `useWorkflows.ts` (CRUD com React Query)

### Fase 2 - Editor Visual (Frontend)
5. Criar página `Automacoes.tsx` (lista de workflows)
6. Criar página `AutomacoesEditor.tsx` (canvas React Flow)
7. Implementar `WorkflowCanvas.tsx` (React Flow + minimap + controles + background)
8. Implementar `WorkflowToolbar.tsx` (nome, salvar, ativar, voltar)
9. Implementar nós customizados (Trigger, Action, Condition, Delay, Copilot, End)
10. Implementar `AnimatedEdge.tsx`
11. Implementar `WorkflowSidebar.tsx` (painel lateral + router de painéis)
12. Implementar painéis de configuração (Trigger, Action, Condition, Delay, Copilot)
13. Adicionar rota no `App.tsx` e item no sidebar

### Fase 3 - Backend (Execução)
14. Criar Edge Function `execute-workflow`
15. Criar Edge Function `resume-workflow`
16. Criar database triggers para cada trigger type
17. Implementar açoes (WhatsApp, mover estágio, tags, follow-up, copilot handoff)
18. Implementar lógica de condiçoes (operadores + acesso a dados)
19. Implementar controle de loops (contadores + limites)
20. Criar hook `useWorkflowExecution.ts` (consulta execuçoes)

### Fase 4 - Migração
21. Criar Edge Function `migrate-workflows`
22. Implementar conversão dispatch rules → workflows
23. Implementar conversão follow-up rules → workflows
24. Adicionar banner de deprecação nas telas antigas
25. Criar hook `useWorkflowMigration.ts`

### Fase 5 - Polish
26. Testes end-to-end dos workflows
27. Otimização de performance (lazy loading dos painéis)
28. Validação do workflow antes de salvar (grafo conectado, trigger obrigatório, etc.)
29. Empty states e onboarding no editor


## Links relacionados

- [[Visao Geral]]

- [[Regras de Pipe]]

- [[Metas]]

- [[Onboarding]]

- [[n8n Orquestracao]]

- [[Permissoes Sistema]]

- [[Follow-ups]]

- [[Campanhas]]

- [[Workflow Builder]]

- [[Lead Score]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
