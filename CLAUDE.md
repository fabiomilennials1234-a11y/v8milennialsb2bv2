# CLAUDE.md — Torque CRM

## O que é

SaaS B2B multi-tenant para gestão de leads, pipelines de vendas, campanhas e automações com IA. Produto da Milennials. Domínio: `torquecrm.com.br`.

- **~30 organizações ativas** (crescendo diariamente)
- **ICP**: Empresas B2B — fábricas e distribuidoras
- **Time**: CTO (Gabriel) + 1 dev junior

## Team de Agentes — Protocolo Autônomo

**OBRIGATÓRIO**: Este projeto é desenvolvido por um time de 9 agentes especializados. Toda task, alteração, ou request passa automaticamente por esse time. Nenhuma invocação manual necessária.

### Como funciona

1. **Toda task** → Invoque a skill `agent-conductor` para triagem e roteamento
2. **SDD** → `tlc-spec-driven` roda para especificação e documentação (auto-sized por escopo)
3. **Execução** → Agente(s) selecionado(s) operam com persona, regras e abordagem definidas
4. **Documentação** → Obsidian vault é atualizado com mudanças (`06 — Features/`, `07 — Changelog/`)

### O Time

| Agente | Domínio | Skill |
|--------|---------|-------|
| **Conductor** | Triagem, roteamento, orquestração | `agent-conductor` |
| **Architect** | Decisões de sistema, trade-offs, domain modeling | `agent-architect` |
| **Backend** | Edge functions, APIs, integrações, resiliência | `agent-backend` |
| **Frontend** | React, UI/UX, componentes, visual, performance | `agent-frontend` |
| **DBA** | PostgreSQL, migrations, RLS, query optimization | `agent-dba` |
| **QA** | Testes, verificação, cobertura, acessibilidade | `agent-qa` |
| **Infra** | Deploy, CI/CD, monitoring, segurança | `agent-infra` |
| **Automation** | n8n, cron jobs, webhooks, event-driven, workflows | `agent-automation` |
| **AI** | Copilot, RAG, embeddings, conversations, prompts | `agent-ai` |

### Roteamento rápido

| Sinal na task | Agente(s) |
|---------------|-----------|
| `supabase/functions/`, endpoint, payload, webhook | Backend |
| `src/components/`, `src/pages/`, UI, visual, design | Frontend |
| `supabase/migrations/`, tabela, index, RLS, SQL | DBA |
| Teste, coverage, verificação, QA | QA |
| Deploy, Docker, CI/CD, env vars, monitoring | Infra |
| n8n, cron, automação, workflow trigger | Automation |
| Copilot, agente IA, RAG, embeddings, conversation | AI |
| Arquitetura, decisão cross-cutting, trade-off | Architect |
| Feature completa nova | Architect → DBA → Backend → Frontend → QA |

### Regra de ouro

Não pule o Conductor. Não pule o SDD. Não declare pronto sem atualizar Obsidian.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + TypeScript 5.8 + Vite 5 (SWC) |
| UI | shadcn/ui (Radix) + Tailwind 3 + Lucide icons |
| State | TanStack Query v5 (server state) + React Context (auth/features) |
| Forms | React Hook Form + Zod |
| Backend | Supabase (Postgres + Auth + Edge Functions + Realtime + Storage) |
| AI | Google Gemini (embeddings 1536d) + pgvector (RAG) |
| Integrações | Evolution API (WhatsApp), Meta, Google Calendar, TinyERP, Asaas, n8n, SZ.Chat, ElevenLabs |
| Testes | Vitest (unit/integration) + Playwright (E2E) |
| Monitoring | Sentry |

## Comandos

```bash
npm run dev              # Dev server em localhost:8080
npm run build            # Build de produção (Vite)
npm run build:dev        # Build modo desenvolvimento
npm run test:unit        # Testes unitários (Vitest)
npm run test:integration # Testes de integração (precisa Supabase local)
npm run test:e2e         # E2E (Playwright + Chromium)
npm run test:coverage    # Coverage dos testes unitários
npm run lint             # ESLint
```

### Deploy

```bash
# Edge functions (produção)
supabase functions deploy <nome-funcao> --project-ref jsjsmuncfkbsbzqzqhfq

# Edge functions (dev)
supabase functions deploy <nome-funcao> --project-ref bcfadphgsibjzivtbjvc

# Frontend: VPS Hostinger via EasyPanel (Docker containers)
# Push pra main → build Docker → deploy no EasyPanel
git push origin main
```

