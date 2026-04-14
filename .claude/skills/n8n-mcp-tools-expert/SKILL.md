---
name: n8n-mcp-tools-expert
description: Expert at using n8n MCP tools for workflow management — creating, editing, listing, and debugging workflows via MCP protocol. Used by agent-automation.
---

# n8n MCP Tools Expert — Torque CRM

Especialista em gerenciar workflows n8n via ferramentas MCP (Model Context Protocol). Usado pelo agent-automation quando ha tools MCP de n8n disponiveis na sessao.

## Quando Usar

Esta skill e ativada quando ferramentas MCP do n8n estao disponiveis no contexto (ex: `mcp__n8n__*`). Se nao houver ferramentas MCP de n8n, usar a interface web do n8n ou orientar o usuario.

## Operacoes Comuns

### Listar Workflows

Usar para entender o estado atual dos workflows antes de modificar.

- Identificar workflows ativos vs inativos
- Mapear quais clientes tem workflows configurados
- Verificar naming convention (padrao: `[Cliente] Trello → V8`)

### Criar Workflow

Ao criar workflow novo:

1. **Seguir naming**: `[NomeCliente] Trello → V8`
2. **Template base**: Trello Trigger → Code (parse) → Switch (classificar) → HTTP Request (lead-webhook)
3. **Configurar retry**: 3 tentativas, backoff exponencial
4. **Error Trigger**: Sempre incluir
5. **Credenciais**: Reutilizar credenciais existentes do Trello e Supabase
6. **Ativar**: Apos teste manual com card de teste

### Editar Workflow

Ao modificar workflow existente:

1. **Desativar** antes de editar (evitar execucoes durante mudanca)
2. **Versionar** — anotar o que mudou e por que
3. **Testar** com execucao manual
4. **Reativar** apos confirmacao

### Debugar Workflow

1. **Listar execucoes** — filtrar por status (failed, success)
2. **Ler execucao falhada** — identificar node e erro
3. **Verificar input/output** de cada node na chain
4. **Corrigir** e re-executar

## Padroes de Payload

### Para lead-webhook (POST)

```json
{
  "source": "trello",
  "organization_id": "{{uuid}}",
  "fields": {
    "name": "Lead Name",
    "phone": "+5511999999999",
    "email": "lead@company.com",
    "company": "Company Name"
  },
  "tags": ["Ouro"],
  "place_in_pipe": {
    "pipe": "whatsapp",
    "stage": "novo_lead"
  },
  "assigned_user_id": "{{uuid}}",
  "update_existing_if_match": true
}
```

### Headers obrigatorios

```
Content-Type: application/json
x-webhook-key: {{WEBHOOK_KEY}}
```

## Mapeamento de Ferramentas MCP

Se as seguintes ferramentas estiverem disponiveis, use-as:

| Operacao | Ferramenta MCP esperada |
|----------|------------------------|
| Listar workflows | `workflow_list` ou `list_workflows` |
| Obter workflow | `workflow_get` ou `get_workflow` |
| Criar workflow | `workflow_create` ou `create_workflow` |
| Atualizar workflow | `workflow_update` ou `update_workflow` |
| Ativar/desativar | `workflow_activate` / `workflow_deactivate` |
| Executar | `workflow_execute` ou `execute_workflow` |
| Listar execucoes | `execution_list` ou `list_executions` |
| Obter execucao | `execution_get` ou `get_execution` |

Se os nomes exatos forem diferentes, adaptar. O padrao pode variar entre versoes do MCP server do n8n.

## Seguranca

- NUNCA expor credentials via MCP — usar referencia por ID
- NUNCA modificar workflow de producao sem backup
- NUNCA ativar workflow sem testar primeiro
- SEMPRE verificar organization_id antes de ativar
- SEMPRE confirmar com usuario antes de modificar workflows ativos

## Regras

- SEMPRE listar workflows existentes antes de criar novo (evitar duplicatas)
- SEMPRE desativar workflow antes de editar
- SEMPRE testar com execucao manual antes de ativar
- SEMPRE usar naming convention: `[Cliente] Source → V8`
- NUNCA deletar workflow sem confirmacao explicita
- NUNCA modificar credenciais compartilhadas sem avaliar impacto
