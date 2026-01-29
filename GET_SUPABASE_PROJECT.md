# Buscar Project ID do Supabase via MCP

## ✅ Configuração do MCP do Supabase

O MCP do Supabase foi **adicionado ao `.mcp.json`** na raiz do projeto. 

### Próximos Passos:

1. **Reinicie o Cursor completamente** (Cmd+Q e abra novamente)
2. Na primeira vez, o MCP do Supabase irá solicitar autenticação
3. Você será redirecionado para fazer login com sua conta Supabase
4. Após autenticar, as ferramentas MCP estarão disponíveis

## Como Buscar o Project ID via MCP

Após reiniciar o Cursor e autenticar, você pode pedir:

```
"Use o MCP do Supabase para listar meus projetos e encontrar o projeto chamado 'torque | crm'"
```

Ou mais diretamente:

```
"Liste meus projetos do Supabase usando MCP e me mostre o project ID do projeto 'torque | crm'"
```

### Ferramentas MCP Disponíveis:

- `list_projects` - Lista todos os projetos do Supabase
- `get_project` - Obtém detalhes de um projeto específico
- `list_tables` - Lista tabelas de um projeto
- E outras ferramentas de gerenciamento

## Alternativa: Via Dashboard do Supabase

Se o MCP não funcionar imediatamente, você pode:

1. Acesse https://supabase.com/dashboard
2. Faça login
3. Procure pelo projeto "torque | crm"
4. Vá em **Settings** → **General**
5. O **Reference ID** é o Project ID

## Alternativa: Via Script (API)

Use o script criado em `scripts/get-supabase-project.sh`:

```bash
# 1. Obter Personal Access Token
# Acesse: https://supabase.com/dashboard/account/tokens
# Crie um novo token

# 2. Exportar o token
export SUPABASE_ACCESS_TOKEN='seu-token-aqui'

# 3. Executar o script
./scripts/get-supabase-project.sh
```

O script irá:
- ✅ Buscar todos os seus projetos
- ✅ Encontrar o projeto "torque | crm"
- ✅ Mostrar o Project ID, Reference ID e região

## Verificar Configuração Atual

No arquivo `.env` você deve ter:
- `VITE_SUPABASE_PROJECT_ID="SEU_PROJECT_ID"`
- `VITE_SUPABASE_URL="https://SEU_PROJECT_ID.supabase.co"`

> ⚠️ **SEGURANÇA**: O project ID deve corresponder à URL. Nunca commite credenciais reais.
