# Exemplos de Uso do Sistema de Logging

## 1. Uso Básico em Componentes React

```typescript
// src/pages/Leads.tsx
import { useLogger } from '@/hooks/useLogger';

export default function Leads() {
  const log = useLogger();
  const { data: leads, isLoading } = useLeads();

  useEffect(() => {
    log.info('Leads page loaded', {
      action: 'page_view',
      resource: 'leads',
    });
  }, []);

  const handleCreateLead = async (leadData: LeadInsert) => {
    try {
      const result = await createLead.mutateAsync(leadData);
      
      // Log de sucesso
      log.info('Lead created successfully', {
        action: 'create',
        resource: 'lead',
        metadata: { leadId: result.id },
      });

      // Log de auditoria (ação crítica)
      log.audit('create', 'lead', {
        metadata: { 
          leadId: result.id,
          leadName: result.name,
          origin: result.origin,
        },
      });
    } catch (error) {
      // Log de erro
      log.error('Failed to create lead', error as Error, {
        action: 'create',
        resource: 'lead',
        metadata: { leadData },
      });
    }
  };

  return (
    // ... componente
  );
}
```

## 2. Uso em Hooks

```typescript
// src/hooks/useLeads.ts
import { logger } from '@/lib/logger';

export function useLeads() {
  const tenantId = useTenant();
  
  return useQuery({
    queryKey: ["leads", tenantId],
    queryFn: async () => {
      if (!tenantId) {
        logger.warn('Attempted to fetch leads without tenant context', {
          tenantId: null,
          action: 'fetch',
          resource: 'leads',
        });
        throw new Error("No tenant context");
      }
      
      logger.debug('Fetching leads', {
        tenantId,
        action: 'fetch',
        resource: 'leads',
      });

      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("organization_id", tenantId)
        .order("created_at", { ascending: false });
      
      if (error) {
        logger.error('Failed to fetch leads', error, {
          tenantId,
          action: 'fetch',
          resource: 'leads',
        });
        throw error;
      }

      logger.info('Leads fetched successfully', {
        tenantId,
        action: 'fetch',
        resource: 'leads',
        metadata: { count: data?.length || 0 },
      });

      return data;
    },
    enabled: !!tenantId,
  });
}
```

## 3. Uso em Webhooks (Edge Functions)

```typescript
// supabase/functions/webhook-new-lead/index.ts
import { logger } from '../_shared/logger.ts';

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    
    logger.info('Webhook received', {
      action: 'webhook_received',
      resource: 'webhook',
      metadata: { 
        source: 'n8n',
        hasName: !!body.name,
        hasEmail: !!body.email,
      },
    });

    // ... processamento ...

    if (existingLead) {
      logger.audit('lead_unified', 'lead', {
        tenantId: existingLead.organization_id,
        metadata: {
          existingLeadId: existingLead.id,
          deduplicationMethod: 'email',
        },
      });
    } else {
      logger.audit('lead_created', 'lead', {
        tenantId: lead.organization_id,
        metadata: {
          leadId: lead.id,
          origin: lead.origin,
        },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    logger.error('Webhook error', error, {
      action: 'webhook_error',
      resource: 'webhook',
    });

    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
```

## 4. Logs de Auditoria (Ações Críticas)

```typescript
// Exemplos de quando usar log.audit():

// 1. Criação/Edição/Exclusão de dados sensíveis
log.audit('delete', 'lead', {
  metadata: { leadId: lead.id, leadName: lead.name },
});

// 2. Mudanças de permissões
log.audit('update', 'team_member_role', {
  metadata: { 
    teamMemberId: member.id,
    oldRole: oldRole,
    newRole: newRole,
  },
});

// 3. Acessos a dados sensíveis
log.audit('access', 'sensitive_data', {
  metadata: { 
    dataType: 'financial_reports',
    reportId: report.id,
  },
});

// 4. Mudanças de subscription
log.audit('update', 'subscription', {
  metadata: {
    organizationId: org.id,
    oldStatus: oldStatus,
    newStatus: newStatus,
    plan: org.subscription_plan,
  },
});

// 5. Exportação de dados
log.audit('export', 'data', {
  metadata: {
    exportType: 'leads_csv',
    recordCount: leads.length,
  },
});
```

## 5. Substituindo console.logs Existentes

### Antes:
```typescript
console.log("Received lead data:", { name, email, phone });
console.error("Error creating lead:", error);
```

