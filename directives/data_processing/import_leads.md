# Importação de Leads

## Objetivo
Importar leads de arquivo CSV ou Excel, validar dados, mapear colunas, processar em lote e gerar relatório de importação com erros e sucessos.

## Entradas
- file_path: string - Caminho do arquivo CSV/Excel (obrigatório)
- column_mapping: object - Mapeamento de colunas do arquivo para campos do sistema (obrigatório)
- tenant_id: string - ID da organização (obrigatório)
- user_id: string - ID do usuário que está executando (obrigatório)
- skip_duplicates: boolean? - Se deve pular leads duplicados (padrão: true)
- batch_size: number? - Tamanho do lote para processamento (padrão: 100)

## Ferramentas
- `execution/python/data_processing/import_leads.py` - Script de importação

## Saídas
- total_rows: number - Total de linhas no arquivo
- leads_imported: number - Número de leads importados com sucesso
- leads_skipped: number - Número de leads pulados (duplicados)
- leads_failed: number - Número de leads que falharam
- errors: object[] - Lista de erros com linha e motivo
- report_path: string - Caminho do relatório de importação gerado

## Edge Cases
- Arquivo não encontrado: Retornar erro
- Formato de arquivo inválido: Validar extensão e estrutura
- Colunas faltando no mapeamento: Usar valores padrão ou retornar erro
- Dados inválidos em linhas específicas: Registrar erro mas continuar processamento
- Arquivo muito grande: Processar em lotes para evitar timeout
- Encoding incorreto: Detectar e converter automaticamente
- Tenant sem subscription: Bloquear execução
- Memória insuficiente: Processar em chunks menores
- Leads duplicados: Aplicar estratégia configurada (skip, merge, update)
- Timeout: Salvar progresso e permitir retomada

## Aprendizados
(Atualizado automaticamente pelo sistema)
