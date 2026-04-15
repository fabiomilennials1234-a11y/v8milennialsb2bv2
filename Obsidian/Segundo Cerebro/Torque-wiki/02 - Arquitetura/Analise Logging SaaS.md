---
tags:
  - torque-crm
  - arquitetura
created: 2026-04-14
last_updated: 2026-04-14
status: active
---

# Análise e Melhorias: Sistema de Logging para SaaS Multi-Tenant

**Data:** 23 de Janeiro de 2026  
**Contexto:** Sistema SaaS B2B com múltiplas empresas/tenants  
**Objetivo:** Implementar logging seguro, auditável e escalável

---

## 📊 Situação Atual

### Problemas Identificados

1. **Logging Inexistente Estruturado**
   - ❌ 91 ocorrências de `console.log/error/warn` espalhadas pelo código
   - ❌ Sem separação entre logs de desenvolvimento e produção
   - ❌ Logs expoem dados sensíveis (emails, IDs, tokens)
   - ❌ Sem rastreamento de açoes por tenant/organização
   - ❌ Sem auditoria de açoes críticas

2. **Multi-Tenancy Não Implementado**
   - ❌ Não há separação de dados por organização/empresa
   - ❌ Todos os dados são compartilhados entre tenants
   - ❌ Risco crítico de vazamento de dados entre empresas
   - ❌ Sem validação de pagamento/subscription

3. **Autenticação Básica**
   - ✅ Autenticação via Supabase Auth (bom)
   - ❌ Sem verificação de subscription ativa
   - ❌ Sem controle de acesso baseado em roles por tenant
   - ❌ Sem rate limiting por tenant

4. **Segurança de Logs**
   - ❌ Logs podem conter informaçoes sensíveis
   - ❌ Sem sanitização de dados antes de logar
   - ❌ Logs não são criptografados
   - ❌ Sem retenção/rotação de logs

---

## 🎯 Proposta de Solução

### 1. Sistema de Logging Estruturado

#### 1.1 Biblioteca de Logging

Criar sistema centralizado de logging com níveis e contexto:

```typescript
// src/lib/logger.ts
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  AUDIT = 'audit', // Para açoes críticas
}

export interface LogContext {
  userId?: string;
  tenantId?: string;
  action?: string;
  resource?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}
```

#### 1.2 Implementação do Logger

```typescript
// src/lib/logger.ts
class Logger {
  private sanitize(data: unknown): unknown {
    // Remove dados sensíveis antes de logar
    if (typeof data === 'string') {
      // Remove emails, tokens, senhas
      return data
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]')
        .replace(/\b[A-Za-z0-9]{32,}\b/g, (match) => 
          match.length > 40 ? '[TOKEN_REDACTED]' : match
        );
    }
    if (typeof data === 'object' && data !== null) {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        // Campos sensíveis
        if (['password', 'token', 'secret', 'key', 'auth', 'credential'].some(s => 
          key.toLowerCase().includes(s)
        )) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(value);
        }
      }
      return sanitized;
    }
    return data;
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    context: LogContext = {},
    error?: Error
  ): LogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: {
        ...context,
        metadata: context.metadata ? this.sanitize(context.metadata) : undefined,
      },
      error: error ? {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      } : undefined,
    };
  }

  private async sendToBackend(entry: LogEntry): Promise<void> {
    // Em produção, enviar para backend/Supabase
    if (import.meta.env.PROD) {
      try {
        await supabase.from('application_logs').insert({
          level: entry.level,
          message: entry.message,
          timestamp: entry.timestamp,
          user_id: entry.context.userId,
          tenant_id: entry.context.tenantId,
          action: entry.context.action,
          resource: entry.context.resource,
          ip_address: entry.context.ipAddress,
          user_agent: entry.context.userAgent,
          metadata: entry.context.metadata,
          error: entry.error,
        });
      } catch (err) {
        // Fallback para console em caso de falha
        console.error('[Logger Error]', err);
      }
    } else {
      // Em desenvolvimento, usar console formatado
      const prefix = `[${entry.level.toUpperCase()}]`;
      const contextStr = entry.context.tenantId 
        ? `[Tenant: ${entry.context.tenantId}]` 
        : '';
      console.log(prefix, contextStr, entry.message, entry.context);
    }
  }

  async debug(message: string, context?: LogContext): Promise<void> {
    if (import.meta.env.DEV) {
      const entry = this.createLogEntry(LogLevel.DEBUG, message, context);
      await this.sendToBackend(entry);
    }
  }

  async info(message: string, context?: LogContext): Promise<void> {
    const entry = this.createLogEntry(LogLevel.INFO, message, context);
    await this.sendToBackend(entry);
  }

  async warn(message: string, context?: LogContext): Promise<void> {
    const entry = this.createLogEntry(LogLevel.WARN, message, context);
    await this.sendToBackend(entry);
  }

  async error(message: string, error: Error, context?: LogContext): Promise<void> {
    const entry = this.createLogEntry(LogLevel.ERROR, message, context, error);
    await this.sendToBackend(entry);
  }

  async audit(
    action: string,
    resource: string,
    context?: LogContext
  ): Promise<void> {
    // Logs de auditoria são sempre salvos, mesmo em produção
    const entry = this.createLogEntry(
      LogLevel.AUDIT,
      `AUDIT: ${action} on ${resource}`,
      { ...context, action, resource }
    );
    await this.sendToBackend(entry);
  }
}

export const logger = new Logger();
```

