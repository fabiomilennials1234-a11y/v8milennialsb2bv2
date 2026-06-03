# copilot-v2-simulate 🔒

Endpoint do **simulador dry-run** do Copilot v2 (Slice 9). Wrapper fino sobre `runSimulatorTurn` (espinha de cognição INALTERADA + executor dry-run).

## Contrato
`POST { archetype, message, config? , capabilities?, rubricRules?, agentId?, seed? }` → `{ trace, writes, reply, model }`.
- **CREATE (rascunho):** passar `config` (CopilotV2Config com `capabilities`) no body → testa estado não-salvo do wizard.
- **EDIT (salvo):** passar `agentId` → carrega `copilot_v2_config` + `copilot_v2_rubric` do DB (RLS org-scoped via client do user).

## Invariantes
- **Zero escrita.** Executor dry-run nunca recebe supabase; writes viram `{would_execute:true}` no `trace`/`writes`.
- **Gates reais disparam** (capability-gate + introspect-guard rodam dentro de `runTurn` antes do executor).
- **Modelo real por arquétipo** (decisão CTO: fidelidade > custo no sim interativo).
- **Org nunca do payload.** No modo rascunho não há leitura do agente no DB; no modo salvo, RLS escopa por org.
- **Reads híbridos:** `seed.stages/fields` podem vir ao vivo (caller); `lead-360/contact-status` do lead-semente (sem PII real). Hybrid live-fetch de stages/fields = follow-up.

## Deps
`simulator-turn.ts`, `dry-run-executor.ts`, `dry-run-trace.ts`, `config-schema.ts`, `capability-gate.ts`, `openrouter-client.ts`. Lógica testada em `tests/unit/copilot-v2/{simulator-turn,dry-run-executor,dry-run-trace}.test.ts`.

## config.toml
`verify_jwt = false` (preflight OPTIONS); JWT do user via client.
