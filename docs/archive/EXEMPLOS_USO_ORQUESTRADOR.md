# Exemplos de Uso do Sistema de Orquestração

## Exemplo 1: Processar Lead via Webhook

```typescript
// supabase/functions/webhook-new-lead/index.ts
import { agent } from '../../orchestration/agent';
import { getCorsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Identificar tenant (pode vir do body ou header)
    const tenantId = body.organization_id || req.headers.get('x-tenant-id');
    
    if (!tenantId) {
      return new Response(
        JSON.stringify({ error: "organization_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Usar orquestrador para processar
    const result = await agent.executeDirective(
      'business/process_lead.md',
      {
        name: body.name,
        email: body.email,
        phone: body.phone,
        company: body.company,
        origin: body.origin || 'outro',
        segment: body.segment,
        faturamento: body.faturamento,
        urgency: body.urgency,
        notes: body.notes,
        rating: body.rating,
        sdr_id: body.sdr_id,
        compromisso_date: body.compromisso_date,
      },
      {
        tenantId,
        userId: null, // Webhook não tem usuário
      }
    );

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const output = JSON.parse(result.executionResult?.output || '{}');
    
    return new Response(
      JSON.stringify({
        success: true,
        lead_id: output.lead_id,
        action: output.action,
        pipe: output.pipe,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

## Exemplo 2: Criar Follow-ups Automáticos

```typescript
// src/hooks/useAutoFollowUp.ts (atualizado)
import { agent } from '@/orchestration/agent';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';

export function useAutoFollowUp() {
  const { user } = useAuth();
  const tenantId = useTenant();

  const triggerFollowUpAutomation = async (
    leadId: string,
    pipeType: string,
    stage: string,
    automationRules: any
  ) => {
    if (!tenantId || !user) return;

    const result = await agent.executeDirective(
      'business/follow_up_automation.md',
      {
        lead_id: leadId,
        pipe_type: pipeType,
        stage,
        automation_rules: automationRules,
      },
      {
        tenantId,
        userId: user.id,
      }
    );

    if (result.success) {
      const output = JSON.parse(result.executionResult?.output || '{}');
      console.log(`Created ${output.follow_ups_created} follow-ups`);
    }
  };

  return { triggerFollowUpAutomation };
}
```

## Exemplo 3: Processar Campanha

```typescript
// src/pages/CampanhaDetail.tsx
import { agent } from '@/orchestration/agent';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/contexts/AuthContext';

export function CampanhaDetail() {
  const tenantId = useTenant();
  const { user } = useAuth();

  const processCampaign = async (campaignId: string, leads: any[]) => {
    if (!tenantId || !user) return;

    const result = await agent.executeDirective(
      'business/campaign_processing.md',
      {
        campaign_id: campaignId,
        leads,
        assignment_rules: {
          method: 'round_robin',
        },
      },
      {
        tenantId,
        userId: user.id,
      }
    );

    if (result.success) {
      const output = JSON.parse(result.executionResult?.output || '{}');
      toast.success(`Processados ${output.leads_processed} leads`);
    } else {
      toast.error(`Erro: ${result.error}`);
    }
  };

  // ...
}
```

## Exemplo 4: Importar Leads de CSV

```typescript
// src/components/campanhas/ImportLeadsModal.tsx
import { agent } from '@/orchestration/agent';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/contexts/AuthContext';

