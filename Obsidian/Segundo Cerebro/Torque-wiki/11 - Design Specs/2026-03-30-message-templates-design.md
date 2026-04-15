---
tags:
  - torque-crm
  - docs
  - design
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/specs/2026-03-30-message-templates-design.md
---

# Message Templates with Slash Commands - Design Spec

## Goal

Criar uma feature de mensagens template com comandos `/` no chat WhatsApp, eliminando a necessidade de copiar/colar scripts de documentos externos. Qualquer membro da org pode criar, editar e usar templates.

## Overview

Três partes: (1) página de gestão de templates acessível pela sidebar, (2) autocomplete de `/` no input do chat WhatsApp, (3) resolução de variáveis dinâmicas com dados do lead ativo.

---

## Data Model

### Tabela: `message_templates`

| Campo | Tipo | Constraints |
|-------|------|-------------|
| `id` | UUID PK | DEFAULT gen_random_uuid() |
| `organization_id` | UUID FK → organizations | NOT NULL |
| `command` | TEXT | NOT NULL, CHECK lowercase + hifens + números only |
| `display_name` | TEXT | NOT NULL |
| `body` | TEXT | NOT NULL |
| `created_by` | UUID FK → auth.users | NOT NULL |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

**Constraints:**
- UNIQUE on `(organization_id, command)`
- CHECK on `command`: `command ~ '^[a-z0-9][a-z0-9-]*$'` (lowercase, números, hifens, não começa com hífen)
- O campo `command` é armazenado sem o prefixo `/`

**RLS:**
- SELECT: membros da org (via team_members)
- INSERT/UPDATE/DELETE: membros da org (qualquer membro pode criar/editar/deletar)
- Masters: acesso total

**Indexes:**
- `(organization_id, command)` - unique, usado no autocomplete
- `(organization_id)` - listagem

---

## Template Variables

### Variáveis disponíveis

| Variável | Fonte | Descrição |
|----------|-------|-----------|
| `{nome}` | `leads.name` | Nome do lead |
| `{empresa}` | `leads.company` | Empresa do lead |
| `{email}` | `leads.email` | Email do lead |
| `{telefone}` | `leads.phone` | Telefone do lead |
| `{origem}` | `leads.source` | Origem do lead |
| `{interesse}` | `leads.interest` | Campo de interesse |
| `{segmento}` | `leads.segment` | Segmento do lead |
| `{campanha}` | `leads.campaign_name` | Nome da campanha |
| `{atendente}` | `team_members.name` | Nome do atendente logado |
| `{campo:slug}` | `lead_custom_fields` | Campo custom por slug (ex: `{campo:cnpj}`) |

### Resolução

- Variáveis são resolvidas no frontend no momento da seleção do template
- O contexto é: lead da conversa ativa + team_member logado
- Se uma variável não tem valor, é substituída por string vazia (nunca envia `{nome}` literal)
- Mesma sintaxe `{var}` já usada no OutboundConfigStep do Copilot

---

## UI: Página de Gestão (`/templates`)

### Localização
- Nova aba na sidebar, entre Automaçoes e Copilot
- Rota: `/templates`
- Protegida por ProtectedRoute + LayoutWrapper (inclui subscription guard)
- Controlada por feature flag `message_templates`

### Layout
- Header com título "Templates" + botão "Novo Template"
- Campo de busca que filtra por comando e nome
- Grid/lista de cards, cada um mostrando:
  - Comando com prefixo `/` (ex: `/saudacao`)
  - Nome de exibição
  - Preview do body (truncado em 2 linhas)
  - Criado por (nome do membro) + data
  - Botoes de editar e deletar

### Modal de criação/edição
- Campo "Comando": input prefixado com `/`, validação em tempo real (lowercase, hifens, números), verifica unicidade
- Campo "Nome": texto livre
- Campo "Mensagem": textarea com counter de caracteres
- Badges clicáveis de variáveis abaixo do textarea (mesmo padrão do OutboundConfigStep) - clicar insere a variável na posição do cursor
- Preview ao vivo: mostra a mensagem com variáveis resolvidas usando dados fictícios ("João", "Empresa XYZ", etc.)
- Botoes: Cancelar / Salvar

---

## UI: Autocomplete no Chat

### Trigger
- O autocomplete aparece quando o atendente digita `/` como primeiro caractere no input de mensagem do WhatsAppChat
- Se o input já tem texto antes do `/`, não ativa (é uma mensagem normal)

### Dropdown (SlashCommandPopover)
- Flutuante, posicionado acima do input do chat
- Lista de templates filtrada em tempo real conforme o usuário digita após `/`
- Cada item mostra: `/comando` em bold + nome + preview do body (1 linha, truncado)
- Máximo ~8 itens visíveis, scroll se houver mais
- Navegação por teclado: setas cima/baixo + Enter para selecionar
- Esc fecha o dropdown
- Se não houver match para o texto digitado, dropdown some

### Seleção
- Ao selecionar (click ou Enter), o conteúdo do input é substituído pelo body do template com variáveis resolvidas
- O atendente pode revisar/editar o texto antes de enviar (não envia automaticamente)
- A mensagem é enviada pelo mesmo fluxo existente (`useSendWhatsAppMessage`)

### Dados
- Templates são carregados via `useMessageTemplates` hook com cache de 5 minutos
- Filtragem é client-side (lista completa em memória, filtro por startsWith no comando)

---

## Feature Flag

- Key: `message_templates`
- Adicionada à tabela `feature_flags`
- Habilitada nos planos Torque 2.0 e V8, desabilitada no Torque 1.0
- Sidebar item aparece/esconde conforme o plano da org

---

## Arquitetura de Componentes

### Arquivos novos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `supabase/migrations/XXXX_message_templates.sql` | Tabela, RLS, indexes, feature flag |
| `src/hooks/useMessageTemplates.ts` | CRUD hook: list, create, update, delete |
| `src/pages/MessageTemplates.tsx` | Página de gestão (lista + modal) |
| `src/components/chat/SlashCommandPopover.tsx` | Dropdown autocomplete no chat |
| `src/lib/template-variables.ts` | Função pura `resolveVariables(body, lead, teamMember)` |

### Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `src/components/chat/WhatsAppChat.tsx` | Detectar `/` no input, renderizar SlashCommandPopover, substituir texto |
| `src/App.tsx` | Rota `/templates` |
| `src/components/layout/` (sidebar) | Novo item "Templates" |
| `src/lib/feature-registry.ts` | Feature key `message_templates` |

### O que NÃO muda
- Nenhuma edge function
- Nenhuma mudança no Copilot/agentes
- O envio usa o mesmo `useSendWhatsAppMessage()` existente

---

## Escopo explicitamente fora

- Não há categorias/pastas para templates (lista flat com busca)
- Não há templates pessoais vs compartilhados (tudo é da org)
- Não há suporte a mídia nos templates (só texto)
- Não há analytics de uso de templates
- Não há importação/exportação de templates


## Links relacionados

- [[MOC - Arquitetura]]

- [[Chat WhatsApp]]

- [[Gestao de Time]]

- [[Templates de Mensagem]]

- [[Permissoes Sistema]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
