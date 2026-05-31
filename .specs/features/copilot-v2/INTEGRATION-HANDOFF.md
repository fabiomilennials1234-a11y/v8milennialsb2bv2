# Copilot v2 — Handoff da Sessão de Integração Ao Vivo

**Criado:** 2026-05-31 · **Pré-req:** PRs #593/#594/#595 mergeadas em `develop`
**Ler antes:** `.specs/features/copilot-v2/PROGRESS.md` · `docs/adr/0002-copilot-v2-architecture.md` · `.specs/features/copilot-v2/SPEC.md`

> Estado ao fechar a sessão de núcleo: **9/13 tools live**, 146 testes TDD verdes, schema (foundation + slices 4/6/7) **em prod**, nada ativado. As 4 tools restantes + o queue-worker + deploy são **I/O ao vivo** — exigem ambiente real (WhatsApp, embeddings Gemini, Google Calendar) e validação por **trace numa conversa real na Milennials**, não por mock. Esta é a lista de execução dessa sessão.

## Pré-flight da sessão
1. `git checkout develop && git pull` (ter #593/#594/#595).
2. Branch nova: `feat/copilot-v2-integration-live`.
3. MCP Supabase autenticado (`database:write`). Confirmar prod = `jsjsmuncfkbsbzqzqhfq`.
4. **NUNCA `supabase db push`** (drift). Migrations via MCP `apply_migration`, isoladas; salvar arquivo local com a versão registrada.
5. Confirmar secrets no edge: `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `UAZAPI_*`.

## As 4 tools restantes (em `_shared/copilot-v2/tool-executor.ts`, hoje `not_implemented`)

### 1. `handoff_to_vendedor` — médio
- **Faz:** passa lead qualificado ao Vendedor humano + notifica.
- **Schema real:** `notifications(organization_id, user_id NOT NULL, type, title, description, lead_id, link, read_at, created_at)`. `user_id` é obrigatório → precisa do **target user** vindo da config do agente (slot de transferência, `copilot_v2_config.slots`).
- **Plano:** resolver target user (config → team_member responsável/configurado) → `notifications.insert` (description = resumo estruturado: tier/motivo/resumo; link = deeplink do lead) → opcional reassign (`leads.sale_responsible_id`). Reusar padrão de `transfer_to_human` (já pausa phone-keyed).
- **Verificação:** integração — cria notification real na Milennials, confere user_id válido, RLS.

### 2. `send_media` — médio
- **Faz:** envia 1 item da biblioteca aprovada ao lead, no gatilho certo.
- **Schema real:** `copilot_v2_send_media(id, org, storage_path, kind, what_it_is, trigger, nuance, is_active)` + `copilot_v2_agent_media(agent_id, media_id, trigger)` (JÁ em prod).
- **Adapter:** `_shared/whatsapp-client.ts` + `whatsapp-providers/` (Uazapi). Procurar `sendMediaMessage`/equivalente (confirmar nome real). Resolver storage_path → URL pública (bucket).
- **Gate (já no SPEC):** já-enviou? momento ok? — checar contra `whatsapp_messages`/trace antes de reenviar.
- **Verificação:** integração — envia 1 mídia de teste pra número controlado; confere no chat.

### 3. `search_knowledge` — GRANDE (Slice 7 inteira)
- **Faz:** busca híbrida (semântico + keyword) na KB org-level, retorna chunks com fonte.
- **Schema real:** `copilot_v2_knowledge(storage_path, source_kind, extracted_text, status)` + `copilot_v2_knowledge_chunks(knowledge_id, content, embedding vector(1536))` (JÁ em prod, pgvector).
- **Falta o PIPELINE DE INGESTÃO (não existe):** upload → extrair texto (doc/pdf: extract+chunk; imagem: OCR/caption; vídeo: transcrição) → embed (Gemini 1536d, reusar `_shared/embeddings.ts`) → gravar chunks. É uma **edge fn nova** (`copilot-v2-ingest`) + provavelmente um cron/worker.
- **Busca:** RPC pgvector (`<=>` cosine) + keyword (tsvector) + rerank + **threshold centralizado** (não 4 valores espalhados como v1). Falha de embedding **não-silenciosa** (loga no trace).
- **Verificação:** integração — sobe 1 PDF de catálogo, confirma chunk buscável, query responde spec com chunk_id no trace.
- **Nota:** é a maior peça. Pode virar PR própria (Slice 7 = ingest + RAG).

### 4. `schedule_meeting` — médio-grande
- **Faz:** agenda reunião em horário livre (precedido de `check_agenda_availability`).
- **Integração:** Google Calendar — reusar `_shared/google-calendar-utils.ts` + edge fns `google-calendar-events`/`-connect`. Escreve em `pipe_confirmacao` (meeting_date, meet_link).
- **Falta também `check_agenda_availability`** (read introspect, hoje not_implemented) — listar slots livres do calendar conectado da org.
- **Verificação:** integração — cria evento de teste no calendar conectado da Milennials; confere meet_link em pipe_confirmacao.

## Queue-worker + wiring (Task #6 — o que faz tudo rodar)
1. **`copilot-v2-worker`** (edge fn nova, cron pg_cron 1/min via pg_net, auth `x-cron-secret`):
   - pull `copilot_v2_message_queue` status pending/retry (FOR UPDATE SKIP LOCKED ou claim por update).
   - montar `ResolvedContext` do DB: `get_contact_status` → arquétipo; carregar `copilot_v2_agents`(is_active)+`_config`+capabilities; `introspection` (stages+custom_fields).
   - `createToolExecutor(supabase, ctx)` + `createOpenRouterClient(model)` → `handleQueuedMessage`.
   - enviar reply no WhatsApp (adapter) → marcar `processed`; erro → `retry` (1→5→15min) → `dead` (DLQ). Gravar trace steps.
2. **wiring border** (`border.ts`): aplicar `message-debounce` ANTES do enqueue (coalescing). Registrar `outgoing` na queue/trace pra o `checkLoop` enxergar o bot (hoje só inbound é enfileirado → loop-gate cego).
3. **deploy:** `supabase functions deploy agent-runtime-v2 --project-ref jsjsmuncfkbsbzqzqhfq` + worker + ingest. config.toml já tem `agent-runtime-v2` (verify_jwt=false); adicionar entradas das novas.

## Hardening pendente da review (PR #593) a fechar nesta sessão
- **Testes RLS cross-org** por tabela `copilot_v2_*` (`tests/integration/rls-copilot_v2_*.test.ts`) — mandato do repo, hoje ausente.
- **Un-skip** `tests/integration/copilot-v2/border-regression.test.ts` (migration já aplicada) — rodar contra prod.
- **LLM-judge de saída + input short-circuit** (Slice 5 / ADR #7) — ainda ausentes.

## Ativação (Task #7 — o walking skeleton ao vivo)
1. Criar 1 `copilot_v2_agents` (Milennials `6030520a-2ca7-477d-be89-55758e2cd808`, archetype `qualificador`, is_active=false) + `copilot_v2_config` + `copilot_v2_rubric` seed.
2. Apontar 1 instância WhatsApp de teste pro `agent-runtime-v2` (webhook).
3. **Dry-run primeiro** (simulador, Slice 9 — se já existir) OU conversa de teste com número controlado.
4. Validar por **trace** (`copilot_v2_traces`/`_trace_steps`): rota certa? gates dispararam? tools corretas?
5. Só então `is_active=true`. v1 segue on pras demais orgs. Rollback = `is_active=false`.

## Invariantes que NÃO podem quebrar (verificar em cada PR)
- org_id SEMPRE do ctx/instance, NUNCA do payload/LLM (teste adversarial).
- pausa/loop **fail-CLOSED**; dedup/rate-limit fail-closed.
- write SEMPRE após introspect (write-after-introspect guard).
- capability-gate server-side (LLM não burla).
- tool sem backing real → `not_implemented` explícito, NUNCA NOOP silencioso (bug v1).
- base prompts imutáveis; cliente só preenche slots.

## Ordem sugerida da sessão
`handoff_to_vendedor` + `schedule_meeting`/`check_agenda_availability` + `send_media` (médias, fecham 12/13) → **queue-worker + wiring + deploy** (faz rodar) → **ativar Milennials 1 arquétipo + validar por trace** → `search_knowledge`/ingestão (Slice 7, PR própria) → hardening RLS + judge.
