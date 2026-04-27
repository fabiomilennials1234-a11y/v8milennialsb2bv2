# Arquitetura de 3 Camadas - Documentação Completa

## Visão Geral

Este sistema implementa uma arquitetura de 3 camadas que separa responsabilidades para maximizar confiabilidade:

```
┌─────────────────────────────────────────┐
│  Camada 1: Diretivas (O que fazer)      │
│  directives/*.md                       │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  Camada 2: Orquestração (Tomada de     │
│  decisão) - orchestration/agent.ts     │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  Camada 3: Execução (Fazer trabalho)   │
│  execution/typescript/*.ts              │
│  execution/python/*.py                  │
└─────────────────────────────────────────┘
```

## Por Que Esta Arquitetura?

### Problema
LLMs são probabilísticos (90% de precisão por etapa). Em 5 etapas, você tem apenas 59% de sucesso.

### Solução
Empurrar complexidade para código determinístico. O agente AI foca apenas em tomada de decisão.

## Camada 1: Diretivas

**Localização**: `directives/`

**Responsabilidade**: Definir O QUE fazer

**Formato**: Markdown (SOPs)

**Características**:
- Linguagem natural
- Instruções como para funcionário intermediário
- Define objetivos, entradas, ferramentas, saídas, edge cases
- Auto-atualizável com aprendizados

**Exemplo**:
```markdown
# Processamento de Lead

## Objetivo
Processar um novo lead recebido...

## Entradas
- name: string - Nome do lead (obrigatório)

## Ferramentas
- `execution/typescript/business/process_lead.ts`

## Saídas
- lead_id: string - ID do lead criado
```

## Camada 2: Orquestração

**Localização**: `orchestration/`

**Responsabilidade**: Tomada de decisão inteligente

**Componentes**:
- `agent.ts` - Orquestrador principal
- `directive-reader.ts` - Leitor de diretivas
- `executor.ts` - Executor de scripts

**Funcionalidades**:
- Ler diretivas
- Validar inputs e subscription
- Rotear para scripts corretos
- Gerenciar erros e retries
- Auto-aperfeiçoamento (self-annealing)
- Atualizar diretivas com aprendizados

**Fluxo**:
```
1. Ler diretiva
2. Validar subscription
3. Validar inputs
4. Validar ferramentas
5. Executar script
6. Se falhar → Retry (até 3x)
7. Se todas falharem → Self-anneal
8. Atualizar diretiva com aprendizado
```

## Camada 3: Execução

**Localização**: `execution/`

**Responsabilidade**: Fazer o trabalho determinístico

**Tipos**:
- **TypeScript**: Integrações, webhooks, processamento rápido
- **Python**: Processamento pesado, importação, exportação, relatórios

**Características**:
- Determinístico (mesma entrada = mesma saída)
- Testável
- Rápido
- Bem comentado
- Tratamento de erros robusto

## Fluxo Completo

### Exemplo: Processar Lead

```
1. Agente recebe: "Processar lead João Silva"
   ↓
2. Agente lê: directives/business/process_lead.md
   ↓
3. Agente valida:
   - Subscription válida? ✓
   - Inputs corretos? ✓
   - Script existe? ✓
   ↓
4. Agente executa: execution/typescript/business/process_lead.ts
   ↓
5. Script processa:
   - Valida dados
   - Verifica duplicatas
   - Cria/atualiza lead
   - Cria histórico
   - Loga auditoria
   ↓
6. Script retorna JSON com resultado
   ↓
7. Agente retorna resultado ao chamador
```

### Se Falhar

```
1. Script falha (ex: timeout)
   ↓
2. Agente tenta novamente (retry 1)
   ↓
3. Falha novamente
   ↓
4. Agente tenta novamente (retry 2)
   ↓
5. Falha novamente
   ↓
6. Agente analisa erro (self-anneal):
   - Tipo: timeout
   - Aprendizado: "Script demora muito. Considerar otimizar ou aumentar timeout."
   ↓
7. Agente atualiza diretiva com aprendizado
   ↓
8. Sistema fica mais forte
```

## Integração com Sistema Existente

### Logging
- Todos os scripts usam `executionLogger`
- Logs estruturados em `application_logs`
- Sanitização automática de dados sensíveis
- Auditoria para ações críticas

### Multi-Tenancy
- Todos os scripts validam `tenant_id`
- Dados filtrados por `organization_id`
- RLS (Row Level Security) no banco
- Isolamento garantido

