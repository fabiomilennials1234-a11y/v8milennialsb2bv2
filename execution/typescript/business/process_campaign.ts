/**
 * Process Campaign - Script de Execução
 * 
 * Processa leads de campanha e aplica regras de atribuição de SDRs
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { executionLogger } from '../_shared/logger';

interface ProcessCampaignInput {
  campaign_id: string;
  leads: Array<{
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    [key: string]: any;
  }>;
  assignment_rules: {
    method: 'round_robin' | 'random' | 'by_capacity' | 'manual';
    sdr_ids?: string[];
  };
  tenant_id: string;
  user_id: string;
}

interface ProcessCampaignOutput {
  leads_processed: number;
  leads_assigned: number;
  campaign_metrics: {
    total_leads: number;
    assigned: number;
    failed: number;
  };
  errors: string[];
}

async function main() {
  try {
    const contextFile = process.argv[2];
    if (!contextFile || !fs.existsSync(contextFile)) {
      throw new Error('Context file not provided or not found');
    }

    const contextData = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
    const input = contextData.input as ProcessCampaignInput;
    const tenantId = contextData.tenantId || input.tenant_id;
    const userId = contextData.userId || input.user_id;

    if (!tenantId || !input.campaign_id) {
      throw new Error('tenant_id and campaign_id are required');
    }

    const supabaseUrl = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) || '';
    const supabaseKey = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : process.env.SUPABASE_SERVICE_ROLE_KEY) || '';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not found');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verificar se campanha existe
    const { data: campaign, error: campaignError } = await supabase
      .from('campanhas')
      .select('id, name')
      .eq('id', input.campaign_id)
      .eq('organization_id', tenantId)
      .single();

    if (campaignError || !campaign) {
      throw new Error('Campaign not found or access denied');
    }

    // Buscar SDRs disponíveis
    let sdrIds: string[] = [];
    if (input.assignment_rules.sdr_ids && input.assignment_rules.sdr_ids.length > 0) {
      sdrIds = input.assignment_rules.sdr_ids;
    } else {
      const { data: sdrs } = await supabase
        .from('team_members')
        .select('id')
        .eq('organization_id', tenantId)
        .eq('role', 'sdr')
        .eq('is_active', true);

      if (sdrs) {
        sdrIds = sdrs.map(s => s.id);
      }
    }

    if (sdrIds.length === 0) {
      throw new Error('No SDRs available for assignment');
    }

    let leadsProcessed = 0;
    let leadsAssigned = 0;
    const errors: string[] = [];
    let sdrIndex = 0;

    for (const leadData of input.leads) {
      try {
        // Criar lead
        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .insert({
            name: leadData.name,
            email: leadData.email,
            phone: leadData.phone,
            company: leadData.company,
            origin: 'campanha',
            organization_id: tenantId,
            sdr_id: input.assignment_rules.method === 'round_robin' 
              ? sdrIds[sdrIndex % sdrIds.length]
              : input.assignment_rules.method === 'random'
              ? sdrIds[Math.floor(Math.random() * sdrIds.length)]
              : sdrIds[0],
          })
          .select()
          .single();

        if (leadError) {
          errors.push(`Failed to create lead ${leadData.name}: ${leadError.message}`);
          continue;
        }

        // Associar lead à campanha
        await supabase.from('campanha_leads').insert({
          campanha_id: input.campaign_id,
          lead_id: lead.id,
          organization_id: tenantId,
          sdr_id: lead.sdr_id,
        });

        // Criar no pipe_whatsapp
        await supabase.from('pipe_whatsapp').insert({
          lead_id: lead.id,
          organization_id: tenantId,
          status: 'novo',
          sdr_id: lead.sdr_id,
        });

        leadsProcessed++;
        if (lead.sdr_id) {
          leadsAssigned++;
        }
        sdrIndex++;
      } catch (error) {
        errors.push(`Error processing lead ${leadData.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Atualizar métricas da campanha
    const { data: campaignLeads } = await supabase
      .from('campanha_leads')
      .select('id')
      .eq('campanha_id', input.campaign_id)
      .eq('organization_id', tenantId);

    // Log de auditoria
    await executionLogger.audit('process', 'campaign', {
      tenantId,
      userId,
      metadata: {
        campaignId: input.campaign_id,
        leadsProcessed,
        leadsAssigned,
      },
    });

    console.log(JSON.stringify({
      leads_processed: leadsProcessed,
      leads_assigned: leadsAssigned,
      campaign_metrics: {
        total_leads: campaignLeads?.length || 0,
        assigned: leadsAssigned,
        failed: errors.length,
      },
      errors,
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

export { main as processCampaign };
