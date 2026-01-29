# Configuração do Supabase

## Status da Conexão

✅ **Supabase está configurado e conectado!**

O projeto já possui:
- Cliente Supabase configurado em `src/integrations/supabase/client.ts`
- Edge Functions configuradas em `supabase/config.toml`
- Migrations no diretório `supabase/migrations/`

## Variáveis de Ambiente Necessárias

### Frontend (`.env`)

Crie ou atualize o arquivo `.env` na raiz do projeto com:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua-publishable-key-aqui
VITE_SUPABASE_PROJECT_ID=seu-project-id-aqui
```

**Como obter essas credenciais:**
1. Acesse https://supabase.com
2. Faça login no seu projeto
3. Vá em **Settings** → **API**
4. Copie:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon/public key** → `VITE_SUPABASE_PUBLISHABLE_KEY`
   - **Project ID** → `VITE_SUPABASE_PROJECT_ID`

### Backend (Edge Functions)

As Edge Functions usam variáveis de ambiente do Supabase. Configure no dashboard:

1. Acesse **Settings** → **Edge Functions** → **Secrets**
2. Adicione as seguintes variáveis:

```bash
# OpenRouter (para Agent Engine)
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_DEFAULT_MODEL=anthropic/claude-3.5-sonnet
OPENROUTER_REFERER_URL=https://v8millennials.com

# Webhook API Key (para webhook-orchestrator)
WEBHOOK_API_KEY=sua-api-key-secreta-aqui

# N8N Integration (opcional)
N8N_INTERNAL_EXECUTOR_WEBHOOK=https://seu-n8n.com/webhook/executor
```

**Como configurar no Supabase CLI:**

```bash
# Instalar Supabase CLI (se ainda não tiver)
npm install -g supabase

# Login
supabase login

# Link do projeto (ref do dashboard: https://supabase.com/dashboard/project/jsjsmuncfkbsbzqzqhfq)
supabase link --project-ref jsjsmuncfkbsbzqzqhfq

# Configurar secrets
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
supabase secrets set WEBHOOK_API_KEY=sua-api-key-secreta
supabase secrets set OPENROUTER_DEFAULT_MODEL=anthropic/claude-3.5-sonnet
```

## Verificar Conexão

### 1. Frontend

O cliente Supabase está configurado em:
```
src/integrations/supabase/client.ts
```

Verifique se as variáveis estão sendo carregadas:
```typescript
console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
console.log('Supabase Key:', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
```

### 2. Backend (Edge Functions)

Teste uma Edge Function:
```bash
# Deploy das functions
supabase functions deploy agent-message
supabase functions deploy webhook-orchestrator
supabase functions deploy create-org-user    # Criação de usuários com login pela org (Equipe > Criar usuário com acesso)

# Testar (projeto atual: jsjsmuncfkbsbzqzqhfq)
curl -X POST https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/agent-message \
  -H "Content-Type: application/json" \
  -d '{"from": "+5511999999999", "message": "Olá", "channel": "whatsapp"}'
```

## Estrutura do Banco de Dados

### Tabelas Principais

1. **copilot_agents** - Configuração dos agentes de IA
2. **copilot_agent_faqs** - FAQs dos agentes
3. **copilot_agent_kanban_rules** - Regras por etapa do Kanban
4. **conversations** - Estado das conversas
5. **conversation_messages** - Histórico de mensagens
6. **agent_decision_logs** - Logs de decisões do agente

### Migrations

As migrations estão em `supabase/migrations/`:
- `20260125000000_create_copilot_agents.sql` - Criação inicial
- `20260126000000_add_agent_capabilities_and_conversations.sql` - Capabilities e conversations

**Aplicar migrations:**
```bash
# Via Supabase CLI
supabase db push

# Ou via Dashboard
# Settings → Database → Migrations → Run migrations
```

## Troubleshooting

### Erro: "Invalid API key"
- Verifique se `VITE_SUPABASE_PUBLISHABLE_KEY` está correto
- Use a chave **anon/public**, não a **service_role**

### Erro: "Failed to fetch"
- Verifique se `VITE_SUPABASE_URL` está correto
- Verifique CORS no Supabase Dashboard

### Edge Functions não funcionam
- Verifique se as secrets estão configuradas
- Verifique logs: `supabase functions logs agent-message`

### Erro "JWT inválido" na create-org-user (Equipe → Criar usuário)
A função precisa da mesma chave que o frontend usa para validar o JWT do usuário. Faça no **Supabase Dashboard**:

**Qual chave usar?**
- Se o frontend usa **Publishable key** (`sb_publishable_xxx` no `.env` → `VITE_SUPABASE_PUBLISHABLE_KEY`), use essa mesma chave.
- Se o frontend usa **anon key** (legacy), use a anon key.

**Passos:**

1. Abra **[Edge Functions → Secrets](https://supabase.com/dashboard/project/jsjsmuncfkbsbzqzqhfq/functions)** (ou **Project Settings → Edge Functions**).
2. Em **Secrets**, adicione:
   - **Name:** `SUPABASE_ANON_KEY` (ou `SB_PUBLISHABLE_KEY` — ambos funcionam)
   - **Value:** copie a **mesma chave** que está no seu `.env`:
     - Se `.env` tem `VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_xxx"` → use `sb_publishable_xxx`
     - Se `.env` tem `VITE_SUPABASE_ANON_KEY="eyJ..."` → use `eyJ...`
3. Salve e **faça o deploy de novo** da função:  
   `supabase functions deploy create-org-user`

**Importante:** A chave na Edge Function **deve ser a mesma** que o frontend usa. Se forem diferentes, o JWT não será validado.

### Migrations não aplicadas
- Execute manualmente via Dashboard ou CLI
- Verifique se há conflitos de schema

## Próximos Passos

1. ✅ Configurar variáveis de ambiente no `.env`
2. ✅ Configurar secrets das Edge Functions
3. ✅ Aplicar migrations no banco
4. ✅ Testar conexão frontend
5. ✅ Testar Edge Functions
6. ✅ Criar um agente via quiz e verificar se `system_prompt` é salvo

## Documentação Adicional

- [Supabase Docs](https://supabase.com/docs)
- [Edge Functions](https://supabase.com/docs/guides/functions)
- [Database Migrations](https://supabase.com/docs/guides/cli/local-development#database-migrations)
