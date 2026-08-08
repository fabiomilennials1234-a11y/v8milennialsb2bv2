# CLAUDE.md — `_shared/` módulos compartilhados

Helpers e adapters usados por edge functions. **Sem state global, sem singletons
fora dos triviais.**

## Módulos principais

### Auth + tenancy
- `auth.ts` — extrair org_id/user_id do request (header/JWT custom)
- `cors.ts` — `getCorsHeaders`, `withSecurityHeaders`
- `permission_engine.ts` — engine de permissões (3 camadas)

### Observability
- `error-boundary.ts` — `withErrorBoundary('nome', handler)` wrapper + `logError` / `logEvent`. É o try/catch de topo: devolve 500 **com CORS** (ADR-0017)
- `logger.ts` — wrapper estruturado (level/tags)

### WhatsApp
- `whatsapp-client.ts` — adapter provider-agnostic (Uazapi atual)
- `whatsapp-providers/` — implementations por provider
- `instance-routing.ts` — **Instance Routing Policy** (ADR-0025): resolve de qual Instance o nó de mensagem do Workflow envia. `resolveRoutedInstance` é a costura única dos 11 pontos de envio (texto, mídia, rica, campanha, send_to_number), chamada por `action-handlers/whatsapp-helpers.getWhatsAppInstance`. Ordem: `fixed` → org com uma viva → `responsible` (RPC `get_lead_write_instance`) → `conversation` (última mensagem por `normalized_phone`, grupo fora, **nunca** por `lead_id`) → recuo do nó → falha. Instância não-viva (`session_dead_since`) **falha sem trocar de número**; erro vira `retryable: false` em `executeWorkflowAction`. Não afeta campanhas, regras de pipe, follow-ups, disparo em massa nem Copilot — esses seguem em `resolveDispatchContext`.
- `instance-write-guard.ts` — gate vínculo 1:1 user→instância
- `whatsapp-device-name.ts` — rótulo de dispositivo por org enviado no init (#1167)
- `whatsapp-instance-teardown.ts` — `nullifyInBatches` anula FK em lotes antes de apagar a Instance (#1474). Existe porque `whatsapp_messages` tem ~2,3M linhas / 4,5 GB e **7 índices sobre `instance_id`**: o `ON DELETE SET NULL` num statement só estourava o `statement timeout` (34 de 95 exclusões falhavam). Lote no cliente, não em loop plpgsql — loop server-side é uma transação só segurando lock numa tabela que o webhook grava sem parar. `DEFAULT_BATCH_SIZE` é limitado por **comprimento de URL** (filtro `in` vai na query string do PostgREST), não por custo de banco. Teto de lotes devolve `hitBatchCeiling` e o caller responde 503 pra ser retentado, em vez de fingir que terminou.

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

- `permission_engine.ts` — 3 camadas, **fail-closed** (#647). Toda via não-mapeada
  nega + loga (`logDenied`). Matriz legada (`checkMatrixPermission`) só libera com
  grant explícito `value="allowed"` — ausência de registro = deny.
  Frontend twin (`src/modules/identity/permissions/lib/permissions.ts`) ainda tem
  o default permissivo do matrix (`matrix_default_allowed`) — follow-up.
- `whatsapp-client.ts` — schema Uazapi instável (incidente 2026-05-14)
- `embeddings.ts` — quota Gemini, fallback gracefully