## Ambientes

| Ambiente | Supabase Project ID | Uso |
|----------|-------------------|-----|
| **Produção** | `jsjsmuncfkbsbzqzqhfq` | Clientes reais |
| **Development** | `bcfadphgsibjzivtbjvc` | Testes e staging |

Organization principal (Milennials): `6030520a-2ca7-477d-be89-55758e2cd808`

## Estrutura

```
src/
├── components/        # 46 categorias de componentes
│   └── ui/            # 54 primitivos shadcn/ui
├── hooks/             # 122+ hooks React Query
├── pages/             # 46 páginas (lazy loaded)
├── contexts/          # Auth, OrgFeatures, ThemeTransition
├── lib/               # Utilitários, permissions, analytics
├── integrations/      # Client + types Supabase
└── types/             # Tipos globais (copilot, workflow)

supabase/
├── functions/         # 78+ edge functions (Deno)
│   └── _shared/       # 35 módulos compartilhados
└── migrations/        # 322 migrations SQL
```

## Arquitetura

### Multi-tenancy
Toda query filtra por `organization_id`. RLS no Postgres garante isolamento. O frontend nunca envia org_id manualmente — vem do contexto auth.

### Permissões (3 camadas)
```
Master Admin → Organization Admin → Feature Permissions → Role Matrix
```
- `useUserRole()` — role do usuário (admin/member)
- `useCanPerformAction(action)` — checa permissão via RPC
- `useMasterAuth()` — bypass total (admin Milennials)

### Pipelines (funis)
Leads passam por pipelines configuráveis:
- `pipe_whatsapp` — Qualificação (novo lead → abordado → respondeu → agendado)
- `pipe_confirmacao` — Confirmação de reunião
- `pipe_propostas` — Propostas comerciais
- `custom_pipelines` — Funis customizados por org

Cada pipe tem stages dinâmicas em `pipeline_stages`.

### Edge Functions
Padrão de toda edge function:
```typescript
Deno.serve(withSentry('nome', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req));
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // ... lógica
}));
```

### Realtime
`useRealtimeSubscription(table, queryKeys)` — subscreve em `postgres_changes`, filtra por `organization_id`, debounce de 2s. Usado em chat, leads, pipes.

### Cron Jobs (pg_cron)
10+ jobs rodando a cada 1 minuto via pg_net → edge functions. Autenticam via `x-cron-secret` header. Principais:
- `process-webhook-deliveries` (batch 100)
- `process-workflow-executions` (batch 20)
- `process-outbound-dispatches`
- `process-ai-actions`
- `campaign-rule-dispatch`

## Padrões de código

### Hooks (React Query)
```typescript
// Query
export function useLeads() {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["leads", organizationId],
    queryFn: async () => { /* supabase.from("leads").select(...) */ },
    enabled: !!organizationId,
  });
}

// Mutation
export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => { /* supabase.from("leads").insert(...) */ },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}
```

### Tipos do banco
```typescript
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
type Lead = Tables<"leads">;
```

### Imports
Sempre usar alias `@/`:
```typescript
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
```

### Naming
| Tipo | Convenção | Exemplo |
|------|-----------|---------|
| Componentes | PascalCase | `LeadCard.tsx` |
| Hooks | camelCase com `use` | `useLeads.ts` |
| Tabelas DB | snake_case | `lead_tags` |
| Query keys | array camelCase | `["pipe_whatsapp", orgId]` |
| Env vars | `VITE_SCREAMING_SNAKE` | `VITE_SUPABASE_URL` |

## Áreas frágeis (atenção extra)

### Copilot (agentes IA)
Fluxo que mais gera confusão com usuários e bugs recorrentes. Ao mexer aqui, sempre:
- Testar o fluxo completo: criar agente → configurar → ativar → conversar com lead
- Verificar edge cases: agente sem business_context, lead sem telefone, conversation sem messages
- Checar se a UI deixa claro o que cada config faz (muitos usuários se perdem)

**Arquivos chave:**
- `src/components/copilot/` — UI do copilot wizard e config
- `src/hooks/useCopilotAgents.ts` — CRUD de agentes
- `supabase/functions/agent-message/` — Processamento de mensagem do agente
- `supabase/functions/_shared/ai-action-executor.ts` — Executor de ações IA
- `supabase/functions/outbound-trigger/` — Disparo outbound do agente

