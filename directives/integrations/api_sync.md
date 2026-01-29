# Sincronização de APIs

## Objetivo
Sincronizar dados com APIs externas, fazer pull/push de informações, manter consistência entre sistemas e registrar logs de sincronização.

## Entradas
- api_endpoint: string - Endpoint da API (obrigatório)
- api_credentials: object - Credenciais da API (obrigatório)
- sync_direction: string - Direção da sincronização (pull, push, bidirectional) (obrigatório)
- entity_type: string - Tipo de entidade a sincronizar (leads, contacts, deals) (obrigatório)
- filters: object? - Filtros para sincronização (opcional)
- tenant_id: string - ID da organização (obrigatório)
- user_id: string - ID do usuário que está executando (obrigatório)

## Ferramentas
- `execution/typescript/integrations/sync_api.ts` - Script de sincronização

## Saídas
- records_synced: number - Número de registros sincronizados
- records_created: number - Número de registros criados
- records_updated: number - Número de registros atualizados
- records_failed: number - Número de registros que falharam
- sync_timestamp: string - Timestamp da sincronização (ISO)

## Edge Cases
- API indisponível: Retornar erro e agendar retry
- Rate limiting: Implementar backoff e retry com delays
- Credenciais inválidas: Retornar erro de autenticação
- Dados conflitantes: Aplicar estratégia de resolução (last_write_wins, manual_review)
- Timeout: Retornar erro e permitir retry parcial
- Paginação: Processar todas as páginas automaticamente
- Tenant sem subscription: Bloquear execução
- Campos não mapeados: Registrar warning e continuar
- Sincronização parcial: Retornar status parcial com lista de erros

## Aprendizados
(Atualizado automaticamente pelo sistema)
