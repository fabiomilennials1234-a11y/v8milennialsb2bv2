/**
 * Hook React para logging com contexto automático
 * 
 * Uso:
 * const log = useLogger();
 * log.info('User created lead', { resource: 'lead', action: 'create' });
 * log.audit('create', 'lead', { metadata: { leadId: '123' } });
 */

import { useAuth } from '@/contexts/AuthContext';
import { logger, type LogContext } from '@/lib/logger';

export function useLogger() {
  const { user } = useAuth();
  
  /**
   * Obtém contexto padrão com informações do usuário
   */
  const getContext = (additional?: LogContext): LogContext => {
    // Obter tenant_id do metadata do usuário ou de outra fonte
    const tenantId = user?.user_metadata?.tenant_id || 
                     user?.user_metadata?.organization_id ||
                     undefined;
    
    return {
      userId: user?.id,
      tenantId,
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
      ...additional,
    };
  };

  return {
    /**
     * Debug - apenas em desenvolvimento
     */
    debug: (message: string, context?: LogContext) => 
      logger.debug(message, { ...getContext(), ...context }),

    /**
     * Informação geral
     */
    info: (message: string, context?: LogContext) => 
      logger.info(message, { ...getContext(), ...context }),

    /**
     * Aviso
     */
    warn: (message: string, context?: LogContext) => 
      logger.warn(message, { ...getContext(), ...context }),

    /**
     * Erro
     */
    error: (message: string, error: Error, context?: LogContext) => 
      logger.error(message, error, { ...getContext(), ...context }),

    /**
     * Auditoria - para ações críticas
     * 
     * @param action - Ação realizada (ex: 'create', 'update', 'delete', 'access')
     * @param resource - Recurso afetado (ex: 'lead', 'user', 'subscription')
     * @param context - Contexto adicional
     */
    audit: (action: string, resource: string, context?: LogContext) => 
      logger.audit(action, resource, { ...getContext(), ...context }),
  };
}
