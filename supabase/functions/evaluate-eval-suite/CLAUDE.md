# evaluate-eval-suite 🔒

Endpoint da **eval-suite** do Copilot v2 (Slice 9). Wrapper fino sobre `runEvalSuite`.

## Contrato
`POST { archetype? }` → `{ summary:{total,pass,fail,skip,error}, results: EvalRunResult[] }`.
Sem `archetype` → roda todos os arquétipos com casos habilitados.

## Fluxo
1. Carrega `copilot_v2_eval_cases` habilitados (RLS org-scoped via client do user) — `loadEvalCases`.
2. Pré-resolve, por arquétipo presente nos casos, o agente salvo (`copilot_v2_agents`→`config`+`rubric`) → `agentFor` síncrono.
3. `runEvalSuite` com modelo **real** por arquétipo (cache por (case,model) = follow-up).
4. Retorna summary + por-caso (PASS/FAIL/SKIP/ERROR).

## Invariantes
- **Zero escrita** (executor dry-run). **Org nunca do payload** (RLS escopa).
- Critério: qualificador tier exato (rubrica); vendedor 1º write tool == expected; carteira semântico → SKIP (adiado).

## Follow-ups (MVP)
- Persistir resultados em `copilot_v2_eval_runs` (service_role write) — tabela já criada na migration, persistência adiada.
- Cache de resposta do LLM por (case_id, model) p/ gate de CI determinístico (smoke usa FakeLlm).

## Deps
`eval-runner.ts`, `eval-cases-loader.ts`, `simulator-turn.ts`, `openrouter-client.ts`. Lógica testada em `tests/unit/copilot-v2/{eval-runner,eval-cases-loader,eval-suite-smoke}.test.ts`. Migration `20260602230000_copilot_v2_eval_cases.sql` (committed-not-applied).

## config.toml
`verify_jwt = false` (preflight OPTIONS); RLS org-scoped.