#### 1.3 Hook de Logging para React

```typescript
// src/hooks/useLogger.ts
import { useAuth } from '@/contexts/AuthContext';
import { logger, type LogContext } from '@/lib/logger';

export function useLogger() {
  const { user } = useAuth();
  
  const getContext = (additional?: LogContext): LogContext => ({
    userId: user?.id,
    tenantId: user?.user_metadata?.tenant_id, // Assumindo tenant_id no metadata
    ...additional,
  });

  return {
    debug: (message: string, context?: LogContext) => 
      logger.debug(message, { ...getContext(), ...context }),
    info: (message: string, context?: LogContext) => 
      logger.info(message, { ...getContext(), ...context }),
    warn: (message: string, context?: LogContext) => 
      logger.warn(message, { ...getContext(), ...context }),
    error: (message: string, error: Error, context?: LogContext) => 
      logger.error(message, error, { ...getContext(), ...context }),
    audit: (action: string, resource: string, context?: LogContext) => 
      logger.audit(action, resource, { ...getContext(), ...context }),
  };
}
```

---

### 2. Sistema Multi-Tenant

#### 2.1 Estrutura de Dados

Adicionar `tenant_id` (ou `organization_id`) em todas as tabelas:

```sql
-- Migration: add_tenant_support.sql

-- Tabela de organizaçoes/tenants
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  subscription_status TEXT NOT NULL DEFAULT 'trial', -- trial, active, suspended, cancelled
  subscription_plan TEXT, -- basic, pro, enterprise
  subscription_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Adicionar tenant_id em tabelas existentes
ALTER TABLE leads ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE team_members ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE campanhas ADD COLUMN organization_id UUID REFERENCES organizations(id);
-- ... adicionar em todas as tabelas relevantes

-- Índices para performance
CREATE INDEX idx_leads_organization_id ON leads(organization_id);
CREATE INDEX idx_team_members_organization_id ON team_members(organization_id);
-- ... índices para todas as tabelas

-- RLS (Row Level Security) para isolamento automático
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only see leads from their organization"
  ON leads FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM team_members 
      WHERE user_id = auth.uid()
    )
  );

-- Similar para outras tabelas
```

#### 2.2 Middleware de Tenant

```typescript
// src/lib/tenant.ts
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export async function getCurrentTenant(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Buscar tenant do usuário
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single();

  return teamMember?.organization_id || null;
}

export function useTenant() {
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      getCurrentTenant().then(setTenantId);
    }
  }, [user]);

  return tenantId;
}
```

