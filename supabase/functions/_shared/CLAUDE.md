# CLAUDE.md — `_shared/` módulos compartilhados

Helpers e adapters usados por edge functions. **Sem state global, sem singletons
fora dos triviais.**

## Módulos principais

### Auth + tenancy
- `auth.ts` — extrair org_id/user_id do request (header/JWT custom)
- `cors.ts` — `getCorsHeaders`, `withSecurityHeaders`
- `permission_engine.ts` — engine de permissões (3 camadas)

### Observability
- `sentry.ts` — `withSentry('nome', handler)` wrapper
- `logger.ts` — wrapper estruturado (level/tags)

### WhatsApp
- `whatsapp-client.ts` — adapter provider-agnostic (Uazapi atual)
- `whatsapp-providers/` — implementations por provider
- `instance-write-guard.ts` — gate vínculo 1:1 user→instância

### Copilot
- `copilot/` — submódulos do agent-engine refactor 2026-04-27
  - `context-loader.ts`
  - `build-prompt.ts`
  - (outros — conferir filesystem)
- `ai-action-executor.ts` — executa ações IA (kanban move, follow-up, etc.)
- `embeddings.ts` — Gemini embeddings 1536d
- `ai-queue.ts` — fila de tasks IA

### Comunicação
- `dispatch-router.ts` — roteamento de envio (WhatsApp/SMS/email)
- `audio-sender.ts` — audio messages + TTS ElevenLabs
- `followup-sender.ts` — follow-up scheduler

### Integrações
- `asaas.ts` — Asaas pagamentos
- `google-calendar-utils.ts`
- `fetch-utils.ts` — retry + timeout helpers

### Outros
- `actions/` — actions registradas (referenciadas por kanban_rules)
- `lead-service.ts` — CRUD lead operações comuns
- `campaign-distribution.ts` — round robin de campaigns
- `job-tracker.ts` — tracking de jobs longos

## Padrões

### Função pública
```typescript
export async function nomeDaFuncao(req: Request, supabase: SupabaseClient) {
  // validar input com Zod
  // executar lógica
  // retornar tipo definido (não any)
}
```

### Não fazer
- ❌ State global (variável module-level mutável)
- ❌ Singleton de SupabaseClient — instanciar por request
- ❌ Throw em path normal — retornar Result-like ou Response
- ❌ Console.log em prod — usar `logger`
- ❌ Hardcoded org_id — sempre vem do auth context
- ❌ Import circular — quebrar com interfaces

## Imports

Edge functions consumem via:
```typescript
import { ... } from "../_shared/<modulo>.ts";
```

`_shared/` vai junto no deploy de cada function (Deno deno.json resolve).

## Testes

Unit tests em `tests/unit/_shared-*.test.ts`:
```bash
npx vitest run tests/unit/_shared
```

Integration tests em `tests/integration/_shared-*.test.ts` requerem Supabase
local rodando.

## Refatorações em curso

- Copilot: refactor god module agent-engine completo
  ([ADR-2026-04-27](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/04%20—%20Decisões/ADR-2026-04-27-refactor-agent-engine-modular.md))
- WhatsApp: provider-agnostic adapter pattern (Uazapi atual)
- Permissions: gate server-side pendente
  ([move-pipe-record-server-side](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/08%20—%20Backlog/backlog/move-pipe-record-server-side.md))

## Áreas frágeis

- `permission_engine.ts` — 3 camadas + fallback `allowed: true`
  ([permissions-fallback-fail-closed](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/08%20—%20Backlog/backlog/permissions-fallback-fail-closed.md) MEDIUM)
- `whatsapp-client.ts` — schema Uazapi instável (incidente 2026-05-14)
- `embeddings.ts` — quota Gemini, fallback gracefully
