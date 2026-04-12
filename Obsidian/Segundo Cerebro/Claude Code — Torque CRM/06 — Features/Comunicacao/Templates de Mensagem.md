---
tags:
  - claude-code
  - feature
  - torque-crm
  - comunicacao
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Templates de Mensagem

## O que faz

Templates reutilizaveis com variaveis dinamicas ({nome}, {empresa}, {email}, {atendente}) e slash commands (/saudacao, /follow-up). Preview ao vivo com dados de exemplo durante edicao.

## Regras de negocio

- Command unico por org (unique constraint no banco)
- Formato do command: `^[a-z0-9][a-z0-9-]*$` (enforced no DB)
- Variaveis resolvidas em runtime com dados do lead
- Campos custom via pattern `{campo:slug}` (ex: `{campo:cnpj}`)
- Variaveis sem valor no lead resolvem para string vazia
- Patterns nao reconhecidos sao removidos do texto final

## Como o usuario usa

1. Menu Configuracoes → Templates de Mensagem
2. Clica "Criar template"
3. Define: comando (ex: saudacao), nome de exibicao, corpo com variaveis
4. Ve preview ao vivo com dados ficticios
5. Salva template
6. No chat, digita `/saudacao` → template inserido com variaveis substituidas pelos dados reais do lead

## Edge cases

- Commands duplicados dao erro de unique constraint (tratado no frontend com mensagem amigavel)
- Preview usa `PREVIEW_LEAD` e `PREVIEW_ATTENDANT` com dados ficticios
- Template sem variaveis funciona como texto estatico

---

## Como funciona (tecnico)

### Componentes

- `src/pages/MessageTemplates.tsx` — CRUD completo com grid, busca, modais de criacao/edicao com insercao de variavel e preview ao vivo

### Hooks

- `src/hooks/useMessageTemplates.ts`:
  - `useMessageTemplates()` — queryKey: `["message-templates", orgId]`, ordena por command
  - `useCreateMessageTemplate()` — Valida regex, lowercase command, trata unique constraint error
  - `useUpdateMessageTemplate()` — Atualiza command, display_name, body
  - `useDeleteMessageTemplate()` — Remove por id

### Edge Functions

Nenhuma — CRUD direto via Supabase client com RLS.

### Tabelas

- `message_templates` — id, organization_id, command (unique per org), display_name, body, created_by, updated_at, created_at

### Bibliotecas

- `src/lib/template-variables.ts`:
  - `TEMPLATE_VARIABLES[]` — Lista de variaveis disponiveis com nome e descricao
  - `resolveVariables(body, lead, attendant)` — Substitui `{var}` por dados reais
  - `PREVIEW_LEAD` / `PREVIEW_ATTENDANT` — Dados ficticios para preview na UI

### Fluxo de dados

```
Admin cria template
  → INSERT message_templates (command validado)
    → Usuario digita /comando no chat
      → Frontend busca template pelo command
        → resolveVariables(body, leadData, attendantData)
          → Texto final inserido no campo de mensagem
```

---

## Historico de mudancas

## Links relacionados

- [[Chat WhatsApp]]
- [[Campanhas]]
- [[Regras de Pipe]]
