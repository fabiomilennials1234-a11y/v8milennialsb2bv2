---
name: n8n-validation-expert
description: Expert at validating n8n workflows — diagnosing errors, fixing broken executions, validating node configurations, and resolving common pitfalls. Used by agent-automation.
---

# n8n Validation Expert — Torque CRM

Especialista em diagnosticar e resolver problemas em workflows n8n. Usado pelo agent-automation para troubleshooting.

## Diagnostico de Erros Comuns

### 1. HTTP Request Failures

| Erro | Causa | Solucao |
|------|-------|---------|
| 400 Bad Request | Payload malformado | Verificar JSON body. Tags como string vs array. Campos obrigatorios ausentes |
| 401 Unauthorized | Token/key invalido | Verificar `x-webhook-key` header ou Bearer token |
| 404 Not Found | URL errada | Conferir URL do edge function. Dev vs Prod endpoint |
| 429 Too Many Requests | Rate limit | Habilitar retry com backoff exponencial |
| 500 Internal Server Error | Bug no backend | Checar logs da edge function (`supabase functions logs`) |
| ECONNREFUSED | Servico down | Verificar se edge function esta deployed |
| Timeout | Processamento lento | Aumentar timeout no node. Verificar se ha lock no banco |

### 2. Data Type Mismatches

**Problema**: n8n trata tudo como string em bodies HTTP.

```javascript
// ERRADO - tags como string
{ "tags": "Ouro" }

// CERTO - tags como array
{ "tags": ["Ouro"] }

// MAS no n8n expressions:
// {{ ["Ouro", "Premium"] }} → vira string "Ouro,Premium"

// SOLUCAO: usar Code node pra montar payload correto
// ou enviar JSON stringified: '["Ouro"]'
// A lead-webhook normaliza ambos os formatos
```

**Problema**: Numeros viram strings.

```javascript
// ERRADO
{ "rating": "5" }  // String, nao number

// CERTO - usar Code node
{ "rating": parseInt($json.rating) || 0 }
```

### 3. Webhook Processing Issues

| Problema | Diagnostico | Solucao |
|----------|-------------|---------|
| Lead nao aparece no CRM | Checar `webhook_deliveries` | Verificar status. Se `failed`, ler `error_message` |
| Lead duplicado | `update_existing_if_match` ausente | Adicionar flag `true` no payload |
| Tag nao atribuida | Tag nao existe na org | Criar tag primeiro ou verificar case (case-insensitive no lookup) |
| Lead sem pipe | `place_in_pipe` ausente ou stage errado | Verificar nome do pipe e stage |

### 4. Trello Trigger Issues

| Problema | Causa | Solucao |
|----------|-------|---------|
| Trigger nao dispara | Webhook expirado | Recriar trigger no n8n (delete + re-add) |
| Card atualizado nao detectado | Trigger so em `cardCreated` | Adicionar `cardUpdated` ao trigger |
| Dados incompletos | Card sem descricao | Adicionar fallback/default no Code node |
| Duplicatas | Trigger disparando 2x | Adicionar deduplicacao por card ID |

## Checklist de Validacao de Workflow

### Pre-deploy

- [ ] Todos os nodes tem nomes descritivos (nao "Set", "Code", "IF")
- [ ] HTTP Request nodes tem retry habilitado (3 tentativas, backoff)
- [ ] Error Trigger configurado no workflow
- [ ] Campos obrigatorios validados antes do HTTP Request
- [ ] Telefone normalizado para E.164
- [ ] `organization_id` correto para o cliente
- [ ] `assigned_user_id` valido
- [ ] Tags sao arrays, nao strings simples
- [ ] `update_existing_if_match: true` presente
- [ ] Source preenchido corretamente

### Pos-deploy

- [ ] Executar manualmente com card de teste
- [ ] Verificar lead criado no CRM
- [ ] Verificar tags atribuidas corretamente
- [ ] Verificar pipe placement correto
- [ ] Verificar assigned user correto
- [ ] Checar `webhook_deliveries` para confirmacao
- [ ] Testar com card sem descricao (edge case)
- [ ] Testar com card duplicado (deduplicacao)

## Debugando Execucoes Falhadas

### Passo a passo

1. **Abrir execucao** — n8n UI → Executions → filtrar por Failed
2. **Identificar node falhado** — node vermelho na execucao
3. **Ler erro** — clicar no node → aba Output → error message
4. **Verificar input** — aba Input do node falhado → dados que chegaram
5. **Comparar com esperado** — o input esta no formato correto?
6. **Corrigir** — ajustar node anterior ou adicionar validacao

### Logs da edge function

```bash
# Ver logs em tempo real (producao)
supabase functions logs lead-webhook --project-ref jsjsmuncfkbsbzqzqhfq

# Ver logs (development)
supabase functions logs lead-webhook --project-ref bcfadphgsibjzivtbjvc
```

## Regras

- SEMPRE ler o erro completo antes de propor fix
- SEMPRE testar com execucao manual apos correcao
- SEMPRE verificar se o problema e no n8n ou na edge function
- SEMPRE checar `webhook_deliveries` pra confirmar que o payload chegou
- NUNCA assumir que o erro e no n8n sem verificar o backend
- NUNCA desabilitar retry como "fix" pra erros
- NUNCA ignorar warnings — warnings viram erros em producao
