# Processamento de Campanha

## Objetivo
Processar leads de uma campanha, aplicar regras de atribuição de SDRs, atualizar métricas da campanha e criar histórico de ações.

## Entradas
- campaign_id: string - ID da campanha (obrigatório)
- leads: object[] - Array de leads a processar (obrigatório)
- assignment_rules: object - Regras de atribuição de SDRs (obrigatório)
- tenant_id: string - ID da organização (obrigatório)
- user_id: string - ID do usuário que está executando (obrigatório)

## Ferramentas
- `execution/typescript/business/process_campaign.ts` - Script de processamento de campanha

## Saídas
- leads_processed: number - Número de leads processados
- leads_assigned: number - Número de leads com SDR atribuído
- campaign_metrics: object - Métricas atualizadas da campanha
- errors: string[] - Lista de erros encontrados durante processamento

## Edge Cases
- Campanha não encontrada: Retornar erro
- Leads vazios: Retornar sucesso com contadores zerados
- SDRs indisponíveis: Distribuir entre SDRs disponíveis ou deixar sem atribuição
- Lead já atribuído: Respeitar atribuição existente ou sobrescrever conforme regra
- Tenant sem subscription: Bloquear execução
- Regras de atribuição conflitantes: Aplicar primeira regra válida
- Lead duplicado na campanha: Ignorar ou atualizar conforme configuração

## Aprendizados
(Atualizado automaticamente pelo sistema)