#### 2.3 Hooks com Tenant Automático

```typescript
// src/hooks/useLeads.ts (atualizado)
export function useLeads() {
  const tenantId = useTenant();
  
  return useQuery({
    queryKey: ["leads", tenantId],
    queryFn: async () => {
      if (!tenantId) throw new Error("No tenant context");
      
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("organization_id", tenantId) // Filtro automático por tenant
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });
}
```

---

### 3. Validação de Pagamento/Subscription

#### 3.1 Verificação de Subscription

```typescript
// src/lib/subscription.ts
export interface SubscriptionStatus {
  status: 'trial' | 'active' | 'suspended' | 'cancelled' | 'expired';
  plan: string | null;
  expiresAt: string | null;
  isValid: boolean;
}

export async function checkSubscription(
  organizationId: string
): Promise<SubscriptionStatus> {
  const { data: org, error } = await supabase
    .from('organizations')
    .select('subscription_status, subscription_plan, subscription_expires_at')
    .eq('id', organizationId)
    .single();

  if (error || !org) {
    return {
      status: 'expired',
      plan: null,
      expiresAt: null,
      isValid: false,
    };
  }

  const now = new Date();
  const expiresAt = org.subscription_expires_at 
    ? new Date(org.subscription_expires_at) 
    : null;

  const isValid = 
    org.subscription_status === 'active' &&
    (!expiresAt || expiresAt > now);

  return {
    status: org.subscription_status,
    plan: org.subscription_plan,
    expiresAt: org.subscription_expires_at,
    isValid,
  };
}
```

#### 3.2 Protected Route com Subscription

```typescript
// src/components/SubscriptionProtectedRoute.tsx
export function SubscriptionProtectedRoute({ 
  children 
}: { children: ReactNode }) {
  const { user } = useAuth();
  const tenantId = useTenant();
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tenantId) {
      checkSubscription(tenantId).then(setSubscription).finally(() => setLoading(false));
    }
  }, [tenantId]);

  if (loading) return <LoadingSpinner />;
  if (!subscription?.isValid) {
    return <Navigate to="/subscription-required" />;
  }

  return <>{children}</>;
}
```

#### 3.3 Webhook de Pagamento (Stripe/Asaas)

```typescript
// supabase/functions/webhook-payment/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    
    // Verificar assinatura do webhook (Stripe/Asaas)
    // ... validação de assinatura ...

    const eventType = body.type || body.event;
    const customerId = body.customer || body.customer_id;
    const subscriptionId = body.subscription || body.subscription_id;

    // Buscar organização pelo customer_id
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('payment_customer_id', customerId)
      .single();

    if (!org) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atualizar status baseado no evento
    let subscriptionStatus = 'active';
    let expiresAt: string | null = null;

    switch (eventType) {
      case 'payment.succeeded':
      case 'subscription.created':
        subscriptionStatus = 'active';
        expiresAt = body.current_period_end 
          ? new Date(body.current_period_end * 1000).toISOString()
          : null;
        break;
      case 'subscription.cancelled':
        subscriptionStatus = 'cancelled';
        break;
      case 'payment.failed':
        subscriptionStatus = 'suspended';
        break;
    }

    await supabase
      .from('organizations')
      .update({
        subscription_status: subscriptionStatus,
        subscription_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', org.id);

    // Log de auditoria
    await supabase.from('application_logs').insert({
      level: 'audit',
      message: `Subscription updated: ${eventType}`,
      tenant_id: org.id,
      action: 'subscription_update',
      resource: 'organization',
      metadata: { eventType, customerId, subscriptionId },
    });

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

---

### 4. Tabela de Logs no Banco

```sql
-- Migration: create_application_logs.sql

CREATE TABLE application_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error', 'audit')),
  message TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id),
  tenant_id UUID REFERENCES organizations(id),
  action TEXT,
  resource TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB,
  error JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para queries rápidas
