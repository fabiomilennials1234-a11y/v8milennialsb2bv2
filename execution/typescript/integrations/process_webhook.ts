/**
 * Process Webhook - Script de Execução
 * 
 * Processa webhooks externos e roteia para processamento apropriado
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { executionLogger } from '../_shared/logger';

interface ProcessWebhookInput {
  payload: Record<string, any>;
  headers: Record<string, string>;
  signature?: string;
  webhook_type: 'calcom' | 'n8n' | 'custom';
  tenant_id: string;
}

interface ProcessWebhookOutput {
  processed: boolean;
  lead_id?: string;
  action: 'lead_created' | 'lead_updated' | 'ignored' | 'error';
  response_status: number;
}

async function main() {
  try {
    const contextFile = process.argv[2];
    if (!contextFile || !fs.existsSync(contextFile)) {
      throw new Error('Context file not provided or not found');
    }

    const contextData = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
    const input = contextData.input as ProcessWebhookInput;
    const tenantId = contextData.tenantId || input.tenant_id;

    if (!tenantId) {
      throw new Error('tenant_id is required');
    }

    const supabaseUrl = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) || '';
    const supabaseKey = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : process.env.SUPABASE_SERVICE_ROLE_KEY) || '';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not found');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validar assinatura se fornecida
    if (input.signature && input.webhook_type === 'custom') {
      const webhookSecret = process.env.WEBHOOK_SECRET || '';
      // Implementar validação de assinatura conforme necessário
      // Por exemplo, para Stripe: crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(input.payload)).digest('hex')
    }

    // Processar baseado no tipo de webhook
    let result: ProcessWebhookOutput;

    switch (input.webhook_type) {
      case 'calcom':
        // Processar webhook do Cal.com
        const calPayload = input.payload;
        const email = calPayload.attendees?.[0]?.email || calPayload.responses?.email;
        const name = calPayload.attendees?.[0]?.name || calPayload.responses?.name;
        const startTime = calPayload.startTime;

        if (!email) {
          result = {
            processed: false,
            action: 'error',
            response_status: 400,
          };
          break;
        }

        // Criar/atualizar lead
        const { data: lead } = await supabase
          .from('leads')
          .insert({
            name: name || `Agendamento - ${email.split('@')[0]}`,
            email,
            origin: 'cal',
            compromisso_date: startTime,
            organization_id: tenantId,
          })
          .select()
          .single();

        // Log de auditoria
        await executionLogger.audit('webhook', 'lead', {
          tenantId,
          metadata: {
            webhookType: 'calcom',
            leadId: lead?.id,
          },
        });

        result = {
          processed: true,
          lead_id: lead?.id,
          action: 'lead_created',
          response_status: 200,
        };
        break;

      case 'n8n':
        // Processar webhook do n8n (já tem lógica no webhook-new-lead)
        // Aqui podemos chamar o script process_lead
        result = {
          processed: true,
          action: 'lead_created',
          response_status: 200,
        };
        break;

      default:
        result = {
          processed: false,
          action: 'ignored',
          response_status: 200,
        };
    }

    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
    process.exit(1);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main();
} else if (typeof Deno !== 'undefined' && import.meta.main) {
  main();
}

export { main as processWebhook };
