---
name: n8n-code-javascript
description: Reference for writing JavaScript Code nodes in n8n — syntax, expressions, built-in variables, data manipulation, and common pitfalls. Used by agent-automation.
---

# n8n Code Nodes — JavaScript Reference

Guia de referencia para escrever Code nodes em JavaScript dentro de workflows n8n no Torque CRM.

## Contexto de Execucao

Code nodes no n8n rodam em uma sandbox JavaScript. Nao e Node.js completo — tem restricoes.

### Variaveis Disponiveis

| Variavel | Descricao |
|----------|-----------|
| `$input.all()` | Todos os items de entrada |
| `$input.first()` | Primeiro item |
| `$input.last()` | Ultimo item |
| `$json` | Dados JSON do item atual (em Run Once for Each Item mode) |
| `$node["nome"]` | Acessar output de um node especifico |
| `$env` | Variaveis de ambiente |
| `$execution.id` | ID da execucao atual |
| `$workflow.id` | ID do workflow |
| `$now` | DateTime atual (Luxon) |
| `$today` | Inicio do dia atual (Luxon) |

### Modos de Execucao

**Run Once for All Items** (padrao):
```javascript
// Recebe array, retorna array
const items = $input.all();
const results = [];

for (const item of items) {
  results.push({
    json: {
      ...item.json,
      processed: true,
      processedAt: $now.toISO()
    }
  });
}

return results;
```

**Run Once for Each Item:**
```javascript
// Recebe um item, retorna um item
return {
  json: {
    ...$json,
    processed: true
  }
};
```

## Patterns Comuns no Torque CRM

### Parsear description do Trello

```javascript
const items = $input.all();
const results = [];

for (const item of items) {
  const desc = item.json.desc || '';
  const name = item.json.name || '';
  
  // Extrair telefone
  const phoneMatch = desc.match(/(?:tel|fone|whats|cel)[:\s]*(\+?\d[\d\s()\-]{8,})/i);
  let phone = phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';
  
  // Normalizar BR
  if (phone.length === 11) phone = '55' + phone;
  if (phone.length === 13 && phone.startsWith('55')) phone = '+' + phone;
  
  // Extrair empresa
  const companyMatch = desc.match(/(?:empresa|company|razao)[:\s]*(.+?)(?:\n|$)/i);
  
  // Extrair faturamento
  const revenueMatch = desc.match(/(?:faturamento|receita)[:\s]*R?\$?\s*([\d.,]+)/i);
  const revenue = revenueMatch 
    ? parseFloat(revenueMatch[1].replace(/\./g, '').replace(',', '.')) 
    : 0;
  
  // Classificar tag
  let tag = 'Latao';
  if (revenue >= 10000000) tag = 'Diamante';
  else if (revenue >= 2000000) tag = 'Ouro';
  else if (revenue >= 500000) tag = 'Prata';
  
  results.push({
    json: {
      name: name,
      phone: phone,
      company: companyMatch ? companyMatch[1].trim() : '',
      revenue: revenue,
      tag: tag
    }
  });
}

return results;
```

### Montar payload para lead-webhook

```javascript
const items = $input.all();
const results = [];

for (const item of items) {
  const d = item.json;
  
  results.push({
    json: {
      source: 'trello',
      organization_id: $env.ORGANIZATION_ID,
      fields: {
        name: d.name || '',
        phone: d.phone || '',
        email: d.email || '',
        company: d.company || ''
      },
      tags: [d.tag],
      place_in_pipe: {
        pipe: 'whatsapp',
        stage: 'novo_lead'
      },
      assigned_user_id: $env.ASSIGNED_USER_ID,
      update_existing_if_match: true
    }
  });
}

return results;
```

### Validar campos obrigatorios

```javascript
const items = $input.all();
const valid = [];
const invalid = [];

for (const item of items) {
  const { name, phone } = item.json;
  
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    invalid.push({
      json: { ...item.json, _error: 'telefone invalido ou ausente' }
    });
  } else if (!name || name.trim().length < 2) {
    invalid.push({
      json: { ...item.json, _error: 'nome ausente' }
    });
  } else {
    valid.push(item);
  }
}

// Output 0: validos, Output 1: invalidos
return [valid, invalid];
```

## Gotchas

- **Strings sempre**: Valores de campos n8n sao strings. `$json.amount` e `"1000"`, nao `1000`. Sempre converter com `parseInt()` ou `parseFloat()`
- **Arrays como string**: Para enviar arrays no body HTTP, use `JSON.stringify(["tag1", "tag2"])` ou a edge function precisa normalizar
- **Sem require/import**: Code nodes nao suportam `require()` ou `import`. Bibliotecas externas nao estao disponiveis
- **Sem async/await**: A maioria dos Code nodes roda sincrono. Para HTTP requests, use o node HTTP Request separado
- **Luxon para datas**: Use `$now`, `$today` (Luxon DateTime). Nao use `new Date()` — timezone inconsistente
- **Error handling**: Use try/catch dentro do loop. Um item falhando nao deve derrubar o batch inteiro

## Regras

- SEMPRE validar campos antes de processar
- SEMPRE normalizar telefone antes de enviar
- SEMPRE retornar array de objetos com `{ json: {...} }`
- SEMPRE tratar item invalido separadamente (output split)
- NUNCA usar `new Date()` — use Luxon (`$now`)
- NUNCA assumir tipo de dado — sempre converter explicitamente
- NUNCA silenciar erros com try/catch vazio
