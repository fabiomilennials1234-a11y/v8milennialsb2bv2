/**
 * Logger Helper para Scripts de Execução
 * 
 * Wrapper para o sistema de logging que funciona em scripts standalone
 */

import { createClient } from '@supabase/supabase-js';

interface LogContext {
  userId?: string;
  tenantId?: string;
  action?: string;
  resource?: string;
  metadata?: Record<string, unknown>;
}

class ExecutionLogger {
  private supabase: ReturnType<typeof createClient> | null = null;

  private async initSupabase() {
    if (this.supabase) return;

    let supabaseUrl = '';
    let supabaseKey = '';
    
    if (typeof Deno !== 'undefined') {
      supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    } else if (typeof process !== 'undefined') {
      supabaseUrl = process.env.SUPABASE_URL || '';
      supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    }
    
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
    }
  }

  async info(message: string, context?: LogContext): Promise<void> {
    await this.initSupabase();
    
    const nodeEnv = typeof Deno !== 'undefined' 
      ? Deno.env.get('NODE_ENV') 
      : (typeof process !== 'undefined' ? process.env.NODE_ENV : 'development');
    
    if (this.supabase && nodeEnv === 'production') {
      try {
        await this.supabase.from('application_logs').insert({
          level: 'info',
          message,
          timestamp: new Date().toISOString(),
          user_id: context?.userId || null,
          tenant_id: context?.tenantId || null,
          action: context?.action || null,
          resource: context?.resource || null,
          metadata: context?.metadata || null,
        });
      } catch (error) {
        console.error('[Logger Error]', error);
      }
    } else {
      console.log(`[INFO] ${message}`, context || '');
    }
  }

  async error(message: string, error: Error, context?: LogContext): Promise<void> {
    await this.initSupabase();
    
    const nodeEnv = typeof Deno !== 'undefined' 
      ? Deno.env.get('NODE_ENV') 
      : (typeof process !== 'undefined' ? process.env.NODE_ENV : 'development');
    
    if (this.supabase && nodeEnv === 'production') {
      try {
        await this.supabase.from('application_logs').insert({
          level: 'error',
          message,
          timestamp: new Date().toISOString(),
          user_id: context?.userId || null,
          tenant_id: context?.tenantId || null,
          action: context?.action || null,
          resource: context?.resource || null,
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
          metadata: context?.metadata || null,
        });
      } catch (err) {
        console.error('[Logger Error]', err);
      }
    } else {
      console.error(`[ERROR] ${message}`, error, context || '');
    }
  }

  async audit(action: string, resource: string, context?: LogContext): Promise<void> {
    await this.initSupabase();
    
    if (this.supabase) {
      try {
        await this.supabase.from('application_logs').insert({
          level: 'audit',
          message: `AUDIT: ${action} on ${resource}`,
          timestamp: new Date().toISOString(),
          user_id: context?.userId || null,
          tenant_id: context?.tenantId || null,
          action,
          resource,
          metadata: context?.metadata || null,
        });
      } catch (error) {
        console.error('[Logger Error]', error);
      }
    } else {
      console.log(`[AUDIT] ${action} on ${resource}`, context || '');
    }
  }
}

export const executionLogger = new ExecutionLogger();
