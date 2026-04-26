# Project State

**Last updated:** 2026-04-26 (Trilha 3 completa)

## Decisions

### D034: Copilot fallback elimination + Uazapi bridge + tenant isolation (2026-04-23)

Incidente: usuário pergunta "a granel quais sabores tem?" e recebe "Desculpe, houve um problema ao processar sua mensagem." Logs prod mostram dezenas de casos `messageLength: 54` + `action: SEND_DOCUMENT`, sem `LLM call #3`.

7 causas raízes confirmadas no código:
- CR-1 agent-engine:222 fallback quando LLM retorna content:null+tool_call não-inline
- CR-2 assistant+tool_calls persistidos com content:'' (viola OpenAI contract)
- CR-3 tool_calls[0] — extras silenciosamente descartados
- CR-4 finish_reason nunca consultado
- CR-5 loadConversation ignora agent_id e organization_id
- CR-6 whatsapp-webhook (Uazapi) NUNCA invoca agent-message — Copilot inoperante para orgs Uazapi
- CR-7 identifyTenant busca cross-tenant sem org_id

Fixes: forced-text turn após loop multi-turn; telemetry por invocação; convertMessages respeita content:null; loadConversation filtra por (lead_id, agent_id, organization_id); whatsapp-webhook dispara agent-message fire-and-forget em cada incoming; identifyTenant hard-fail sem org_id. 13 testes novos. Branch `fix-copilot-fallback`. Ver [[ADR-2026-04-23-copilot-fallback-elimination]].

Pendente: deploy em prod; enfileirar extraToolCalls em paralelo (follow-up).

### L003: Fallback silencioso é anti-padrão (2026-04-23)

Lição do incidente Copilot: "fallback se algo der errado" com mensagem genérica sem telemetria torna bugs invisíveis. Regra: toda função que pode retornar fallback deve: (1) logar severity=error com contexto, (2) marcar o caller com flag `fallback_used`, (3) idealmente tentar um retry direcionado (como o forced-text turn) antes do último recurso. Mensagens genéricas silenciam o sinal e o usuário paga pela invisibilidade operacional.

### D032: phone_ai_preferences as single source of truth for AI toggle (2026-04-22)

Resolveu incidentes REALSC (2026-04-22) — três modos de falha do toggle de IA (IA respondendo após desligada; toggle falhando silenciosamente em contato sem lead por causa de enum inválido `shadow_ai_toggle`; IA disparando em conversa iniciada pelo operador).

Nova tabela `phone_ai_preferences(organization_id, normalized_phone, ai_disabled, set_by, set_at)` com PK composta, RLS (SELECT por team_members ativos; INSERT/UPDATE/DELETE bloqueados — writes só via RPC SECURITY DEFINER). 3 migrations novas (`20260916000000`, `20260916000001`, `20260916000002`). RPCs `toggle_phone_ai` + `get_phone_ai_status` + `toggle_lead_ai` ampliada + trigger `sync_lead_ai_to_preferences` defensiva. `toggle_conversation_ai` (RPC quebrada não-versionada) removida. `leads.ai_disabled` permanece como denormalização — consumidores (agent-message, evolution-webhook) não mudam.

Frontend: novo `usePhoneAiStatus(phone)`, `useToggleConversationAI` reescrito com optimistic+rollback, `useToggleLeadAI` ganha optimistic em `lead_ai_status`. `getOrCreateLead` consulta preference antes de INSERT → herança automática na 1ª mensagem.

32 testes novos (9 hooks, 5 lead-service, 18 equivalência de normalização). `test:unit` 2587/2588 passing. `tsc --noEmit` clean. Build OK. Security gate APPROVED. Migrations aplicadas em dev (`bcfadphgsibjzivtbjvc`); prod (`jsjsmuncfkbsbzqzqhfq`) **pendente**.

Detalhes em `.specs/features/phone-ai-preferences/` e [[ADR-2026-04-22-phone-ai-preferences]].

### L002: RPCs não-versionadas são anti-padrão (2026-04-22)

A `toggle_conversation_ai` quebrada só foi descoberta via logs Postgres. Existia no banco de prod mas não no repositório. Pesquisa por `shadow_ai_toggle` no codebase retornou zero resultados — só via `pg_get_functiondef` foi possível diagnosticar. **Regra**: qualquer RPC/trigger/função SQL criada direto no banco deve ser capturada em migration versionada antes de merge. Revisar outros projetos para RPCs órfãs.

### D001: SDD adopted as mandatory workflow (2026-04-01)
All work on this project must follow the Spec-Driven Development workflow (`tlc-spec-driven` skill). No exceptions. Auto-sized by scope (Small/Medium/Large/Complex).

### D002: Brownfield mapping completed (2026-04-01)
7 codebase documents created in `.specs/codebase/`: STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS. These serve as the foundation for all future feature work.

## Blockers

None currently.

## Lessons

### L001: Sub-agents need Write permissions
When dispatching sub-agents for brownfield mapping, they couldn't write files due to permission restrictions. The orchestrating agent must handle file writes itself after receiving research results.

