# Execução - Camada 3

Scripts determinísticos que fazem o trabalho real. Confiáveis, testáveis e rápidos.

## Estrutura

```
execution/
├── typescript/    # Scripts TypeScript/Node.js
│   ├── business/
│   ├── integrations/
│   └── data_processing/
└── python/       # Scripts Python
    ├── business/
    ├── integrations/
    └── data_processing/
```

## Scripts TypeScript

### Características
- Executados via Node.js
- Podem ser chamados de Edge Functions
- Integram com Supabase
- Usam sistema de logging

### Exemplos
- `business/process_lead.ts` - Processa lead
- `business/create_follow_ups.ts` - Cria follow-ups
- `integrations/process_webhook.ts` - Processa webhook
- `integrations/process_payment.ts` - Processa pagamento

### Formato
```typescript
async function main() {
  // Ler contexto
  const contextFile = process.argv[2];
  const contextData = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
  
  // Processar
  // ...
  
  // Output JSON
  console.log(JSON.stringify(result));
}
```

## Scripts Python

### Características
- Processamento pesado (pandas, Excel)
- Conexão com Supabase via Python client
- Logging estruturado

### Dependências
Instalar com:
```bash
pip install -r execution/requirements.txt
```

### Exemplos
- `data_processing/import_leads.py` - Importa leads
- `data_processing/export_data.py` - Exporta dados
- `data_processing/generate_report.py` - Gera relatórios

### Formato
```python
def main():
    context_file = sys.argv[1]
    with open(context_file, 'r') as f:
        context_data = json.load(f)
    
    # Processar
    # ...
    
    # Output JSON
    print(json.dumps(result))
```

## Contexto de Execução

Todos os scripts recebem um arquivo JSON com contexto:

```json
{
  "input": {
    // Dados de entrada conforme diretiva
  },
  "tenantId": "org-123",
  "userId": "user-456",
  "metadata": {
    // Metadados adicionais
  }
}
```

## Output

Scripts devem:
- Output JSON válido em stdout (sucesso)
- Output JSON com erro em stderr (falha)
- Exit code 0 (sucesso) ou 1 (falha)

## Segurança

- Sempre validar `tenant_id`
- Verificar subscription antes de processar
- Sanitizar inputs
- Usar logging de auditoria para ações críticas
- Nunca expor dados de outros tenants

## Boas Práticas

1. **Determinístico**: Mesma entrada = mesma saída
2. **Idempotente**: Pode ser executado múltiplas vezes sem efeitos colaterais
3. **Testável**: Fácil de testar isoladamente
4. **Bem comentado**: Código claro e documentado
5. **Tratamento de erros**: Sempre tratar e logar erros
