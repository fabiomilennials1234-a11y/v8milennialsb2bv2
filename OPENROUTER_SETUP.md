# Configuração OpenRouter para Agent Engine

## Visão Geral

O Agent Engine agora usa **OpenRouter** como provedor de LLM, permitindo escolher entre múltiplos modelos (Claude, GPT-4, Gemini, etc.) através de uma única API.

## Variáveis de Ambiente

Adicione as seguintes variáveis de ambiente no Supabase:

```bash
# Obrigatório
OPENROUTER_API_KEY=sk-or-v1-...  # Sua chave da API OpenRouter

# Opcional
OPENROUTER_DEFAULT_MODEL=anthropic/claude-3.5-sonnet  # Modelo padrão se não especificado no banco
OPENROUTER_REFERER_URL=https://v8millennials.com  # URL de referência (opcional)
```

## Modelos Disponíveis no OpenRouter

Você pode usar qualquer modelo suportado pelo OpenRouter. Exemplos:

### Claude (Anthropic)
- `anthropic/claude-3.5-sonnet` (recomendado)
- `anthropic/claude-3-opus`
- `anthropic/claude-3-sonnet`

### GPT (OpenAI)
- `openai/gpt-4-turbo`
- `openai/gpt-4`
- `openai/gpt-3.5-turbo`

### Gemini (Google)
- `google/gemini-pro`
- `google/gemini-pro-vision`

### Outros
- `meta-llama/llama-3-70b-instruct`
- `mistralai/mixtral-8x7b-instruct`

**Lista completa:** https://openrouter.ai/models

## Configuração por Agente

Cada agente pode ter seu próprio modelo configurado no banco de dados:

```sql
-- Atualizar modelo de um agente específico
UPDATE copilot_agents
SET llm_model = 'openai/gpt-4-turbo'
WHERE id = 'agent-id';
```

Se não especificado, usa o `OPENROUTER_DEFAULT_MODEL` ou `anthropic/claude-3.5-sonnet`.

## Como Obter API Key

1. Acesse https://openrouter.ai/
2. Crie uma conta ou faça login
3. Vá em **Keys** → **Create Key**
4. Copie a chave (formato: `sk-or-v1-...`)
5. Adicione como variável de ambiente no Supabase

## Estrutura da API

O OpenRouter usa formato compatível com OpenAI Chat Completions:

```typescript
POST https://openrouter.ai/api/v1/chat/completions
Headers:
  Authorization: Bearer sk-or-v1-...
  HTTP-Referer: https://v8millennials.com
  X-Title: V8 Millennials CRM Agent

Body:
{
  "model": "anthropic/claude-3.5-sonnet",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "tools": [...],
  "tool_choice": "auto"
}
```

## Vantagens do OpenRouter

1. **Múltiplos Modelos**: Escolha o melhor modelo para cada caso
2. **Custo Otimizado**: Compare preços entre modelos
3. **Fallback Automático**: Se um modelo falhar, pode usar outro
4. **Unified API**: Uma única integração para todos os modelos
5. **Rate Limiting**: Gerenciamento centralizado de limites

## Exemplo de Uso

```typescript
// O Agent Engine automaticamente:
// 1. Carrega o modelo do banco (llm_model)
// 2. Converte mensagens para formato OpenRouter
// 3. Converte tools para formato OpenAI
// 4. Chama OpenRouter API
// 5. Processa resposta e executa ações

// Não precisa mudar nada no código!
// Apenas configure a variável OPENROUTER_API_KEY
```

## Troubleshooting

### Erro: "OPENROUTER_API_KEY not configured"
- Verifique se a variável está configurada no Supabase
- Nome exato: `OPENROUTER_API_KEY`

### Erro: "OpenRouter API error: 401"
- Verifique se a API key está correta
- Verifique se a key não expirou

### Erro: "Model not found"
- Verifique se o nome do modelo está correto
- Use o formato: `provider/model-name`
- Consulte: https://openrouter.ai/models

### Modelo muito lento
- Tente modelos mais rápidos: `openai/gpt-3.5-turbo` ou `anthropic/claude-3-haiku`
- Verifique rate limits no OpenRouter dashboard

## Monitoramento

O OpenRouter fornece dashboard com:
- Uso de tokens por modelo
- Custos por requisição
- Rate limits
- Histórico de chamadas

Acesse: https://openrouter.ai/activity
