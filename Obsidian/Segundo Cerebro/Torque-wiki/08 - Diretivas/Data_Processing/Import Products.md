---
tags:
  - torque-crm
  - diretiva
  - data_processing
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: directives/data_processing/import_products.md
---

# Importação de Produtos

## Objetivo
Importar produtos de arquivo CSV ou Excel conforme template (colunas fixas), validar dados, processar em lote e gerar relatório de importação com erros e sucessos.

## Entradas
- file_path: string - Caminho do arquivo CSV/Excel (obrigatório)
- tenant_id: string - ID da organização (obrigatório)
- column_mapping: object? - Mapeamento de colunas do arquivo para campos do sistema (opcional; se omitido, usa nomes do template)
- skip_duplicates: boolean? - Se deve pular produtos com mesmo nome na mesma organização (padrão: false)
- batch_size: number? - Tamanho do lote para processamento (padrão: 50)

## Template (colunas esperadas)
- name (obrigatório) - Nome do produto
- type (obrigatório) - mrr | projeto | unitario
- ticket, ticket_minimo - Numéricos (R$)
- entregaveis, materiais - Texto
- links - Múltiplos URLs separados por ponto e vírgula
- logo_url, contrato_padrao_url, contrato_minimo_url - URLs
- is_active - true/false ou 1/0 ou sim/não (padrão: true)

## Ferramentas
- `execution/python/data_processing/import_products.py` - Script de importação

## Uso
Contexto JSON (ex.: contexto_import_products.json):
```json
{
  "input": {
    "file_path": "/caminho/para/produtos.xlsx",
    "tenant_id": "UUID-DA-ORGANIZACAO",
    "column_mapping": {},
    "skip_duplicates": false,
    "batch_size": 50
  },
  "tenantId": "UUID-DA-ORGANIZACAO"
}
```
Executar: `python execution/python/data_processing/import_products.py contexto_import_products.json`

## Saídas
- total_rows: number - Total de linhas no arquivo
- products_imported: number - Número de produtos importados com sucesso
- products_failed: number - Número de linhas que falharam
- errors: object[] - Lista de erros com row e error
- report_path: string - Caminho do relatório JSON gerado

## Edge Cases
- Arquivo não encontrado: Retornar erro
- Formato de arquivo inválido: Validar extensão (.xlsx, .xls, .csv)
- Nome ou type ausente/inválido: Registrar erro na linha e continuar
- tenant_id ausente: Retornar erro
- Credenciais Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) ausentes: Retornar erro
- Arquivo muito grande: Processar em lotes (batch_size)

## Aprendizados
(Atualizado automaticamente pelo sistema)


## Links relacionados

- [[MOC - Diretivas]]

- [[Produtos]]

- [[Permissoes Sistema]]

- [[00 - INDEX]]
- [[Fluxos de Trabalho]]
