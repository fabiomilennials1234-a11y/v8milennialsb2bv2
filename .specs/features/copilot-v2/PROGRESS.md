# Copilot v2 — Progresso & Próximos Passos

**Atualizado:** 2026-05-31 · **Branch atual:** `feat/copilot-v2-slices-4-6-7-tables`
**ADR:** `docs/adr/0002-copilot-v2-architecture.md` · **SPEC:** `.specs/features/copilot-v2/SPEC.md`

> Estado vivo da reconstrução. v2 é **isolado da v1** (tabelas `copilot_v2_*`, edge fn `agent-runtime-v2`, módulos `_shared/copilot-v2/`). Nada ativado em prod — v1 100% operante. Rollout por-org via `copilot_v2_agents.is_active`.

## Feito (mergeado em `develop`)

| PR | Conteúdo |
|----|----------|
| #593 | Foundation + Slices 1-4 + roteamento 10 — cores puros + cognição |
| #594 | Tool executor foundation + 4 tools DB-backed |

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

✅ **Implementadas** (schema real): `get_lead_360`, `list_pipeline_stages`, `get_conversation_history`, `move_lead_stage` (pipes sistema), `set_qualification_tier` (rubric-engine + `copilot_v2_rubric` → escreve `leads.qualification_tier`).
🔴 **`not_implemented`** (gating honesto, sem NOOP) — bloqueadas por tabela/origem:
| Tool | Bloqueio |
|------|----------|
| `search_knowledge` | ingestão+embeddings (Slice 7) — tabela `copilot_v2_knowledge` JÁ em prod |
| `send_media` | WhatsApp adapter — tabela `copilot_v2_send_media` JÁ em prod |
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
