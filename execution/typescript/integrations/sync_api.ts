/**
 * Sync API - Script de Execução
 * 
 * Sincroniza dados com APIs externas
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { executionLogger } from '../_shared/logger';

interface SyncAPIInput {
  api_endpoint: string;
  api_credentials: {
    api_key?: string;
    username?: string;
    password?: string;
    token?: string;
  };
  sync_direction: 'pull' | 'push' | 'bidirectional';
  entity_type: 'leads' | 'contacts' | 'deals';
  filters?: Record<string, any>;
  tenant_id: string;
  user_id: string;
}

interface SyncAPIOutput {
  records_synced: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  sync_timestamp: string;
}

async function main() {
  try {
    const contextFile = process.argv[2];
    if (!contextFile || !fs.existsSync(contextFile)) {
      throw new Error('Context file not provided or not found');
    }

    const contextData = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
    const input = contextData.input as SyncAPIInput;
    const tenantId = contextData.tenantId || input.tenant_id;
    const userId = contextData.userId || input.user_id;

    if (!tenantId || !input.api_endpoint) {
      throw new Error('tenant_id and api_endpoint are required');
    }

    const supabaseUrl = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) || '';
    const supabaseKey = (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : process.env.SUPABASE_SERVICE_ROLE_KEY) || '';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not found');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let recordsSynced = 0;
    let recordsCreated = 0;
    let recordsUpdated = 0;
    let recordsFailed = 0;

    // Construir headers de autenticação
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (input.api_credentials.api_key) {
      headers['X-API-Key'] = input.api_credentials.api_key;
    } else if (input.api_credentials.token) {
      headers['Authorization'] = `Bearer ${input.api_credentials.token}`;
    } else if (input.api_credentials.username && input.api_credentials.password) {
      const auth = Buffer.from(`${input.api_credentials.username}:${input.api_credentials.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    if (input.sync_direction === 'pull' || input.sync_direction === 'bidirectional') {
      // Pull: buscar dados da API externa
      const response = await fetch(input.api_endpoint, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const records = Array.isArray(data) ? data : (data.items || data.results || [data]);

      for (const record of records) {
        try {
          // Mapear para schema do sistema
          const leadData: any = {
            name: record.name || record.full_name || 'Unknown',
            email: record.email,
            phone: record.phone || record.telephone,
            company: record.company || record.company_name,
            organization_id: tenantId,
            origin: 'api_sync',
          };

          // Verificar se já existe
          const { data: existing } = await supabase
            .from('leads')
            .select('id')
            .eq('organization_id', tenantId)
            .eq('email', leadData.email)
            .single();

          if (existing) {
            await supabase
              .from('leads')
              .update(leadData)
              .eq('id', existing.id);
            recordsUpdated++;
          } else {
            await supabase.from('leads').insert(leadData);
            recordsCreated++;
          }
          recordsSynced++;
        } catch (error) {
          recordsFailed++;
        }
      }
    }

    if (input.sync_direction === 'push' || input.sync_direction === 'bidirectional') {
      // Push: enviar dados para API externa
      const { data: leads } = await supabase
        .from('leads')
        .select('*')
        .eq('organization_id', tenantId);

      if (leads) {
        for (const lead of leads) {
          try {
            await fetch(input.api_endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                name: lead.name,
                email: lead.email,
                phone: lead.phone,
                company: lead.company,
              }),
            });
            recordsSynced++;
          } catch (error) {
            recordsFailed++;
          }
        }
      }
    }

    console.log(JSON.stringify({
      records_synced: recordsSynced,
      records_created: recordsCreated,
      records_updated: recordsUpdated,
      records_failed: recordsFailed,
      sync_timestamp: new Date().toISOString(),
    }));

    // Log de auditoria
    await executionLogger.audit('sync', 'api', {
      tenantId,
      userId,
      metadata: {
        entityType: input.entity_type,
        syncDirection: input.sync_direction,
        recordsSynced,
      },
    });
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

export { main as syncAPI };
