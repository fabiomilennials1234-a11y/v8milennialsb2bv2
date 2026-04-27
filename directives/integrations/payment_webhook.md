# Webhook de Pagamento

## Objetivo
Processar eventos de pagamento de provedores externos (Stripe, Asaas, etc.), atualizar status de subscription da organização e registrar logs de auditoria.

## Entradas
- event_type: string - Tipo de evento (payment.succeeded, subscription.created, subscription.cancelled, payment.failed) (obrigatório)
- customer_id: string - ID do cliente no sistema de pagamento (obrigatório)
- subscription_id: string? - ID da subscription (opcional)
- payload: object - Payload completo do evento (obrigatório)
- signature: string? - Assinatura do webhook para validação (opcional mas recomendado)
- provider: string - Provedor de pagamento (stripe, asaas) (obrigatório)

## Ferramentas
- `execution/typescript/integrations/process_payment.ts` - Script de processamento de pagamento

## Saídas
- organization_id: string - ID da organização atualizada
- subscription_status: string - Novo status da subscription
- subscription_plan: string? - Plano da subscription
- expires_at: string? - Data de expiração (ISO)
- updated: boolean - Se a subscription foi atualizada

## Edge Cases
- Assinatura inválida: Rejeitar webhook e retornar 401
- Organização não encontrada pelo customer_id: Retornar erro 404
- Evento duplicado (idempotência): Verificar se já foi processado, retornar sucesso sem reprocessar
- Evento desconhecido: Registrar warning e retornar 200 (para não causar retry)
- Subscription já cancelada: Atualizar timestamp mas manter status
- Payment failed mas subscription ainda ativa: Atualizar status para suspended
- Dados de expiração inválidos: Usar data padrão ou calcular baseado no período
- Webhook de teste: Processar normalmente mas marcar como teste

## Aprendizados
(Atualizado automaticamente pelo sistema)
