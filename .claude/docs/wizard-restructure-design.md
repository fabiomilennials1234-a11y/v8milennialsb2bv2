# Design: Reestruturação do Wizard de Criação de Copilot

**Data:** 2026-03-04
**Status:** Aprovado para implementação

---

## Problema

O wizard atual tem ~15 steps com:
- Redundâncias (skills + allowedTopics + forbiddenTopics = 3 steps para a mesma coisa)
- Campos abstratos que não impactam o resultado (dropdowns de personalidade)
- Steps que coletam dados que não fazem diferença real no comportamento do agente
- Interface confusa — difícil saber o que cada campo faz
- Resultado: copilots genéricos mesmo quando preenchidos completamente

## Solução

Reestruturar o wizard para **~10 steps** (7 core + 2-3 template-específicos):
- Campos mais livres e descritivos
- Menos redundância
- Melhor orientação contextual
- Cada campo impacta diretamente o prompt e comportamento do agente

---

## Novo Fluxo de Steps

### Step 1: Nome + Template (SEM MUDANÇA)
- Seleção de template (SDR, Qualificador, Prospectador, Follow-up, Agendador)
- Nome do agente
- **Componente:** `TemplateStep` + `NameStep` (mantidos)

### Step 2: Contexto do Negócio (MELHORIAS VISUAIS)
- Mantém os 12 campos estruturados atuais
- Melhorar placeholders com exemplos reais
- Agrupar em seções visuais: Empresa / Produto-Serviço / Comercial
- Botão "Gerar com IA" permanece
- Botão "Importar de outro copilot" permanece
- **Componente:** `BusinessContextStep` (ajustes visuais)

### Step 3: Persona e Tom de Voz (NOVO — substitui 3 steps)
**Substitui:** `personality` + `conversationStyle` + `availability`

**UI:**
- Textarea principal: "Descreva como o agente deve se comportar e se comunicar"
- Dica contextual expandível com orientações (apresentação, tom, emojis, horário, etc.)
- Seção colapsável "Configurações técnicas":
  - Toggle: "Esconder identidade de IA" (hideAiIdentity)
  - Delay de resposta (segundos)
  - Horário de atendimento (modo scheduled)

**Campos removidos:** `personality.tone`, `personality.style`, `personality.energy` (dropdowns)
**Novo campo:** `personaDescription` (textarea livre)
**Campos mantidos:** `hideAiIdentity`, `responseDelaySeconds`, `availability`

### Step 4: Objetivo e Instruções (FUSÃO — substitui 2 steps)
**Substitui:** `objectiveComposite` + `customInstructions`

**UI:** 4 textareas na mesma tela:
1. **Missão**: "Qual é a missão principal deste agente?"
2. **O que DEVE fazer**: "Liste comportamentos e ações que o agente deve seguir"
3. **O que NÃO deve fazer**: "Liste restrições e comportamentos proibidos"
4. **Critérios de sucesso**: "Quando o agente fez um bom trabalho?"

**Mapping para banco:**
- Missão → `objective_composite.mission`
- Deve fazer → `custom_instructions` (seção dos)
- Não deve fazer → `custom_instructions` (seção donts) + `objective_composite.limits`
- Critérios de sucesso → `objective_composite.success_criteria`

### Step 5: Regras e Limites (FUSÃO — substitui 4 steps)
**Substitui:** `skills` + `allowedTopics` + `forbiddenTopics` + `capabilities`

**UI:** 2 seções:
1. **Habilidades e tópicos** (textarea livre):
   "O que o agente sabe fazer e sobre quais assuntos pode conversar?"
2. **Permissões do agente** (toggles — mantidos):
   - Pode qualificar leads
   - Pode agendar reuniões
   - Pode mover cards no kanban
   - Pode transferir para humano
   - Pode criar leads
   - Máximo de turnos antes de transferir

**Novo campo:** `skillsAndTopics` (textarea livre, substitui arrays skills/allowedTopics/forbiddenTopics)
**Campos mantidos:** todos os `can_*` booleans + `maxConversationTurns`

### Step 6: Base de Conhecimento (SIMPLIFICADO)
- Upload de documentos (RAG) — mantém como está
- **REMOVE FAQs manuais** como step separado
- Documentos existentes visíveis no modo edição (fix já aplicado)
- **Componente:** `KnowledgeBaseStep` (já corrigido)

### Step 7: Exemplos de Conversa (MELHORIA)
- Pares lead/agente — mantém como está
- **Adicionar:** Botão "Gerar exemplos com IA" baseado no contexto + persona
- **Componente:** `ExamplesStep` (com novo botão)

### Steps Template-Específicos (+N)

#### Kanban Rules (REFATORADO)
- **Antes:** Mostrava apenas funil de qualificação com regras pré-populadas
- **Depois:**
  1. Listar funis disponíveis no CRM do usuário
  2. Usuário seleciona em quais funis o agente atua
  3. Para cada funil selecionado, configurar regras por etapa
