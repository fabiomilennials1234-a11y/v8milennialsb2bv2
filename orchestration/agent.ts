/**
 * Agent - Camada 2: Orquestração
 * 
 * Orquestrador principal que:
 * - Lê diretivas
 * - Roteia para scripts de execução
 * - Gerencia erros e retry logic
 * - Auto-aperfeiçoa (self-annealing)
 * - Atualiza diretivas com aprendizados
 */

import { DirectiveReader, type Directive } from './directive-reader';
import { Executor, type ExecutionContext, type ExecutionResult } from './executor';
import { createClient } from '@supabase/supabase-js';

// Logger simplificado para agent
async function logToSupabase(level: string, message: string, context: any, error?: any) {
  try {
    const supabaseUrl = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) || '';
    const supabaseKey = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : process.env.SUPABASE_SERVICE_ROLE_KEY) || '';
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from('application_logs').insert({
        level,
        message,
        timestamp: new Date().toISOString(),
        user_id: context.userId || null,
        tenant_id: context.tenantId || null,
        action: context.action || null,
        resource: context.resource || null,
        metadata: context.metadata || null,
        error: error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : null,
      });
    }
  } catch (err) {
    console.error('[Logger Error]', err);
  }
}

// Subscription check simplificado
async function checkSubscription(organizationId: string): Promise<{ isValid: boolean; status: string }> {
  try {
    const supabaseUrl = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) || '';
    const supabaseKey = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : process.env.SUPABASE_SERVICE_ROLE_KEY) || '';
    if (!supabaseUrl || !supabaseKey) {
      return { isValid: false, status: 'unknown' };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: org } = await supabase
      .from('organizations')
      .select('subscription_status, subscription_expires_at')
      .eq('id', organizationId)
      .single();

    if (!org) {
      return { isValid: false, status: 'expired' };
    }

    const now = new Date();
    const expiresAt = org.subscription_expires_at ? new Date(org.subscription_expires_at) : null;
    const isValid = org.subscription_status === 'active' || 
                   (org.subscription_status === 'trial' && (!expiresAt || expiresAt > now));

    return { isValid, status: org.subscription_status };
  } catch (error) {
    return { isValid: false, status: 'error' };
  }
}

export interface AgentOptions {
  maxRetries?: number;
  retryDelay?: number; // em ms
  validateSubscription?: boolean;
}

export interface AgentResult {
  success: boolean;
  directive: Directive;
  executionResult?: ExecutionResult;
  error?: string;
  retries: number;
}

export class Agent {
  private directiveReader: DirectiveReader;
  private executor: Executor;
  private options: Required<AgentOptions>;

  constructor(options: AgentOptions = {}) {
    this.directiveReader = new DirectiveReader();
    this.executor = new Executor();
    this.options = {
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      validateSubscription: options.validateSubscription ?? true,
    };
  }

