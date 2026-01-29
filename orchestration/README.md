# Orquestração - Camada 2

Sistema de orquestração que conecta diretivas (o que fazer) com scripts de execução (como fazer).

## Componentes

### Agent (`agent.ts`)
Orquestrador principal que:
- Lê diretivas
- Valida inputs e subscription
- Executa scripts
- Gerencia retries e erros
- Auto-aperfeiçoa (self-annealing)

### DirectiveReader (`directive-reader.ts`)
Lê e parseia diretivas Markdown:
- Valida estrutura
- Extrai objetivos, entradas, ferramentas, saídas
- Gerencia aprendizados

### Executor (`executor.ts`)
Executa scripts determinísticos:
- TypeScript via Node.js
- Python via subprocess
- Captura logs e erros
- Integra com sistema de logging

## Uso Básico

```typescript
import { agent } from './agent';

// Executar diretiva
const result = await agent.executeDirective(
  'business/process_lead.md',
  {
    name: 'João Silva',
    email: 'joao@example.com',
    origin: 'site',
  },
  {
    tenantId: 'org-123',
    userId: 'user-456',
  }
);

if (result.success) {
  console.log('Lead processado:', result.executionResult?.output);
} else {
  console.error('Erro:', result.error);
}
```

## Self-Annealing

Quando um script falha após todas as tentativas:
1. Sistema analisa o erro
2. Identifica padrões (timeout, permissão, validação, etc.)
3. Adiciona aprendizado à diretiva
4. Sistema fica mais forte

## Validações Automáticas

- **Subscription**: Verifica se tenant tem subscription válida
- **Inputs**: Valida tipos e campos obrigatórios
- **Ferramentas**: Verifica se scripts existem
- **Tenant**: Garante isolamento de dados

## Retry Logic

- Máximo de 3 tentativas (configurável)
- Backoff exponencial entre tentativas
- Logs de cada tentativa
- Self-annealing após falha final
