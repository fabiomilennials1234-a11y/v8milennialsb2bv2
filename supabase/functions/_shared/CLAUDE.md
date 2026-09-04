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

### Disparo (Canal Oficial)
- `blast-official-runner.ts` — o laço do worker: reivindica, decide, envia, marca (#1722)
- `quick-blast/fechar-entrega.ts` — o **ciclo de entrega** (#1724): o callback de status fecha a linha do destinatário e o custo previsto vira realizado. ⚠️ O casamento **não** é pelo id estável do callback: `blast_plan_recipients.provider_message_id` guarda o id da RESPOSTA DO ENVIO, que é o `channel_messages.external_id` — espaços de identificador diferentes, 747/747 medidos em prod com zero coincidências. Quem resolve o callback até a linha de `channel_messages` é o `notificame-webhook` (duas chaves, `external_id` primeiro); de lá este módulo casa. Tenant vai no JOIN, porque a tabela não tem `organization_id` e a UNIQUE é global

### WhatsApp
- `whatsapp-client.ts` — adapter provider-agnostic (Uazapi atual)
- `whatsapp-providers/` — implementations por provider
- `instance-routing.ts` — **Instance Routing Policy** (ADR-0025): resolve de qual Instance o nó de mensagem do Workflow envia. `resolveRoutedInstance` é a costura única dos 11 pontos de envio (texto, mídia, rica, campanha, send_to_number), chamada por `action-handlers/whatsapp-helpers.getWhatsAppInstance`. Ordem: `fixed` → org com uma viva → `responsible` (RPC `get_lead_write_instance`) → `conversation` (última mensagem por `normalized_phone`, grupo fora, **nunca** por `lead_id`) → recuo do nó → falha. Instância não-viva (`session_dead_since`) **falha sem trocar de número**; erro vira `retryable: false` em `executeWorkflowAction`. Não afeta campanhas, regras de pipe, follow-ups, disparo em massa nem Copilot — esses seguem em `resolveDispatchContext`.
- `instance-write-guard.ts` — gate vínculo 1:1 user→instância
- `whatsapp-device-name.ts` — rótulo de dispositivo por org enviado no init (#1167)
- `whatsapp-proxy-region.ts` — deriva a região do **proxy gerenciado da Uazapi** do próprio telefone da Instance (#1477). `DDD → UF` (67 entradas) e capital por UF (27) são fato nacional fixo, hardcoded; o **slug** da cidade vem sempre do catálogo ao vivo (`GET /proxy-managed/cities`), nunca hardcoded. Granularidade real é **estado** — `DDD → cidade` não é determinístico (DDD 47 é Joinville/Blumenau, não a capital) e não há endpoint que revele o IP de saída (`proxy_url` volta `managed_pool://hidden`), então precisão de cidade não é verificável. Aplicado em **todo** `connect` pelo `uazapi-provider`, nunca na criação — `proxy_managed_*` só é aceito em `POST /instance/connect`. Toda falha (sem telefone, número não-BR, catálogo fora, UF ausente) degrada para o comportamento de hoje: **derivar região nunca custa uma conexão**. Zero UI, por decisão: expor a escolha permitiria o erro que a feature existe para evitar.
- `whatsapp-instance-reconcile.ts` — classifica a lista de Instances do provider contra a nossa (#1478). Só CLASSIFICA, nunca deleta. Casa por `adminField02` (nosso `whatsapp_instances.id`, carimbado desde 2026-04-22), com recuo para o id do provider. Três buckets: **órfã confirmada** (carimbada e ausente do banco), **sem carimbo e desconhecida** (provavelmente criada no painel — decisão humana, nunca automatizar exclusão), e **fantasma** (existe no CRM, ausente do provider). Lista do provider ausente devolve `inconclusive` e classifica ZERO — falha de transporte não pode virar "o provider apagou tudo".
- `whatsapp-reap-policy.ts` — política pura do coletor de lápides (#1476): `404` confirma, `401/403` desiste, teto de 8 tentativas com backoff 1/2/4/8/16 min, e sucesso nunca é sobrescrito pelo teto.
- `whatsapp-instance-teardown.ts` — `nullifyInBatches` anula FK em lotes antes de apagar a Instance (#1474). Nasceu por causa de `whatsapp_messages` (~2,3M linhas, **7 índices sobre `instance_id`**, `statement timeout` em 34 de 95 exclusões). Essa tabela **sai da lista de alvos assim que** a FK `whatsapp_messages_instance_id_fkey` for dropada pela migration `20270811000010_whatsapp_messages_drop_instance_fk.sql` — aí `instance_id` vira uuid histórico da mensagem, e é exatamente anular aquele vínculo que some com a conversa inteira do chat (que filtra por `instance_id`) a cada exclusão de instância. ⚠️ **Migration é passo MANUAL e vem ANTES do deploy do proxy** (ordem: migration → `whatsapp-api-proxy`). Esses dois passos estancam a perda; **não** recuperam o histórico já órfão — isso seria o `scripts/backfill-orphan-whatsapp-messages.sql`, que é OPCIONAL e ficou de fora por decisão do CTO (2026-08-11). Ninguém depende dessa disciplina: `whatsapp-api-proxy` consulta o catálogo por exclusão (`whatsappMessagesFkState`, cache no isolate) e só tira `whatsapp_messages` da lista quando prova que a FK sumiu — na dúvida mantém o nullify, porque com FK viva o cascade anularia as mesmas linhas de qualquer jeito, só que num statement que estoura. `scheduled_user_messages.whatsapp_instance_id` fica `ON DELETE SET NULL` e é limpo sempre: fila de envio pendente, não histórico. Lote no cliente, não em loop plpgsql — loop server-side é uma transação só segurando lock. `DEFAULT_BATCH_SIZE` é limitado por **comprimento de URL** (filtro `in` vai na query string do PostgREST), não por custo de banco. Teto de lotes devolve `hitBatchCeiling` e o caller responde 503 pra ser retentado, em vez de fingir que terminou (alcançável em `whatsapp_messages` enquanto a FK vive — Alamaster tem ~155k linhas contra teto de 100k/chamada).

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
