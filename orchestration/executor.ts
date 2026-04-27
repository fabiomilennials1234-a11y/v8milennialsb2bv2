/**
 * Executor - Camada 3
 * 
 * Executa scripts TypeScript e Python de forma determinística
 * Captura logs e erros, integra com sistema de logging
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import type { DirectiveTool } from './directive-reader';

// Logger simplificado para executor (pode não ter acesso ao logger do src)
async function logToSupabase(level: string, message: string, context: any) {
  try {
    const supabaseUrl = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) || '';
    const supabaseKey = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : process.env.SUPABASE_SERVICE_ROLE_KEY) || '';
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from('application_logs').insert({
        level,
        message,
        timestamp: new Date().toISOString(),
        tenant_id: context.tenantId || null,
        action: context.action || null,
        resource: context.resource || null,
        metadata: context.metadata || null,
      });
    }
  } catch (error) {
    console.error('[Logger Error]', error);
  }
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number;
}

export interface ExecutionContext {
  tenantId?: string;
  userId?: string;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export class Executor {
  private executionPath: string;
  private tmpPath: string;

  constructor(
    executionPath: string = path.join(process.cwd(), 'execution'),
    tmpPath: string = path.join(process.cwd(), '.tmp')
  ) {
    this.executionPath = executionPath;
    this.tmpPath = tmpPath;

    // Garantir que .tmp existe
    if (!fs.existsSync(this.tmpPath)) {
      fs.mkdirSync(this.tmpPath, { recursive: true });
    }
  }

  /**
   * Executa um script baseado em uma ferramenta de diretiva
   */
  async execute(
    tool: DirectiveTool,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const scriptPath = path.isAbsolute(tool.path)
      ? tool.path
      : path.join(this.executionPath, tool.path);

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Script not found: ${scriptPath}`);
    }

    await logToSupabase('info', 'Executing script', {
      action: 'execute_script',
      resource: 'executor',
      tenantId: context.tenantId,
      metadata: {
        scriptPath: tool.path,
        language: tool.language,
      },
    });

    try {
      if (tool.language === 'typescript') {
        return await this.executeTypeScript(scriptPath, context);
      } else if (tool.language === 'python') {
        return await this.executePython(scriptPath, context);
      } else {
        throw new Error(`Unsupported language: ${tool.language}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await logToSupabase('error', `Script execution failed: ${errorMessage}`, {
        action: 'execute_script',
        resource: 'executor',
        tenantId: context.tenantId,
        metadata: {
          scriptPath: tool.path,
          language: tool.language,
          duration,
        },
      });

      return {
        success: false,
        output: '',
        error: errorMessage,
        exitCode: 1,
        duration,
      };
    }
  }

  /**
   * Executa script TypeScript via Node.js/ts-node
   */
  private async executeTypeScript(
    scriptPath: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    // Criar arquivo temporário com contexto
    const contextFile = path.join(this.tmpPath, `context-${Date.now()}.json`);
    fs.writeFileSync(contextFile, JSON.stringify(context, null, 2));

    return new Promise((resolve, reject) => {
      const nodeProcess = spawn('node', [
        '--loader', 'ts-node/esm',
        scriptPath,
        contextFile,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV || 'development',
        },
      });

      let output = '';
      let errorOutput = '';

      nodeProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      nodeProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      nodeProcess.on('close', (code) => {
        const duration = Date.now() - startTime;

        // Limpar arquivo temporário
        if (fs.existsSync(contextFile)) {
          fs.unlinkSync(contextFile);
        }

        resolve({
          success: code === 0,
          output: output.trim(),
          error: errorOutput || undefined,
          exitCode: code || 0,
          duration,
        });
      });

      nodeProcess.on('error', (error) => {
        const duration = Date.now() - startTime;
        
        // Limpar arquivo temporário
        if (fs.existsSync(contextFile)) {
          fs.unlinkSync(contextFile);
        }

        reject(error);
      });
    });
  }

  /**
   * Executa script Python
   */
  private async executePython(
    scriptPath: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    // Criar arquivo temporário com contexto
    const contextFile = path.join(this.tmpPath, `context-${Date.now()}.json`);
    fs.writeFileSync(contextFile, JSON.stringify(context, null, 2));

    return new Promise((resolve, reject) => {
      const pythonProcess = spawn('python3', [scriptPath, contextFile], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      });

      let output = '';
      let errorOutput = '';

      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      pythonProcess.on('close', (code) => {
        const duration = Date.now() - startTime;

        // Limpar arquivo temporário
        if (fs.existsSync(contextFile)) {
          fs.unlinkSync(contextFile);
        }

        resolve({
          success: code === 0,
          output: output.trim(),
          error: errorOutput || undefined,
          exitCode: code || 0,
          duration,
        });
      });

      pythonProcess.on('error', (error) => {
        const duration = Date.now() - startTime;
        
        // Limpar arquivo temporário
        if (fs.existsSync(contextFile)) {
          fs.unlinkSync(contextFile);
        }

        reject(error);
      });
    });
  }

  /**
   * Valida se um script existe e é executável
   */
  async validateScript(tool: DirectiveTool): Promise<boolean> {
    const scriptPath = path.isAbsolute(tool.path)
      ? tool.path
      : path.join(this.executionPath, tool.path);

    if (!fs.existsSync(scriptPath)) {
      return false;
    }

    // Verificar extensão correta
    if (tool.language === 'typescript' && !scriptPath.endsWith('.ts')) {
      return false;
    }
    if (tool.language === 'python' && !scriptPath.endsWith('.py')) {
      return false;
    }

    return true;
  }
}
