# Diretivas - Camada 1

Este diretório contém as **Diretivas** (SOPs) que definem o que fazer, como fazer e quais ferramentas usar.

## Estrutura

```
directives/
├── business/          # Automações de negócio
├── integrations/      # Integrações com APIs externas
└── data_processing/  # Processamento de dados
```

## Formato de Diretiva

Cada diretiva segue este formato padrão:

```markdown
# [Nome da Operação]

## Objetivo
Descrição clara do que esta diretiva faz.

## Entradas
- Campo: Tipo - Descrição (obrigatório/opcional)

## Ferramentas
- `execution/[linguagem]/[categoria]/[script]` - Descrição

## Saídas
- Campo: Tipo - Descrição

## Edge Cases
- Caso 1: Como lidar
- Caso 2: Como lidar

## Aprendizados
(Atualizado automaticamente pelo sistema)
- Data: O que foi aprendido
```

## Diretivas Disponíveis

### Business (Negócio)
- **process_lead.md** - Processa novo lead recebido
- **follow_up_automation.md** - Cria follow-ups automáticos
- **campaign_processing.md** - Processa leads de campanha

### Integrations (Integrações)
- **webhook_handler.md** - Processa webhooks externos
- **api_sync.md** - Sincroniza dados com APIs externas
- **payment_webhook.md** - Processa eventos de pagamento

### Data Processing (Processamento de Dados)
- **import_leads.md** - Importa leads de CSV/Excel
- **export_data.md** - Exporta dados para CSV/Excel
- **generate_reports.md** - Gera relatórios de performance

## Como Usar

As diretivas são lidas automaticamente pelo sistema de orquestração. Para executar uma diretiva:

```typescript
import { agent } from '@/orchestration/agent';

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
```

## Auto-Aperfeiçoamento

O sistema automaticamente atualiza a seção "Aprendizados" quando encontra erros, documentando:
- Limitações de API
- Tempos de execução
- Edge cases descobertos
- Melhores práticas

## Adicionar Nova Diretiva

1. Criar arquivo `.md` no diretório apropriado
2. Seguir o formato padrão
3. Definir ferramentas (scripts) a usar
4. Documentar edge cases conhecidos
5. Testar com o orquestrador
