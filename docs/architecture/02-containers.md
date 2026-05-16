# Architecture — Level 2: Containers

C4 model nível 2. Containers do Torque CRM (front, back, DB, cron, realtime).

## Diagram

```mermaid
graph TB
    classDef person fill:#08427b,stroke:#052e56,color:#fff
    classDef container fill:#438dd5,stroke:#2e6295,color:#fff,stroke-width:2px
    classDef db fill:#1d4ed8,stroke:#1e3a8a,color:#fff,stroke-width:2px
    classDef external fill:#666,stroke:#444,color:#fff

    User["👤 Usuário<br/>(admin/vendedor)"]
    Lead["👤 Lead<br/>(via WhatsApp)"]
    Uazapi["WhatsApp via Uazapi"]

    subgraph Torque["Torque CRM"]
        Frontend["⬛ Frontend SPA<br/>React 18 + Vite 5<br/>(EasyPanel VPS)"]
        EdgeFn["⬛ Edge Functions<br/>94 fns Deno<br/>(Supabase)"]
        Postgres[("⬛ Postgres<br/>+ RLS + pgvector<br/>+ pg_cron + pg_net")]
        Auth["⬛ Supabase Auth<br/>JWT + custom claims<br/>(org_id)"]
        Realtime["⬛ Supabase Realtime<br/>postgres_changes<br/>WebSocket"]
        Storage["⬛ Supabase Storage<br/>buckets multi-tenant"]
    end

    Gemini["Google Gemini"]
    Sentry["Sentry"]

    User -->|HTTPS| Frontend
    Lead -.->|chat| Uazapi
    Uazapi -->|webhook POST| EdgeFn

    Frontend <-->|Supabase JS SDK<br/>queries + mutations| Postgres
    Frontend <-->|REST/RPC| EdgeFn
    Frontend <-->|WSS subscribe| Realtime
    Frontend <-->|auth flows| Auth
    Frontend <-->|file upload/download| Storage

    EdgeFn <-->|service role<br/>+ RLS bypass quando autorizado| Postgres
    EdgeFn <-->|JWT validate| Auth
    EdgeFn -->|push| Realtime
    EdgeFn <-->|file ops| Storage
    EdgeFn -->|LLM calls| Gemini
    EdgeFn -->|errors| Sentry

    Postgres -.->|pg_cron tick<br/>+ pg_net.http_post| EdgeFn
    Postgres -->|postgres_changes| Realtime

    class User,Lead person
    class Frontend,EdgeFn,Auth,Realtime,Storage container
    class Postgres db
    class Uazapi,Gemini,Sentry external
```

## Containers

### Frontend SPA
- **Tecnologia**: React 18 + TypeScript 5.8 + Vite 5 (SWC)
- **UI**: shadcn/ui (Radix) + Tailwind 3 + Lucide
- **State**: TanStack Query v5 + React Context
- **Forms**: React Hook Form + Zod
- **Deploy**: Docker + EasyPanel (VPS Hostinger)
- **Responsabilidade**: UI, validação client-side, cache de queries, WS subscribe

### Edge Functions
- **Tecnologia**: Deno + TypeScript
- **Quantidade**: 94 funções
- **Padrão**: `Deno.serve(withSentry('nome', handler))` + CORS + OPTIONS early return
- **Auth**: maioria `verify_jwt=false`, valida via headers custom
- **Responsabilidade**: lógica de negócio que requer service role / validação custom / integrações externas

### Postgres
- **Tecnologia**: Supabase Postgres + extensions (RLS, pgvector, pg_cron, pg_net)
- **Tables**: ~50 principais
- **Migrations**: 322+
- **RLS**: enforced em toda tabela com `organization_id`
- **Responsabilidade**: source of truth, multi-tenant isolation, cron scheduling

### Supabase Auth
- **JWT**: com custom claims (`organization_id`)
- **Função SQL**: `auth.org_id()` extrai claim
- **Responsabilidade**: signup, login, password reset, JWT management

### Supabase Realtime
- **Mecanismo**: postgres_changes via WS
- **Respeita RLS**: sim
- **Debounce**: 2s no cliente (`useRealtimeSubscription`)

### Supabase Storage
- **Buckets**: multi-tenant via path `org_id/...`
- **RLS**: enforced no bucket policy

## Flows críticos

Ver [03-data-flow.md](./03-data-flow.md).
