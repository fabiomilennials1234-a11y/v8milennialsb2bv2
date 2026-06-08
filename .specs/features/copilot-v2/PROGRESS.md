# Copilot v2 — Progresso & Próximos Passos

**Atualizado:** 2026-06-08 · **Branch atual:** `feat/copilot-v2-slices-4-6-7-tables`
**ADR:** `docs/adr/0002-copilot-v2-architecture.md` · **SPEC:** `.specs/features/copilot-v2/SPEC.md`

> Estado vivo da reconstrução. v2 é **isolado da v1** (tabelas `copilot_v2_*`, edge fn `agent-runtime-v2`, módulos `_shared/copilot-v2/`). Nada ativado em prod — v1 100% operante. Rollout por-org via `copilot_v2_agents.is_active`.

## Wizard redesign — toggle + 2 abas (Base/Especificidades) (2026-06-08)

Redesenho do fluxo de criação/edição (mata o stepper de 12 seções planas; unifica criar/editar num layout único). Decisões travadas pelo CTO:
1. **Toggle de personalidade = navegação por rota** `/copilot/v2/:archetype` (radiogroup desktop com underline gold `topnav-item-active::after` + status Ativo/Rascunho/Não criado; mobile vira Select). Dirty-guard: `window.confirm` ao trocar com alterações não salvas.
2. **Aba BASE (de fábrica, read-only)** — selo "Verificado pela Torque", **tom em cards** com micro-exemplo (único editável da base), **capabilities como chips read-only** (não switches), accordion "Garantias" (5 itens; "O que ele nunca faz" em **verde** `text-success`). Conteúdo = nova constante front `src/modules/copilot/lib/copilot-v2-base-narrative.ts` (`BASE_NARRATIVE`) — **não derivada por regex**; smoke-test `base-narrative-hash.test.ts` trava o FNV dos 3 prompts (muda prompt → re-review forçado).
3. **Aba ESPECIFICIDADES (editável)** — slots de `wizardSections.ts` reagrupados em 5 grupos (Sua empresa · Produtos+particularidades ★ · Quem você atende · Como vender · Observações). NADA sumiu; tom+capabilities saíram pra BASE. `*` GOLD, validação on-blur.
4. **Capabilities travadas por arquétipo (v1)** — cliente NÃO edita. Front envia o whitelist inteiro `true`; **server re-deriva via `defaultCapabilitiesFor(archetype)` em `save-config-flow.ts`** (payload do cliente ignorado). Gate "≥1 capability" sempre satisfeito.
5. **NOVO slot `companyParticularities?: string`** (≤1000, opcional) — separado de `products`. Injetado nos 3 base-prompts como seção `{{company_particularities}}` (subordinada a `commercial_policy`). `slots` é JSONB → sem migration; agentes existentes ficam sem ele (ok).
6. **Simulador vira a 3ª aba `Testar`** (criar E editar; aceita rascunho incompleto com nudge).

**Re-bless consciente dos fingerprints:** o texto dos 3 base-prompts mudou (nova seção) → eval-golden.json + redteam-golden.json regenerados (`qualificador fa1cda15d2dd930c · vendedor f3fefc8eab904cd0 · carteira 4644b50761a3b7e8`). Casos golden NÃO setam companyParticularities → comportamento inalterado; eval+redteam gate **verdes**.

**QA:** `tests/unit/copilot-v2/` 86 files / 638 tests pass. tsc 0 erros · build OK · eslint 0 erros nos arquivos novos. Verificado ao vivo (dev, Milennials qualificador ativo) via Playwright: toggle+3 abas, Base read-only com selo/tom-cards/chips/accordion verde, Especificidades 5 grupos + companyParticularities, agente ativo carrega sem quebrar.

## W13 — Industrialização do eval (PR aberto → develop, 2026-06-03)

Primeira das 4 waves must-have do ⛳ portão de produção (Fase D). **Não** "ligar eval no CI" (a Slice 9 já fazia isso via `eval-suite-smoke`); W13 **industrializa** o dataset + fecha o loop judge→dataset + garante determinismo.

**Decisões do CTO:** D1 cognition goldens (os 5 incidentes v1 ficam regressões de harness, não eval-cases) · D2 judge→dataset **manual-curado** (candidato `enabled=false`) · D3 fixture commitado `eval-golden.json` (seed SQL gerado dele) · D4 `trace_id` nullable em eval_runs (forward-compat) · D5 gate path-filtered pré-merge.

