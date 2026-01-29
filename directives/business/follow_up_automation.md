# Automação de Follow-ups

## Objetivo
Criar follow-ups automáticos baseados em regras configuradas, estágio do pipeline e tempo decorrido. Notificar responsáveis quando necessário.

## Entradas
- lead_id: string - ID do lead (obrigatório)
- pipe_type: string - Tipo de pipe (whatsapp, confirmacao, propostas) (obrigatório)
- stage: string - Estágio atual do lead no pipeline (obrigatório)
- automation_rules: object - Regras de automação configuradas (obrigatório)
- tenant_id: string - ID da organização (obrigatório)
- user_id: string - ID do usuário que está executando (obrigatório)

## Ferramentas
- `execution/typescript/business/create_follow_ups.ts` - Script de criação de follow-ups

## Saídas
- follow_ups_created: number - Número de follow-ups criados
- follow_up_ids: string[] - IDs dos follow-ups criados
- notifications_sent: number - Número de notificações enviadas

## Edge Cases
- Lead sem SDR atribuído: Atribuir automaticamente ou pular criação de follow-up
- Regras de automação não configuradas: Retornar erro informativo
- Lead já tem follow-up ativo para o mesmo estágio: Não duplicar, atualizar existente
- Tenant sem subscription: Bloquear execução
- Lead em estágio final (fechado, perdido): Não criar follow-ups
- Múltiplas regras aplicáveis: Criar follow-ups para todas as regras válidas

## Aprendizados
(Atualizado automaticamente pelo sistema)
