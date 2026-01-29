# Geração de Relatórios

## Objetivo
Gerar relatórios de performance, métricas e análises baseados em dados do sistema, calcular estatísticas e formatar para visualização.

## Entradas
- report_type: string - Tipo de relatório (performance, sales, campaigns, team) (obrigatório)
- period_start: string - Data de início do período (ISO) (obrigatório)
- period_end: string - Data de fim do período (ISO) (obrigatório)
- metrics: string[]? - Métricas específicas a incluir (opcional)
- filters: object? - Filtros adicionais (opcional)
- format: string - Formato de saída (json, pdf, xlsx) (obrigatório)
- tenant_id: string - ID da organização (obrigatório)
- user_id: string - ID do usuário que está executando (obrigatório)

## Ferramentas
- `execution/python/data_processing/generate_report.py` - Script de geração de relatório

## Saídas
- report_id: string - ID único do relatório gerado
- report_path: string - Caminho do arquivo do relatório
- download_url: string? - URL de download (se aplicável)
- metrics: object - Métricas calculadas
- generated_at: string - Timestamp de geração (ISO)
- period: object - Período do relatório (start, end)

## Edge Cases
- Período inválido (end antes de start): Retornar erro
- Tipo de relatório não suportado: Retornar erro
- Nenhum dado no período: Gerar relatório vazio com mensagem informativa
- Cálculos complexos com timeout: Processar em etapas e cachear resultados intermediários
- Formato não suportado: Retornar erro
- Tenant sem subscription: Bloquear execução
- Métricas não disponíveis: Incluir apenas métricas disponíveis e registrar warning
- Dados inconsistentes: Aplicar regras de limpeza e documentar
- Memória insuficiente: Processar em chunks menores

## Aprendizados
(Atualizado automaticamente pelo sistema)
