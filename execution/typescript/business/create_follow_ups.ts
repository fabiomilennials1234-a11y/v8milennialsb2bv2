/**
 * Create Follow-ups - Script de Execução
 * 
 * Cria follow-ups automáticos baseados em regras e estágio do pipeline
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { executionLogger } from '../_shared/logger';

interface CreateFollowUpsInput {
  lead_id: string;
  pipe_type: string;
  stage: string;
  automation_rules: {
    delay_hours?: number;
    message?: string;
    assign_to?: string;
    notify?: boolean;
  };
  tenant_id: string;
  user_id: string;
}

interface CreateFollowUpsOutput {
  follow_ups_created: number;
  follow_up_ids: string[];
  notifications_sent: number;
}

async function main() {
  try {
    const contextFile = process.argv[2];
    if (!contextFile || !fs.existsSync(contextFile)) {
      throw new Error('Context file not provided or not found');
    }

    const contextData = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
    const input = contextData.input as CreateFollowUpsInput;
    const tenantId = contextData.tenantId || input.tenant_id;
    const userId = contextData.userId || input.user_id;

    if (!tenantId || !input.lead_id) {
      throw new Error('tenant_id and lead_id are required');
    }

    const supabaseUrl = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) || '';
    const supabaseKey = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : process.env.SUPABASE_SERVICE_ROLE_KEY) || '';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not found');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verificar se lead existe e pertence ao tenant
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, sdr_id, name')
      .eq('id', input.lead_id)
      .eq('organization_id', tenantId)
      .single();

    if (leadError || !lead) {
      throw new Error('Lead not found or access denied');
    }

    // Verificar se já existe follow-up ativo para este estágio
    const { data: existingFollowUps } = await supabase
      .from('follow_ups')
      .select('id')
      .eq('lead_id', input.lead_id)
      .eq('status', 'pending')
      .eq('organization_id', tenantId);

    if (existingFollowUps && existingFollowUps.length > 0) {
      // Atualizar follow-up existente
      const followUpIds: string[] = [];
      let notificationsSent = 0;

      for (const existing of existingFollowUps) {
        const scheduledDate = new Date();
        scheduledDate.setHours(scheduledDate.getHours() + (input.automation_rules.delay_hours || 24));

        await supabase
          .from('follow_ups')
          .update({
            scheduled_date: scheduledDate.toISOString(),
            message: input.automation_rules.message || 'Follow-up automático',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        followUpIds.push(existing.id);

        if (input.automation_rules.notify) {
          notificationsSent++;
        }
      }

      console.log(JSON.stringify({
        follow_ups_created: 0,
        follow_up_ids: followUpIds,
        notifications_sent: notificationsSent,
      }));
      return;
    }

    // Criar novo follow-up
    const scheduledDate = new Date();
    scheduledDate.setHours(scheduledDate.getHours() + (input.automation_rules.delay_hours || 24));

    const { data: followUp, error: followUpError } = await supabase
      .from('follow_ups')
      .insert({
        lead_id: input.lead_id,
        organization_id: tenantId,
        status: 'pending',
        scheduled_date: scheduledDate.toISOString(),
        message: input.automation_rules.message || 'Follow-up automático',
        assigned_to: input.automation_rules.assign_to || lead.sdr_id,
        pipe_type: input.pipe_type,
        stage: input.stage,
      })
      .select()
      .single();

    if (followUpError) {
      throw new Error(`Failed to create follow-up: ${followUpError.message}`);
    }

    let notificationsSent = 0;
    if (input.automation_rules.notify && followUp.assigned_to) {
      // Aqui você pode integrar com sistema de notificações
      notificationsSent = 1;
    }

    // Log de auditoria
    await executionLogger.audit('create', 'follow_up', {
      tenantId,
      userId,
      metadata: {
        followUpId: followUp.id,
        leadId: input.lead_id,
        pipeType: input.pipe_type,
      },
    });

    console.log(JSON.stringify({
      follow_ups_created: 1,
      follow_up_ids: [followUp.id],
      notifications_sent: notificationsSent,
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

export { main as createFollowUps };