### Permissões
Sistema de 3 camadas que tem issues recorrentes. Ao mexer:
- Testar com role `admin`, `membro`, e `master` separadamente
- Verificar RLS policies + `feature_permissions` + `member_feature_permissions`
- Checar o hook `useCanPerformAction()` e o RPC `check_action_allowed`

**Arquivos chave:**
- `src/lib/permissions.ts` — Engine de permissões frontend
- `supabase/functions/_shared/permission_engine.ts` — Engine backend
- `src/hooks/useUserRole.ts` — Role do usuário logado
- `tests/integration/permission-engine.test.ts` — Testes de integração

## Gotchas

- **JWT em edge functions**: A maioria tem `verify_jwt = false` no `config.toml`. Autenticação é feita internamente via headers customizados (`x-webhook-key`, `x-cron-secret`, Bearer token manual).
- **Supabase types**: O arquivo `src/integrations/supabase/types.ts` (270KB) é auto-gerado. Nunca edite manualmente. Regenere com `supabase gen types typescript`.
- **Deploy de edge functions**: `--no-verify-jwt` não é mais aceito na CLI. Use `verify_jwt = false` no `config.toml` (cuidado: `--no-verify-jwt=false` HABILITA JWT — double negative trap).
- **pg_net**: Disponível só no Supabase, não existe no RDS Aurora. Edge functions cron dependem dele.
- **Realtime handlers**: `onUpdate` recebe apenas campos alterados, não o row completo com joins. Dados aninhados (lead_tags, responsible) vêm do cache.
- **Body parameters no n8n**: Valores são sempre strings. Para enviar arrays (ex: tags), use JSON body ou a edge function precisa normalizar strings → arrays.
- **Build chunks**: Vite split manual configurado. Se adicionar dependência grande, adicione em `manualChunks` no `vite.config.ts`.
- **Testes de integração**: Precisam de Supabase local rodando (`supabase start`). CI faz isso automaticamente.

## Webhook lead-webhook

Endpoint principal de ingestão de leads. Aceita:
```json
{
  "source": "meta_ads",
  "organization_id": "uuid",
  "fields": { "name": "...", "phone": "...", "email": "...", "company": "..." },
  "tags": ["Ouro"],
  "place_in_pipe": { "pipe": "whatsapp", "stage": "novo_lead" },
  "assigned_user_id": "uuid",
  "update_existing_if_match": true
}
```
Tags aceita: array, string JSON `'["Ouro"]'`, ou string simples `"Ouro"`. Busca case-insensitive.

## Domínio de negócio

### O que é um Lead
Toda pessoa/empresa que entra no sistema. Tem: nome, empresa, telefone, email, origem (meta_ads, whatsapp, google_ads...), rating (1-5, manual), qualification_score (0-100, automático), tags, e responsáveis (SDR, Closer, Responsible).

### Lifecycle do Lead
```
Entrada (n8n/webhook/manual)
  → pipe_whatsapp: novo → abordado → respondeu → agendado
    → pipe_confirmacao: reuniao_marcada → confirmar_d5 → d3 → d1 → compareceu
      → pipe_propostas: proposta_enviada → vendido/perdido
        → upsell (pós-venda)
```
Um lead pode estar em MÚLTIPLOS pipes simultaneamente. Stages finais: `vendido` (positivo) ou `perdido` (negativo).

### Papéis no time
- **Admin**: Gerencia org, configura workflows, acesso total dentro da org
- **Membro**: Operador padrão, vê apenas leads atribuídos
- **Master**: Admin Milennials, acesso cross-org (invisível para clientes)

> **REGRA**: No código, roles são SEMPRE `admin`, `master`, `membro`. Nunca usar "SDR" ou "Closer" como identificador no código. SDR/Closer são conceitos de negócio — usados apenas na UI e documentação.

### Copilot (agentes IA)
Agentes de IA que conversam com leads via WhatsApp. Tipos: qualificador, sdr, followup, agendador, prospectador, custom. Cada agente tem personalidade (tom, estilo, energia), capabilities (qualificar, agendar, mover cards), regras de kanban (auto-move), e contexto de negócio injetado no prompt. Conversas ficam em `conversations` + `conversation_messages`.

