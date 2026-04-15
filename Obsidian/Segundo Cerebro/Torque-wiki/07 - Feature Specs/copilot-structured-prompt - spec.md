---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/copilot-structured-prompt/spec.md
---

# Copilot Structured Prompt

## Problema

Hoje o prompt do Copilot no Playground é um **bloco único de texto** (`PlaygroundData.prompt`). O usuário escreve tudo em um campo só - personalidade, objetivo, fluxo, instruçoes, tudo junto. Ferramentas são referenciadas via `@mentions` que se transformam em `[usar ferramenta "X"]`, sem contexto de QUANDO e COMO usar cada uma.

Isso gera:
- Prompts desorganizados e inconsistentes
- Ferramentas mencionadas sem instrução clara de uso
- Templates que funcionam como blocos monolíticos difíceis de ajustar
- Dificuldade de o usuário entender o que está configurando

## Solução

Reestruturar o prompt do Playground em **seçoes organizadas**, cada uma com escrita livre, e dar a cada ferramenta uma **seção descritiva dedicada** com instruçoes de quando/como usar.

## Requisitos

### REQ-01: Seçoes do Prompt

O prompt passa a ter 4 seçoes estruturadas, cada uma com escrita livre (textarea):

| Seção | Campo | Propósito |
|-------|-------|-----------|
| **Personalidade** | `personality` | Quem é o copilot - nome, persona, tom de voz, como age, como se apresenta |
| **Objetivo** | `objective` | Missão principal, critério de sucesso, limites |
| **Fluxo** | `flow` | Fluxo de atendimento/conversa - etapas, como conduzir, quando avançar |
| **Instruçoes** | `instructions` | Do's e Don'ts - regras rígidas, o que fazer e o que nunca fazer |

- Cada seção é um textarea independente com placeholder descritivo
- O usuário pode deixar seçoes vazias - só as preenchidas entram no prompt final
- A ordem no prompt gerado é fixa: Personalidade → Objetivo → Fluxo → Ferramentas → Instruçoes

### REQ-02: Instruçoes de Ferramentas no Prompt

Cada ferramenta ativada ganha uma **seção descritiva** no prompt final, entre Fluxo e Instruçoes:

```
# FERRAMENTAS DISPONÍVEIS

## Qualificar Lead
[texto livre do usuário descrevendo quando e como usar esta ferramenta]

## Agendar Reunião
[texto livre do usuário descrevendo quando e como usar esta ferramenta]
```

- Quando o usuário ativa uma tool no painel Tools, um campo de texto aparece: **"Instrução de uso"**
- Esse campo permite descrever em linguagem natural QUANDO e COMO o copilot deve usar a ferramenta
- Se o campo estiver vazio, usa uma instrução default baseada na `description` da tool
- O `@mention` continua funcionando dentro dos textareas das seçoes (para referências inline)

### REQ-03: Dados Persistidos

O `PlaygroundData` muda de:
```ts
prompt: string  // bloco único
```

Para:
```ts
promptSections: {
  personality: string;
  objective: string;
  flow: string;
  instructions: string;
}
```

E cada tool ganha um campo `instruction`:
```ts
tools: Record<string, {
  enabled: boolean;
  config: Record<string, any>;
  instruction: string;  // NOVO: instrução livre de quando/como usar
}>
```

### REQ-04: Prompt Assembly (buildSystemPrompt)

A função `buildSystemPrompt()` no `CopilotPlayground.tsx` monta o prompt final assim:

```
# PERSONALIDADE
{personality - com @mentions resolvidas}

# OBJETIVO
{objective - com @mentions resolvidas}

# FLUXO DE ATENDIMENTO
{flow - com @mentions resolvidas}

# FERRAMENTAS DISPONÍVEIS
## {Tool Name}
{instruction do usuário OU description default}
(para cada tool ativada)

# INSTRUÇÕES
{instructions - com @mentions resolvidas}

## Links disponíveis para enviar ao lead:
{links, se houver}
```

### REQ-05: Template Presets Atualizados

Cada template preset passa a preencher as 4 seçoes + instruçoes de tools:

```ts
data: {
  promptSections: {
    personality: "Voce e um SDR da TechCorp...",
    objective: "Prospectar ativamente e agendar reunioes...",
    flow: "1. Apresentacao + proposta de valor\n2. Identificacao de dor...",
    instructions: "- Faca UMA pergunta por mensagem\n- Nunca pressione..."
  },
  tools: {
    QUALIFICAR_LEAD: {
      enabled: true,
      config: {},
      instruction: "Use quando coletar informacoes de qualificacao do lead..."
    }
  }
}
```

### REQ-06: Compatibilidade com Agent Engine

O `system_prompt` salvo no banco continua sendo um bloco de texto (string). A montagem em seçoes é responsabilidade do Playground (frontend). O `buildSystemPrompt()` gera o texto final que é salvo como `custom_instructions` / `system_prompt`.

O agent-engine.ts no backend **não muda** - ele continua recebendo o prompt montado como string e adicionando contexto dinâmico (lead data, kanban rules, etc).

### REQ-07: Retrocompatibilidade (Edit Mode)

Ao editar um agente criado com o formato antigo (campo `prompt` único):
- Se `promptSections` não existe, coloca o `prompt` inteiro no campo `instructions` (o mais genérico)
- Os outros campos começam vazios
- Permite ao usuário redistribuir o texto nas seçoes corretas

### REQ-08: UI/UX do Editor

- Layout: seçoes empilhadas verticalmente com labels claros e placeholders descritivos
- Cada seção tem: label com ícone + textarea expansível
- Seçoes colapsáveis para economizar espaço vertical
- O botão @ e autocomplete continuam funcionando dentro de cada textarea
- A toolbar "System Prompt" vira header com nome "Prompt do Agente"
- Contador de caracteres total (soma de todas as seçoes + tool instructions)

## Fora de Escopo

- Mudanças no `useCopilotPromptBuilder.ts` (prompt builder das 4 camadas do Wizard v2/v3)
- Mudanças no `agent-engine.ts` (backend)
- Mudanças na tabela `copilot_agents` (schema DB)
- Migração automática de agentes existentes

## Arquivos Impactados

| Arquivo | Mudança |
|---------|---------|
| `src/components/copilot/playground/types.ts` | Novo tipo `PromptSections`, update `PlaygroundData`, update `PlaygroundToolState` |
| `src/components/copilot/playground/CopilotPlayground.tsx` | Novo `buildSystemPrompt()`, update payload assembly, update edit load |
| `src/components/copilot/playground/PromptEditor.tsx` | Rewrite: de textarea único para seçoes estruturadas |
| `src/components/copilot/playground/template-presets.ts` | Update presets para novo formato |
| `src/components/copilot/playground/PlaygroundTools.tsx` | Adicionar campo `instruction` por tool |


## Links relacionados

- [[MOC - Arquitetura]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