**Entregue (TDD, reusa `runEvalSuite`/`createFakeLlm` verbatim):**
- `eval-fingerprint.ts` — FNV-1a da superfície de eval (base prompt + modelo + tool-registry) por arquétipo; o fixture trava os fingerprints → editar prompt/modelo/tool força re-bless.
- `llm-cache.ts` — `makeCachedLlm` (respostas commitadas por (case_id, model)); cache-miss = throw (nunca LLM ao vivo no CI).
- `eval-golden.json` — dataset golden de cognição por arquétipo (fonte única) + respostas cacheadas + fingerprints.
- `eval-dataset-gate.test.ts` — gate hermético sobre o dataset; **bloqueia regressão** (verificado: flip de tier → vermelho). + `eval-seed-drift.test.ts` (paridade fixture↔seed).
- `judge-to-eval-case.ts` — mapper puro rejeição-do-judge → candidato `enabled=false` (+ `candidateToEvalCaseRow`).
- `eval-run-row.ts` / `eval-run-persist.ts` — persiste `eval_runs` (org do contexto, `trace_id` nullable).
- Edge wiring: `evaluate-eval-suite` persiste runs (service_role, best-effort); `copilot-v2-worker` `judgeOutput` promove violação real → candidato (best-effort, idempotente, nunca quebra o turno).
- CI `copilot-v2-eval.yml` — gate path-filtered, pré-merge, em PRs a develop/main que tocam copilot-v2 (herma, sem DB/secret).
- Migrations **committed-not-applied**: `20260603120000_..._eval_seed_golden` (org-guarded, idempotente) + `20260603120100_..._eval_runs_trace_id`.

**Verificação:** copilot-v2 unit **64 files / 442 pass**; eslint 0 err (0 warn nos novos); tsc ratchet 0 novos. (Full `tests/unit/` tem 42 falhas **pré-existentes** em develop, fora de copilot-v2.)

**Follow-up explícito (fora do gate):** UI de **curadoria** dos candidatos judge→dataset (flipar `enabled=true`) + espelho FE `JUDGE_CATEGORIES` + contract-lock — net-new, design. Até lá, curar via SQL. Eval semântico de `expected_action` (carteira).

## Feito (mergeado em `develop`)

## 🟢 RUNTIME LIVE EM PROD (2026-06-01) — inerte até ativar

Deployado e smoke-testado: `agent-runtime-v2` (border) + `copilot-v2-worker` (cron 1/min). Pipeline borda→fila→worker→cognição→WhatsApp roda end-to-end (smoke 2x verde, trace persiste). Agente Qualificador Milennials criado (`eb38b52f`, **is_active=FALSE** — silencioso). v1 100% on.

