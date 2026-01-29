/**
 * Process Lead - Script de Execução
 * 
 * Processa um novo lead: valida, verifica duplicatas, cria/atualiza no banco
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { executionLogger } from '../_shared/logger';

// Helper functions
function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

function getDayBoundaries(date: Date): { start: string; end: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

interface ProcessLeadInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  origin: string;
  segment?: string | null;
  faturamento?: string | null;
  urgency?: string | null;
  notes?: string | null;
  rating?: number | null;
  sdr_id?: string | null;
  compromisso_date?: string | null;
  tenant_id: string;
  user_id: string;
}

interface ProcessLeadOutput {
  lead_id: string;
  action: 'created' | 'updated' | 'unified';
  deduplication_method?: string;
  pipe?: string;
}

async function main() {
  try {
    // Ler contexto do arquivo passado como argumento
    const contextFile = process.argv[2];
    if (!contextFile || !fs.existsSync(contextFile)) {
      throw new Error('Context file not provided or not found');
    }

    const contextData = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
    const input: ProcessLeadInput = contextData.input as ProcessLeadInput;
    const tenantId = contextData.tenantId || input.tenant_id;
    const userId = contextData.userId || input.user_id;

    if (!tenantId) {
      throw new Error('tenant_id is required');
    }

    // Inicializar Supabase
    const supabaseUrl = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) || '';
    const supabaseKey = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : process.env.SUPABASE_SERVICE_ROLE_KEY) || '';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not found');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validar inputs obrigatórios
    if (!input.name) {
      throw new Error('name is required');
    }

    const normalizedEmail = normalizeEmail(input.email);
    const normalizedName = normalizeName(input.name);

    // Verificar duplicatas
    let existingLead: any = null;
    let deduplicationMethod: string | null = null;

    // 1. Buscar por email
    if (normalizedEmail) {
      const { data: leads, error } = await supabase
        .from('leads')
        .select('*')
        .eq('organization_id', tenantId)
        .order('created_at', { ascending: false });

      if (!error && leads) {
        existingLead = leads.find(lead => normalizeEmail(lead.email) === normalizedEmail);
        if (existingLead) {
          deduplicationMethod = 'email';
        }
      }
    }

    // 2. Buscar por nome no mesmo dia
    if (!existingLead && normalizedName) {
      const today = new Date();
      const { start, end } = getDayBoundaries(today);
      
      const { data: todayLeads, error } = await supabase
        .from('leads')
        .select('*')
        .eq('organization_id', tenantId)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });

      if (!error && todayLeads) {
        existingLead = todayLeads.find(lead => normalizeName(lead.name) === normalizedName);
        if (existingLead) {
          deduplicationMethod = 'name_same_day';
        }
      }
    }

    let result: ProcessLeadOutput;

    if (existingLead) {
      // Unificar com lead existente
      const updatedData: Record<string, any> = {};
      
      if (input.phone && !existingLead.phone) updatedData.phone = input.phone;
      if (input.company && !existingLead.company) updatedData.company = input.company;
      if (input.segment && !existingLead.segment) updatedData.segment = input.segment;
      if (input.faturamento && !existingLead.faturamento) updatedData.faturamento = input.faturamento;
      if (input.urgency && !existingLead.urgency) updatedData.urgency = input.urgency;
      if (input.sdr_id && !existingLead.sdr_id) updatedData.sdr_id = input.sdr_id;
      
      if (deduplicationMethod === 'name_same_day' && normalizedEmail && !existingLead.email) {
        updatedData.email = input.email;
      }

      if (input.rating && parseInt(String(input.rating), 10) > (existingLead.rating || 0)) {
        updatedData.rating = parseInt(String(input.rating), 10);
      }

      if (input.notes) {
        updatedData.notes = existingLead.notes 
          ? `${existingLead.notes}\n\n[Unificado] ${input.notes}`
          : input.notes;
      }

      if (Object.keys(updatedData).length > 0) {
        const { error: updateError } = await supabase
          .from('leads')
          .update(updatedData)
          .eq('id', existingLead.id);

        if (updateError) {
          throw new Error(`Failed to update lead: ${updateError.message}`);
        }
      }

      // Criar histórico
      await supabase.from('lead_history').insert({
        lead_id: existingLead.id,
        organization_id: tenantId,
        action: 'Lead unificado',
        description: `Lead duplicado detectado (${deduplicationMethod}). Dados mesclados automaticamente.`,
      });

      // Log de auditoria
      await executionLogger.audit('unify', 'lead', {
        tenantId,
        userId,
        metadata: {
          leadId: existingLead.id,
          deduplicationMethod,
        },
      });

      result = {
        lead_id: existingLead.id,
        action: 'unified',
        deduplication_method: deduplicationMethod || undefined,
        pipe: input.compromisso_date ? 'confirmacao' : undefined,
      };
    } else {
      // Criar novo lead
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .insert({
          name: input.name,
          email: input.email,
          phone: input.phone,
          company: input.company,
          origin: input.origin,
          segment: input.segment,
          faturamento: input.faturamento || null,
          urgency: input.urgency,
          notes: input.notes,
          rating: input.rating ? parseInt(String(input.rating), 10) : 0,
          sdr_id: input.sdr_id,
          compromisso_date: input.compromisso_date || null,
          organization_id: tenantId,
        })
        .select()
        .single();

      if (leadError) {
        throw new Error(`Failed to create lead: ${leadError.message}`);
      }

      // Rotear para pipe apropriado
      if (lead.compromisso_date) {
        await supabase.from('pipe_confirmacao').insert({
          lead_id: lead.id,
          organization_id: tenantId,
          status: 'reuniao_marcada',
          sdr_id: input.sdr_id || null,
          meeting_date: lead.compromisso_date,
        });
      } else {
        await supabase.from('pipe_whatsapp').insert({
          lead_id: lead.id,
          organization_id: tenantId,
          status: 'novo',
          sdr_id: input.sdr_id || null,
        });
      }

      // Criar histórico
      await supabase.from('lead_history').insert({
        lead_id: lead.id,
        organization_id: tenantId,
        action: 'Lead criado via integração',
        description: `Lead ${input.name} adicionado automaticamente`,
      });

      // Log de auditoria
      await executionLogger.audit('create', 'lead', {
        tenantId,
        userId,
        metadata: {
          leadId: lead.id,
          origin: input.origin,
        },
      });

      result = {
        lead_id: lead.id,
        action: 'created',
        pipe: lead.compromisso_date ? 'confirmacao' : 'whatsapp',
      };
    }

    // Output JSON para o orquestrador
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
    process.exit(1);
  }
}

    // Executar apenas se chamado diretamente
    if (typeof require !== 'undefined' && require.main === module) {
      main();
    } else if (typeof Deno !== 'undefined') {
      // Deno environment
      if (import.meta.main) {
        main();
      }
    }

export { main as processLead };
