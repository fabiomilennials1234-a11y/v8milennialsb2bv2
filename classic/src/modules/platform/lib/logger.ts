/**
 * Sistema de Logging Seguro para SaaS Multi-Tenant
 * 
 * Características:
 * - Sanitização automática de dados sensíveis
 * - Suporte a multi-tenancy
 * - Logs estruturados
 * - Separação dev/prod
 */

import { supabase } from '@/integrations/supabase/client';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  AUDIT = 'audit', // Para ações críticas que devem ser sempre logadas
}

export interface LogContext {
  userId?: string;
  tenantId?: string;
  action?: string;
  resource?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class Logger {
  private isDevelopment = import.meta.env.DEV;
  private isProduction = import.meta.env.PROD;

  /**
   * Sanitiza dados sensíveis antes de logar
   */
  private sanitize(data: unknown): unknown {
    if (typeof data === 'string') {
      // Remove emails
      let sanitized = data.replace(
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        '[EMAIL_REDACTED]'
      );
      
      // Remove tokens longos (mais de 32 caracteres alfanuméricos)
      sanitized = sanitized.replace(
        /\b[A-Za-z0-9]{33,}\b/g,
        '[TOKEN_REDACTED]'
      );
      
      // Remove possíveis senhas (padrões comuns)
      sanitized = sanitized.replace(
        /(password|senha|pwd)[=:]\s*[^\s,}]+/gi,
        '$1=[REDACTED]'
      );
      
      return sanitized;
    }
    
    if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data)) {
        return data.map(item => this.sanitize(item));
      }
      
      const sanitized: Record<string, unknown> = {};
      const sensitiveKeys = [
        'password', 'senha', 'pwd', 'pass',
        'token', 'secret', 'key', 'auth',
        'credential', 'api_key', 'apikey',
        'access_token', 'refresh_token',
        'authorization', 'bearer',
        'credit_card', 'card_number', 'cvv',
        'cpf', 'cnpj', 'ssn'
      ];
      
      for (const [key, value] of Object.entries(data)) {
        const keyLower = key.toLowerCase();
        const isSensitive = sensitiveKeys.some(sensitive => 
          keyLower.includes(sensitive)
        );
        
        if (isSensitive) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(value);
        }
      }
      
      return sanitized;
    }
    
    return data;
  }

  /**
   * Cria entrada de log estruturada
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    context: LogContext = {},
    error?: Error
  ): LogEntry {
    return {
      level,
      message: this.sanitize(message) as string,
      timestamp: new Date().toISOString(),
      context: {
        ...context,
        metadata: context.metadata ? this.sanitize(context.metadata) as Record<string, unknown> : undefined,
      },
      error: error ? {
        name: error.name,
        message: this.sanitize(error.message) as string,
        stack: this.isDevelopment ? error.stack : undefined,
      } : undefined,
    };
  }

  /**
   * Envia log para backend (Supabase) ou console (dev)
   */
  private async sendToBackend(entry: LogEntry): Promise<void> {
    // Em produção, tentar enviar para Supabase
    if (this.isProduction) {
      try {
        const { error } = await supabase.from('application_logs').insert({
          level: entry.level,
          message: entry.message,
          timestamp: entry.timestamp,
          user_id: entry.context.userId || null,
          tenant_id: entry.context.tenantId || null,
          action: entry.context.action || null,
          resource: entry.context.resource || null,
          ip_address: entry.context.ipAddress || null,
          user_agent: entry.context.userAgent || null,
          metadata: entry.context.metadata || null,
          error: entry.error || null,
        });

        if (error) {
          // Fallback para console em caso de falha
          console.error('[Logger Error] Failed to save log:', error);
        }
      } catch (err) {
        // Fallback para console em caso de erro crítico
        console.error('[Logger Critical Error]', err);
      }
    } else {
      // Em desenvolvimento, usar console formatado
      const prefix = `[${entry.level.toUpperCase()}]`;
      const contextParts: string[] = [];
      
      if (entry.context.tenantId) {
        contextParts.push(`Tenant: ${entry.context.tenantId}`);
      }
      if (entry.context.userId) {
        contextParts.push(`User: ${entry.context.userId.substring(0, 8)}...`);
      }
      if (entry.context.action) {
        contextParts.push(`Action: ${entry.context.action}`);
      }
      
      const contextStr = contextParts.length > 0 
        ? `[${contextParts.join(' | ')}]` 
        : '';
      
      const logMethod = entry.level === LogLevel.ERROR 
        ? console.error 
        : entry.level === LogLevel.WARN 
        ? console.warn 
        : console.log;
      
      logMethod(prefix, contextStr, entry.message, entry.context.metadata || '');
      
      if (entry.error) {
        console.error('Error details:', entry.error);
      }
    }
  }

  /**
   * Log de debug (apenas em desenvolvimento)
   */
  async debug(message: string, context?: LogContext): Promise<void> {
    if (this.isDevelopment) {
      const entry = this.createLogEntry(LogLevel.DEBUG, message, context);
      await this.sendToBackend(entry);
    }
  }

  /**
   * Log informativo
   */
  async info(message: string, context?: LogContext): Promise<void> {
    const entry = this.createLogEntry(LogLevel.INFO, message, context);
    await this.sendToBackend(entry);
  }

  /**
   * Log de aviso
   */
  async warn(message: string, context?: LogContext): Promise<void> {
    const entry = this.createLogEntry(LogLevel.WARN, message, context);
    await this.sendToBackend(entry);
  }

  /**
   * Log de erro
   */
  async error(message: string, error: Error, context?: LogContext): Promise<void> {
    const entry = this.createLogEntry(LogLevel.ERROR, message, context, error);
    await this.sendToBackend(entry);
  }

  /**
   * Log de auditoria (sempre salvo, mesmo em produção)
   * Use para ações críticas: criação/edição/exclusão de dados,
   * mudanças de permissões, acessos a dados sensíveis, etc.
   */
  async audit(
    action: string,
    resource: string,
    context?: LogContext
  ): Promise<void> {
    const entry = this.createLogEntry(
      LogLevel.AUDIT,
      `AUDIT: ${action} on ${resource}`,
      { ...context, action, resource }
    );
    await this.sendToBackend(entry);
  }
}

// Exportar instância singleton
export const logger = new Logger();
