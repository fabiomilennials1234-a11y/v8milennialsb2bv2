/**
 * Process Payment - Script de Execução
 * 
 * Processa eventos de pagamento e atualiza subscription
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { executionLogger } from '../_shared/logger';

interface ProcessPaymentInput {
  event_type: string;
  customer_id: string;
  subscription_id?: string;
  payload: Record<string, any>;
  signature?: string;
  provider: 'stripe' | 'asaas';
}

interface ProcessPaymentOutput {
  organization_id: string;
  subscription_status: string;
  subscription_plan?: string;
  expires_at?: string;
  updated: boolean;
}

async function main() {
  try {
    const contextFile = process.argv[2];
    if (!contextFile || !fs.existsSync(contextFile)) {
      throw new Error('Context file not provided or not found');
    }

    const contextData = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
    const input = contextData.input as ProcessPaymentInput;

    if (!input.customer_id) {
      throw new Error('customer_id is required');
    }

    const supabaseUrl = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) || '';
    const supabaseKey = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : process.env.SUPABASE_SERVICE_ROLE_KEY) || '';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not found');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Buscar organização pelo customer_id
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, subscription_status, subscription_plan, subscription_expires_at')
      .eq('payment_customer_id', input.customer_id)
      .single();

    if (orgError || !org) {
      throw new Error('Organization not found for customer_id');
    }

    // Determinar novo status baseado no evento
    let subscriptionStatus = org.subscription_status;
    let expiresAt: string | null = org.subscription_expires_at;
    let subscriptionPlan = org.subscription_plan;

    switch (input.event_type) {
      case 'payment.succeeded':
      case 'subscription.created':
      case 'subscription.updated':
        subscriptionStatus = 'active';
        if (input.payload.current_period_end) {
          expiresAt = new Date(input.payload.current_period_end * 1000).toISOString();
        }
        if (input.payload.plan?.name || input.payload.plan?.id) {
          subscriptionPlan = input.payload.plan.name || input.payload.plan.id;
        }
        break;

      case 'subscription.cancelled':
        subscriptionStatus = 'cancelled';
        break;

      case 'payment.failed':
        subscriptionStatus = 'suspended';
        break;

      case 'subscription.deleted':
        subscriptionStatus = 'expired';
        break;
    }

    // Atualizar organização
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        subscription_status: subscriptionStatus,
        subscription_plan: subscriptionPlan,
        subscription_expires_at: expiresAt,
        payment_subscription_id: input.subscription_id || org.payment_subscription_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', org.id);

    if (updateError) {
      throw new Error(`Failed to update organization: ${updateError.message}`);
    }

    // Log de auditoria (já feito pelo executionLogger, mas manter compatibilidade)
    await executionLogger.audit('update', 'subscription', {
      tenantId: org.id,
      metadata: {
        eventType: input.event_type,
        customerId: input.customer_id,
        subscriptionId: input.subscription_id,
        oldStatus: org.subscription_status,
        newStatus: subscriptionStatus,
      },
    });

    console.log(JSON.stringify({
      organization_id: org.id,
      subscription_status: subscriptionStatus,
      subscription_plan: subscriptionPlan,
      expires_at: expiresAt,
      updated: true,
    }));
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

export { main as processPayment };