CREATE INDEX idx_logs_tenant_timestamp ON application_logs(tenant_id, timestamp DESC);
CREATE INDEX idx_logs_level ON application_logs(level);
CREATE INDEX idx_logs_action ON application_logs(action);
CREATE INDEX idx_logs_user ON application_logs(user_id, timestamp DESC);

-- RLS para isolamento por tenant
ALTER TABLE application_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only see logs from their organization"
  ON application_logs FOR SELECT
  USING (
    tenant_id IN (
      SELECT organization_id 
      FROM team_members 
      WHERE user_id = auth.uid()
    )
  );

-- Política para inserção (apenas sistema)
-- Service role pode inserir, usuários não podem inserir diretamente
```

---

### 5. Dashboard de Logs (Opcional)

```typescript
// src/pages/Logs.tsx (apenas para admins)
export function Logs() {
  const tenantId = useTenant();
  const { data: logs } = useQuery({
    queryKey: ["logs", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("application_logs")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("timestamp", { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });

  return (
    <div>
      <h1>Logs do Sistema</h1>
      {/* Tabela de logs com filtros */}
    </div>
  );
}
```

---

## 🔐 Segurança de Logs

### Regras de Sanitização

1. **Nunca logar:**
   - Senhas (mesmo hasheadas)
   - Tokens de autenticação
   - Chaves de API
   - Dados de cartão de crédito
   - CPF/CNPJ completos (usar apenas últimos 4 dígitos)

2. **Sempre sanitizar:**
   - Emails (substituir por `[EMAIL_REDACTED]`)
   - Tokens longos (substituir por `[TOKEN_REDACTED]`)
   - IPs podem ser logados (úteis para segurança)

3. **Logs de auditoria:**
   - Açoes críticas (criação/edição/exclusão de dados)
   - Mudanças de permissoes
   - Acessos a dados sensíveis
   - Mudanças de subscription

---

## 📋 Checklist de Implementação

### Fase 1: Fundação (Semana 1)
- [ ] Criar tabela `organizations`
- [ ] Criar tabela `application_logs`
- [ ] Adicionar `organization_id` em tabelas principais
- [ ] Implementar RLS (Row Level Security)
- [ ] Criar sistema de logging básico

### Fase 2: Multi-Tenancy (Semana 2)
- [ ] Atualizar todos os hooks para filtrar por tenant
- [ ] Implementar `useTenant()` hook
- [ ] Atualizar webhooks para incluir tenant_id
- [ ] Testar isolamento de dados

### Fase 3: Subscription (Semana 3)
- [ ] Implementar verificação de subscription
- [ ] Criar webhook de pagamento
- [ ] Adicionar `SubscriptionProtectedRoute`
- [ ] Página de "Subscription Required"

### Fase 4: Logging Completo (Semana 4)
- [ ] Substituir todos os `console.log` por `logger`
- [ ] Adicionar logs de auditoria em açoes críticas
- [ ] Implementar dashboard de logs (opcional)
- [ ] Configurar retenção de logs

---

## 🚨 Açoes Imediatas (Críticas)

1. **URGENTE:** Implementar multi-tenancy antes de vender
   - Sem isso, empresas verão dados de outras empresas
   - Risco legal e de segurança crítico

2. **URGENTE:** Implementar validação de pagamento
   - Sem isso, usuários podem usar sem pagar

3. **IMPORTANTE:** Substituir console.logs
   - Expor dados sensíveis em produção
   - Poluir logs do navegador

---

## 📊 Métricas de Sucesso

- ✅ Zero vazamento de dados entre tenants
- ✅ 100% das açoes críticas auditadas
- ✅ Zero logs com dados sensíveis
- ✅ Subscription validada em todas as rotas protegidas
- ✅ Performance: queries com tenant_id < 100ms

---

**Próximo passo:** Implementar Fase 1 (Fundação) imediatamente antes de qualquer venda.


## Links relacionados

- [[MOC - Arquitetura]]

- [[Gestao de Time]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Campanhas]]

- [[Asaas Pagamentos]]

- [[00 - INDEX]]