### Depois:
```typescript
const log = useLogger();

log.info("Lead data received", {
  action: 'receive',
  resource: 'lead',
  metadata: { 
    hasName: !!name,
    hasEmail: !!email,
    hasPhone: !!phone,
  },
});

log.error("Failed to create lead", error, {
  action: 'create',
  resource: 'lead',
});
```

## 6. Logging em Context Providers

```typescript
// src/contexts/AuthContext.tsx
import { logger } from '@/lib/logger';

export function AuthProvider({ children }: { children: ReactNode }) {
  // ...

  const signIn = async (email: string, password: string) => {
    logger.info('Login attempt', {
      action: 'login_attempt',
      resource: 'auth',
      metadata: { email: '[REDACTED]' }, // Email já será sanitizado automaticamente
    });

    const { error, data } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      logger.warn('Login failed', {
        action: 'login_failed',
        resource: 'auth',
        metadata: { errorCode: error.message },
      });
    } else {
      logger.audit('login', 'auth', {
        userId: data.user?.id,
        metadata: { 
          email: '[REDACTED]',
          provider: 'email',
        },
      });
    }

    return { error: error as Error | null };
  };

  // ...
}
```

## 7. Tratamento de Erros com Logging

```typescript
// src/pages/Dashboard.tsx
import { useLogger } from '@/hooks/useLogger';

export default function Dashboard() {
  const log = useLogger();
  const { data, error, isLoading } = useDashboardMetrics();

  useEffect(() => {
    if (error) {
      log.error('Failed to load dashboard metrics', error, {
        action: 'fetch',
        resource: 'dashboard_metrics',
      });
    }
  }, [error, log]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage />;

  return (
    // ... dashboard
  );
}
```

## 8. Logging de Performance

```typescript
// Exemplo: medir tempo de operação
const startTime = performance.now();

try {
  await processLargeDataset();
  
  const duration = performance.now() - startTime;
  
  log.info('Large dataset processed', {
    action: 'process',
    resource: 'dataset',
    metadata: {
      duration: `${duration.toFixed(2)}ms`,
      recordCount: dataset.length,
    },
  });
} catch (error) {
  log.error('Failed to process dataset', error, {
    action: 'process',
    resource: 'dataset',
    metadata: {
      duration: `${(performance.now() - startTime).toFixed(2)}ms`,
    },
  });
}
```

## 9. Logging Condicional por Ambiente

```typescript
// O logger já faz isso automaticamente:
// - DEBUG: apenas em desenvolvimento
// - INFO/WARN/ERROR: sempre
// - AUDIT: sempre (mesmo em produção)

// Você não precisa fazer nada especial, apenas usar:
log.debug('This will only log in development', { ... });
log.info('This will always log', { ... });
log.audit('This will always log, even in production', 'resource', { ... });
```

## 10. Buscar Logs no Banco

```typescript
// src/pages/Admin/Logs.tsx (apenas para admins)
export function LogsViewer() {
  const tenantId = useTenant();
  const [filters, setFilters] = useState({
    level: null as string | null,
    action: null as string | null,
    startDate: null as Date | null,
    endDate: null as Date | null,
  });

  const { data: logs } = useQuery({
    queryKey: ['logs', tenantId, filters],
    queryFn: async () => {
      let query = supabase
        .from('application_logs')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('timestamp', { ascending: false })
        .limit(100);

      if (filters.level) {
        query = query.eq('level', filters.level);
      }
      if (filters.action) {
        query = query.eq('action', filters.action);
      }
      if (filters.startDate) {
        query = query.gte('timestamp', filters.startDate.toISOString());
      }
      if (filters.endDate) {
        query = query.lte('timestamp', filters.endDate.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });

  return (
    <div>
      {/* Filtros */}
      {/* Tabela de logs */}
    </div>
  );
}
```

---

## Checklist de Migração

Para migrar do sistema atual para o novo sistema de logging:

- [ ] Substituir `console.log` por `log.info()` ou `log.debug()`
- [ ] Substituir `console.error` por `log.error()`
- [ ] Substituir `console.warn` por `log.warn()`
- [ ] Adicionar `log.audit()` em ações críticas
- [ ] Adicionar contexto (action, resource, metadata) em todos os logs
- [ ] Testar que dados sensíveis são sanitizados
- [ ] Verificar que logs são salvos no banco em produção
- [ ] Configurar limpeza automática de logs antigos