### Workflows (automações)
DAG de nodes executado por triggers (lead_created, stage_changed, tag_added, cron, etc.). Tipos de node: trigger, action (send_whatsapp, move_stage, add_tag, assign_responsible), condition, delay, wait_response, split_ab, copilot, webhook_call, wait_business_window. Execuções trackadas em `workflow_executions`.

### Campanhas
Processos paralelos aos pipes. Cada campanha tem: objetivo, deadline, agente IA, metas de time, distribuição de leads (round robin), sequence de mensagens. Lead pode estar em campanha E no pipe ao mesmo tempo.

## Data model (tabelas principais)

| Tabela | Propósito |
|--------|----------|
| `leads` | Entidade central — todo lead/prospect |
| `organizations` | Tenant — isolamento multi-tenant |
| `team_members` | Time de vendas (SDR, Closer, Admin) com comissões |
| `pipe_whatsapp` | Pipeline de qualificação WhatsApp |
| `pipe_confirmacao` | Pipeline de confirmação de reunião |
| `pipe_propostas` | Pipeline de propostas/fechamento |
| `custom_pipelines` / `custom_pipe_entries` | Pipelines customizados por org |
| `pipeline_stages` | Stages dinâmicas de qualquer pipeline |
| `tags` / `lead_tags` | Tags de segmentação (many-to-many) |
| `campanhas` / `campanha_stages` | Campanhas de marketing/vendas |
| `workflows` / `workflow_executions` | Motor de automação |
| `copilot_agents` | Agentes IA configuráveis |
| `conversations` / `conversation_messages` | Histórico de chat agente↔lead |
| `channel_messages` | Mensagens multi-canal (WhatsApp, Meta, SZ.Chat) |
| `products` | Produtos/serviços vendidos |
| `lead_history` | Audit log de todas as ações no lead |
| `follow_ups` | Tarefas de follow-up do time |
| `webhook_deliveries` | Fila de webhooks com retry |
| `subscription_plans` | Planos de assinatura |

### Relações importantes
- Lead → tem entradas em pipes (1:N) — um lead pode estar em vários funis
- Lead → tem tags via `lead_tags` (N:N)
- Lead → tem responsible, sdr, closer (3 FKs para `team_members`)
- Organization → tem leads, team_members, workflows, campaigns (tudo org-scoped)
- Workflow → tem executions → tem execution_steps (auditoria granular)
- Copilot Agent → tem conversations → tem messages

## Fluxo n8n → V8

Clientes externos usam Trello como CRM básico. O padrão é:
1. Lead entra no Trello (via Meta Ads → Make/Zapier → Trello card)
2. n8n monitora o board Trello (`Trello Trigger`)
3. n8n extrai dados do card (nome, telefone, empresa, faturamento via regex no `desc`)
4. n8n classifica por faturamento → tag (Latão/Prata/Ouro/Diamante)
5. n8n envia POST para `lead-webhook` com campos + tags + pipe placement

Existem 20+ workflows n8n seguindo esse padrão (um por cliente). Cada um tem seu próprio board Trello e `assigned_user_id`.

## Debugging

### Logs de edge function
```bash
# Ver logs em tempo real
supabase functions logs <nome> --project-ref jsjsmuncfkbsbzqzqhfq

# Logs também são salvos na tabela runtime_logs (via logger.ts _shared)
```

### Testar edge function local
```bash
supabase functions serve <nome> --env-file .env.local
# Depois: curl http://localhost:54321/functions/v1/<nome>
```

### Verificar dados no banco (produção)
```bash
# Obter service_role key
supabase projects api-keys --project-ref jsjsmuncfkbsbzqzqhfq

# Query via REST API
curl "https://jsjsmuncfkbsbzqzqhfq.supabase.co/rest/v1/leads?select=id,name&limit=5" \
  -H "apikey: SERVICE_KEY" -H "Authorization: Bearer SERVICE_KEY"
```

### Regenerar tipos TypeScript
```bash
supabase gen types typescript --project-id jsjsmuncfkbsbzqzqhfq > src/integrations/supabase/types.ts
```

## Hooks principais → tabelas

