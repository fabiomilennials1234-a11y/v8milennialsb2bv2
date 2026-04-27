# Exportação de Dados

## Objetivo
Exportar dados do sistema para arquivo CSV ou Excel, aplicar filtros, formatar dados e gerar link de download.

## Entradas
- entity_type: string - Tipo de entidade a exportar (leads, contacts, deals, campaigns) (obrigatório)
- filters: object? - Filtros para aplicar na exportação (opcional)
- format: string - Formato de saída (csv, xlsx) (obrigatório)
- columns: string[]? - Colunas específicas a exportar (opcional, se vazio exporta todas)
- tenant_id: string - ID da organização (obrigatório)
- user_id: string - ID do usuário que está executando (obrigatório)

## Ferramentas
- `execution/python/data_processing/export_data.py` - Script de exportação

## Saídas
- file_path: string - Caminho do arquivo exportado
- download_url: string? - URL de download (se armazenado em cloud storage)
- total_records: number - Número total de registros exportados
- file_size: number - Tamanho do arquivo em bytes
- export_timestamp: string - Timestamp da exportação (ISO)

## Edge Cases
- Nenhum registro encontrado: Criar arquivo vazio ou retornar erro informativo
- Filtros inválidos: Validar e retornar erro
- Memória insuficiente para grandes datasets: Processar em chunks e criar arquivo incremental
- Permissão negada para escrita: Retornar erro de permissão
- Formato não suportado: Retornar erro
- Tenant sem subscription: Bloquear execução
- Timeout: Salvar progresso e permitir retomada
- Dados sensíveis: Sanitizar antes de exportar (emails, telefones)
- Campos calculados: Calcular dinamicamente durante exportação

## Aprendizados
(Atualizado automaticamente pelo sistema)