**Pra ligar de verdade (Task #7, falta):** (1) apontar 1 instância WhatsApp de teste pro `agent-runtime-v2` (config Uazapi externa); (2) `is_active=true` + validar 1ª conversa real por trace; (3) wizard UI (Slice 8) pra criar/configurar sem SQL. Rollback = is_active=false.

| PR | Conteúdo |
|----|----------|
| #593 | Foundation + Slices 1-4 + roteamento 10 — cores puros + cognição |
| #594 | Tool executor foundation + 4 tools DB-backed |
| #600/#601 | Queue worker + live deploy (runtime ON) |

**Tabelas em PROD** (via MCP, verificadas):
- `20260531174908_copilot_v2_foundation`: `copilot_v2_agents`, `_config`, `_message_queue`, `_dlq`, `_dedup_locks`, `_pause_state`, `_turn_counters`, `_traces`, `_trace_steps` + 5 RPCs SECURITY DEFINER (dedup atômico, enqueue, pause phone-keyed, next_turn atômico).
- `20260531214954_copilot_v2_slices_4_6_7_tables`: `copilot_v2_rubric`, `copilot_v2_send_media`, `_agent_media`, `copilot_v2_knowledge`, `_chunks` (pgvector 1536d).
- Todas RLS deny-all default; org-scoped read em agents/config/traces/rubric/send_media/knowledge.

**Módulos `_shared/copilot-v2/` (133 testes TDD verdes, 17 módulos):**
- Borda/primitivos (Slice 1): `phone-normalizer` (fix 40% ai_disabled), `loop-detector` (+pingpong, fix Bertin), `human-pause` (fail-CLOSED), `message-debounce`, `dedup-lock`, `border` (orquestração fail-CLOSED), `trace-context`
- Cognição (Slice 2): `capability-gate`+budget, `introspect-guard`, `cognition-loop`, `model-selector`, `openrouter-client`, `base-prompts` (3 arquétipos Torque-owned), `prompt-builder`, `cognition-worker`
- Qualificação (Slice 4): `rubric-engine` (determinístico)
- Roteamento (Slice 10): `contact-status`
- Contrato/exec (Slice 3): `tool-registry` (front↔back travado), `tool-executor`

**Incidentes v1 cobertos como regressão:** human-pause phone-keyed, Bertin bot-loop, dedup race, increment_turn race, is_group — todos verificados em prod via RPC.

## Tool executor — estado por tool

✅ **Implementadas** (9/13, schema real): `get_lead_360`, `list_pipeline_stages`, `get_conversation_history`, `get_contact_status` (leads+`upsell_clients`+tier → NOVO/LEAD_NO_PIPELINE/QUALIFIED/CLIENTE_CARTEIRA), `list_custom_fields` (`lead_custom_fields`), `move_lead_stage` (pipes sistema), `set_qualification_tier` (rubric-engine → `leads.qualification_tier`), `fill_lead_field` (upsert em `lead_custom_field_values`, unique lead_id+field_id), `transfer_to_human` (pausa phone-keyed via RPC + payload de handoff).
🔴 **`not_implemented`** (gating honesto, sem NOOP) — 4 restantes, todas I/O pesado pra integração:
| Tool | Bloqueio |
|------|----------|
| `handoff_to_vendedor` | reassign + notificação (`notifications.user_id` NOT NULL → target-user da config) |
| `search_knowledge` | ingestão+embeddings Gemini (Slice 7) — tabela `copilot_v2_knowledge` JÁ em prod |
| `send_media` | WhatsApp adapter (envio real) — tabela `copilot_v2_send_media` JÁ em prod |
| `schedule_meeting` | Google Calendar |
| `schedule_meeting` | Google Calendar + `check_agenda_availability` |
| `transfer_to_human` / `handoff_to_vendedor` | notificação estruturada + reassign |
| `get_contact_status` | lógica leads+pipes+carteira |
| `list_custom_fields` / `fill_lead_field` | origem de campos custom |
| `move_lead_stage` (custom pipe) | `custom_pipe_entries.stage_id` |

## Próximos passos (ordenados)

### Garfo A — destravar tools (tabelas das slices)  ← EM ANDAMENTO
1. ✅ **Slice 4/6/7 tables** em PROD (migration `20260531214954`, via MCP): `copilot_v2_rubric`, `copilot_v2_send_media`+`_agent_media`, `copilot_v2_knowledge`+`_chunks` (pgvector 1536d). RLS verificada.
2. ✅ **`set_qualification_tier`** — rubric-engine + rubric table → escreve `leads.qualification_tier`.
3. ⏭️ `send_media` (resolve item de `copilot_v2_send_media` + delega envio ao adapter WhatsApp), `search_knowledge` (após pipeline de ingestão Slice 7 popular `_chunks`).
4. ⏭️ tools restantes: `get_contact_status` (leads+pipes+carteira), `list_custom_fields`/`fill_lead_field`, `schedule_meeting` (calendar), `transfer_to_human`/`handoff_to_vendedor` (notify+reassign).

### Garfo B — walking skeleton ao vivo (Tasks #6/#7)
4. **queue-worker** — drena `copilot_v2_message_queue` → resolve `ResolvedContext` do DB → `handleQueuedMessage` → envia WhatsApp + marca processed/retry/dlq + trace.
5. **wiring border** — `message-debounce` antes do enqueue; registrar `outgoing` (pro loop-gate funcionar).
6. **deploy** `agent-runtime-v2` (config.toml pronto) + **testes RLS cross-org** por tabela + **un-skip** `border-regression` contra prod.
7. **ativar Milennials** — `copilot_v2_agents.is_active` (1 arquétipo) + validar por trace/dry-run. v1 segue pras demais orgs.

### Depois (slices/waves restantes)
Slice 5 (guardrails: LLM-judge + input short-circuit), Slice 6/7 ingestão+RAG completos, Slice 8 wizard, Slice 9 simulador, Slice 11 proatividade, Slice 12 HITL, W1-W15. Ordem em `SPEC.md` linha ~170.

## Regras operacionais aprendidas
- **NUNCA `supabase db push`** — prod tem drift (8 migrations remote-only, incl `copilot_builder_*`). Aplicar migration isolada via **MCP `apply_migration`**.
- Integration tests rodam contra **PROD** (padrão do repo, service key hardcoded). Verificação de comportamento DB feita via **MCP `execute_sql`** quando sem deploy.
- Fail-mode travado: pausa/loop **fail-CLOSED**; dedup/rate-limit fail-closed.
- org_id SEMPRE do ctx/auth, NUNCA do payload/LLM.