### L002: Never hardcode viewport math for full-height panels (2026-04-20)
Chat page used `h-[calc(100vh-4rem)]` — wrong (TopNav is 3.5rem, not 4rem) and brittle (ignored MainLayout's `py-6 lg:py-8`). Root fix was propagating height through the flex chain in MainLayout (`h-screen` on outer, `min-h-0` on main, `min-h-full flex flex-col` on inner wrapper), then letting children use `flex-1 min-h-0` with no viewport math. Rule: if a panel needs full height, the layout chain should give it to them — hardcoded calcs are an anti-pattern. Also: flex items that contain wide content (composer, fixed-min-width children) need `min-w-0` to prevent horizontal clip when the parent has `overflow-hidden`.

## Todos

- [ ] Address CONCERN-S1 (Critical): Remove `VITE_SUPABASE_SERVICE_ROLE_KEY` from `.env.development`
- [ ] Address CONCERN-S3 (Critical): Audit edge functions for `verify_jwt` settings
- [ ] Address CONCERN-T1 (Critical): Increase test coverage from 3% -- prioritize auth, payments, RLS
- [ ] Address CONCERN-A1 (High): Decompose 30+ files over 800 lines
- [ ] **phone_ai_preferences**: aplicar as 3 migrations em produção (`jsjsmuncfkbsbzqzqhfq`) após validação manual do fluxo em dev
- [ ] **Copilot send-time re-check**: fechar gap temporal de 15–36s entre gerar resposta IA e enviar pelo Evolution API — re-checar `leads.ai_disabled` imediatamente antes do `fetch` em `agent-message`
- [ ] **Auditoria de RPCs órfãs**: rodar `SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace` em prod e conferir quais estão no repo (task surgiu ao descobrir `toggle_conversation_ai` não versionada)

### D003: S1+S3 deferred, T2+T5 prioritized (2026-04-01)
CTO decided to defer security fixes (S1: service role key exposure, S3: verify_jwt audit) and focus first on building the testing safety net (T2: auth/permissions tests, T5: RLS policy tests). Rationale: tests prevent future regressions; fixes without tests just create new untested code.

### D004: org-quota-enforcement spec/design/tasks complete (2026-04-09)
Feature fully specified in `.specs/features/org-quota-enforcement/`. 12 tasks across 5 phases. CTO decisions: delta model (plan_base + addons + admin_adj), soft enforcement (block new, keep existing), scope = WhatsApp instances + users + copilot agents.

### D005: org-quota-enforcement implemented (2026-04-09)
All 12 tasks executed. 9 SQL migrations (20260910000000–20260910000008), 1 new hook (useOrgQuotas), 1 new component (QuotaManagementPanel), 3 files updated (WhatsAppSettings, Copilot, BillingOverrideModal), 1 edge function updated (checkout-provision-org). Build passes. Pending: integration tests against live DB, E2E validation.

### D006: Agent Team System created (2026-04-13)
9 specialized AI agents operating autonomously via CLAUDE.md protocol. Agents: Conductor (orchestrator), Architect, Backend, Frontend, DBA, QA, Infra, Automation (new), AI (new). Every task auto-routes through Conductor → agent selection → SDD → execution → Obsidian update. Skills in `.claude/skills/agent-*/SKILL.md`. Obsidian notes in `Agentes/`. Protocol simplified to 3 phases (Triage → Execute → Document). Eliminated fragile skill path verification (Fase 3) and redundant Fixes/ documentation (Fase 5). All agents integrate `tlc-spec-driven` for mandatory SDD compliance.

### D007: Coverage 70% project started (2026-04-13)
Full system coverage project. Baseline: 9.33% (1,058/11,331 lines). Target: 70%+. Sprint 0 complete: 706 tests, 43 test files. Created spec in `.specs/features/coverage-70/`. Infrastructure: supabase-mock, deno-mock, setup-prod (integration against prod with isolated test org `__integration_test_org__`). Coverage scope expanded to include hooks + contexts. 4 sprints planned.

### D008: Copilot wizard is dead code (2026-04-13)
CopilotWizard, step-tips, prompt-quality, followupSchedule are deprecated. Current flow uses CopilotPlayground (single-pane editor). Templates still active as presets. Obsidian Copilot.md updated with dead code callout. Tests for dead code kept but low priority.

### D031: Fase 1 — natural-messaging covered (2026-04-14)
Added `tests/unit/shared-natural-messaging.test.ts` with 14 tests via resetModules for OPENROUTER_API_KEY control. Covers smartSplitMessage: disabled bypass, short-msg bypass (minChunkChars), LLM success with delays, markdown ```json wrapper stripped, LLM single-chunk → full msg, LLM HTTP 500 → heuristic fallback, LLM invalid JSON → heuristic, LLM non-array → heuristic, LLM throws → heuristic. Heuristic: paragraph split, sentence split for oversized paragraph, merge tiny chunks, all 3 intensity presets (suave/natural/conversacional).
Coverage: 67.67 → **94.31 lines / 75.75 branches / 100 functions**. Threshold: 94/93/100/75.

### D030: Fase 1 — audio-sender at 100% (2026-04-14)
Added `tests/unit/shared-audio-sender.test.ts` with 8 tests: missing env vars (both + only URL), happy path sends with 55-prefix normalization, non-digit stripping, already-prefixed phones, HTTP error → errorText, missing key.id → undefined messageId, Error → .message, non-Error via String(). Coverage: 61.11 → **100 / 100 / 100 / 100**.

### D029: Fase 1 — ai-queue at 100% (2026-04-14)
Added `tests/unit/shared-ai-queue.test.ts` with 7 tests covering enqueueAiAction (happy, null optionals, 23505 dup→skip, generic DB error, thrown exception) + enqueueAiActions batch (mixed results, empty input). Coverage: 56.25 → **100 / 100 / 100 / 100**.

### D028: Fase 1 — auth.ts validateApiKey covered (2026-04-14)
Added `tests/unit/shared-auth-branches.test.ts` with 11 tests for `validateApiKey` (per-org tq_live_* keys + legacy WEBHOOK_API_KEY + SHA-256 hash matching) and `validateOrganizationAccess` DB-error branch. Uses Web Crypto API to compute real SHA-256 hashes for happy path. Covers:
- No key in any header → rejected with specific message.
- Legacy WEBHOOK_API_KEY match via X-API-Key + X-Webhook-Key headers.
- Legacy key env missing → rejected.
- tq_live_ via Authorization: Bearer extraction.
- Per-org: DB select error → generic 500, no rows → invalid, hash mismatch → invalid, hash match → org context + rate_limit + fire-and-forget last_used_at update, prefix collision iterated through candidates.
- validateOrganizationAccess DB error → false + console.error.
Coverage: 67.02 → **98.93 lines / 98.59 branches / 92.85 functions**. Threshold: 98/98/92/98.

### D027: Fase 1 — embeddings at 100% (2026-04-14)
Added `tests/unit/shared-embeddings.test.ts` with 20 tests. Covers all 5 exports:
- generateEmbedding: happy path, 8000-char truncation, API error.
- generateMultimodalEmbedding: ASCII base64, large buffer (100KB triggers chunked String.fromCharCode loop), error.
- generateEmbeddingsBatch: single batch, 100+ item multi-batch, error, empty input, truncation per text.
- chunkText: empty, short, CRLF + triple-newline normalization, paragraph split with overlap, long-paragraph sentence split, filter <50 char chunks.
- formatEmbeddingForPg: normal, empty, floats.
Coverage: 38.8 → **100 lines / 92.85 branches / 100 functions**. Threshold: 100/100/100/92.

### D026: Fase 1 — asaas at 100% (2026-04-14)
Module had 0% coverage (no test file). Added `tests/unit/shared-asaas.test.ts` with 11 tests via the `vi.resetModules()` + dynamic import pattern for env-at-top-level modules. Covers all 6 exported functions:
- createCustomer: POSTs to /customers, headers include `access_token` + JSON content-type.
- findCustomerByEmail: returns first match, null when empty data array, null when field missing.
- createPayment (PIX), getPaymentStatus, getPaymentPixQrCode.
- createSubscription (MONTHLY cycle).
- HTTP error branch: 400/404 throw with status + method + path in message.
- ASAAS_API_URL env override honored (sandbox URL test).
Coverage: 0 → **100 all metrics**. Threshold: 100/100/100/100.

### D025: Fase 1 — global thresholds ratcheted (2026-04-14)
Bumped vitest.config.ts global floors from 68/63/65/55 to **72/68/67/59**, reflecting current project state (73.53 lines / 60.04 branches / 67.15 funcs / 68.58 stmts). Any PR that drops below these fails CI.

### D024: Fase 1 — meta-api covered (2026-04-14)
Added `tests/unit/shared-meta-api-branches.test.ts` with 22 tests covering previously-missed branches:
- Missing-env throws: exchangeCodeForToken, exchangeForLongLivedToken, buildLoginUrl.
- buildLoginUrl happy paths with/without state + authType.
- verifyWebhookSignature: no secret, no sig header, matches real HMAC (uses Node's real `crypto.createHmac` via vitest alias), differs.
- acceptLeadgenTos: success via data.success, success via data.accepted, API error + warn, thrown fetch error.
- getLeadFormFields: mapped fields, empty questions fallback, API error throws.
- listLeadForms: tos_not_accepted early return, pagination error mid-stream throws, multi-page pagination.
- listPages: IG username fetch throw (catch block logs warn, page still returned), IG happy path attaches username.
- sendMediaMessage: error branch throws.
Coverage: 82.17 → **100 lines / 93.15 branches / 100 functions**. Threshold: 100/100/100/93.
Discovery: vitest.config.ts aliases `https://deno.land/std@0.177.0/node/crypto.ts` → Node's `crypto`, so vi.mock on the Deno URL is inert. Use the real Node crypto to compute expected HMACs.

### D023: Fase 1 — tinyerp-utils covered (2026-04-14)
Added `tests/unit/shared-tinyerp-crypto.test.ts` with 10 tests reusing the `vi.resetModules()` + dynamic import pattern from google-calendar-utils. Covers:
- encryptToken/decryptToken round-trip (ASCII, distinct nonces per call, invalid hex → throws).
- logTinyOp: full-fields insert, defaults applied when fields omitted, error branch logs to console.
- getOrgTinyToken: no connection found → null, query error → null, happy path decrypt + return token+connectionId, decrypt throws (corrupted ciphertext) → null.
Coverage: 62.71 → **100 lines / 96.87 branches / 100 functions**. Threshold: 100/98/100/96.

### D022: Fase 1 — tts-elevenlabs covered (2026-04-14)
Previously 26% lines / 20% branches (no test file existed). Added `tests/unit/shared-tts-elevenlabs.test.ts` with 15 tests:
- truncateForTts: unchanged-when-short, sentence-end truncation (. ! ?), hard cut + ellipsis fallback, early-period fallback threshold.
- generateTtsAudio happy path (upload + public URL w/ UUID path scheme).
- Default model/stability/similarity/output_format vs custom values.
- API error (429 non-ok) → returns error + no upload.
- Storage upload error propagated.
- Thrown fetch error caught.
- AbortError → reported as "Timeout after 10000ms".
- Non-Error thrown values converted via String().
Coverage: 26 → **100 lines / 100 branches / 66.66 functions / 98 stmts**. Threshold: 100/97/66/100 (functions % reflects mocked supabase storage helpers).

### D021: Fase 1 — google-calendar-utils covered (2026-04-14)
Added `tests/unit/shared-google-calendar-crypto.test.ts` with 7 tests using `vi.resetModules()` + dynamic `await import()` to re-read `ENCRYPTION_KEY_HEX` (the module captures env at import time). Covers previously-blocked paths:
- encryptToken/decryptToken round-trip (ASCII + unicode + differing nonces).
- Invalid hex key throws in hexToBytes.
- getValidAccessToken: no token record → null, happy path refreshing token + DB update, refresh API failure propagates error.
Coverage: 65.21 → **100 lines / 91.66 branches / 93.33 functions**. Threshold: 100/98/93/91.

### D020: Fase 1 — outbound-sender covered (2026-04-14)
Added 2 tests to `tests/unit/shared-outbound-sender.test.ts` closing remaining branches:
- Multi-chunk send with non-zero delays between chunks (previously line 158 not exercised).
- text_first ordering with audio enabled — text sends, then audio scheduled in background via setTimeout (lines 209-218, only partial — setTimeout callback itself is fire-and-forget, lines 213-216 inside).
Coverage: 90.72 → **96.77 lines / 93.54 branches**. Threshold: 96/95/80/93.

### D019: Fase 1 — ai-action-executor threshold locked (2026-04-14)
Confirmed coverage at 94.27 lines / 85.52 branches / 88.37 functions / 93.91 stmts for the 1,323-line Copilot action dispatcher. Remaining gap is mostly `descriptionFn` arrows in `ACTION_HISTORY_MAP` that are unreachable by design: the log-to-lead_history skip check `STAGE_AI_ACTIONS.includes(actionType)` short-circuits before calling them for `advance_stage`, `advance_confirmation_stage`, `automation_qualify`, `automation_disqualify`, `update_pipeline_stage` (PG triggers handle stage logging). No new tests; threshold ratcheted at current state to freeze regression. Threshold: 94/93/88/85.

### D018: Fase 1 — lead-service at 100% (2026-04-14)
Added `tests/unit/lead-service-branches.test.ts` with 19 tests using a scripted supabase mock (`scripted()` helper) that allows injecting per-table step-by-step responses including errors. Covers all uncovered branches:
- Search errors: phone error logged + falls through to email search; email error logged too.
- Create path branches: isShadow=true (no pipe_whatsapp insert), sdrId sets sdr_id + responsible_id, pushName fallback, 'WhatsApp <last4>' fallback.
- pipe_whatsapp insert throwing swallowed (best-effort).
- Race condition retry: 23505 via phone then retry find; 'duplicate' message via email retry.
- Non-duplicate create error returns null.
- associateMessagesToLead: normalized_phone update, raw-phone fallback, error path logged.
- promoveShadowLead: lead not shadow → false, lead not found → false, update error → false, default pipe_whatsapp (with sdrId), pipe_confirmacao branch, pipe_propostas branch, thrown error caught → false.
Coverage: 69.44 → **100 lines / 94.05 branches / 100 funcs**. Threshold: 100/100/100/94.

### D017: Fase 1 — workflow-condition-evaluator at 100% (2026-04-14)
Added `tests/unit/workflow-condition-evaluator-branches.test.ts` with 14 tests for `evaluateCondition` and private helpers (the pure `compare()` function was already 100% covered by the existing `workflow-condition-evaluator.test.ts`). Covers:
- Lead not found → false.
- Field resolution: default lookup, `stage` → pipe_whatsapp (+ empty fallback), `score` → qualification_score (+ 0 default), unknown field returns undefined.
- Tags field: joined tag names, empty list, null tag name skipped.
- Custom fields: found full round-trip, field not defined, value row missing, organization_id missing.
Coverage: 54.07 → **100 all metrics**. Threshold: 100/100/100/100.

### D016: Fase 1 — followup-sender at 100% (2026-04-14)
Rewrote `tests/unit/shared-followup-sender.test.ts` (was 2 tests, now 10). Fixed broken `smartSplitMessage` mock (object `{chunks, delays}`, not bare array). Covers: missing env (both vars + just URL), single-chunk happy path with DB asserts (whatsapp_messages, copilot_followup_execution_log, conversation_context_summary upsert), phone normalization (with/without 55, non-digit chars stripped), incremented followup_count over existing ctx, multi-chunk send w/ delays, typing indicator throw (best-effort), all-chunks-fail, one-of-two-chunks-fail.
Coverage: 18.75 → **100 all metrics**. Threshold: 100/100/100/100.

### D015: Fase 1 — lead-webhook covered (2026-04-14)
Brought the public ingress endpoint under test. Techniques:
- Mocked `https://deno.land/std@0.168.0/http/server.ts` `serve` to capture the handler and `_shared/sentry.ts` `withSentry` as identity, so module-load side-effects don't block.
- Mocked `createClient` to return a test-configurable supabase mock; `lead-service`, `webhook-utils`, `campaign-distribution`, `logger` mocked.
Added `tests/unit/lead-webhook.test.ts` with 50 tests covering:
- CORS (OPTIONS 200), auth (missing + wrong key → 401).
- Validation: no phone/email, non-UUID org/assigned/campaign/stage, invalid ISO meeting_date, whitespace sanitization, custom_fields > 100.
- Tag normalization: array, JSON string, simple string, malformed JSON → single-tag, > 50 rejected.
- Origin mapping: 19 source variants (meta_ads/Facebook/instagram/tiktok/google_ads/landing_page/site/remarketing/Indicação/referral/evento/event/prospeccao_ativa/prospeccao/outbound/whatsapp/calendly/cal.com/unknown_source).
- update_existing_if_match: true, string "true", getOrCreateLead null → 500, default create path.
- place_in_pipe: whatsapp new + existing, confirmacao with meeting_date, propostas new.
- place_in_campaign: campaign not found, stage not in campaign, new insert w/ SDR/Closer distribution, update existing entry.
- No organization found → 400. Catch block: invalid JSON body → 500.
- Custom field values saved (round-trip through lead_custom_fields + lead_custom_field_values).
Coverage of `lead-webhook/index.ts` from 0% (not in scope) → **83.76 lines / 71.47 branches / 82.78 stmts**. Functions % lower (55) because background fire-and-forget arrow fns run after response returns and aren't captured by the sync mock. Threshold: 83/82/55/70.

### D014: Fase 1 — workflow-action-handler.ts covered (2026-04-14)
Added `tests/unit/shared-action-handler-branches.test.ts` with 29 targeted tests (1412-line module). Filled gaps in:
- **resolveVariables**: standard lead vars, time-based (saudacao/data_hoje/hora_atual), team members (sdr/closer/responsavel/responsavel_telefone), org name, data_reuniao, valor_proposta (BRL formatted), AI summary vars, custom fields `{{custom.x}}`, executionContext override path, missing lead fallback.
- **handleMoveStage**: all 5 pipe types (whatsapp/confirmacao/propostas/upsell_base/upsell_gestao) × {update existing, insert new}. Custom pipeline: stage not found, first move insert, is_final_positive auto-transition to standard pipe (propostas) and to another custom pipeline.
- **handleMoveCampaignStage**: missing campaignId, stage not found, ilike name resolution, direct stageId.
- **handleGenerateAiMessage**: missing OPENROUTER_API_KEY, HTTP 500 response, empty content, thrown fetch error, custom aiOutputVariable stored in executionContext.
Coverage: 81.61 → **92.99 stmts**, 71.01 → **82.1 branches**, 83.3 → **95.82 lines**. Threshold ratchet: 95/92/100/82.

### D014: Security agent added to team (2026-04-15)
Team expanded from 9 to 10 agents. New `agent-security` — Senior Security Engineer with veto power over merges/deploys touching sensitive surface. Domain: SAST/SCA/secrets scanning, RLS review, auth hardening, multi-tenant isolation, LGPD, threat modeling (STRIDE), LLM security (Copilot prompt injection), supply chain. Skill in `.claude/skills/agent-security/SKILL.md`. Threat model in `.specs/codebase/SECURITY.md`. Conductor updated with triggers and sensitive-feature pipeline: Architect → Security (threat model) → DBA → Backend → Security (RLS + auth review) → Frontend → QA → Security (final gate) → Infra. Obsidian notes in `Agentes/Security.md`, ADR-2026-04-15, feature note `06 — Features/Seguranca/`. CLAUDE.md tabela e roteamento atualizados.

### D013: Fase 1 — workflow-trigger.ts covered (2026-04-14)
Added `tests/unit/workflow-trigger-branches.test.ts` with 16 tests for previously untested exports:
- `fireStageChangedTrigger` — delegates to fireTrigger with optional fields.
- `processCronTriggers` — empty list, no cron_expression, matching `*` expression, range `N-M`, step `*/N`, comma-separated, malformed (<5 parts), non-matching literal minute, DB error.
- `fireTrigger` — catch block (supabase.from throws), initial select error, insert error, happy path w/ 2 matching workflows inserted, filtering out non-matching workflows before insert.
Coverage: 63.02 → **100 lines**, 70.81 → **92.97 branches**, 50 → **100 functions**. Threshold ratchet: 100/94/100/92.

### D012: Fase 1 — workflow-executor.ts covered (2026-04-14)
Added `tests/unit/workflow-executor-branches.test.ts` with 26 tests targeting uncovered branches of the DAG engine:
- webhook_call: missing URL fail, HTTP 500 continues, success w/ body template + outputVariable, GET skips body.
- wait_response resume: `_wait_resolved=timeout` follows timeout edge; `_wait_resolved=replied` follows replied edge + clears context markers.
- split_ab: `variants[]` format, reused sticky assignment, legacy `source-a` handle contains match, orphan split w/ no matching edge.
- time_window / wait_business_window: inside vs outside window (paused). Uses hoisted `mockNextSendTime` with per-test override.
- delay: short (inline), long (paused), randomized (min/max).
- assign_responsible: manual, random, round_robin w/ no members (fails), member filter.
- Error paths: goto to missing target, unknown node type (skip+continue), action rejects (catch→fail), action returns success:false (fail).
- end node terminates; resume from `currentNodeId` skips trigger.
Coverage: 54.07 → **92.6 lines**, 53.04 → **80.64 branches**, 61.9 → **90.47 functions**. Threshold ratchet: 92/91/90/80.

### D011: Fase 1 — user-auth.ts covered (2026-04-14)
Rewrote `tests/unit/shared-user-auth.test.ts` with a configurable createClient mock (hoisted `mockState`) so happy paths were testable. Coverage: 47.22 → **98.48 lines**, 38.35 → **94.52 branches**, 75 → **100 functions**. Paths covered: token extraction (3 sources + empty), master-only auth, admin+member+forbidden, fallback to first active team_member, organization_id from body, internal API key (match/wrong/missing orgId/ignored when flag off), requireAdmin allow+403, resolvePermission full cascade (master, no membership, admin, override true/false, role fallback, default deny). vitest.config.ts threshold set to 98/98/100/90.

### D010: Fase 1 — permission_engine covered (2026-04-14)
Uncovered branches on `_shared/permission_engine.ts` fully filled in `tests/unit/shared-permission-engine.test.ts`:
- All `ACTION_TO_FEATURE` keys (edit_workflow, manage_team, manage_copilot, send_message) × {feature missing, admin_only, default deny, member override true/false}.
- `delete_lead` via `checkOrgPermission`: individual override enabled/disabled, role fallback, default deny.
- Legacy matrix: create_lead default-allowed, view_lead/export_leads/trigger_campaign/import_leads each with deny and allowed_* variants.
- `move_pipe_record` with resourceId allow+deny and without resourceId (fallback).
- `canUserAccessFeature` edge cases: missing feature, admin_only, override true vs default_value=false.
Coverage bump: 53.12 → **95.31 lines**, 45.45 → **97.72 branches**, 57.14 → **85.71 functions**.
vitest.config.ts thresholds ratcheted to 95/95/85/95.

### D009: Coverage roadmap — Fase 0 shipped (2026-04-14)
Starting point: 64.59 stmts / 56.15 branches / 66.03 funcs / 69.48 lines on src+_shared (vitest).
Fase 0 delivered:
1. Fixed failing `useCalendarSharing` test (added fetch stub in `tests/unit/hooks-final-zero.test.ts`).
2. Added ratchet thresholds in `vitest.config.ts`: global floor + strict gates on `src/lib/permissions.ts` (98/95/100/90) and `supabase/functions/_shared/permission_engine.ts` (baseline 52/51/55/44 — must ratchet up in Fase 1).
3. Stood up Deno test pipeline for edge functions: `supabase/functions/deno.json`, seed test `_shared/response.test.ts` (94.9 line cov), npm scripts `test:edge` + `test:edge:coverage`.
4. Hardened CI (`.github/workflows/test.yml`): removed `continue-on-error` on coverage, bumped Node 18 → 20, added `edge-function-tests` job, coverage artifacts uploaded.
Target roadmap: 85% lines global, 90% branches on fragile areas (permissions, copilot, webhooks), mutation testing on critical modules, contract tests on public webhooks, RLS isolation tests. Not "100% coverage" — correctness + gates, not numbers.

### D032: Fix "receita do mês" / MRR contract duration inflation (2026-04-17)
A RPC `get_dashboard_metrics` (latest: `20260911000000_fix_dashboard_conversion_rate.sql`) multiplicava `sale_value × contract_duration` para produtos MRR em `v_venda_total`, `v_venda_base_ativa` e `v_venda_primeiro_pedido`, resultando em "Faturamento do Mês" exibindo o valor TOTAL CONTRATADO ao longo do contrato (LTV-like) em vez das vendas que efetivamente entraram no mês. Ex.: MRR R$1.000 × 12 meses mostrava R$12.000 como receita do mês.

**Histórico**: `20260708000004` adicionou a multiplicação intencionalmente (confundiu semântica), `20260829400000` removeu, `20260911000000` regrediu ao reescrever a RPC para fix de `taxaConversao`.

**Fix**: migration `20260417100000_fix_receita_mes_mrr_contract_duration.sql` recria a RPC sem a multiplicação em `v_venda_total/base_ativa/primeiro_pedido`. `vendaMRR` e `vendaProjeto` já estavam corretos e permanecem intactos. `ticketMedio` deixa de ser inflado.

**Invariante**: `vendaTotal` = Σ sale_value das vendas do período, nunca × contract_duration. Se algum consumidor precisar de "valor total contratado" (LTV-like), deve ser campo separado explicitamente nomeado.

**Evidência**: `tests/sql/validate_receita_mes_mrr.sql` — fixtures MRR(1000, dur=12) + Projeto(5000) → `vendaTotal=6000` (não 17000), `vendaMRR=1000`, `ticketMedio=3000`. Roda em transação com ROLLBACK.

**Pendente**: aplicar migration no dev (`bcfadphgsibjzivtbjvc`) via SQL Editor, CLI bloqueada por Device Guard.

### L002: Duas semânticas de receita ("mês" vs "LTV contratado") são fáceis de confundir (2026-04-17)
A multiplicação `sale_value × contract_duration` para MRR faz sentido em contextos de LTV/forecast ("valor total contratado"), mas NUNCA no card "Receita do Mês" do dashboard. Já houve 3 migrations flipando a regra (`20260708` adicionou, `20260829` removeu, `20260911` regrediu). Regra operacional: se aparecer PR que mude agregação de receita, validar explicitamente qual semântica está sendo atingida antes de aprovar. Preferir campos separados e nomeados (ex: `valorTotalContratado` vs `vendaTotal`) em vez de reusar o mesmo campo com semântica diferente.

### D033: Fix pipe closer_id/sdr_id sync from leads → pipes (2026-04-17)
Trigger `trg_sync_responsible_from_lead_to_pipes` (definido em 20260826100000) sincronizava apenas `responsible_id` de `leads` para os pipes. Quando o closer de um lead era transferido via `leads.closer_id`, o `pipe_propostas.closer_id` ficava obsoleto. A RLS SELECT de pipe_propostas lê `closer_id` do próprio pipe — resultado: closer antigo continuava vendo o card, dois closers atendiam o mesmo lead, métricas individuais ficavam infladas.

**Fix**: migration `20260417110000_fix_pipe_closer_sdr_sync.sql` estende a função e o trigger para propagar `responsible_id`, `closer_id` e `sdr_id` de `leads` para todos os pipes aplicáveis. Backfill histórico corrige drift existente. Bloco de validação falha se drift > 0 após backfill.

**Frontend defensivo**: `PipePropostas.tsx` e `PipeConfirmacao.tsx` aplicam `filterResponsible = teamMemberId` como default one-shot para role `member` (flag `membroDefaultApplied` persiste a decisão). Admin/Master começam com "all".

**Evidência**: `tests/sql/validate_pipe_closer_sync.sql` (sync) + `tests/sql/validate_pipe_closer_rls.sql` (RLS end-to-end com impersonation via `request.jwt.claims`). Ambos rodados contra dev `bcfadphgsibjzivtbjvc` e passaram. Build ok, 2543 tests pass, zero regressões.

**Invariante**: `pipe_propostas.closer_id ≡ leads.closer_id`, `pipe_confirmacao.{sdr_id, closer_id} ≡ leads.{sdr_id, closer_id}`, `pipe_whatsapp.sdr_id ≡ leads.sdr_id`. Manutenção via trigger após esta fix.

**Produção (`jsjsmuncfkbsbzqzqhfq`) NÃO foi tocada** — migration pronta para aplicar quando CTO autorizar.

### L003: RLS em pipes precisa espelhar leads ou usar subquery (2026-04-17)
Se a RLS usa colunas DO PIPE (ex: `pipe_propostas.closer_id`) e o pipe não está sincronizado com `leads`, nascem vazamentos de visibilidade. Duas opções: (a) garantir sync via trigger (escolhida — menor impacto em performance), (b) fazer a RLS ler de `leads` via subquery (adiciona custo por linha). Se aparecer PR mudando `closer_id`/`sdr_id`/`responsible_id` em tabelas de pipe, verificar se o trigger cobre o caminho ou se é necessária nova policy.

### D034: Outbound idempotência — Task #3 shipped (2026-04-20)
Ciclo de idempotência `whatsapp_messages` fechado. Tasks #1/#2 (sessão anterior) fizeram `outbound-sender.ts` e `workflow-action-handler.ts` persistirem com `message_id = key.id` da Evolution e `onConflict: "message_id,instance_id"`. Task #3 converteu os 3 `insert`s restantes em `evolution-webhook/index.ts` (`:978` messages.upsert, `:1251` agent TTS, `:1300` agent text) para `upsert` com `ignoreDuplicates: true` (política conservadora — outbound/copilot é fonte de verdade para `content` humanizado + `sent_by_ai`). Mantido `:1461` (send.message) com `ignoreDuplicates: false` por precisar atualizar `media_url` pós-MESSAGES_UPSERT. Removido swallow string-match `.includes("duplicate")` — dead code.

**Invariante**: toda escrita em `whatsapp_messages` (qualquer edge function) usa `upsert` com `onConflict: "message_id,instance_id"`. UNIQUE constraint existe desde `20260127000000_add_whatsapp_messages.sql:37`.

**Evidência**: `tests/unit/evolution-webhook-idempotency.test.ts` — 4 contract asserts via grep no source (nenhum `.insert(`, todo upsert tem onConflict correto, 3 paths usam ignoreDuplicates:true, zero swallow por string-match). `npm run test:unit` = 2548 passed, zero regressão. `tsc --noEmit` = 0 erros.

**Pendente**: deploy `evolution-webhook` em prod após review (`supabase functions deploy evolution-webhook --project-ref jsjsmuncfkbsbzqzqhfq`).

### D035: Outbound idempotência — Task #4 shipped (2026-04-20)
Invariante global fechada. 9 pontos em 5 edge functions convertidos de `.insert()` para `.upsert()` com `onConflict: "message_id,instance_id"`:
- `_shared/followup-sender.ts:90` (false), `_shared/ai-action-executor.ts:1294` (false).
- `sz-chat-webhook:359` (true, inbound), `:558` (true, agent reply).
- `process-scheduled-user-messages:144` (false), `campaign-rule-dispatch:373` (false), `:716` (false), `pipe-rule-dispatch:419` (false), `:764` (false).

Política consolidada: webhook echo handlers = `ignoreDuplicates:true`; dispatcher/sender = `false`. Exceção única anchorada por marker `SEND_MESSAGE_MEDIA_REFRESH` no `evolution-webhook` send.message handler (refresh de media_url).

Contract test global em `tests/unit/whatsapp-messages-idempotency-contract.test.ts` (5 asserts AST-grep) garante invariante em CI para qualquer PR futuro. Deploy 8 funções em prod.

**Evidência**: `npm run test:unit` = 2554 passed (+5 vs. baseline Task #3), `tsc --noEmit` = 0, 9 pontos com grep zero de `.insert(` em `whatsapp_messages` no projeto.

### D050: Revisão arquitetura automações + copilots (2026-04-26)

CTO solicitou revisão profunda. Conduzida via 4 agentes paralelos (AI, Automation, DBA, Backend) + telemetria 30d real do prod.

**Achados topo:**
- 3 engines paralelos (workflows + pipe_rules + campaign_rules) — duplicação estrutural
- 13 bugs identificados; 6 já corrigidos pré-revisão (C1, C4, A2, A7, M3, M4)
- **115/115 conversas (100%)** com transferência human dessincronizada (`leads.ai_disabled=true` mas `conversations.state≠WAITING_HUMAN`) — RPC atomic faltando
- 24.4k erros `lead_origin "web"` (enum não aceita) em 30d
- 11.7k erros `outbound_dispatch_log` tabela inexistente em 30d
- 10.9k erros action_type desconhecido em 30d
- 209 pares de mensagens assistant duplicadas em <60s (race condition)

**Decisões:**
1. **Não reescrever copilot do zero** — refactor cirúrgico em 5 fases com feature flag `copilot_engine_version` (Trilha 3.B)
2. **Unificar engines** — workflow vira fonte única, pipe/campaign rules viram macros (Trilha 3.A, absorção em 4 fases, sem big-bang)
3. **Ondas:** Onda 1 (fix bleeding ~30h) → Onda 2 (visibility ~25h) → Trilha 3 (4-8 semanas estratégica)

**Specs criadas:**
- `.specs/features/automations-onda-1/` — 20 tasks P0/P1/P2/P3
- `.specs/features/automations-onda-2/` — 19 tasks (5 fases A-E)
- `.specs/features/automations-trilha-3/` — 37 tasks (sub-features 3.A + 3.B)

**Próximo:** CTO confirma kickoff Onda 1 P0 (fixes táticos ~9h, 5 paralelizáveis).

**Telemetria SQL salva em:** `/tmp/torque_telemetry/q*.sql`

### D051: Trilha 3 (A+B) + Ondas 1+2 deploy completo (2026-04-26)

Sessão única massiva. Tudo em prod (jsjsmuncfkbsbzqzqhfq) sem incidente.

**Onda 1 (P0+P1+P2+P3):**
- 7 migrations corrigem 47k+ erros/30d (lead_origin web, outbound_dispatch_log, action types desconhecidos)
- Backfill 125 conversas drift transfer → 0
- RPCs atomic (transfer_lead_to_human, increment_conversation_turn)
- Per-org cap em claim_workflow_executions + claim_pending_ai_actions
- Idempotency conv_msgs sha256+bucket5min
- Bug fix invoke_process_scheduled_user_messages 401 (-150 erros/h)

**Onda 2 (visibility):**
- system_alerts + audit_log tables + 4 triggers
- runtime_logs perf cols (duration_ms, prompt_tokens, completion_tokens, llm_model)
- 6 edge functions instrumentadas
- Webhook circuit breaker auto-disable + alert
- Dead-letter pattern detector
- Frontend /master/automation-health (7 tabs) + AlertsBanner reusable

**Trilha 3.B (refactor copilot):**
- 17 funções pure extraídas pra _shared/copilot/* (3314→2828 LOC, -14.7%)
- 88 testes unit copilot 100% PASS (state-machine, dispatcher, helpers, cache, DB loaders)
- Feature flag organizations.copilot_engine_version v1/v2 + UI master toggle
- Decisão: buildDynamicPrompt + buildDynamicTools ficam em agent-engine (orchestrator methods)

**Trilha 3.A (unificação engines):**
- Cols workflows.wrapper_for + wrapper_source_id
- 2 RPCs PL/pgSQL convert_pipe_rule_to_workflow + convert_campaign_rule_to_workflow
- Dispatchers viram shim (cancelam items de rules com wrapper)
- Migration converteu 1 campaign rule ativa em wrapper (workflow 237a3c1e, 8 nodes)
- A4 cleanup: +30d soak

**Stats:**
- 13 migrations (20260426000000 → 20260426050000)
- 9 edge functions deployed
- 8 RPCs novas
- 2 tabelas novas
- 11 cols agregados
- 4 triggers audit
- 9 módulos copilot extraídos (1210 LOC)
- 88 tests novos
- 1 página frontend nova
- 47k+ erros eliminados

**Push:** develop + main → fd37f9c

**Pendências:**
- 17 mocks Uazapi (débito independente)
- 45 cron 401 residual (-40% vs baseline, investigação separada)
- A4 cleanup +30d
- B4 piloto quando v2 divergir
- buildDynamic* extração se virar útil (não bloqueante)

**Docs criados:**
- Obsidian/.../07 — Changelog/2026-04-26-trilha-3-completa.md
- Obsidian/.../04 — Decisões/ADR-2026-04-26-trilha-3-unificacao-engines-refactor-copilot.md
- Obsidian/.../06 — Features/Admin/Automation Health.md
- .specs/features/automations-trilha-3/{T3A-A1-AUDIT,T3B-EXECUTION-LOG,T3B-FINAL-REPORT}.md

## Deferred Ideas

- S1+S3 security fixes -- deferred until T2+T5 test suite is in place

## Preferences

- CTO prefers world-class engineering standards -- no mediocre work shipped
- Dark-first design, editorial typography, cinematic UI sensibility
- Portuguese (BR) for user-facing content and business logic comments
- English for technical documentation and code
