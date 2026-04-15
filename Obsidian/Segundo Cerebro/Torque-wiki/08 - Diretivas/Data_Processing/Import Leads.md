---
tags:
  - torque-crm
  - diretiva
  - data_processing
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: directives/data_processing/import_leads.md
---

# Importação de Leads

## Objetivo
Importar leads de arquivo CSV ou Excel (XLSX/XLS), validar dados, mapear colunas (com notificação de colunas não reconhecidas para mapear ou criar campo personalizado), processar em lote e gerar relatório de importação. Disponível em: Campanhas (etapa da campanha), Qualificação (funil WhatsApp), Propostas e Confirmação.

## Entradas
- file_path: string - Caminho do arquivo CSV/Excel (obrigatório)
- column_mapping: object - Mapeamento de colunas do arquivo para campos do sistema (obrigatório no script; no frontend há preview e mapeamento de colunas não reconhecidas)
- tenant_id: string - ID da organização (obrigatório)
- user_id: string - ID do usuário que está executando (obrigatório)
- skip_duplicates: boolean? - Se deve pular leads duplicados (padrão: true)
- batch_size: number? - Tamanho do lote para processamento (padrão: 100)
- destination (frontend): 'campanha' | 'qualificacao' | 'propostas' | 'confirmacao' - Destino do import (funil)
- metrics_period_month: number? - Mês (1-12) em que os leads devem contar nas métricas. Quando informado com metrics_period_year, leads antigos importados não distorcem as métricas do mês atual
- metrics_period_year: number? - Ano em que os leads devem contar nas métricas. Usado junto com metrics_period_month

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
- Leads antigos importados: Quando metrics_period_month/year são informados, os leads contam no período indicado e não nas métricas do mês atual (evita distorção)

## Aprendizados
(Atualizado automaticamente pelo sistema)


## Links relacionados

- [[MOC - Diretivas]]

- [[Campanhas]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
- [[Fluxos de Trabalho]]
