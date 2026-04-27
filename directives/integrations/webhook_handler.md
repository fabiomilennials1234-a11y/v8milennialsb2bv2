# Handler de Webhooks

## Objetivo
Processar webhooks externos (Cal.com, n8n, sistemas terceiros), validar assinatura quando aplicável, extrair dados relevantes e rotear para processamento apropriado.

## Entradas
- payload: object - Payload do webhook (obrigatório)
- headers: object - Headers HTTP do webhook (obrigatório)
- signature: string? - Assinatura do webhook para validação (opcional, depende do provedor)
- webhook_type: string - Tipo de webhook (calcom, n8n, custom) (obrigatório)
- tenant_id: string - ID da organização (obrigatório)

## Ferramentas
- `execution/typescript/integrations/process_webhook.ts` - Script de processamento de webhook

## Saídas
- processed: boolean - Se o webhook foi processado com sucesso
- lead_id: string? - ID do lead criado/atualizado (se aplicável)
- action: string - Ação realizada (lead_created, lead_updated, ignored, error)
- response_status: number - Status HTTP para resposta (200, 400, 500)

## Edge Cases
- Assinatura inválida: Rejeitar webhook e retornar 401
- Payload malformado: Retornar 400 com mensagem de erro
- Webhook duplicado (idempotência): Verificar se já foi processado, retornar sucesso sem reprocessar
- Tenant não encontrado: Retornar 404
- Subscription inválida: Retornar 403
- Tipo de webhook desconhecido: Retornar 400
- Timeout no processamento: Retornar 504
- Dados obrigatórios faltando: Validar e retornar 400 com lista de campos faltantes

## Aprendizados
(Atualizado automaticamente pelo sistema)