| Hook | Tabela(s) | O que faz |
|------|-----------|-----------|
| `useLeads` | `leads` | Lista leads da org com filtros |
| `usePipeWhatsapp` | `pipe_whatsapp` + `leads` (join) | Kanban de qualificação |
| `usePipeConfirmacao` | `pipe_confirmacao` + `leads` | Kanban de confirmação reunião |
| `usePipePropostas` | `pipe_propostas` + `leads` + `products` | Kanban de propostas |
| `useCustomPipelines` | `custom_pipelines` + `custom_pipe_entries` | Funis customizados |
| `useTeamMembers` | `team_members` | Time da org (SDRs, closers, admins) |
| `useCopilotAgents` | `copilot_agents` + `copilot_agent_faqs` | Agentes IA |
| `useCampanhas` | `campanhas` + `campanha_stages` | Campanhas de vendas |
| `useWorkflows` | `workflows` | Automações |
| `useChannelChat` | `channel_messages` + `conversations` | Chat multi-canal (realtime) |
| `useTags` | `tags` | Tags da org |
| `useWebhooks` | `webhook_endpoints` + `webhook_deliveries` | Webhooks configurados |
| `useUserRole` | `team_members` + `profiles` | Role do usuário logado |
| `useOrganization` | `organizations` | Dados da org atual |
| `useFollowUps` | `follow_ups` | Tarefas de follow-up |
| `useProducts` | `products` | Catálogo de produtos |
| `useScheduledMessages` | `scheduled_user_messages` | Mensagens agendadas |
| `useGoogleCalendar` | `google_calendar_connections` | Integração Google Calendar |

## Nota para o dev junior

Se você é novo no projeto e não tem muito background em banco de dados, aqui vai o essencial:

- **RLS (Row Level Security)**: É como um "filtro automático" no banco. Toda query que você faz já vem filtrada pela sua organização. Você não precisa adicionar `WHERE organization_id = X` manualmente — o Postgres faz isso por você baseado no token de login.
- **Migrations**: São arquivos SQL que alteram a estrutura do banco (criar tabela, adicionar coluna, etc.). Rodam em ordem cronológica. Nunca edite uma migration que já rodou — crie uma nova.
- **Edge Functions**: São funções que rodam no servidor (Supabase). Pense nelas como "APIs" que o frontend ou o n8n chamam. Cada pasta em `supabase/functions/` é uma function separada.
- **Joins no Supabase**: Quando você vê `supabase.from("pipe_whatsapp").select("*, lead:leads(name, phone)")`, isso é como um JOIN — puxa dados da tabela `leads` junto com `pipe_whatsapp`.
- **Query Keys no React Query**: São "etiquetas" que identificam cada consulta. Quando você faz `invalidateQueries({ queryKey: ["leads"] })`, está dizendo "essa consulta ficou velha, busque de novo".

## Design

Dark-first. Referências: Linear, Stripe, Vercel. Tema usa CSS variables HSL. Cores em `tailwind.config.ts` via `--primary`, `--secondary`, etc. Accent gold: `hsl(47 100% 50%)`. Font: Inter. Componentes shadcn/ui com customização via `cn()` helper.

Regra: se parece template genérico, reprovou. Sofisticação > segurança visual.

## Operações comuns

### Criar organização nova
Via Supabase Dashboard ou edge function `checkout-provision-org`. Precisa: nome, plano, e usuário admin vinculado.

### Provisionar cliente
1. Criar org
2. Criar usuário admin (`create-org-user` edge function)
3. Vincular usuário à org (`assign-user-to-org`)
4. Configurar plano e limites
5. Configurar instância WhatsApp (se aplicável)

### Resetar dados de teste
Deletar em ordem (por FK constraints): `lead_tags` → `pipe_*` → `leads` → `conversations`. Sempre filtrar por `organization_id`.

### Adicionar edge function nova
1. Criar pasta em `supabase/functions/<nome>/index.ts`
2. Usar pattern padrão (Deno.serve + withSentry + CORS)
3. Se não precisa JWT: adicionar `verify_jwt = false` no `supabase/config.toml`
4. Deploy: `supabase functions deploy <nome> --project-ref <ref>`
5. Se for cron: criar trigger pg_cron via migration SQL

## CI/CD

GitHub Actions em push para main/develop:
1. `unit-tests` — Vitest
2. `integration-tests` — Vitest + Supabase local
3. `e2e-tests` — Playwright + Chromium
4. `docker-image` — Build Docker (Node 20 + Nginx)