export function ImportLeadsModal() {
  const tenantId = useTenant();
  const { user } = useAuth();

  const handleImport = async (file: File, columnMapping: Record<string, string>) => {
    if (!tenantId || !user) return;

    // Upload arquivo para .tmp primeiro
    const filePath = `/tmp/import_${Date.now()}.csv`;
    // ... código de upload ...

    const result = await agent.executeDirective(
      'data_processing/import_leads.md',
      {
        file_path: filePath,
        column_mapping: columnMapping,
        skip_duplicates: true,
        batch_size: 100,
      },
      {
        tenantId,
        userId: user.id,
      }
    );

    if (result.success) {
      const output = JSON.parse(result.executionResult?.output || '{}');
      toast.success(
        `Importados ${output.leads_imported} leads. ` +
        `${output.leads_skipped} duplicados pulados.`
      );
    }
  };

  // ...
}
```

## Exemplo 5: Processar Webhook de Pagamento

```typescript
// supabase/functions/webhook-payment/index.ts
import { agent } from '../../orchestration/agent';
import { getCorsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const signature = req.headers.get('stripe-signature') || 
                     req.headers.get('asaas-signature');

    // Identificar provedor
    const provider = req.headers.get('x-payment-provider') || 'stripe';

    const result = await agent.executeDirective(
      'integrations/payment_webhook.md',
      {
        event_type: body.type || body.event,
        customer_id: body.customer || body.customer_id,
        subscription_id: body.subscription || body.subscription_id,
        payload: body,
        signature,
        provider,
      },
      {
        // tenantId será identificado pelo customer_id no script
      }
    );

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

## Exemplo 6: Sincronizar com API Externa

```typescript
// Background job ou função agendada
import { agent } from '@/orchestration/agent';

async function syncExternalAPI() {
  const tenants = await getActiveTenants(); // Sua função para buscar tenants ativos

  for (const tenant of tenants) {
    const result = await agent.executeDirective(
      'integrations/api_sync.md',
      {
        api_endpoint: 'https://api.external.com/contacts',
        api_credentials: {
          api_key: tenant.api_key,
        },
        sync_direction: 'pull',
        entity_type: 'leads',
        filters: {
          updated_at: { gte: getLastSyncDate(tenant.id) },
        },
      },
      {
        tenantId: tenant.id,
        userId: null, // Background job
      }
    );

    if (result.success) {
      console.log(`Synced ${JSON.parse(result.executionResult?.output || '{}').records_synced} records for tenant ${tenant.id}`);
    }
  }
}
```

## Exemplo 7: Gerar Relatório Diário

```typescript
// Via pg_cron ou função agendada
import { agent } from '@/orchestration/agent';

async function generateDailyReports() {
  const tenants = await getActiveTenants();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const today = new Date();

  for (const tenant of tenants) {
    const result = await agent.executeDirective(
      'data_processing/generate_reports.md',
      {
        report_type: 'performance',
        period_start: yesterday.toISOString(),
        period_end: today.toISOString(),
        format: 'json',
      },
      {
        tenantId: tenant.id,
        userId: null,
      }
    );

    if (result.success) {
      const output = JSON.parse(result.executionResult?.output || '{}');
      // Enviar relatório por email ou salvar
      await sendReportEmail(tenant.id, output.report_path);
    }
  }
}
```

## Exemplo 8: Listar Diretivas Disponíveis

```typescript
import { agent } from '@/orchestration/agent';

// Listar todas as diretivas
const directives = await agent.listDirectives();
console.log('Diretivas disponíveis:', directives);
// ['business/process_lead.md', 'business/follow_up_automation.md', ...]

// Obter detalhes de uma diretiva
const directive = await agent.getDirective('business/process_lead.md');
console.log('Objetivo:', directive.objective);
console.log('Entradas:', directive.inputs);
console.log('Ferramentas:', directive.tools);
```

## Exemplo 9: Tratamento de Erros

```typescript
import { agent } from '@/orchestration/agent';

try {
  const result = await agent.executeDirective(
    'business/process_lead.md',
    input,
    { tenantId, userId }
  );

  if (!result.success) {
    // Erro após todas as tentativas
    console.error('Falha após', result.retries, 'tentativas');
    console.error('Erro:', result.error);
    
    // Verificar se há aprendizado novo na diretiva
    const directive = await agent.getDirective('business/process_lead.md');
    const latestLearning = directive.learnings[directive.learnings.length - 1];
    console.log('Último aprendizado:', latestLearning);
  }
} catch (error) {
  // Erro no orquestrador (não no script)
  console.error('Erro no orquestrador:', error);
}
```

## Exemplo 10: Execução com Retry Customizado

```typescript
import { Agent } from '@/orchestration/agent';

// Criar instância com opções customizadas
const customAgent = new Agent({
  maxRetries: 5,
  retryDelay: 2000, // 2 segundos
  validateSubscription: true,
});

const result = await customAgent.executeDirective(
  'integrations/api_sync.md',
  input,
  { tenantId, userId }
);
```

## Boas Práticas

1. **Sempre passar tenantId e userId** quando disponíveis
2. **Tratar erros** e mostrar mensagens amigáveis ao usuário
3. **Logar ações críticas** usando sistema de logging
4. **Validar inputs** antes de chamar o orquestrador
5. **Usar diretivas existentes** antes de criar novas
6. **Monitorar aprendizados** para melhorar sistema continuamente