  /**
   * Executa uma diretiva por nome
   */
  async executeDirective(
    directivePath: string,
    input: Record<string, unknown>,
    context: {
      tenantId?: string;
      userId?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<AgentResult> {
    let retries = 0;
    let lastError: Error | null = null;

    // Ler diretiva
    let directive: Directive;
    try {
      directive = await this.directiveReader.readDirective(directivePath);
    } catch (error) {
      await logToSupabase('error', 'Failed to read directive', {
        action: 'read_directive',
        resource: 'agent',
        metadata: { directivePath },
      }, error instanceof Error ? error : new Error(String(error)));

      return {
        success: false,
        directive: {} as Directive,
        error: error instanceof Error ? error.message : String(error),
        retries: 0,
      };
    }

    // Validar subscription se necessário
    if (this.options.validateSubscription && context.tenantId) {
      const subscription = await checkSubscription(context.tenantId);
      if (!subscription.isValid) {
      await logToSupabase('warn', 'Subscription invalid, blocking execution', {
        action: 'validate_subscription',
        resource: 'agent',
        tenantId: context.tenantId,
        metadata: { subscriptionStatus: subscription.status },
      });

        return {
          success: false,
          directive,
          error: `Subscription invalid: ${subscription.status}`,
          retries: 0,
        };
      }
    }

    // Validar inputs
    const validationError = this.validateInputs(directive, input);
    if (validationError) {
      return {
        success: false,
        directive,
        error: validationError,
        retries: 0,
      };
    }

    // Validar ferramentas
    for (const tool of directive.tools) {
      const isValid = await this.executor.validateScript(tool);
      if (!isValid) {
        return {
          success: false,
          directive,
          error: `Tool not found or invalid: ${tool.path}`,
          retries: 0,
        };
      }
    }

    // Executar com retry logic
    while (retries <= this.options.maxRetries) {
      try {
        await logToSupabase('info', 'Executing directive', {
          action: 'execute_directive',
          resource: 'agent',
          tenantId: context.tenantId,
          userId: context.userId,
          metadata: {
            directiveName: directive.name,
            retry: retries,
          },
        });

        // Executar primeira ferramenta (pode ser expandido para múltiplas)
        const tool = directive.tools[0];
        const executionContext: ExecutionContext = {
          tenantId: context.tenantId,
          userId: context.userId,
          input,
          metadata: context.metadata,
        };

        const executionResult = await this.executor.execute(tool, executionContext);

        if (executionResult.success) {
          await logToSupabase('info', 'Directive executed successfully', {
            action: 'execute_directive',
            resource: 'agent',
            tenantId: context.tenantId,
            metadata: {
              directiveName: directive.name,
              duration: executionResult.duration,
            },
          });

          return {
            success: true,
            directive,
            executionResult,
            retries,
          };
        } else {
          // Erro na execução, tentar novamente
          lastError = new Error(executionResult.error || 'Execution failed');
          retries++;

          if (retries <= this.options.maxRetries) {
            await logToSupabase('warn', 'Execution failed, retrying', {
              action: 'execute_directive',
              resource: 'agent',
              tenantId: context.tenantId,
              metadata: {
                directiveName: directive.name,
                retry: retries,
                error: executionResult.error,
              },
            });

            // Aguardar antes de retry
            await this.sleep(this.options.retryDelay * retries); // Backoff exponencial
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retries++;

        await logToSupabase('error', 'Directive execution error', {
          action: 'execute_directive',
          resource: 'agent',
          tenantId: context.tenantId,
          metadata: {
            directiveName: directive.name,
            retry: retries,
          },
        }, lastError);

        if (retries <= this.options.maxRetries) {
          await this.sleep(this.options.retryDelay * retries);
        }
      }
    }

    // Todas as tentativas falharam - self-annealing
    await this.selfAnneal(directive, lastError!, input);

    return {
      success: false,
      directive,
      error: lastError?.message || 'Execution failed after all retries',
      retries,
    };
  }

  /**
   * Valida inputs contra a diretiva
   */
  private validateInputs(
    directive: Directive,
    input: Record<string, unknown>
  ): string | null {
    for (const inputDef of directive.inputs) {
      if (inputDef.required && !(inputDef.field in input)) {
        return `Missing required input: ${inputDef.field}`;
      }

      // Validação básica de tipo (pode ser expandida)
      if (inputDef.field in input) {
        const value = input[inputDef.field];
        const expectedType = inputDef.type.toLowerCase();

        if (expectedType.includes('string') && typeof value !== 'string') {
          return `Invalid type for ${inputDef.field}: expected string`;
        }
        if (expectedType.includes('number') && typeof value !== 'number') {
          return `Invalid type for ${inputDef.field}: expected number`;
        }
        if (expectedType.includes('object') && typeof value !== 'object') {
          return `Invalid type for ${inputDef.field}: expected object`;
        }
      }
    }

    return null;
  }

  /**
   * Self-Annealing: Aprende com erros e atualiza diretivas
   */
  private async selfAnneal(
    directive: Directive,
    error: Error,
    input: Record<string, unknown>
  ): Promise<void> {
    try {
      const errorMessage = error.message;
      const stackTrace = error.stack;

      // Analisar erro
      let learning = '';
      
      if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        learning = `Script ou recurso não encontrado. Verificar caminho: ${directive.tools[0]?.path}`;
      } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        learning = `Timeout na execução. Considerar aumentar timeout ou otimizar script.`;
      } else if (errorMessage.includes('permission') || errorMessage.includes('403')) {
        learning = `Problema de permissão. Verificar credenciais e acesso ao recurso.`;
      } else if (errorMessage.includes('subscription') || errorMessage.includes('payment')) {
        learning = `Subscription inválida ou expirada. Verificar status antes de executar.`;
      } else if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
        learning = `Dados de entrada inválidos. Verificar formato e tipos esperados.`;
      } else {
        learning = `Erro inesperado: ${errorMessage}. Stack: ${stackTrace?.substring(0, 200)}`;
      }

      // Adicionar aprendizado à diretiva
      await this.directiveReader.addLearning(directive.filePath, learning);

      await logToSupabase('info', 'Self-annealing: Learning added to directive', {
        action: 'self_anneal',
        resource: 'agent',
        metadata: {
          directiveName: directive.name,
          learning,
        },
      });
    } catch (annealError) {
      await logToSupabase('error', 'Self-annealing failed', {
        action: 'self_anneal',
        resource: 'agent',
      }, annealError instanceof Error ? annealError : new Error(String(annealError)));
    }
  }

  /**
   * Lista todas as diretivas disponíveis
   */
  async listDirectives(): Promise<string[]> {
    return await this.directiveReader.listDirectives();
  }

  /**
   * Obtém uma diretiva sem executar
   */
  async getDirective(directivePath: string): Promise<Directive> {
    return await this.directiveReader.readDirective(directivePath);
  }

  /**
   * Helper para sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Exportar instância singleton
export const agent = new Agent();