### Subscription
- Validação automática antes de executar
- Bloqueio se subscription inválida
- Logs de tentativas sem subscription

## Self-Annealing (Auto-Aperfeiçoamento)

Quando algo quebra:

1. **Consertar**: Corrigir o script
2. **Atualizar ferramenta**: Melhorar código
3. **Testar**: Confirmar que funciona
4. **Atualizar diretiva**: Documentar aprendizado
5. **Sistema fica mais forte**: Próxima vez será melhor

### Exemplo de Aprendizado

```
Erro: "Script timeout após 30s"
↓
Aprendizado adicionado à diretiva:
"2026-01-24: Script process_lead pode demorar >30s com muitos leads. 
Considerar processar em lotes menores ou aumentar timeout."
```

## Uso Prático

### Em Edge Functions

```typescript
// supabase/functions/webhook-new-lead/index.ts
import { agent } from '../../orchestration/agent';

Deno.serve(async (req) => {
  const body = await req.json();
  
  const result = await agent.executeDirective(
    'business/process_lead.md',
    body,
    {
      tenantId: body.organization_id,
      userId: null, // Webhook não tem usuário
    }
  );
  
  return new Response(JSON.stringify(result));
});
```

### Em Background Jobs

```typescript
// Via pg_cron ou similar
import { agent } from '@/orchestration/agent';

// Executar diariamente
await agent.executeDirective(
  'data_processing/generate_reports.md',
  {
    report_type: 'performance',
    period_start: startDate,
    period_end: endDate,
  },
  { tenantId, userId }
);
```

### Em Componentes React

```typescript
// src/pages/Leads.tsx
import { agent } from '@/orchestration/agent';

const handleImport = async (file: File) => {
  const result = await agent.executeDirective(
    'data_processing/import_leads.md',
    {
      file_path: file.path,
      column_mapping: mapping,
    },
    { tenantId, userId }
  );
};
```

## Princípios de Operação

### 1. Verifique Ferramentas Primeiro
Antes de criar novo script, verifique `execution/` seguindo a diretiva.

### 2. Auto-Aperfeiçoamento
Quando algo quebra:
- Leia erro e stack trace
- Corrija script
- Teste novamente
- Atualize diretiva com aprendizado

### 3. Atualize Diretivas Conforme Aprende
Diretivas são documentos vivos. Quando descobrir:
- Limitações de API
- Melhores abordagens
- Erros comuns
- Expectativas de tempo

→ Atualize a diretiva!

## Organização de Arquivos

### Deliverables vs Intermediários
- **Deliverables**: Resultados finais (leads criados, relatórios gerados)
- **Intermediários**: Arquivos em `.tmp/` (sempre regeneráveis)

### Estrutura
```
directives/      # SOPs em Markdown
execution/       # Scripts determinísticos
orchestration/   # Sistema de orquestração
.tmp/            # Arquivos temporários (gitignored)
```

## Segurança

- ✅ Validação de `tenant_id` em todos os scripts
- ✅ Verificação de subscription antes de executar
- ✅ Sanitização de inputs
- ✅ Logging de auditoria
- ✅ Rate limiting por tenant (a implementar)
- ✅ Isolamento de dados via RLS

## Testes

### Testar Diretiva
```typescript
const directive = await agent.getDirective('business/process_lead.md');
console.log(directive.objective);
```

### Testar Script
```bash
# TypeScript
node --loader ts-node/esm execution/typescript/business/process_lead.ts context.json

# Python
python3 execution/python/data_processing/import_leads.py context.json
```

### Testar Orquestrador
```typescript
const result = await agent.executeDirective(
  'business/process_lead.md',
  testInput,
  { tenantId: 'test-org', userId: 'test-user' }
);
```

## Próximos Passos

1. ✅ Estrutura criada
2. ✅ Diretivas criadas
3. ✅ Scripts criados
4. ✅ Orquestração implementada
5. ⚠️ Testar em ambiente real
6. ⚠️ Adicionar mais diretivas conforme necessário
7. ⚠️ Implementar rate limiting
8. ⚠️ Adicionar métricas e monitoramento

## Referências

- `AGENTS.MD` - Arquitetura original
- `directives/README.md` - Documentação de diretivas
- `orchestration/README.md` - Documentação de orquestração
- `execution/README.md` - Documentação de scripts