- **Componente:** `KanbanRulesStep` (reescrita significativa)

#### Demais (MANTIDOS):
- `OutboundConfigStep` — config de mensagens outbound + áudios (SDR, Prospectador)
- `AutomationActionsStep` — ações ao qualificar/desqualificar (SDR, Qualificador, Prospectador)
- `FollowupRulesStep` — regras de follow-up (Follow-up)
- `OperationModeStep` — modo inbound/outbound/hybrid (SDR, Prospectador)
- `ActivationTriggersStep` — triggers de ativação (SDR, Prospectador)
- `TestConversationStep` — teste do agente (todos)

---

## Steps Removidos

| Step | Motivo |
|------|--------|
| `PersonalityStep` | Substituído por campo livre em "Persona e Tom de Voz" |
| `ConversationStyleStep` | Absorvido em "Persona e Tom de Voz" |
| `AvailabilityStep` | Absorvido em "Persona e Tom de Voz" (seção técnica) |
| `SkillsStep` | Absorvido em "Regras e Limites" (campo livre) |
| `AllowedTopicsStep` | Absorvido em "Regras e Limites" (campo livre) |
| `ForbiddenTopicsStep` | Absorvido em "Regras e Limites" (campo livre) |
| `FaqStep` | Removido — RAG (Knowledge Base) substitui FAQs manuais |
| `QualificationStep` | Absorvido em "Objetivo e Instruções" |
| `ObjectiveCompositeStep` | Fundido em "Objetivo e Instruções" |
| `CustomInstructionsStep` | Fundido em "Objetivo e Instruções" |
| `AgentCapabilitiesStep` | Absorvido em "Regras e Limites" (toggles) |

---

## Decision Log

| # | Decisão | Alternativas | Motivo |
|---|---------|-------------|--------|
| 1 | Abordagem A (steps reduzidos) | B (conversacional), C (single page) | Mantém guia passo-a-passo mas reduz complexidade |
| 2 | Campo livre para personalidade | Dropdowns, personas pré-definidas, colar mensagens | Mais expressivo, gera prompts melhores |
| 3 | Fundir objetivo + instruções | Manter separados, só objetivo | Elimina redundância dos/donts vs limites |
| 4 | Manter critérios de sucesso | Absorver na missão | Importante para o agente saber quando fez bom trabalho |
| 5 | Unificar skills/topics em campo livre | Manter separados, remover | Elimina 3 steps redundantes |
| 6 | Remover FAQs manuais | Unificar com KB, manter separados | RAG funciona melhor que pares estáticos |
| 7 | Absorver conversation style na persona | Step separado, remover campos | Tom de voz inclui como fala (emojis, comprimento, etc.) |
| 8 | Kanban Rules multi-funil | Só qualificação, funis por template | Usuário escolhe funis reais do CRM |
| 9 | Manter contexto do negócio estruturado | Campo livre, menos campos | Dados factuais funcionam melhor estruturados |
| 10 | Adicionar "Gerar exemplos com IA" | Manter manual apenas | Ajuda quem não sabe por onde começar |

---

## Impacto no Banco de Dados

### Novos campos:
- `persona_description` (TEXT) — substitui personality_tone/style/energy
- `skills_and_topics` (TEXT) — substitui skills[]/allowed_topics[]/forbidden_topics[]

### Campos mantidos (backward-compatible):
- Todos os campos antigos continuam existindo no banco
- Novos campos são adicionais — não remove nada
- Prompt generation prioriza novos campos quando disponíveis, fallback para antigos

### Migração:
- Agentes existentes continuam funcionando com os campos antigos
- Ao editar um agente antigo, os dados antigos são mostrados nos novos steps
- Ao salvar, os novos campos são populados

---

## Impacto no Prompt Generation

O `generatePrompt()` precisa ser atualizado para:

1. **Camada 1 (Identidade):** Usar `persona_description` em vez de tone/style/energy
2. **Camada 2 (Conhecimento):** Usar `skills_and_topics` em vez de arrays separados
3. **Camada 4 (Custom):** Usar o novo formato unificado de objetivo+instruções

Fallback: se `persona_description` estiver vazio, usar os campos antigos (backward-compatible).

---

## Ordem de Implementação Sugerida

1. **Criar novos step components** (PersonaTomStep, ObjectiveInstructionsStep, RulesLimitsStep)
2. **Atualizar wizard configs** dos 5 templates com nova sequência de steps
3. **Atualizar step registry** com novos componentes
4. **Adicionar novos campos** no schema Zod + tipos TypeScript
5. **Atualizar prompt generation** para usar novos campos
6. **Refatorar Kanban Rules** para multi-funil
7. **Adicionar "Gerar exemplos com IA"** no ExamplesStep
8. **Migração de dados** — converter agentes existentes ao editar
9. **Testes** — verificar que agentes novos e antigos funcionam
